# Backlog

## AIOStreams external title-search integration

Deferred until AIOStreams exposes an authenticated external title-search API.

- Publish each event's promotion-generated queries as
  `meta.behaviorHints.searchTitles`.
- Add contract coverage for UFC, AEW, and unknown promotions.
- Add per-user AIOStreams connection settings to SeriousSportSync.
- Submit `type`, `titles[]`, and optional `year` to AIOStreams.
- Merge returned rows with the existing TorBox, Easynews, and Usenet
  pipelines.
- Prevent recursive requests back into SeriousSportSync.
