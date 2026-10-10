/**
 * Does it still converge when the network misbehaves?
 *
 * test-convergence.mjs asks whether two well-behaved clients agree. This asks
 * the question a production system actually faces: many clients, typing at
 * once, on connections that drop, stall and come back — does every replica
 * still end up holding the same document as the server?
 *
 * A load test cannot answer that. It measures whether the server keeps up, and
 * it has no idea what the right answer is: two clients ending a session with
 * different documents is not an error, a timeout or a dropped connection. It is
 * two successful requests. The graphs stay green while the text quietly rots.
 * That is the same blind spot that let the old whole-document rebroadcast pass
 * a thousand-client load test while 16.2% of concurrent edit pairs diverged.
 *
 * So this is a correctness harness wearing a load test's clothes. It drives the
 * real server over real sockets with real ot-core clients, breaks the network
 * underneath them on purpose, and at the end asserts one thing: everybody
 * agrees, and they agree with the server.
 *
 *   node chaos/chaos.mjs
 *   CLIENTS=40 DURATION_MS=30000 node chaos/chaos.mjs
 *
 * Start a server first (`node dev-server.js`). Pair it with infrastructure
 * chaos from another shell for the full exercise — see chaos/README.md.
 */

import { io } from 'socket.io-client';
import { Client } from 'ot-core/client';
import { insert } from 'ot-core';

const URL = process.env.URL ?? `http://localhost:${process.env.PORT ?? 5000}`;
const ROOM = process.env.ROOM ?? `chaos-${Date.now()}`;
const CLIENTS = Number(process.env.CLIENTS ?? 20);
const DURATION_MS = Number(process.env.DURATION_MS ?? 20000);
const EDIT_EVERY_MS = Number(process.env.EDIT_EVERY_MS ?? 120);
/** Upper bound on injected one-way delay. Each message gets a random share. */
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 150);
/** Chance per client per second of being knocked offline. */
const DROP_RATE = Number(process.env.DROP_RATE ?? 0.06);
const SEED = Number(process.env.SEED ?? 1);
/**
 * Use the catch-up route on reconnect. CATCHUP=0 forces the old snapshot path,
 * which is how the cost of not having it was measured in the first place.
 */
const CATCHUP = process.env.CATCHUP !== '0';

/*
 * Seeded, so a divergence can be re-run rather than described. A failure that
 * cannot be reproduced is a rumour.
 */
let seed = SEED >>> 0 || 1;
const random = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 0x100000000;
};
const randInt = (n) => Math.floor(random() * n);
const chance = (p) => random() < p;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * One distinct character per client, so the final document can be audited per
 * author. A multi-character token would be worthless here: another client can
 * insert into the middle of it, and a split token is indistinguishable from a
 * lost one. Single characters cannot be split.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const markerFor = (i) => ALPHABET[i % ALPHABET.length];
const PER_AUTHOR_AUDIT = CLIENTS <= ALPHABET.length;

const stats = {
  issued: 0,      // edits handed to a client
  dropped: 0,     // deliberate disconnections
  rejoined: 0,
  otErrors: 0,
  discarded: 0,          // unconfirmed edits ot-core had to throw away
  caughtUp: 0,           // rejoins answered with just the missing operations
  snapshotFallbacks: 0,  // rejoins that asked to catch up and got a snapshot
  catchUpRejected: 0,    // catch-ups the client could not apply
};

/**
 * A chaos participant: a socket, an ot-core client, and a record of what it
 * has typed so the end state can be audited against it.
 */
class Participant {
  constructor(index) {
    this.index = index;
    this.name = `chaos-${index}`;
    this.marker = markerFor(index);
    this.issued = 0;
    this.socket = null;
    this.client = null;
    this.resuming = null;
    this.online = false;
  }

