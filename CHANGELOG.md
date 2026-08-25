# Changelog

## 0.4.7

### Public configuration administration

- Replaced the legacy stored-account and invite interface with management for
  the encrypted configurations actually created through `/configure`.
- Added privacy-safe configuration summaries with status, dates, indexer and
  catalog counts, playback limits, and pre-show filtering state. Secrets,
  indexer URLs, and private editing links are never rendered.
- Added admin controls to disable, re-enable, or permanently delete a public
  configuration. Disabled manifests immediately stop resolving.
- Retired the remaining stored-user, invite, match-test, and public invitation
  routes. With environment auth enabled, legacy stored accounts cannot sign in.
- Renamed the main admin navigation to **Configurations** and improved its
  empty state, destructive confirmations, and configurator shortcut.

## 0.4.6

### Authoritative admin authentication

- Made `ADMIN_USER` and `ADMIN_PASSWORD` authoritative for maintenance access;
  old setup-created administrator accounts can no longer bypass environment
  authentication when both variables are configured.
- Added an unambiguous startup log confirming that environment administrator
  authentication is active, without logging the password.
- Added an **Admin login** button to the top-right of the public configurator.

## 0.4.5

### Public configuration resilience

- Made `/health` return HTTP 503 when the encrypted public configuration store
  is malformed or contains records that cannot be decrypted with the current
  `SESSION_SECRET`, allowing Docker and monitoring to detect a broken restore.
- Added encrypted public configuration integrity and capacity information to
  the operator health page without exposing it through the public endpoint.
- Updated the administrator backup to use NZB-Sport-Pro branding and clarify
  that restoring `/app/data` requires the exact separately backed-up secret.
- Added regression coverage for healthy, missing, and corrupt stores.
- Reduced the operator dashboard to metadata refresh, stored-user management,
  health, logs, and backup; retired SeriousSportSync tools now return 404.
- Added environment-managed dashboard authentication with `ADMIN_USER` and
  `ADMIN_PASSWORD`, retaining `/setup` only as an optional stored-user fallback.

## 0.4.4

### Result controls and editing-link guidance

- Added an optional advanced filter for prelims, preliminary cards, pre-shows,
  countdowns, kickoff shows, and Zero Hour releases. Filtering happens before
  NZB preparation and TorBox cache checks.
- Made the private editing link a prominent orange warning panel explaining
  that it is the only way to reopen the configuration after the page closes.
- Added editing-link reminders to save, copy, collection, and install feedback.

## 0.4.3

### Configurator interaction hotfix

- Corrected escaping in the generated configurator script that prevented all
  button event handlers from being registered in the browser.
- Added a regression that compiles the final generated inline script, plus a
  browser interaction pass covering Add indexer, Test services, and Save edits.

## 0.4.2

### Safer public configuration management

- Added a prominent Save edits action with a clear confirmation before the
  Stremio and Nuvio install tools.
- Added read-only TorBox and Newznab connection tests with specific feedback
  for rejected keys, rate limits, timeouts, blocked addresses, provider API
  errors, and endpoints that do not return Newznab XML.
- Added manifest rotation without changing the private editing link, allowing
  a user to invalidate and reinstall a leaked use-only manifest.
- Added permanent deletion of a stored public configuration, invalidating both
  its manifest and private editing link.
- Separated configure, connection-test, edit, and lifecycle rate-limit buckets
  so normal configuration management cannot exhaust an unrelated action.

## 0.4.1

### Faster-playback result sizing

- Added an optional per-user maximum result size, applied before NZB
  preparation and TorBox cache checks while retaining results without size
  metadata.
- Corrected maximum-stream enforcement after relevance and size filtering.

## 0.4.0

### Public-host security and privacy hardening

- Split the installed use-only manifest capability from the private editing
  capability, keeping editing secrets in browser URL fragments and
  authorization headers rather than request paths.
- Moved public configurations into an encrypted persistent store with bounded
  capacity and strict file permissions.
- Added public-origin validation, secure response headers, request-body limits,
  setup protection, central secret redaction, and stream/resolve rate and
  concurrency controls.
- Added DNS pinning and private-address protection for user-configured Newznab
  endpoints, including strict redirect handling and bounded response bodies.
- Updated the container runtime to Node.js 24 and verified the production
  dependency tree without known audit findings at release time.

## 0.3.2

### Long TorBox processing without exhausting player redirects

- Rebalanced automatic playback from many short resolver redirects to an
  initial request plus five continuations of up to 35 seconds each, covering
  roughly three and a half minutes while retaining redirect headroom for the
  final TorBox/CDN URL.
