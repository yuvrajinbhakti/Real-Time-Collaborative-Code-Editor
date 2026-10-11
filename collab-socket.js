/**
 * The collaborative editing socket protocol, in one place.
 *
 * `server.js` and `dev-server.js` each used to carry their own copy of this
 * wiring. Keeping two copies of a protocol in step is a thing nobody actually
 * does, and they had drifted three separate ways by the time this was written:
 *
 *   - `ot-resync` existed only in `dev-server.js`, so the catch-up route was
 *     unreachable in production and every reconnect there threw away the work
 *     it had in flight. The chaos harness was pointed at the dev server and
 *     reported a catch-up rate the deployed service could not deliver.
 *   - `getAllConnectedClients` filtered out half-joined sockets in `server.js`
 *     only, so the dev server still drew the nameless avatars that fix removed.
 *   - `dev-server.js` still called `socket.leave()` with no argument, which
 *     joins a room literally named "undefined".
 *
 * Each of those was fixed once, in one file, by someone who had no reason to
 * know the other existed. The duplication was the bug; this module is the fix.
 *
 * What stays outside: HTTP routes, CORS, static files, clustering, Redis and
 * the AI review service. Those legitimately differ between the two servers.
 * Only the protocol lives here, and the protocol is the part that must not.
 */

const ACTIONS = require('./src/Actions');
const otRooms = require('./ot-rooms');
const metrics = require('./services/metrics');

/**
 * Wire an `io` instance for collaborative editing.
 *
 * Metrics are recorded unconditionally. Every function in `services/metrics` is
 * inert until `init()` has been called, so the dev server — which never calls
 * it — pays nothing and behaves exactly as it did before.
 */
