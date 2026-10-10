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
const store = require('./ot-store');

function init(redisService = null) {
  store.use(redisService);
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

/**
 * The most operations one catch-up will return.
 *
 * A reconnecting client asks "what happened since revision N", and the honest
 * answer for a small N is the entire history — which is both the most
 * expensive reply the server can produce and one a socket can ask for
 * repeatedly. Past this many operations a snapshot is smaller anyway: history
 * grows per keystroke while the document only grows per surviving character,
 * so a thousand edits that net out to fifty characters is a thousand entries
 * against fifty.
 *
 * So the reply is bounded both ways — at most this many operations, otherwise
 * a document whose size is bounded by the document. Deliberately well under
 * RETAIN: a client further behind than this is better served by a snapshot
 * even though the history to answer it still exists.
 */
const CATCH_UP_LIMIT = 200;

/**
 * How many catch-up requests one socket may make per window.
 *
 * Catch-up is the one request here whose cost the caller chooses: an operation
 * costs one rebase, but a catch-up costs as much history as it asks for. Left
 * open, a socket can sit in a loop asking for everything since revision zero.
 * Twelve in ten seconds is far more than a reconnect needs — a client resyncs
 * once per disconnection — and far less than a loop wants.
 */
const CATCH_UP_BUDGET = 12;
const CATCH_UP_WINDOW_MS = 10000;

/** @type {Map<string, { server: Server, sockets: Set<string>, cursors: Map<string, object> }>} */
const rooms = new Map();

const STARTER = [
  '// Everyone here is editing the same document.',
  '// Type in the same line as somebody else — both edits survive.',
  '',
].join('\n');

/**
 * Rooms currently being loaded from the store.
 *
 * Two people opening a cold room at the same moment would otherwise each read
 * from Redis, each build a `Server`, and the second would replace the first —
 * along with anything the first had already applied. Sharing the promise means
 * the room is constructed exactly once and both callers get the same one.
 * @type {Map<string, Promise<object>>}
 */
const opening = new Map();

/**
 * The room, loaded from the store if this process has not seen it before.
 *
 * Async, which `operation` and `cursor` are not — deliberately. They can only be
 * reached by a client that has already been sent the document, which means the
 * room is in memory by then, so they use `existing()` and stay synchronous. The
 * server's whole job is to put operations in an order, and an `await` in that
 * path is an invitation to interleave two of them.
 */
async function ensure(roomId) {
  const already = rooms.get(roomId);
  if (already) return already;

  const inFlight = opening.get(roomId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const saved = await store.load(roomId);
    const it = {
      server: new Server(
        saved ? { document: saved.document, revision: saved.revision } : { document: STARTER }
      ),
      sockets: new Set(),
      cursors: new Map(),
      dirty: false,
      saveTimer: null,
    };
    // Re-check: an await happened, and a concurrent caller may have won.
    const raced = rooms.get(roomId);
    if (raced) return raced;
    rooms.set(roomId, it);
    if (saved) {
      console.log(`[ot] room ${roomId} restored at revision ${saved.revision}`);
    }
    return it;
  })();

  opening.set(roomId, promise);
  try {
    return await promise;
  } finally {
    opening.delete(roomId);
  }
}

/**
 * The room if it is in memory, or null.
 *
 * This used to throw, on the reasoning that a client cannot send an operation
 * before it has been given a document. That is true of *this* client and
 * irrelevant: anything can open a socket and send whatever it likes. The throw
 * propagated out of the Socket.IO handler and killed the process, so one
 * malformed message from one client took down every room for everybody.
 *
 * Returning null makes the caller decide, which is the only place that knows
 * whether a missing room is worth an error message or a shrug.
 */
function existing(roomId) {
  return rooms.get(roomId) ?? null;
}

function requireServer() {
  if (Server === null) {
    // Only reachable if a server opened its port without awaiting init(). Loud,
    // because the quiet version is a room that silently accepts edits and
    // cannot order them.
    throw new Error('ot-rooms: init() must be awaited before the port is opened');
  }
}

/**
 * Somebody joined. Returns what they need to start editing.
 *
 * The document comes from the server rather than from another client, which is
 * the point: there is now one authoritative answer to "what does this file say",
 * and a joiner gets it without a peer having to be awake and willing to send it.
 */
