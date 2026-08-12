// 0.36.0 — DELETED. This file is a no-op placeholder kept only because the
// Cowork bash mount couldn't unlink it during local cleanup. Remove it from
// the server in the deploy walkthrough:
//   rm /mnt/storage/stremio-stack/serioussportsync/lib/sources/torbox-usenet.js
//
// Previously: 0.31.0 attempted to use TorBox's search-api newznab proxy.
// 0.31.1 rolled that back in favour of the Newsnab + UU handoff, and this
// file became a stub. Now removed entirely — no code references it.
module.exports = {};
