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
  discarded: 0,   // unconfirmed edits ot-core had to throw away
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
    this.online = false;
  }

  /*
   * A fresh socket and a fresh ot-core Client from the server's snapshot.
   *
   * Deliberately not client.reconnect(missed): that needs the server to answer
   * "what happened since revision N", and this server has no such route —
   * ot-core's Server exposes since(), ot-rooms never calls it. The only way
   * back in is a whole new snapshot, which means anything unconfirmed at the
   * moment of the drop is gone. That is a real property of this system, so the
   * harness reproduces it faithfully and counts the cost rather than papering
   * over it with a protocol the server does not speak.
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
        socket.emit('ot-sync', { roomId: ROOM });
      });

      socket.on('ot-init', ({ document, revision }) => {
        clearTimeout(failed);
        if (this.client) stats.rejoined++;

        this.client = new Client({
          id: socket.id,
          document,
          revision,
          // Injected one-way delay. Without it every client is on the same
          // loopback and operations arrive in the order they were sent, which
          // is the one case concurrency bugs hide in.
          send: (message) => {
            const delay = randInt(LATENCY_MS);
            setTimeout(() => {
              if (this.online && socket.connected) {
                socket.emit('ot-op', { roomId: ROOM, message });
              }
            }, delay);
          },
          onError: (e) => {
            stats.otErrors++;
            stats.discarded += e.discarded?.length ?? 0;
          },
        });

        socket.on('ot-op', (m) => this.client.receive(m));
        socket.on('ot-ack', (m) => this.client.receive(m));
        socket.on('ot-error', () => { stats.otErrors++; });

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

console.log(`\n  chaos: ${CLIENTS} clients, ${DURATION_MS}ms, latency<=${LATENCY_MS}ms, drop=${DROP_RATE}/s, seed=${SEED}`);
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
      if (p.online && chance(DROP_RATE)) p.drop();
      // An offline client comes back fairly quickly; the interesting window is
      // the one where it was away, not how long it stays away.
      else if (!p.online && chance(0.5)) await p.restore();
    }
    const up = participants.filter((p) => p.online).length;
    process.stdout.write(`\r  t=${((Date.now() - started) / 1000).toFixed(0)}s  online ${up}/${CLIENTS}  edits ${stats.issued}  drops ${stats.dropped}   `);
  }

  await wait(EDIT_EVERY_MS);
}

console.log('\n\n  chaos over — restoring everyone and letting it settle');

for (const p of participants) await p.restore();

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
