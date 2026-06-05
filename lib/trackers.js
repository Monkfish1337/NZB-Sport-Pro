// 0.32.0 — Public tracker list used to populate the `sources` array on
// infoHash stream rows. Stremio's spec accepts `tracker:<url>` and `dht:<hash>`
// entries; we provide both. Trackers help clients with debrid integrations
// resolve faster than DHT-only lookups, especially for less-popular content.
//
// Same well-known public list that other infoHash-emitting addons ship.
// Edit freely — anything reachable here improves resolve time, but the list
// also gets supplemented per-row with whatever trackers the originating
// magnet URL embeds (extractTrackersFromMagnet in streams.js).

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://public.popcorn-tracker.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://9.rarbg.com:2810/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
];

// Build the `sources` array for a Stremio infoHash stream row.
// Spec accepts:
//   "tracker:udp://..."   — a tracker URL (preferred over DHT)
//   "dht:<infohash>"      — DHT bootstrap with the infohash
function buildSources(infoHash, magnetTrackers) {
  const trackers = new Set();
  for (const t of (magnetTrackers || [])) trackers.add(t);
  for (const t of PUBLIC_TRACKERS) trackers.add(t);
  const out = Array.from(trackers).map((t) => 'tracker:' + t);
  if (infoHash) out.push('dht:' + infoHash.toLowerCase());
  return out;
}

// Extract tracker URLs from a `tr=...` magnet URL. Magnet URLs typically embed
// the trackers the indexer thought worked at index time — those are usually
// the most reliable for that specific torrent.
function extractTrackersFromMagnet(magnetUrl) {
  if (!magnetUrl || typeof magnetUrl !== 'string') return [];
  const out = [];
  // tr= can appear multiple times, URL-decoded values.
  const re = /[?&]tr=([^&]+)/g;
  let m;
  while ((m = re.exec(magnetUrl))) {
    try { out.push(decodeURIComponent(m[1])); } catch (_) { out.push(m[1]); }
  }
  return out;
}

module.exports = { PUBLIC_TRACKERS, buildSources, extractTrackersFromMagnet };
