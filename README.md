# Real-Time Collaborative Code Editor

Multiple people editing one document at once, over WebSockets, with the merge
logic backed by a property test rather than by hope.

**[Live demo](https://real-time-code-editor-codebuddy.onrender.com/)** · open it
in two tabs and type in the same line. The host is a free tier that sleeps, so
the first request after a quiet spell can take half a minute to wake.

---

## The part worth reading

This project's write-up used to say, as a plain statement of fact, that two
people can type in the same place and both edits survive. That is what
Operational Transform is for and it is what I believed I had built. It had been
load-tested to 1,000 concurrent clients at 75ms P95 and it held.

Then I tested the one thing OT actually promises, and **16.2% of concurrent edit
pairs came back different.** Two people editing at once were ending up with
different documents.

A load test cannot catch that. It asks whether the server keeps up, not whether
the answer is right — and two clients ending a session holding different text is
not an error or a timeout. It is two successful requests. The dashboards were
green the entire time the merge was wrong.

Worse, when I went back to fix it and finally read the sync code properly:

```js
// on every keystroke
socket.emit(CODE_CHANGE, { roomId, code: instance.getValue() });

// on every message received
editor.setValue(code);
```

The whole document, both directions, every keystroke. The server held no state —
it rebroadcast whatever it was handed. There was no merge logic to be wrong. And
`sharedb`, a complete OT implementation, had been sitting in `package.json` the
whole time, imported by exactly zero lines.

## How it works now

The transform was extracted, fixed, and published as
**[ot-core](https://www.npmjs.com/package/ot-core)** — because an algorithm
inside an application can hide behind the application, and one in a library with
a test suite cannot. Extracting it surfaced nine more bugs, none of them in the
algebra: all in the client state machine, the server rebase, and the room
fan-out.

Clients now send **operations** — an insert or delete at a position — not
documents. The server holds one authority per room: it orders operations, rebases
late ones against everything that landed while they were in flight, and returns
an acknowledgement to the author plus a broadcast to everyone else.

That means remote edits no longer call `setValue`, so your cursor, scroll
position and undo history survive other people typing. Remote carets move with
the text instead of being redrawn from stale offsets, and undo undoes only your
own edits.

Documents persist to Redis, so a room survives a restart instead of evaporating.

### Verify it yourself

The convergence property is exported from the library, so you do not have to
take the number on trust:

```bash
npm i ot-core
node --input-type=module -e "
  const { checkConvergence, identityTransform } = await import('ot-core/fuzz');
  console.log(checkConvergence({ pairs: 100000 }).divergences);
  console.log(checkConvergence({ pairs: 100000, transform: identityTransform }).divergences);
"
```

The first prints `0` divergences. The second — the same fuzzer against a
transform that ignores the operation it is meant to rebase against — prints
around `47,000`. That second number is what makes the first one worth reading.

There is also a **[browser visualiser](https://yuvrajinbhakti.github.io/ot-core/visualizer/)**:
edit two operations, watch them transform against each other, and run either
fuzzer live.

## AI code review

Rooms can request an automated review of the current buffer, backed by Google
Gemini (free tier) or OpenAI. Reviews are collaborative — everyone in the room
sees the findings and can comment on them.

```bash
curl https://real-time-code-editor-codebuddy.onrender.com/api/ai-review/status
# {"success":true,"data":{"enabled":true,"provider":"gemini","isFree":true,...}}
```

| Endpoint | Purpose |
|---|---|
| `POST /api/ai-review/analyze` | One-off analysis, no room |
| `POST /api/ai-review/create` | Start a collaborative review in a room |
| `GET /api/ai-review/room/:roomId` | Reviews for a room |
| `POST /api/ai-review/:reviewId/comment` | Comment on a finding |
| `GET /api/ai-review/status` | Provider, cache size, request counts |

Responses are cached and rate-limited per user.

## Metrics

`prometheus.yml` had been scraping `/metrics` every fifteen seconds since it was
written. The load test hit the same path. `prom-client` was installed. No route
ever served it — the scrape target did not exist.

It does now:

```bash
curl https://real-time-code-editor-codebuddy.onrender.com/metrics | grep '^collab_'
```

| Metric | What it answers |
|---|---|
| `collab_operations_total{outcome}` | Edits received, by what happened to them |
| `collab_operation_duration_seconds` | Time to order one edit, including rebasing |
| `collab_socket_connections` | Currently connected sockets |
| `collab_rooms_active` | Rooms held in memory |
| `collab_room_history_depth` | Rebaseable operations retained for the deepest room |
| `collab_document_bytes` | Total size of documents in memory |

## Running it

```bash
npm install
npm start          # builds the client, then serves on :5000
```

Redis is optional. Without it, documents live only as long as the room does —
which is the behaviour this had before persistence was added.

```bash
# .env
REDIS_URL=redis://localhost:6379      # optional; enables document persistence
GEMINI_API_KEY=...                    # optional; enables AI review (free tier)
OPENAI_API_KEY=...                    # optional alternative to Gemini
PORT=5000
```

With Docker:

```bash
docker compose up
```

## Stack

React 18 · CodeMirror 5 · Socket.IO 4 · Node · Redis · **ot-core** for the merge
logic · prom-client · Docker · Nginx

## What this does not do

**No TP2.** The convergence property tested here is TP1 — two concurrent
operations converge. This model does not claim convergence for three or more
operations transformed against each other in different orders, which is a case an
undo of an old edit can reach. The limitation is documented in ot-core rather
than worked around.

**One character can be dropped.** If you type into text somebody else is deleting
at that exact moment, your character does not survive. Preserving it would
require splitting their delete into two pieces around it, and an operation here
is one position and one length, which cannot express that. The alternative is
modelling operations as retain/insert/delete sequences the way Quill Delta and
ShareDB do — strictly more capable, considerably more machinery. I kept the
simple model and wrote down what it costs.

**The load-test numbers measured the old sync layer.** 1,000 concurrent clients
at 75ms P95, >10,000 ops/sec, error rate under 0.5% — all real, all measured
against code that no longer exists, and all about throughput rather than
correctness. They are here as history, not as a claim about the current build.

**The free tier sleeps.** First request after idle can take 30+ seconds.

## Related

- **[ot-core on npm](https://www.npmjs.com/package/ot-core)** — the merge logic, 158 tests
- **[Convergence visualiser](https://yuvrajinbhakti.github.io/ot-core/visualizer/)** — run the property in your browser