  /*
   * A fresh socket, then either a catch-up or a snapshot.
   *
   * CATCHUP=0 forces the snapshot path, which is what this harness measured
   * before the server learned to answer `ot-resync`: a whole fresh document,
   * and everything the client had in flight discarded. Keeping it switchable
   * is what lets the run put a number on the difference rather than asserting
   * one.
   */
  connect() {
    return new Promise((resolve, reject) => {
      const socket = io(URL, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      const failed = setTimeout(() => {
        socket.close();
        reject(new Error(`${this.name}: no ot-init within 10s`));
      }, 10000);

      socket.on('connect', () => {
        socket.emit('join', { roomId: ROOM, username: this.name });

        // A client that has been here before knows where it got to, so it asks
        // for the difference. A first connection has nothing to catch up on.
        if (CATCHUP && this.client) {
          this.resuming = this.client;
          socket.emit('ot-resync', { roomId: ROOM, revision: this.client.revision });
        } else {
          this.resuming = null;
          socket.emit('ot-sync', { roomId: ROOM });
        }
      });

      /*
       * The catch-up landed: the same Client carries on, rebasing the
       * operations it missed and re-sending whatever was in flight. This is
       * the whole point — the edits it was holding survive the disconnection.
       */
      socket.on('ot-missed', ({ missed }) => {
        const client = this.resuming;
        // Not a catch-up this participant asked for. Leave the timeout armed:
        // clearing it without settling the promise is how a reconnect hangs
        // forever with nothing left to reject it.
        if (!client) return;

        try {
          client.id = socket.id;
          this.rewire(socket, client);
          // Rebases what it missed and re-sends what was in flight. The whole
          // point: the edits it was holding survive the disconnection.
          client.reconnect(missed);
        } catch (error) {
          // A catch-up the client cannot apply — it is further out of step
          // than the operations explain. Ask for a snapshot, which always
          // works, and let the ot-init handler settle this promise. The
          // timeout is still armed, so a server that answers neither fails
          // rather than hangs.
          stats.catchUpRejected++;
          this.resuming = null;
          socket.emit('ot-sync', { roomId: ROOM });
          return;
        }

        clearTimeout(failed);
        stats.rejoined++;
        stats.caughtUp++;
        this.socket = socket;
        this.online = true;
        resolve(this);
      });

      socket.on('ot-init', ({ document, revision }) => {
        clearTimeout(failed);
        if (this.client) {
          stats.rejoined++;
          // Asked for a catch-up and was handed a snapshot instead: too far
          // behind, or past what the room still remembers.
          if (this.resuming) stats.snapshotFallbacks++;
        }

        this.client = new Client({
          id: socket.id,
          document,
          revision,
          /*
           * Sends through `this.socket`, not the socket captured here.
           *
           * A resumed client outlives the socket it was built on — that is the
           * point of catching up — so a closure over the original would go on
           * writing to a dead connection for the rest of the run, and every
           * edit after the first reconnection would vanish. The indirection
           * costs a property read and is the difference between measuring the
           * catch-up path and measuring nothing.
           *
           * The delay is injected one-way latency. Without it every client is
           * on the same loopback and operations arrive in the order they were
           * sent, which is the one case concurrency bugs hide in.
           */
          send: (message) => {
            const delay = randInt(LATENCY_MS);
            setTimeout(() => {
              // Only the socket being gone suppresses a send, and that is a
              // genuine loss the client already knows about — it was told to
              // disconnect(). Suppressing on any other condition is how this
              // harness broke itself: a message silently dropped here leaves
              // ot-core believing it is in flight, so the client waits for an
              // ack that cannot arrive and never leaves `awaiting`. Those are
              // stuck clients the harness manufactured, not ones the server
              // lost, and they fail the run for the wrong reason.
              if (this.socket?.connected) {
                this.socket.emit('ot-op', { roomId: ROOM, message });
              }
            }, delay);
          },
          onError: (e) => {
            stats.otErrors++;
            stats.discarded += e.discarded?.length ?? 0;
          },
        });

        this.rewire(socket, this.client);
        this.socket = socket;
        this.online = true;
        resolve(this);
      });

      socket.on('connect_error', (e) => {
        clearTimeout(failed);
        reject(new Error(`${this.name}: ${e.message}`));
      });
    });
  }

  /** Point a socket's inbound events at a client. Both paths need this. */
  rewire(socket, client) {
    socket.on('ot-op', (m) => client.receive(m));
    socket.on('ot-ack', (m) => client.receive(m));
    socket.on('ot-error', () => { stats.otErrors++; });
  }

  type() {
    if (!this.online || !this.client) return;
    // A random position in the client's own document, which is the only
    // document it is entitled to have an opinion about.
    const at = randInt(this.client.document.length + 1);
    this.client.edit(insert(at, this.marker));
    this.issued++;
    stats.issued++;
  }

  drop() {
    if (!this.online) return;
    this.online = false;
    stats.dropped++;
    // The client is told first. ot-core then buffers edits instead of handing
    // them to a send that cannot deliver, which is what makes the unconfirmed
    // work still exist at reconnect — and therefore what makes the catch-up
    // route measurable at all.
    this.client?.disconnect();
    this.socket?.close();
  }

  async restore() {
    if (this.online) return;
    try {
      await this.connect();
    } catch {
      // A server that is down right now is the point of the exercise; the next
      // sweep tries again.
      this.online = false;
    }
  }

  /** Nothing in flight and nothing buffered. */
  get settled() {
    return !this.online || this.client?.state === 'synchronized';
  }
}

/* ------------------------------------------------------------------ run -- */

console.log(`\n  chaos: ${CLIENTS} clients, ${DURATION_MS}ms, latency<=${LATENCY_MS}ms, drop=${DROP_RATE}/s, seed=${SEED}, catch-up ${CATCHUP ? 'on' : 'OFF (snapshot only)'}`);
console.log(`  room ${ROOM} on ${URL}\n`);

const participants = [];
for (let i = 0; i < CLIENTS; i++) {
  try {
    participants.push(await (new Participant(i)).connect());
  } catch (e) {
    console.error(`  could not connect ${i}: ${e.message}`);
    process.exit(1);
  }
}
console.log(`  ${participants.length} connected at revision ${participants[0].client.revision}`);

/*
 * The document before anybody types, kept because the room opens with a
 * comment block and that prose contains ordinary letters — the same letters
 * used as author markers. Counting markers in the final document without
 * subtracting this one reports more surviving edits than were ever made.
 */
const baseline = participants[0].client.document;

const started = Date.now();
let lastChaos = started;

while (Date.now() - started < DURATION_MS) {
  for (const p of participants) if (chance(0.5)) p.type();

  // Chaos sweep once a second, so DROP_RATE reads as "per client per second".
  if (Date.now() - lastChaos >= 1000) {
    lastChaos = Date.now();
    for (const p of participants) {
      // Participant 0 never drops.
      //
      // A room exists only while at least one socket is in it: ot-rooms
      // deletes it on the last leave, and dev-server configures no store, so
      // flushSave has nowhere to write. A reconnect storm that happens to
      // leave nobody connected for an instant therefore destroys the
      // document, and the run that follows is measuring a room that restarted
      // at revision 0 rather than anything about convergence.
      //
      // That is a real property of this server and worth its own fix — a
      // grace period before eviction, or a store in the dev path. Pinning one
      // client keeps it out of the measurement meanwhile, and matches how a
      // shared document is actually used: somebody is usually still in it.
      if (p.index === 0) continue;

      if (p.online && chance(DROP_RATE)) p.drop();
      // An offline client comes back fairly quickly; the interesting window is
      // the one where it was away, not how long it stays away.
      //
      // Not awaited. Awaiting here puts every reconnection in a queue behind
      // the one before it, so a sweep that finds ten clients offline spends
      // ten handshakes in series and the chaos loop stops running while it
      // does. It also misrepresents the thing being tested: when a network
      // blips, clients come back at once, and a reconnect storm arriving
      // together is harder on the server than a tidy procession. restore()
      // swallows its own failures, so nothing here goes unhandled.
      else if (!p.online && chance(0.5)) void p.restore();
    }
    const up = participants.filter((p) => p.online).length;
    process.stdout.write(`\r  t=${((Date.now() - started) / 1000).toFixed(0)}s  online ${up}/${CLIENTS}  edits ${stats.issued}  drops ${stats.dropped}   `);
  }

  await wait(EDIT_EVERY_MS);
}

console.log('\n\n  chaos over — restoring everyone and letting it settle');

// Concurrently, for the same reason the sweep is: in series, sixteen clients
// each able to spend ten seconds failing to connect is a settle phase longer
// than the chaos it follows.
await Promise.all(participants.map((p) => p.restore()));

/*
 * Quiescence, not a guessed sleep. Every client reports whether it is
 * synchronized; wait for all of them, with a ceiling so a genuinely stuck
 * client fails the run instead of hanging it.
 */
const settleDeadline = Date.now() + 15000;
while (Date.now() < settleDeadline && !participants.every((p) => p.settled)) {
  await wait(250);
}
const unsettled = participants.filter((p) => !p.settled).length;
await wait(1000); // let the last acks land

/*
 * The server's own answer, from a client that took no part in the chaos. Its
 * ot-init is the authoritative document by definition — it is what the server
 * hands anyone who asks right now.
 */
const observer = await (new Participant(9999)).connect();
await wait(500);
const truth = observer.client.document;

/* -------------------------------------------------------------- verdict -- */

const online = participants.filter((p) => p.online && p.client);

/*
 * Prove the check can fail.
 *
 * A convergence test that only ever passes is indistinguishable from one that
 * does not look at anything, and this one spends most of its life passing. So
 * SELFTEST=1 corrupts a single replica by one character immediately before the
 * comparison. If the run still reports success, the comparison is broken and
 * every green result it has ever produced was worthless.
 *
 * Same reasoning as ot-core shipping a deliberately broken transform next to
 * its fuzzer: the red run is what makes the green one mean something.
 */
if (process.env.SELFTEST === '1' && online.length > 0) {
  const victim = online[0];
  victim.client.document += 'X';
  console.log(`\n  SELFTEST: corrupted ${victim.name} by one character — the run below MUST fail`);
}

const diverged = online.filter((p) => p.client.document !== truth);

console.log(`\n  ── result ────────────────────────────────────────────────`);
console.log(`  clients              ${online.length}/${CLIENTS} online at the end`);
console.log(`  edits issued         ${stats.issued}`);
console.log(`  deliberate drops     ${stats.dropped}  (rejoins ${stats.rejoined})`);
console.log(`  rejoin path          ${stats.caughtUp} caught up, ${stats.snapshotFallbacks} fell back to a snapshot, ${stats.catchUpRejected} unusable`);
console.log(`  ot errors            ${stats.otErrors}  (unconfirmed discarded ${stats.discarded})`);
console.log(`  unsettled at cutoff  ${unsettled}`);
console.log(`  server document      ${truth.length} chars at revision ${observer.client.revision}`);

let failed = false;

if (diverged.length > 0) {
  failed = true;
  console.log(`\n  FAIL  ${diverged.length}/${online.length} replicas disagree with the server`);
  for (const p of diverged.slice(0, 3)) {
    console.log(`    ${p.name}: ${p.client.document.length} chars, state=${p.client.state}`);
  }
} else {
  console.log(`\n  ok    all ${online.length} replicas match the server exactly`);
}

if (unsettled > 0) {
  failed = true;
  console.log(`  FAIL  ${unsettled} clients never reached synchronized`);
}

/*
 * What the missing catch-up route costs, in characters.
 *
 * Every surviving edit is one marker character in the final document. Counting
 * them per author against what that author typed turns "some edits are lost on
 * reconnect" into a number — and it is a number this harness can watch move if
 * the server ever learns to answer since().
 *
 * This is reported, not asserted. Losing unconfirmed edits on a cold rejoin is
 * the protocol working as built; the point is to know the size of it.
 */
if (PER_AUTHOR_AUDIT) {
  const occurrences = (text, ch) => {
    let n = 0;
    for (const c of text) if (c === ch) n++;
    return n;
  };
  let typed = 0;
  let survived = 0;
  for (const p of participants) {
    typed += p.issued;
    // Net new markers: what this author contributed, with the starter's own
    // letters taken back out.
    survived += occurrences(truth, p.marker) - occurrences(baseline, p.marker);
  }
  const lost = typed - survived;
  const pct = typed ? ((lost / typed) * 100).toFixed(1) : '0.0';
  console.log(`\n  edits typed          ${typed}`);
  console.log(`  edits in final doc   ${survived}`);
  console.log(`  lost to reconnect    ${lost}  (${pct}%)  — unconfirmed work dropped on cold rejoin`);
  if (lost > 0 && stats.dropped === 0) {
    failed = true;
    console.log(`  FAIL  edits went missing with no disconnections to explain them`);
  }
} else {
  console.log(`\n  (per-author audit skipped: ${CLIENTS} clients exceeds the ${ALPHABET.length}-marker alphabet)`);
}

for (const p of [...participants, observer]) p.socket?.close();
await wait(200);

console.log(failed ? '\n  FAILED\n' : '\n  converged under chaos\n');
process.exit(failed ? 1 : 0);
