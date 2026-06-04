// 0.31.1: TorBox direct integration retired.
//
// 0.31.0 attempted to use TorBox's `search-api.torbox.app/newznab/api` as a
// per-user backend. In practice this returned "Rate limit exceeded: 0 per
// 1 minute" for every request, because TorBox's search-api is a thin
// proxy over user-connected indexers (set up via the TorBox dashboard),
// not a standalone content database. Without indexers pre-configured on
// TorBox's side, the endpoint is closed regardless of plan tier.
//
// Any submit-poll-redirect alternative (using TorBox's main /usenet API)
// would put our addon back in the playback path, violating the isolation
// principle established in 0.30.0 (catalog/metadata layer only — third
// parties handle stream resolution).
//
// This module is retained as a placeholder so any leftover require() in
// older code or user JSON does not crash. It exports nothing functional.
// Will be deleted in a future cleanup pass.

module.exports = {};