- Made the TorBox status-poll attempt count follow the configured wait window;
  longer waits now continue polling instead of silently stopping after about
  twenty checks.

## 0.3.1

### Automatic playback after TorBox processing

- Kept an uncached result's original playback request alive through a bounded
  chain of signed resolver redirects while TorBox processes the Usenet job.
- Redirected directly to the TorBox media URL as soon as a playable file is
  available, removing the normal need to back out and click the row again.
- Reused the same pending TorBox job throughout and retained the existing
  processing response as the timeout fallback; video data is never proxied.
- Detected terminal TorBox Usenet states such as failed, expired, missing, and
  aborted; these now stop the wait chain, emit the job ID, release title,
  state, and available TorBox reason as an error log, and tell the user to
  choose another result.

## 0.3.0

### Collections and honest wait-to-play states

- Added first-class Nuvio collection Download and Copy JSON actions to the
  stateless public configurator.
- Assigned NZB-Sport-Pro its own stable collection and folder IDs so Nuvio no
  longer merges the export with a previously imported SeriousSportSync collection.
- Removed the obsolete direct indexer-link attachment option and always keeps
  credential-bearing Newznab URLs out of TorBox submissions.
- Reserved Instant Play for completed downloads already owned by the user;
  shared-cache matches now clearly say attach-and-wait.
- Added bounded TorBox job polling, pending-job reuse, processing rows and
  no-store stream responses so repeated clicks and reopened events do not add
  duplicate downloads or display stale queue state.
- Added a normal queue fallback when TorBox reports a shared-cache hash that
  cannot actually be attached to the user's library.

## 0.2.0

### Stateless hosted-addon configurator

- Replaced public signup and account creation with a Comet-style configuration
  page that directly generates private Stremio and Nuvio URLs.
- Added authenticated AES-256-GCM configuration tokens, so public users are not
  written to the user database and secrets never appear as plaintext in URLs.
- Added token-scoped manifest, catalog, metadata, stream, resolve, edit and
  Nuvio collection routes while retaining the operator tools separately.
- Made the root URL open the configurator and documented that changing the
  server session secret invalidates previously generated manifests.

## 0.1.0

### Standalone public product split

- Split the native Newznab to TorBox Usenet work into NZB-Sport-Pro with its
  own addon identity, repository, container and release lifecycle.
- Added the initial public product shell and private configuration work while
  retaining an operator-only setup surface.
- Focused the user interface on TorBox and personal Newznab indexers; the
  SeriousSportSync stable release remains unchanged.
- Added a declared metadata boundary and six-hour workflow that imports and
  tests canonical metadata updates from SeriousSportSync main.
- Retained explicit owned/instant and click-to-queue behaviour without
  claiming reliable global TorBox Usenet cache detection.

## 0.46.0-experimental.6

### Expanded TorBox Usenet cache coverage

- Expanded the native Newznab TorBox POST cache check from 100 hashes to a
  conservative 2,000-hash cap so first-message IDs from substantially more NZB
  files can participate in shared-cache matching.
- Preserved fair interleaving across displayed results and added the submitted
  hash count to cache diagnostics.
- Kept cache discovery read-only and retained owned-library fallback behavior.

## 0.46.0-experimental.5

### Link-identified TorBox cache attachment experiment

- Added a disabled-by-default per-user consent switch that permits a clicked
  link-matched cache result to send its credential-bearing NZB download URL to
  TorBox instead of uploading the NZB file.
- Split shared-cache diagnostics into link and content match counts so live
  tests show whether the direct attachment path is applicable.
- Prevented Newznab links whose item identity lives in query parameters from
  using TorBox's query-stripped alternative hash, which could falsely mark all
  results from the same indexer endpoint as cached.
- Kept owned-job reuse, content-matched uploads, and queue behavior unchanged;
  no indexer URL or API key is returned to the playback client or written to
  logs.
- Added the running application version to container startup logs.

## 0.46.0-experimental.4

### Isolated native Newznab → TorBox Usenet development

- Added an opt-in, per-user native Newznab search pipeline that keeps indexer
  API keys encrypted and credential-bearing NZB links out of client responses.
- Added bounded in-memory NZB preparation and a batched TorBox shared-cache
  check, producing distinct instant-play and explicit queue rows. Matching uses
  TorBox's documented message-ID, NZB-file, and exact/normalized link hashes;
  every displayed native row is prepared and classified by default.
