/**
 * The document, on the server, for real this time.
 *
 * ## What this replaces
 *
 * The previous sync was one line each way. Every keystroke sent the *entire*
 * document (`instance.getValue()`), and every arriving message replaced the
 * *entire* document (`editor.setValue(code)`). The server held no state at all —
 * it rebroadcast whatever it was handed, and a new joiner was brought up to date
 * by asking an existing client to mail them its text.
 *
 * That is not a merge strategy that could be wrong; it is the absence of one.
 * Two people typing within one round trip of each other do not merge badly, they
 * overwrite each other outright: the second message to arrive wins the whole
 * file, and everything the other person typed in that window is gone. It also
 * meant `setValue` on every remote keystroke, which resets the cursor, the
 * scroll position and the undo history of everybody who is not typing.
 *
 * The case study on my site claimed this editor's "merge logic was still wrong".
 * Reading the code to write this, that was too generous.
 *
 * ## What this is
 *
 * One `ot-core` `Server` per room, which is the authority: it orders operations,
 * rebases late ones against everything that landed while they were in flight,
 * and hands back an acknowledgement for the author and a broadcast for everyone
 * else. Clients send *operations* — an insert or a delete at a position — rather
 * than documents, so two people typing in different places both keep their work,
 * and two people typing in the *same* place get a defined answer rather than a
 * race.
 *
 * The fan-out order matters and is the one thing to be careful about here.
 * Broadcasting before acknowledging is deliberate: acknowledging first is a bug
 * that silently loses one operation per collision, and it was found in ot-core's
 * own room implementation rather than reasoned about in advance.
 */

/**
 * ot-core is ESM and these servers are CommonJS, on Node 18 where `require` of
 * an ES module does not exist — that only arrived in Node 22. So it is loaded
 * with a dynamic `import()`, which works from CommonJS on every version this
 * runs on, and `init()` is awaited once at startup before the port is opened.
 *
 * Gating on startup rather than per-call keeps the socket handlers synchronous.
 * Making them async instead would mean an operation could be awaited while the
 * next one for the same room is already being handled, and the server's whole
 * job is to put operations in an order.
 */
let Server = null;
let loading = null;

function init() {
  if (!loading) loading = import('ot-core/server').then((m) => { Server = m.Server; });
  return loading;
}

/**
 * How much history a room keeps before compacting.
 *
 * Rebasing is linear in history depth — about 22µs per operation a thousand
 * entries deep against 0.016µs at one — so a room that never compacts gets
 * steadily slower for as long as it is open. Compacting drops history below a
 * revision, and any client that far behind is told to rejoin rather than being
 * quietly given a wrong answer.
 *
 * 500 is generous: it is the work of several minutes of fast typing, and far
 * more than a client can fall behind without the socket having died.
 */
const RETAIN = 500;

/** @type {Map<string, { server: Server, sockets: Set<string>, cursors: Map<string, object> }>} */
const rooms = new Map();

const STARTER = [
  '// Everyone here is editing the same document.',
  '// Type in the same line as somebody else — both edits survive.',
  '',
].join('\n');

function room(roomId) {
  if (Server === null) {
    // Only reachable if a server opened its port without awaiting init(). Loud,
    // because the quiet version is a room that silently accepts edits and
    // cannot order them.
    throw new Error('ot-rooms: init() must be awaited before the port is opened');
  }
  let existing = rooms.get(roomId);
  if (!existing) {
    existing = {
      server: new Server({ document: STARTER }),
      sockets: new Set(),
      cursors: new Map(),
    };
    rooms.set(roomId, existing);
  }
  return existing;
}

/**
 * Somebody joined. Returns what they need to start editing.
 *
 * The document comes from the server rather than from another client, which is
 * the point: there is now one authoritative answer to "what does this file say",
 * and a joiner gets it without a peer having to be awake and willing to send it.
 */
function join(roomId, socketId) {
  const it = room(roomId);
  it.sockets.add(socketId);
  const { document, revision } = it.server.snapshot();
  return {
    document,
    revision,
    cursors: [...it.cursors.entries()]
      .filter(([id]) => id !== socketId)
      .map(([id, cursor]) => ({ socketId: id, ...cursor })),
  };
}

/**
 * An operation from a client.
 *
 * @returns {{ ack: object, broadcast: object | null } | { error: string }}
 *   `broadcast` is null when nothing changed — a duplicate resend, or an edit a
 *   concurrent delete cancelled out entirely. Send `broadcast` to the room
 *   first, then `ack` to the author.
 */
function operation(roomId, socketId, message) {
  const it = room(roomId);
  try {
    const { ack, broadcast } = it.server.receive(socketId, message);

    // Compact against the slowest revision any connected client could still be
    // holding. Without a per-client revision this is an approximation, so it is
    // deliberately conservative — dropping history a client still needs turns a
    // recoverable lag into a forced rejoin.
    if (it.server.history.length > RETAIN) {
      it.server.compact(it.server.revision - RETAIN);
    }

    return { ack, broadcast };
  } catch (error) {
    // A malformed or unrebaseable message is the client's problem, not grounds
    // for taking the room down with it.
    return { error: error.message };
  }
}

/**
 * A cursor position. Stored so a joiner sees where people are immediately,
 * rather than only once they next move.
 *
 * Deliberately not routed through the operation channel: presence is ephemeral,
 * high-frequency and safe to lose, and operations are none of those things.
 */
function cursor(roomId, socketId, { selection, revision, username }) {
  const it = room(roomId);
  it.cursors.set(socketId, { selection, revision, username });
}

/**
 * Somebody left. Drops their cursor, and the room once it is empty.
 *
 * The room's document goes with it, which is the same lifetime the previous
 * implementation had — nothing was persisted before either. Keeping the `Server`
 * around for an empty room would leak one document and its history per room ever
 * opened.
 */
function leave(roomId, socketId) {
  const it = rooms.get(roomId);
  if (!it) return;
  it.sockets.delete(socketId);
  it.cursors.delete(socketId);
  it.server.forget(socketId);
  if (it.sockets.size === 0) rooms.delete(roomId);
}

/** The current text, for the features that want a document rather than edits. */
function document(roomId) {
  const it = rooms.get(roomId);
  return it ? it.server.document : '';
}

function stats() {
  return [...rooms.entries()].map(([roomId, it]) => ({
    roomId,
    revision: it.server.revision,
    history: it.server.history.length,
    sockets: it.sockets.size,
  }));
}

module.exports = { init, join, operation, cursor, leave, document, stats, RETAIN };
