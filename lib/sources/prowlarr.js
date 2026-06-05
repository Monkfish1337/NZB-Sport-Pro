// 0.33.0: Prowlarr integration retired from the metadata addon.
//
// Indexer-side work moved to the SeriousSportScraper companion service,
// which the operator deploys separately and configures via the admin
// "Companion Scraper URL" field. This keeps the public metadata addon
// free of any content-providing code paths.
//
// Stub retained so any leftover require('./sources/prowlarr') in older
// versions of the user's data files or downstream forks doesn't crash.

module.exports = { search: async () => [], multiSearch: async () => [] };