- Completed downloads already owned by the user are matched through TorBox's
  Usenet list and reused directly when the shared cache endpoint misses them.
- Shared-cache batches prioritize one message ID plus cleaned/raw NZB and
  exact/normalized URL hashes for every displayed result before extra IDs.
- Cached attachment timeouts are recovered through a forced-fresh TorBox user
  list lookup, allowing the original click to continue to playback.
- Cached clicks use TorBox cached-only creation; uncached content is not added
  to a user's account until its queue row is clicked. SSS never stores NZBs on
  disk or proxies media.
- Added independent GUI enable switches for TorBox torrents, Usenet Ultimate,
  Easynews, and native Newznab without clearing saved credentials.
- Assigned enabled experimental deployments a separate addon ID and name so
  they can be installed alongside the current stable release.
- Added public-host safeguards for indexer endpoints plus mocked end-to-end
  coverage for search, filtering, signed resolve, TorBox upload, and playback.

## 0.45.5

### TorBox Unified discovery probe

- Added a read-only account diagnostic for TorBox Voyager torrent and Usenet
  searches with cache, ownership, and the user's configured BYOI sources.
- Sanitised the diagnostic response so API keys and full NZB/download URLs are
  never returned to the browser or written to the report.
- Kept the existing companion, UU, and playback pipelines unchanged while the
  current TorBox Search API contract is verified against real sports queries.

## 0.45.4

### Prowlarr torrent hash recovery

- Authenticated Prowlarr download-proxy hydration requests and safely followed
  redirects without forwarding the API key to external indexer hosts.
- Added info-hash recovery from ordinary `.torrent` response bodies so raw
  Prowlarr hits are no longer discarded when no magnet redirect is available.

## 0.45.3

### Manchester United torrent discovery

- Made the companion and direct Prowlarr use one precise Manchester United
  fixture query in scene order: `competition + date + teams`.
- Removed HCAFC, nickname, `@`, date-last, and undated variants from the
  Manchester United torrent path while retaining UU's optimized fallbacks.

## 0.45.2

### Manchester United UU search latency

- Prioritised football scene-style `competition + date + teams` searches for
  Manchester United fixtures.
- Reduced Manchester United's UU direct-search fan-out from twelve parallel
  queries to four precise variants to avoid local index-manager timeouts.

## 0.45.1

### New-catalog account migration

- Automatically enabled the two Manchester United catalogs once for accounts
  that saved an explicit catalog list before version 0.45.0.
- Preserved the ability to disable either catalog after the migrated account
  settings are saved.

## 0.45.0

### Manchester United catalogs

- Added built-in `Man United Upcoming` and `Man United Recent` catalogs.
- Added team-scoped football-data.org refreshes so Manchester United fixtures
  are combined across every competition available to the configured API key.
- Added domestic and European opponent aliases, exact-date release matching,
  and both catalogs to the generated Nuvio Football collection folder.

## 0.44.4

### Collection copy compatibility

- Made Copy JSON work on plain-HTTP account pages and older browsers by
  embedding the generated payload and falling back to selection-based copy.
- Added a Nuvio Desktop-compatible collections-only manifest mode alongside
  the `showInHome` hint, while keeping every collection source resolvable.

## 0.44.3

### Collections-only manifest fix

- Kept collection-backed catalogs registered in the manifest when home rows
  are disabled, and now mark them with Nuvio's `showInHome: false` hint.
- Fixed imported collection folders becoming empty in collections-only mode.

## 0.44.2

### Catalog home-row visibility

- Added a per-account option to hide enabled catalog rows from the generated
  manifest while keeping their endpoints available to imported Nuvio
  collections.
- Existing accounts continue showing home rows unless they explicitly switch
  to a collections-only layout.

## 0.44.1

### Nuvio collection artwork

- Renamed the generated collection from SSS to SeriousSportSync.
- Added matching orange-and-black folder artwork for Combat Sports,
  Wrestling, Football, and Motorsport instead of using promotion artwork.

## 0.44.0

### Nuvio collections export

- Added an account download that generates Nuvio's native collections JSON
  schema for the user's enabled SSS catalogs and saved ordering.
- Added Combat Sports (UFC, ONE, Boxing), Wrestling (WWE, AEW), Football
  (Match of the Day), and Motorsport (Formula 1, MotoGP) folders.
- Added Download JSON and Copy JSON actions for Nuvio website and app imports,
  using public SSS artwork URLs and stable collection/folder identifiers.