async function join(roomId, socketId, username) {
  requireServer();
  const it = await ensure(roomId);
  it.sockets.add(socketId);

  // Who has used this room, keyed by name so returning updates rather than
  // duplicates. The version of this idea in the other repository inserted into
  // Mongo under a unique index on username, so the second visit by anyone threw
  // a duplicate-key error that was caught and logged — a write-only record that
  // failed for exactly the people it was most interesting about. A hash cannot
  // have that bug, and this one is read back below.
  const recent = await store.participants(roomId);
  if (username) store.recordParticipant(roomId, username);

  const { document, revision } = it.server.snapshot();
  return {
    document,
    revision,
    recent,
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
  const it = existing(roomId);
  if (!it) {
    // An operation for a room this process has never opened. The client is out
    // of step — it is writing against a revision nobody has — so it is told, and
    // the server carries on.
    return { error: `room ${roomId} has not been opened; sync first` };
  }
  try {
    const { ack, broadcast } = it.server.receive(socketId, message);

    // Compact against the slowest revision any connected client could still be
    // holding. Without a per-client revision this is an approximation, so it is
    // deliberately conservative — dropping history a client still needs turns a
    // recoverable lag into a forced rejoin.
    if (it.server.history.length > RETAIN) {
      it.server.compact(it.server.revision - RETAIN);
    }

    // Only schedule a save when something actually changed. A duplicate resend
    // or an edit cancelled by a concurrent delete produces no broadcast and no
    // new revision, and saving on those would turn an idle room full of
    // reconnecting clients into a steady write load.
    if (broadcast) scheduleSave(roomId, it);

    return { ack, broadcast };
  } catch (error) {
    // A malformed or unrebaseable message is the client's problem, not grounds
    // for taking the room down with it.
    return { error: error.message };
  }
}

/** Per-socket catch-up spend, for the budget above. */
const catchUpSpend = new Map();

/**
 * What happened since a client's revision.
 *
 * This is the route that makes a reconnection cheap. Without it the only way
 * back into a room is a whole fresh snapshot, which also means the client
 * throws away whatever it had in flight when the socket died — measured at
 * 6.2% of edits across a chaos run with 94 disconnections. With it, a client
 * that was at revision 120 against a server at 127 asks for the seven it
 * missed, rebases what it was holding, and keeps its work.
 *
 * Every answer is bounded. `revision` arrives from the client, so it is
 * checked rather than trusted: anything that is not a plain integer inside the
 * history the server actually has resolves to `resync`, which tells the caller
 * to send a snapshot instead. That is the fail-closed direction — a snapshot
 * is always correct and its size is the document's, not the caller's choice.
 *
 * @param {string} roomId
 * @param {string} socketId
 * @param {unknown} revision the client's claim about where it is
 * @returns {{ missed: Array, revision: number } | { resync: true } | { error: string }}
 */
function catchUp(roomId, socketId, revision) {
  const it = existing(roomId);
  if (!it) return { error: `room ${roomId} has not been opened; sync first` };

  const now = Date.now();
  const spend = catchUpSpend.get(socketId);
  if (!spend || now - spend.since > CATCH_UP_WINDOW_MS) {
    catchUpSpend.set(socketId, { since: now, count: 1 });
  } else if (spend.count >= CATCH_UP_BUDGET) {
    return { error: 'too many catch-up requests; slow down' };
  } else {
    spend.count++;
  }

  // Not a revision this server ever issued. Covers NaN, Infinity, strings,
  // fractions, negatives and anything from the future — a client claiming to
  // be ahead of the server is as broken as one claiming to be at -1.
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > it.server.revision) {
    return { resync: true };
  }

  const behind = it.server.revision - revision;
  if (behind === 0) return { missed: [], revision: it.server.revision };
  if (behind > CATCH_UP_LIMIT) return { resync: true };

  try {
    return { missed: it.server.since(revision), revision: it.server.revision };
  } catch {
    // since() throws once that revision has been compacted away. The client is
    // further behind than the room still remembers, which is exactly what a
    // snapshot is for.
    return { resync: true };
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
  const it = existing(roomId);
  // Presence is best effort by construction. A cursor for a room that is not
  // open is not worth an error, and definitely not worth an exception.
  if (!it) return;
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
  // Unconditional, and before the room lookup: a socket's catch-up budget is
  // keyed by socket rather than by room, so leaving any room is the moment to
  // drop it. Left behind, this map is the one structure here that grows for
  // the life of the process — one entry per socket that ever connected.
  catchUpSpend.delete(socketId);

  const it = rooms.get(roomId);
  if (!it) return;
  it.sockets.delete(socketId);
  it.cursors.delete(socketId);
  it.server.forget(socketId);

  if (it.sockets.size === 0) {
    // Last one out saves the document, then the room leaves memory. Without a
    // store this is the same lifetime as before — the text goes when the room
    // does — which is why the save is awaited nowhere and its failure is not an
    // error: persistence is a bonus, not a precondition for having been able to
    // edit.
    flushSave(roomId, it);
    if (it.saveTimer) clearTimeout(it.saveTimer);
    rooms.delete(roomId);
  }
}

/**
 * How long to wait before writing a changed room.
 *
 * Every keystroke is a revision, so saving on each one would write hundreds of
 * times a minute for one person typing. Coalescing to a couple of seconds turns
 * that into a handful of writes and costs at most a couple of seconds of work if
 * the process dies — against a baseline where a restart lost everything.
 */
const SAVE_DEBOUNCE_MS = 2000;

function scheduleSave(roomId, it) {
  if (!store.enabled || it.saveTimer) return;
  it.saveTimer = setTimeout(() => {
    it.saveTimer = null;
    flushSave(roomId, it);
  }, SAVE_DEBOUNCE_MS);
  // Do not hold the process open for a pending save. On a shutdown the room is
  // flushed by `leave` or lost, and either is better than a server that will not
  // exit.
  it.saveTimer.unref?.();
}

function flushSave(roomId, it) {
  if (!store.enabled) return;
  const { document, revision } = it.server.snapshot();
  store.save(roomId, { document, revision });
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
    persisted: store.enabled,
    // For the metrics gauge. Byte length rather than code points, because the
    // question it answers is how much memory the room is holding.
    documentBytes: Buffer.byteLength(it.server.document, 'utf8'),
  }));
}

module.exports = { init, join, operation, catchUp, cursor, leave, document, stats, RETAIN, CATCH_UP_LIMIT };
