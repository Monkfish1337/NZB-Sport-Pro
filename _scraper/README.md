# SeriousSportSync Scraper

Companion indexer-aggregator for the SeriousSportSync metadata addon.

The metadata addon stays content-neutral. This service does the dirty work — querying Prowlarr, Zilean (DMM), Knaben, raw Torznab feeds, anything you wire in — and returns a flat list of release-candidate metadata to the addon, which in turn resolves them against the user's debrid provider and returns only playable URLs.

> Private companion. Not intended for public distribution. Run it on your own infrastructure, behind your own auth.

---

## How it fits

```
   Stremio client                                      
        │ /stream                                      
        ▼                                              
   ┌──────────────────────┐                            
   │  SeriousSportSync    │  POST /scrape              
   │  metadata addon      │ ─────────────────────►  ┌──────────────────────┐
   │  (public)            │ ◄─── candidates ──────  │ SeriousSportSync     │
   │                      │                         │ Scraper (this repo)  │
   │  resolves via        │                         │  • Prowlarr          │
   │  TorBox / etc.       │                         │  • Zilean            │
   │  returns playable    │                         │  • Knaben            │
   │  URLs only           │                         │  • Torznab           │
   └──────────────────────┘                         └──────────────────────┘
```

The scraper never speaks to the Stremio client and never resolves candidates to playable links. Its sole job: take a `{promotion, event, searchTitles}` request, fan out to every configured source in parallel, return a deduped list of `{infoHash, title, size, seeders, indexer, magnetTrackers}`.

---

## Running

Docker is the supported deployment path.

```bash
cd _scraper
cp .env.example .env
# edit .env — set SCRAPER_AUTH_TOKEN to a long random string
docker compose up -d
```

Open `http://<host>:8080/` for the GUI.

The metadata addon's `/admin → Sources` page is where you point at this service (companion URL + auth token).

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | bind address |
| `PORT` | `8080` | listen port |
| `SCRAPER_AUTH_TOKEN` | _(unset = open)_ | bearer token required on `/scrape` |
| `SOURCE_TIMEOUT_MS` | `10000` | default per-source request timeout |
| `SCRAPE_BUDGET_MS` | `25000` | hard ceiling on overall `/scrape` time |
| `LOG_BUFFER_MAX` | `4000` | in-memory log ring buffer size |
| `HISTORY_MAX` | `200` | on-disk `/scrape` call retention |
| `HTTPS_PROXY` | _(unset)_ | outbound proxy (e.g. `http://gluetun:8888`) |
| `NO_PROXY` | _(see compose)_ | comma-separated hosts that bypass the proxy |
| `DATA_DIR` | `/app/data` | persistent state directory |

---

## GUI tour

- **Dashboard** — stat tiles, per-source health, recent `/scrape` calls, activity tail.
- **Sources** — add / edit / delete sources; enable/disable toggle; per-source `Test` probe; schema-driven forms (each source type declares its own config schema, the form is generated from it).
- **Search** — manual probe. Paste search titles, see what every enabled source returns side-by-side. Useful for "why is this event coming back thin".
- **Logs** — live tail via Server-Sent Events; level/category/source/text filters; pause + clear.
- **History** — newest-first list of `/scrape` calls; click any row for per-source breakdown (latency, returned count, status pill).
- **Settings** — runtime config display; clear history; clear log buffer; export/import `sources.json`.

---

## Supported source types

Each source type lives at `lib/sources/<type>.js` and exports a small contract:

```js
module.exports = {
  type: 'prowlarr',
  label: 'Prowlarr',
  description: 'Federated Torznab aggregator…',
  schema: [
    { name: 'url',    label: 'Base URL', type: 'url',    required: true },
    { name: 'apiKey', label: 'API key',  type: 'secret', required: true },
    // …
  ],
  async multiSearch(searchTitles, config, log) { /* return candidates */ },
  async test(config, log)                       { /* return {ok, message} */ },
};
```

To add a new source type: drop a new file, register it in `lib/sources/registry.js`, restart. The GUI picks it up automatically — no view code change.

Built-in types in v0.1:

- **prowlarr** — federated Torznab; supports hash hydration via the `/download` proxy when an indexer only returns a `magnetUrl`.
- **zilean** — DebridMediaManager hashlist mirror (`POST /dmm/search`).
- **knaben** — Knaben multi-tracker aggregator (`POST /v1`).
- **torznab** — generic Torznab XML feed; bring your own indexer URL + API key.

---

## API protocol

Single endpoint. Auth via `Authorization: Bearer <SCRAPER_AUTH_TOKEN>` if configured.

```
POST /scrape
Content-Type: application/json
Authorization: Bearer <token>

{
  "promotion": "ufc",
  "event": { "name": "UFC 291", "date": "2026-07-29" },
  "searchTitles": ["UFC 291", "UFC.291.PPV"]
}
```

Response:

```json
{
  "candidates": [
    {
      "infoHash": "abcdef…",
      "title": "UFC.291.PPV.1080p.WEB-DL",
      "size": 5400000000,
      "seeders": 42,
      "indexer": "Prowlarr/<indexer-name>",
      "magnetTrackers": ["udp://tracker.example:6969"],
      "publishDate": "2026-07-30T00:00:00Z"
    },
    …
  ]
}
```

The metadata addon takes it from there: TorBox batched cache-check on the infoHashes, resolve cached candidates to playable URLs, return Stremio `url` rows only.

---

## Operations notes

- State is a flat JSON file (`data/sources.json` + `data/history.json`). Atomic-rename writes, file mode `0o600`. Volume-mount `/app/data` to survive container rebuilds.
- Logs mirror to `stdout`, so `docker logs serioussportsync-scraper` works fine, but the in-GUI log viewer is faster (SSE, filterable, no shell needed).
- Per-source timeouts are independent; one dead indexer doesn't stall the rest. The overall `SCRAPE_BUDGET_MS` is the hard ceiling.
- All outbound HTTP honors `HTTPS_PROXY` + `NO_PROXY` if set — point at gluetun if you want the scraper to share its VPN egress.

---

## Status

v0.1 — foundation. Designed for a single operator running it next to their metadata addon. No multi-tenant auth, no rate limiting, no user accounts. Front with a reverse proxy if you expose it.
