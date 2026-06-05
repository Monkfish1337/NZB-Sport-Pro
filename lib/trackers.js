// 0.33.0: Tracker list module retired. The metadata addon no longer
// emits infoHash stream rows — TorBox-resolved playback URLs are returned
// instead, so trackers and DHT bootstrap are no longer relevant.
//
// Stub retained for any leftover require() in older code.

module.exports = {
  PUBLIC_TRACKERS: [],
  buildSources: () => [],
  extractTrackersFromMagnet: () => [],
};