- Removed the retired stream-cache module from CI's module-load list.

## 0.43.9

### Catalog ordering UI fix

- Changed promotion groups from a three-column grid to one top-down sequence
  matching the order shown by Nuvio.
- Replaced unreliable native button dragging with direct mouse, touch, and pen
  pointer movement so grabbing a handle moves its promotion or catalog row.

## 0.43.8

### Per-user catalog ordering

- Added drag handles for reordering promotion blocks and the catalogs inside
  each promotion on the account Catalogs screen.
- Added touch/pen dragging and keyboard arrow controls to the same handles.
- Persisted each account's order and applied it directly to the generated
  manifest, so Nuvio and Stremio receive catalogs in the chosen sequence.
- Kept existing accounts compatible and append newly introduced promotions or
  catalogs without discarding saved ordering.

## 0.43.7

### Scene-title keyword matching

- Fixed UU results such as `Match.Of.The.Day.2026.08.23` being rejected as
  `no-keyword-match` when promotion keywords contained spaces.
- Phrase matching now treats dots, underscores, and hyphens as word separators
  while preserving date-strict event validation.

## 0.43.6

### Remove proactive stream warming

- Removed the scheduled and boot-time all-event stream-candidate warmer.
- Removed the manual global warm route, persistent candidate database, warmer
  status files, configuration variables, and health-page controls.
- Companion and direct Prowlarr discovery are now strictly request-only for
  the single event a user opens.
- Kept explicit per-event admin tools using short-lived in-memory candidates;
  they never launch a catalog-wide search.

## 0.43.5

### Match of the Day catalog lifecycle

- Split Match of the Day into Upcoming and Recent catalogs, following the
  same air-date transition and sort behavior as other SSS promotions.
- Limited retained and displayed episodes to the active July-June football
  season so old weekly episodes are pruned at refresh time.
- Added branded Match of the Day fallback artwork for episodes whose TMDB
  metadata has no still image.

## 0.43.4

### Refresh failure reporting

- Targeted TMDB promotion refreshes now return `ok: false` with an explicit
  error when `TMDB_API_KEY` is missing or the TMDB source is unavailable.
- Admin logs now label unsuccessful per-promotion results as `failed` instead
  of reporting them as complete with zero updates.

## 0.43.3

### Match of the Day catalog

- Added one combined Match of the Day catalog backed by the TMDB entries for
  Match of the Day and Match of the Day 2.
- Normalised both shows to `Match of the Day DD MM YYYY` for catalog display,
  indexer searches, and date-strict stream matching.
- Added show-aware TMDB episode IDs so episodes from the two series cannot
  overwrite one another when season and episode numbers coincide.

### Provider-owned Usenet Ultimate discovery

- Replaced SSS's server-wide Newznab search with manifest-scoped direct title
  search through each user's Usenet Ultimate instance.
- UU now owns its indexer credentials and discovery; SSS supplies promotion-
  aware event titles, applies sports relevance filtering, and returns NzbDAV
  playback rows to Nuvio/Stremio.
- Documented the temporary `ghcr.io/monkfish1337/usenet-ultimate:sss-direct`
  compatibility image while the upstream UU endpoint is under review.
- Removed obsolete `NEWSNAB_*` configuration, scripts, and admin wording.
- Renamed the per-promotion `newsnab` pipeline toggle to `uu`, with backward
  compatibility for existing saved promotions.

## 0.43.2

### Guided promotion setup

- Reworked Content Studio's promotion creator into a two-step source wizard.
- Automatically infers the short ID, safe search templates, recognition terms,
  date matching, and known football team/league alias presets.
- Previews real recent/upcoming source events and imports available source
  artwork before creation, making an incorrect source easy to spot.
- Starts the promotion's first event import automatically after creation.

### Matchup stream matching

- Added reversed and `@` search variants for generic matchup promotions such
  as NBA, NHL, and MLB, including exact ISO/DMY date variants.
- Treats both canonical team names plus an exact fixture date as authoritative,
  regardless of home/away order or overly narrow promotion keywords.
- Added full `YYYY-YYYY` season-token support alongside `YYYY-YY`.
- Fixed completed/skipped pipelines emitting phantom timeout logs later because
  their timeout timers were not cancelled.
- Stream requests now use the composed Content Studio event store, so saved
  event aliases and overrides affect playback searches.

## 0.43.1

### TheSportsDB source discovery

- Fixed Content Studio throwing `slice(...).map is not a function` when a
  TheSportsDB name search returned its string error payload.
