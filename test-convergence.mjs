/**
 * Does the rewritten editor actually converge?
 *
 * Run a server first (`npm start`, or `node dev-server.js`), then
 * `npm run test:convergence`. Override the target with URL= or PORT=.
 *
 * Drives the real dev-server over a real Socket.IO connection with two real
 * ot-core clients, typing at the same position at the same time — the exact case
 * the old whole-document rebroadcast destroyed.
 *
 * The old behaviour, for comparison: both clients send their entire document,
 * the later message wins outright, and one person's edit is gone. That is what
 * this is checking has stopped happening.
 */

import { io } from 'socket.io-client';
import { Client } from 'ot-core/client';
import { insert } from 'ot-core';

const URL = process.env.URL ?? `http://localhost:${process.env.PORT ?? 5000}`;
const ROOM = 'e2e-' + process.argv[2];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(username) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false });
    const failed = setTimeout(() => reject(new Error(`${username}: no INIT`)), 8000);

    socket.on('connect', () => {
      socket.emit('join', { roomId: ROOM, username });
      // The document is sent in reply to this, not as part of the join —
      // the browser client's editor mounts after the socket connects, so a
      // broadcast on join could arrive before anything was listening.
      socket.emit('ot-sync', { roomId: ROOM });
    });

    socket.on('ot-init', ({ document, revision }) => {
      clearTimeout(failed);
      const client = new Client({
        id: socket.id,
        document,
        revision,
        send: (message) => socket.emit('ot-op', { roomId: ROOM, message }),
        onError: (e) => console.error(`  [${username}] ${e.code}: ${e.reason}`),
      });
      socket.on('ot-op', (m) => client.receive(m));
      socket.on('ot-ack', (m) => client.receive(m));
      socket.on('ot-error', ({ reason }) => console.error(`  [${username}] rejected: ${reason}`));
      resolve({ socket, client, username });
    });

    socket.on('connect_error', (e) => reject(new Error(`${username}: ${e.message}`)));
  });
}

const fail = (message) => {
  console.error('\n  FAIL ' + message);
  process.exitCode = 1;
};

const a = await connect('alice');
const b = await connect('bob');
await wait(300);

console.log(`\n  both joined at revision ${a.client.revision}, document ${a.client.document.length} chars`);

if (a.client.document !== b.client.document) {
  fail('the two clients did not even start from the same document');
}

/* ---- the case the old code destroyed: same position, same instant ---- */

const at = a.client.document.length;
a.client.edit(insert(at, 'AAAA'));
b.client.edit(insert(at, 'BBBB'));

await wait(1200);

console.log(`  alice: ${JSON.stringify(a.client.document.slice(-12))}`);
console.log(`  bob:   ${JSON.stringify(b.client.document.slice(-12))}`);

if (a.client.document !== b.client.document) {
  fail(`diverged\n    alice ${JSON.stringify(a.client.document)}\n    bob   ${JSON.stringify(b.client.document)}`);
} else if (!a.client.document.includes('AAAA') || !a.client.document.includes('BBBB')) {
  fail(`one edit was lost — this is the old last-write-wins behaviour\n    ${JSON.stringify(a.client.document)}`);
} else {
  console.log('  ok  converged, and both edits survived');
}

/* ---- a burst, interleaved, which is what typing actually looks like ---- */

for (let i = 0; i < 12; i++) {
  a.client.edit(insert(Math.min(2, a.client.document.length), 'a'));
  b.client.edit(insert(Math.min(5, b.client.document.length), 'b'));
  await wait(15);
}
await wait(2500);

const countA = (a.client.document.match(/a/g) ?? []).length;
const countB = (b.client.document.match(/b/g) ?? []).length;

if (a.client.document !== b.client.document) {
  fail(`a burst diverged\n    alice ${JSON.stringify(a.client.document)}\n    bob   ${JSON.stringify(b.client.document)}`);
} else {
  console.log(`  ok  24 interleaved edits converged (${a.client.document.length} chars)`);
}

/* ---- a third client joining mid-session gets the server's document ---- */

const c = await connect('carol');
await wait(400);

if (c.client.document !== a.client.document) {
  fail(`a joiner did not receive the current document\n    carol ${JSON.stringify(c.client.document)}\n    alice ${JSON.stringify(a.client.document)}`);
} else {
  console.log(`  ok  a joiner received the document from the server at revision ${c.client.revision}`);
}

for (const it of [a, b, c]) it.socket.close();
await wait(200);
console.log(process.exitCode ? '\n  FAILED\n' : '\n  all checks passed\n');
process.exit(process.exitCode ?? 0);