function attach(io) {
    // Per-instance rather than module-level: the map is this server's view of
    // who is connected, and a second `io` would need its own.
    const userSocketMap = {};

    function getAllConnectedClients(roomId) {
        return Array.from(io.sockets.adapter.rooms.get(roomId) || [])
            .map((socketId) => ({ socketId, username: userSocketMap[socketId] }))
            // A socket in the room with no username has either not finished joining
            // or is in the middle of leaving — `disconnecting` clears the name while
            // the socket is still a member. Either way it is not a person to draw,
            // and drawing it is permanent: the client list is only ever pruned by a
            // DISCONNECTED event, and one has already been sent for a socket in that
            // state. That is where the nameless avatars came from.
            .filter((client) => Boolean(client.username));
    }

    io.on('connection', (socket) => {
        console.log('🚀 Socket connected:', socket.id);

        socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
            console.log(`👤 ${username} joining room ${roomId}`);
            userSocketMap[socket.id] = username;
            socket.join(roomId);

            // No document here. It is sent in reply to SYNC instead, because the
            // component that renders it mounts after the socket connects — sending
            // it on JOIN as well meant every client initialised twice, and the
            // second initialisation replaced the document while the collaborative
            // binding was already attached, which reported the replacement as an
            // edit and wiped the room.

            const clients = getAllConnectedClients(roomId);
            clients.forEach(({ socketId }) => {
                io.to(socketId).emit(ACTIONS.JOINED, {
                    clients,
                    username,
                    socketId: socket.id,
                });
            });
        });

        // The editor asks for the document when it is ready to receive it.
        // Emitting it on JOIN alone raced the client: the React component that
        // listens for it mounts after the socket connects, so the broadcast
        // could arrive before anything was listening and the editor stayed
        // empty. Asking is not subject to that ordering.
        socket.on(ACTIONS.SYNC, async ({ roomId }) => {
            // Wrapped because this handler is async: a rejection here is an
            // unhandled promise rejection, which Node treats as fatal. One client
            // asking for a room that cannot be loaded should not end the process
            // for everybody else in every other room.
            try {
                // Awaited because a cold room is read back from the store first.
                // Only this path awaits; operations stay synchronous so nothing can
                // interleave in the ordering.
                const opening = await otRooms.join(roomId, socket.id, userSocketMap[socket.id]);
                socket.emit(ACTIONS.INIT, opening);
            } catch (error) {
                console.error('[ot] sync failed:', error.message);
                socket.emit(ACTIONS.OT_ERROR, { reason: 'could not open the room' });
            }
        });

        /*
         * A reconnecting client asking what it missed.
         *
         * The cheap way back into a room. SYNC hands over a whole fresh snapshot,
         * which is correct but makes the client drop everything it had in flight
         * when the socket died; this hands back just the operations after the
         * revision it reached, so it can rebase what it was holding and keep it.
         *
         * Synchronous, unlike SYNC: a room that is already open is the only case
         * this answers, and `catchUp` says `resync` for every other — including a
         * revision the room has compacted past, and anything the client sends that
         * is not a revision this server issued. The fallback is the snapshot path,
         * so the worst outcome is the behaviour that existed before this route.
         */
        socket.on(ACTIONS.RESYNC, async ({ roomId, revision }) => {
            const result = otRooms.catchUp(roomId, socket.id, revision);

            if (result.error) {
                metrics.recordCatchUp('rejected');
                socket.emit(ACTIONS.OT_ERROR, { reason: result.error });
                return;
            }

            if (result.resync) {
                // Counted before the fallback runs, not after: this client has
                // already lost its unconfirmed work by this point, whether or not
                // re-opening the room succeeds.
                metrics.recordCatchUp('snapshot');
                try {
                    const opening = await otRooms.join(roomId, socket.id, userSocketMap[socket.id]);
                    socket.emit(ACTIONS.INIT, opening);
                } catch (error) {
                    console.error('[ot] resync fallback failed:', error.message);
                    socket.emit(ACTIONS.OT_ERROR, { reason: 'could not open the room' });
                }
                return;
            }

            metrics.recordCatchUp('caught-up');
            socket.emit(ACTIONS.MISSED, { missed: result.missed, revision: result.revision });
        });

        socket.on(ACTIONS.OPERATION, ({ roomId, message }) => {
            const startedAt = process.hrtime.bigint();
            const result = otRooms.operation(roomId, socket.id, message);
            const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

            // Three outcomes worth telling apart: applied, rejected (the client is
            // too far behind to rebase), and a duplicate resend that changed
            // nothing. A rising rejection rate is the signal that the retention
            // window is too small.
            metrics.recordOperation(
                result.error ? 'rejected' : result.broadcast ? 'applied' : 'duplicate',
                seconds
            );

            if (result.error) {
                socket.emit(ACTIONS.OT_ERROR, { reason: result.error });
                return;
            }

            // Broadcast before acknowledging. Acknowledging first lets the author
            // send its next operation against a revision the room has not finished
            // distributing, which silently loses one operation per collision — a
            // bug found in ot-core's own fan-out rather than predicted.
            if (result.broadcast) {
                socket.in(roomId).emit(ACTIONS.OPERATION, result.broadcast);
            }
            socket.emit(ACTIONS.ACK, result.ack);
        });

        socket.on(ACTIONS.CURSOR, ({ roomId, selection, revision }) => {
            const username = userSocketMap[socket.id];
            otRooms.cursor(roomId, socket.id, { selection, revision, username });
            socket.in(roomId).emit(ACTIONS.CURSOR, {
                socketId: socket.id,
                selection,
                revision,
                username,
            });
        });

        socket.on('disconnecting', () => {
            const rooms = [...socket.rooms];
            rooms.forEach((roomId) => {
                otRooms.leave(roomId, socket.id);
                socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
                    socketId: socket.id,
                    username: userSocketMap[socket.id],
                });
            });
            delete userSocketMap[socket.id];
            // No `socket.leave()` here. With no argument it leaves a room called
            // "undefined"; disconnecting removes the socket from its rooms anyway,
            // so the call was doing nothing except looking like it did something.
        });
    });
}

module.exports = { attach };
