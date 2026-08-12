// Per-source statistics — kept entirely in-memory, reset on process restart.
// (Operators wanting persistent stats can stand up Prometheus later; for
// the ops UI snapshot view, in-memory is enough.)

const stats = new Map();

function get(sourceId) {
  let s = stats.get(sourceId);
  if (!s) {
    s = {
      queries: 0,
      ok: 0,
      errors: 0,
      totalCandidates: 0,
      sumLatencyMs: 0,
      lastErrorAt: null,
      lastError: null,
      lastSuccessAt: null,
    };
    stats.set(sourceId, s);
  }
  return s;
}

function recordCall(sourceId, { latencyMs, candidates }) {
  const s = get(sourceId);
  s.queries++; s.ok++;
  s.totalCandidates += (candidates || 0);
  s.sumLatencyMs += (latencyMs || 0);
  s.lastSuccessAt = new Date().toISOString();
}

function recordError(sourceId, err) {
  const s = get(sourceId);
  s.queries++; s.errors++;
  s.lastErrorAt = new Date().toISOString();
  s.lastError = String((err && err.message) || err || 'unknown');
}

function snapshot() {
  const out = {};
  for (const [id, s] of stats.entries()) {
    const avg = s.queries > 0 ? Math.round(s.sumLatencyMs / s.queries) : 0;
    const rate = s.queries > 0 ? Math.round((s.ok / s.queries) * 100) : 0;
    out[id] = {
      queries: s.queries, ok: s.ok, errors: s.errors,
      totalCandidates: s.totalCandidates,
      avgLatencyMs: avg, successRatePct: rate,
      lastErrorAt: s.lastErrorAt, lastError: s.lastError,
      lastSuccessAt: s.lastSuccessAt,
    };
  }
  return out;
}

module.exports = { recordCall, recordError, snapshot };
