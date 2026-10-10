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
node dev-server.js          # in one shell
npm run chaos               # in another
```

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

## A measured run

40 clients, 25s, latency up to 400ms, 12% chance per client per second of being
dropped, seed 7:

```
clients              40/40 online at the end
edits issued         3416
deliberate drops     94  (rejoins 94)
ot errors            0
unsettled at cutoff  0
server document      3315 chars at revision 3201

ok    all 40 replicas match the server exactly

edits typed          3416
edits in final doc   3204
lost to reconnect    212  (6.2%)
```

## The 6.2%, and why it is reported rather than asserted

Every surviving edit is one marker character in the final document — one
distinct character per author, because a multi-character token can be split
down the middle by another client's insert and a split token is
indistinguishable from a lost one. Counting markers per author against what
that author typed turns "some edits are lost on reconnect" into a number.

That number is the cost of a route this server does not have. `ot-core`'s
`Server` exposes `since(revision)` — give it a revision and it returns the
history after it, which is what `Client.reconnect(missed)` wants so a client
can catch up from where it left off and re-send what was in flight. Neither
`ot-rooms.js` nor `dev-server.js` ever calls it. The only way back in is
`ot-sync` → a whole fresh snapshot, so anything unconfirmed at the moment of
the drop is gone.

Losing unconfirmed work on a cold rejoin is therefore the protocol working as
built, not a bug — which is why the harness reports it instead of failing on
it. Wire `since()` to a socket event and this number should fall toward zero;
the harness will say by how much.

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