- Replaced the unsupported v1 league-name query with the free API's exact
  league-name team lookup and deduplicated its league results.
- Added direct numeric league-ID lookup and clearer free-API search guidance.
- Updated the default public v1 API key from the legacy `3` key to TheSportsDB's
  documented `123` key, raising season results from 5 to the free limit of 15.
- Existing deployments that still set `TSDB_API_KEY=3` are migrated to `123`
  automatically; premium/user keys remain untouched.
- Added automatic split-season detection so NBA/EPL-style leagues query
  `2025-2026` and `2026-2027` rather than empty calendar-year seasons.
- Added refresh logging when a response reaches the free 15-event schedule cap.

## 0.43.0

### Content Studio

- Added a promotion overview with visible, manual, and review-pending counts.
- Added refresh-safe manual events, source-event overrides, disabling,
  restoring, resetting, and deletion controls.
- Added a missing-event inbox for promotion-filter rejections and possible
  duplicates, with accept, merge, and ignore decisions.
- Added previewed ICS, CSV, and JSON event imports.
- Added guided matching suggestions that turn good and bad release examples
  into per-event search aliases and exclusion patterns.
- Added searchable TheSportsDB, football-data.org, and TMDB source discovery
  to a simplified promotion wizard, while keeping the advanced editor.
- Stored editorial content separately from the refreshed source cache so
  catalog refreshes cannot overwrite manual work.

## 0.42.17

### Broader direct Prowlarr discovery

- Removed the forced Movies, TV, and Other category filters from direct Prowlarr searches.
- Prowlarr indexers such as Bitmagnet can now return results from their full text-search index.
- SeriousSportSync still applies its promotion relevance filtering before showing streams.

## 0.42.16

### Direct Prowlarr request boundary

- Fixed direct Prowlarr being queried by the scheduled stream-cache warmer.
- Direct Prowlarr now runs only for user event stream requests and explicit
  admin live searches.
- The warmer exits immediately when no companion scraper is configured,
  preventing event-window fan-out and empty cache rewrites.

## 0.42.15

### Direct Prowlarr

- Restored optional direct Prowlarr configuration in the SeriousSportSync
  admin panel and through `PROWLARR_URL` / `PROWLARR_API_KEY`.
- Direct Prowlarr and companion-scraper candidates now merge by info hash
  before relevance filtering and per-user TorBox cache checks.
- Restored Prowlarr hash extraction and bounded download-proxy hydration
  without returning raw torrent rows to clients.
- Added Prowlarr status to `/health` and stream availability detection to
  the addon manifest.

## 0.42.14

Catch-up release covering the unpublished work since GitHub version 0.33.0.

### Streaming and providers

- Added direct Easynews search and deferred authenticated playback.
- Added TorBox cache checks, signed resolve-on-play URLs, and optional
  warm-to-cache rows for uncached releases.
- Restored per-NZB Usenet Ultimate rows with multi-Newznab endpoint support,
  indexer attribution, subtitle hints, and stronger deduplication.
- Added per-promotion pipeline controls and an eight-second pipeline budget so
  slow providers do not hold the entire stream response open.
- Expanded filtering for sports noise, foreign-language results, release year,
  exact event dates, team aliases, and duplicate titles.

### Catalogs and matching

- Added custom promotion creation and editing from the admin interface.
- Added promotion-specific alias/noise overrides and an interactive match test
  bench.
- Added football-data.org competitions with bidirectional team aliases and
  date-strict fixture matching.
- Added TMDB episode sources for dated sports programmes.
- Added per-promotion refreshes and hot-reloaded catalog definitions.
- Improved UFC, WWE, AEW, Formula 1, boxing, MotoGP, and football title
  generation and relevance matching.

### Administration and operations

- Reworked the account and administration interface with shared Tabler page
  chrome.
- Added general search and grab tools for qBittorrent, SABnzbd, and TorBox.
- Added cache warming controls, health/log views, source validation, and
  safer secret handling.
- Added backup scripts and systemd timer/service examples for runtime state.

### Companion scraper

- Bundled the SeriousSportSync scraper source, including Prowlarr, Torznab,
  Zilean, Knaben, TheRARBG, and Bitsearch adapters.
- Added scraper history, statistics, source configuration, logs, general
  search, and downloader management.

### Compatibility and fixes

- Improved Nuvio/Stremio presentation, manifest stream advertisement, artwork
  fallbacks, result metadata, request timeouts, proxy handling, and redaction.
- Includes all maintenance fixes through 0.42.14.
