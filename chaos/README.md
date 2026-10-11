# Chaos harness

Does this editor still converge when the network misbehaves?

`test-convergence.mjs` asks whether two well-behaved clients agree. This asks
the question production actually poses: many clients, typing at once, on
connections that drop, stall and come back — does every replica still end up
holding the same document as the server?

## Why a load test cannot answer that

The load test in `load-test.yml` measures whether the server keeps up. It has
no idea what the right answer is. Two clients finishing a session with
different documents is not an error, a timeout or a dropped connection — it is
two successful requests. The graphs stay green while the text quietly rots.

That is not hypothetical here. The previous sync layer passed a 1,000-client
load test at 75ms p95 while **16.2% of concurrent edit pairs diverged**. The
load test was measuring throughput; nothing was measuring correctness.

So this is a correctness harness wearing a load test's clothes.

## Running it

```bash
node server.js              # in one shell
npm run chaos               # in another
```

Point it at `server.js` — the one `npm run start:ai` runs in production. It needs
no Redis; without `REDIS_URL` it keeps documents in memory and everything the
harness asserts still holds.

`dev-server.js` now gives the same answers, because both servers get their
protocol from `collab-socket.js` and there is only one copy of it to test. That
was not true until recently. `ot-resync` lived in `dev-server.js` alone for a
while, and a harness pointed there certified a catch-up rate production could
not deliver — a convergence test aimed at the wrong binary, which is the same
mistake as the load test it was built to replace. Prefer `server.js` anyway:
sharing the protocol does not make the Redis adapter, the metrics registry or
the cluster setup identical, and those are what differ under load.

Knobs, all environment variables:

| var | default | meaning |
| --- | --- | --- |
| `CLIENTS` | 20 | concurrent participants |
| `DURATION_MS` | 20000 | how long chaos runs before settling |
| `LATENCY_MS` | 150 | upper bound on injected one-way delay |
| `DROP_RATE` | 0.06 | chance per client per second of being knocked offline |
| `SEED` | 1 | seeded RNG, so a failure reproduces |
| `URL` / `PORT` | `localhost:5000` | target server |

```bash
CLIENTS=40 DURATION_MS=25000 LATENCY_MS=400 DROP_RATE=0.12 SEED=7 npm run chaos
```

Exit code is 0 on convergence and 1 on divergence, so it belongs in CI.

## What it asserts

After the chaos window it restores every client, waits for all of them to
report `synchronized` (real quiescence, not a guessed sleep), then connects a
fresh observer that took no part in the run. That observer's `ot-init` **is**
the server's authoritative document — it is what the server hands anyone who
asks. Every replica must match it exactly.

It also fails if any client never reaches `synchronized`, and if edits go
missing with no disconnections to explain them.

## Proving the check can fail

A convergence test that only ever passes is indistinguishable from one that
looks at nothing, and this one spends most of its life passing.

```bash
SELFTEST=1 npm run chaos    # must exit 1
```

`SELFTEST=1` corrupts one replica by a single character immediately before the
comparison. If the run still reports success, the comparison is broken and
every green result it ever produced was worthless. Same reasoning as `ot-core`
shipping a deliberately broken transform beside its fuzzer: the red run is what
makes the green one mean anything.

## What catch-up is worth

The server answers `ot-resync` now: a client says where it got to and gets the
operations after it, so `Client.reconnect(missed)` can rebase what it was
holding and re-send what was in flight. `CATCHUP=0` forces the old path — a
whole fresh snapshot, everything unconfirmed discarded — which is what makes
the difference measurable rather than asserted.

Against `server.js`, 16 clients, 10s, latency to 200ms, 12% drop per client per
second, `SEED=3`:

```
catch-up OFF (snapshot only)        catch-up ON (ot-resync)
  9 drops, 0 caught up               17 drops, 17 caught up
  566 typed / 560 survived           574 typed / 574 survived
  6 lost  (1.1%)                      0 lost  (0.0%)
  all 16 replicas match the server   all 16 replicas match the server
```

Both converge — that was never the question. What changes is whether the work a
client was holding when its socket died still exists afterwards.

The two columns are not one experiment run twice. Dropping is sampled per client
per second, so the runs diverge in timing the moment their reconnect costs
differ, and drop and edit counts diverge with them. The loss *rate* is the
comparable number.

## Known limits

Past roughly 400ms of injected latency combined with a drop rate near 0.25, a
run becomes unreliable in a way that is not yet understood: the main loop
stalls, clients sit in `awaiting-with-buffer`, and the room comes back at
revision 0 with the document gone. Part of it is understood — a room lives only
while a socket is in it, `ot-rooms` deletes it on the last leave, and with no
`REDIS_URL` set there is no store to read it back from, so a moment with nobody
connected destroys the document. Participant 0 never drops in order to hold the
room open, which removes that cause, and the failure still appears at extreme
settings. The numbers above are from settings that reproduce; harsher ones are
measuring the harness as much as the server, and are not quoted.

Worth fixing before trusting a harsher run: a grace period before a room is
evicted. Running the server with `REDIS_URL` set also avoids it, at the cost of
no longer testing the configuration most people deploy.

## Infrastructure chaos

The harness breaks the network. To break the infrastructure underneath it, run
either of these from a third shell while a long run is in flight — clients
treat it as a disconnection and rejoin:

```bash
docker compose restart redis
docker compose restart app          # with more than one app replica
```

The assertion does not change: when it settles, everyone agrees with the
server.
