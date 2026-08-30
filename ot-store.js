/**
 * Making a room outlive the people in it.
 *
 * Until now a room's document lived only in memory: the last person leaves, the
 * `Server` is dropped, and the text goes with it. Restart the process and every
 * open room resets. That was the same lifetime the old implementation had, so
 * nothing regressed — but it is a real limitation once the merging actually
 * works, because the thing being lost is now everybody's reconciled work rather
 * than whoever's copy happened to win.
 *
 * ## Why this is a separate file, and optional
 *
 * Persistence is the one part of this that can fail for reasons that have
 * nothing to do with editing: Redis is unreachable, credentials rotate, the free
 * tier is asleep. None of that should stop two people typing. So every method
 * here answers rather than throws, a failed load is indistinguishable from a
 * room that was never saved, and a failed save is logged and forgotten.
 *
 * Redis is not configured on the current deployment at all. With no
 * `REDIS_HOST`/`REDIS_URL` this is inert and the application behaves exactly as
 * it did before — which is the point: turning it on should be a deployment
 * decision, not a code change.
 *
 * ## What is stored, and what is deliberately not
 *
 * The document and the revision it is at. Not the history — a restored room
 * starts with an empty one, and `Server` sets `baseRevision` to the revision it
 * resumed at, so a client reconnecting from further back is told to rejoin
 * instead of being silently rebased against operations nobody has. Storing
 * history would make that window larger, not smaller, and the failure it
 * prevents is exactly the one this library refuses to paper over.
 *
 * Not cursors either. Presence is ephemeral by construction; a caret belonging
 * to somebody who left the building is noise.
 */

const KEY = (roomId) => `ot:doc:${roomId}`;

/**
 * How long a saved room survives without being touched.
 *
 * Seven days. Long enough that coming back to a room on Monday works, short
 * enough that a demo does not accumulate every room anybody ever opened. Each
 * save renews it, so an active room never expires.
 */
const TTL_SECONDS = 7 * 24 * 60 * 60;

let redis = null;
let enabled = false;

/**
 * Wire this to a Redis service. Safe to skip entirely.
 *
 * @param {object|null} service  the `services/redis` singleton, or null
 */
function use(service) {
  redis = service ?? null;
  enabled = Boolean(service);
}

/**
 * The saved state of a room, or null if there is none.
 *
 * Null covers both "never saved" and "the store is unreachable", and the caller
 * treats them the same: start a fresh room. Distinguishing them would only let
 * the application do something clever about an outage, and the clever thing —
 * refusing to open the room — is worse than opening a blank one.
 *
 * @returns {Promise<{ document: string, revision: number } | null>}
 */
async function load(roomId) {
  if (!enabled) return null;
  try {
    const raw = await redis.get(KEY(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Anything malformed is treated as absent rather than trusted. A document
    // that is not a string would end up inside `Server`, where it throws on
    // construction and takes the room down with it.
    if (typeof parsed?.document !== 'string') return null;
    if (!Number.isInteger(parsed?.revision) || parsed.revision < 0) return null;
    return { document: parsed.document, revision: parsed.revision };
  } catch (error) {
    console.warn(`[ot-store] load failed for ${roomId}:`, error.message);
    return null;
  }
}

/**
 * @returns {Promise<boolean>}  whether it was actually written
 */
async function save(roomId, { document, revision }) {
  if (!enabled) return false;
  try {
    const value = JSON.stringify({ document, revision, at: new Date().toISOString() });
    return await redis.setWithExpiration(KEY(roomId), value, TTL_SECONDS);
  } catch (error) {
    console.warn(`[ot-store] save failed for ${roomId}:`, error.message);
    return false;
  }
}

/* ------------------------------------------------------- who has been here */

/**
 * Record that somebody used this room.
 *
 * Keyed by username, which is the whole difference from the version this
 * replaces. That one inserted `{ username, roomId }` into a Mongo collection
 * with a unique index on `username`, so the second time anyone reused a name the
 * insert threw — caught and logged, so it silently recorded nothing. A hash
 * field is idempotent: joining again updates the timestamp.
 *
 * Fire-and-forget. Nobody is waiting on this and a failure means one missing
 * line in a sidebar.
 */
function recordParticipant(roomId, username) {
  if (!enabled) return;
  Promise.resolve()
    .then(() => redis.addUserToRoom(roomId, username, { lastSeen: new Date().toISOString() }))
    .then(() => redis.client?.expire?.(`room:${roomId}:users`, TTL_SECONDS))
    .catch((error) => console.warn(`[ot-store] participant record failed:`, error.message));
}

/**
 * Everyone who has used this room, most recent first.
 *
 * Read on join and sent to the client, which is the point — the record it
 * replaces was never read by anything.
 *
 * @returns {Promise<{ username: string, lastSeen: string }[]>}
 */
async function participants(roomId) {
  if (!enabled) return [];
  try {
    const users = await redis.getRoomUsers(roomId);
    return users
      .map((u) => ({ username: u.userId, lastSeen: u.lastSeen ?? null }))
      .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
      .slice(0, 20);
  } catch (error) {
    console.warn(`[ot-store] participants failed for ${roomId}:`, error.message);
    return [];
  }
}

module.exports = {
  use,
  load,
  save,
  recordParticipant,
  participants,
  KEY,
  TTL_SECONDS,
  get enabled() {
    return enabled;
  },
};
