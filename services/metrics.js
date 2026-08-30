/**
 * The metrics Prometheus was already configured to scrape.
 *
 * `prometheus.yml` has scraped `app:5000/metrics` every fifteen seconds since it
 * was written, `load-test.yml` hits the same path, and `prom-client` has been a
 * dependency the whole time — but no route ever served it. The scrape target did
 * not exist, so the dashboards had nothing behind them.
 *
 * That matters more here than it would elsewhere, because the write-up for this
 * project is *about* claims that outran what was actually checked. "The stack
 * ships with Prometheus and Grafana" was true of the configuration and false of
 * the application. This file is the cheaper of the two fixes: make the sentence
 * true rather than soften it.
 *
 * ## What is measured, and why these
 *
 * Default process metrics, plus the four numbers that would actually tell you
 * something is wrong with a collaborative editor:
 *
 *   - **operations, by outcome.** A rising `rejected` rate means clients are
 *     falling too far behind to rebase — the failure that compaction causes if
 *     the retention window is too small.
 *   - **how long an operation takes to order.** Rebasing is linear in how far
 *     behind an operation was written, so this is the number that grows when a
 *     room accumulates history.
 *   - **history depth per room.** The input to the one above, and the thing
 *     compaction is supposed to bound.
 *   - **connected sockets and live rooms.** Load, and whether rooms are being
 *     cleaned up when the last person leaves.
 *
 * Deliberately not a per-room label on the counters. Room ids are user-supplied
 * and unbounded, and a label with unbounded cardinality is how a Prometheus
 * server runs out of memory. The per-room gauges are set at scrape time from a
 * bounded snapshot instead.
 */

let client = null;
let registry = null;

const metrics = {};

/**
 * Set up the registry. Returns false if `prom-client` is unavailable, in which
 * case every function here is inert and `/metrics` reports that plainly rather
 * than pretending.
 */
function init() {
  if (registry) return true;
  try {
    client = require('prom-client');
  } catch (error) {
    console.log(`📊 Metrics: off (${error.message})`);
    return false;
  }

  registry = new client.Registry();
  registry.setDefaultLabels({ app: 'collab-editor' });
  client.collectDefaultMetrics({ register: registry });

  metrics.operations = new client.Counter({
    name: 'collab_operations_total',
    help: 'Edits received by the server, by what happened to them',
    labelNames: ['outcome'],
    registers: [registry],
  });

  metrics.operationSeconds = new client.Histogram({
    name: 'collab_operation_duration_seconds',
    help: 'Time to order one edit, including rebasing it past concurrent ones',
    // Rebasing is single-digit microseconds shallow and tens of microseconds a
    // hundred revisions deep, so the interesting range is well under a
    // millisecond. The default buckets start at 5ms and would put everything in
    // the first one.
    buckets: [0.00005, 0.0001, 0.00025, 0.0005, 0.001, 0.005, 0.025, 0.1],
    registers: [registry],
  });

  metrics.sockets = new client.Gauge({
    name: 'collab_socket_connections',
    help: 'Currently connected sockets',
    registers: [registry],
  });

  metrics.rooms = new client.Gauge({
    name: 'collab_rooms_active',
    help: 'Rooms held in memory',
    registers: [registry],
  });

  metrics.historyDepth = new client.Gauge({
    name: 'collab_room_history_depth',
    help: 'Rebaseable operations retained for the deepest room',
    registers: [registry],
  });

  metrics.documentBytes = new client.Gauge({
    name: 'collab_document_bytes',
    help: 'Total size of the documents held in memory',
    registers: [registry],
  });

  console.log('📊 Metrics: on at /metrics');
  return true;
}

const enabled = () => registry !== null;

/** One edit, and what became of it. */
function recordOperation(outcome, seconds) {
  if (!registry) return;
  metrics.operations.inc({ outcome });
  if (typeof seconds === 'number') metrics.operationSeconds.observe(seconds);
}

function setSockets(count) {
  if (registry) metrics.sockets.set(count);
}

/**
 * Refresh the per-room gauges from a snapshot.
 *
 * Called at scrape time rather than on every edit: these are derived numbers, a
 * scrape is every fifteen seconds, and recomputing them on each keystroke would
 * make the measurement more expensive than the thing measured.
 */
function observeRooms(rooms) {
  if (!registry) return;
  metrics.rooms.set(rooms.length);
  metrics.historyDepth.set(rooms.reduce((worst, r) => Math.max(worst, r.history ?? 0), 0));
  metrics.documentBytes.set(rooms.reduce((total, r) => total + (r.documentBytes ?? 0), 0));
}

/** The exposition text, or null when metrics are off. */
async function text() {
  if (!registry) return null;
  return registry.metrics();
}

const contentType = () => (registry ? registry.contentType : 'text/plain');

module.exports = {
  init,
  enabled,
  recordOperation,
  setSockets,
  observeRooms,
  text,
  contentType,
};
