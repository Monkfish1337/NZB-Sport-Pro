<p align="center">
  <img src="public/logo-banner.png" alt="SeriousSportSync" width="820">
</p>

# 📅 SeriousSportSync — Sports Metadata & Calendar Add-on

> A self-hosted Stremio/Nuvio add-on that turns combat sports, pro-wrestling and motorsport into proper meta items — with a built-in calendar of upcoming events.
>
> 🎯 **Primarily designed for [Nuvio](https://github.com/zaarrak/Nuvio)** (a Stremio-compatible client). Also works with **Stremio** and other compatible clients.

[![Version](https://img.shields.io/badge/version-0.42.14-blue.svg)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Nuvio](https://img.shields.io/badge/Nuvio-compatible-orange.svg)](#)
[![Stremio Add-on](https://img.shields.io/badge/Stremio-compatible-7b5bf5.svg)](https://www.stremio.com/)

---

## ⚠️ Disclaimer

> This project is a **metadata catalog**, published strictly for **educational** purposes.
>
> SeriousSportSync **hosts no content**, ships **no indexers, no credentials, no playback layer**, and has **no affiliation** with any sport, league, broadcaster, or service. The operator brings their own configuration and is solely responsible for ensuring their use complies with applicable laws and any third-party terms of service.

---

## ✨ What it does

SeriousSportSync is a **sports metadata add-on and event calendar** for Stremio-compatible clients.

- 📅 **Calendar of upcoming events** for every supported sport — see what's airing this week or next month, browsable in Discover.
- 🏷️ **Proper meta items** for sports events that mainstream meta providers (IMDb / TMDb) don't index — so they actually appear as first-class entries rather than being unfindable.
- 🔎 **Smart per-event search aliases** built into each promotion (number, year, matchup, session).

The add-on only emits metadata and catalog data. Stream playback is the responsibility of the user's separately-configured Stremio environment.

---

## 🏆 Covered sports

| Sport | Events | Catalogs |
|-------|--------|----------|
| 🥋 **UFC** | PPVs, Fight Nights, UFC on ABC/ESPN, DWCS | Recent + Upcoming |
| 🥊 **ONE Championship** | Numbered events, Fight Night, Friday Fights | Recent + Upcoming |
| 🎤 **WWE** | PLEs, named NXT events, Saturday Night's Main Event, Main Event mini-PLEs | Recent + Upcoming |
| 🤼 **AEW** | PPVs + Zero Hour pre-shows | Recent + Upcoming |
| 🏎️ **Formula 1** | Per-session items per Grand Prix weekend | Upcoming + per-session catalogs |
| 🏁 **MotoGP** | Per-session items per round | Upcoming + per-session catalogs |
| 🥊 **Boxing** | Cards from major promoters | Recent + Upcoming |

Adding another sport is a single self-contained entry in `lib/promotions.js`.

---

## 🚀 Quick start (Docker)

```bash
git clone https://github.com/<your-user>/serioussportsync.git
cd serioussportsync
cp .env.example .env
# Minimum: SESSION_SECRET (openssl rand -hex 32) and ADMIN_USER.
docker compose up -d --build
```

The container listens on `:7000`.

1. 🔑 Open `http://<your-server>:7000/` — login / first-run signup page. Create an account; if its username matches `ADMIN_USER`, it's auto-promoted to admin.
2. ✅ Copy your install URL from the account page and add it to your Stremio-compatible client (Add-ons → paste URL → Install).

---

## ⚙️ Configuration

Env-driven with sensible defaults. See [`.env.example`](./.env.example) for the full annotated list.

| Variable | Default | Purpose |
|----------|---------|---------|
| `SESSION_SECRET` | _(required, ≥32 chars)_ | Signs login cookies. Generate with `openssl rand -hex 32`. |
| `ADMIN_USER` | — | Username auto-promoted to admin on first signup. |
| `LOGIN_MAX_FAILS` / `LOGIN_WINDOW_MS` / `LOGIN_LOCKOUT_MS` | `5` / `900000` / `900000` | Per-IP login rate-limit. |
| `EVENT_WINDOW_START_DATE` | `2025-01-01` | Earliest date included in the catalog window. |
| `REFRESH_INTERVAL_HOURS` | `6` | How often the metadata cache is refreshed from upstream sources. |
| `STREAM_MAX_ROWS` | `20` | Cap on rows returned per `/stream` request. |
| `WIKIPEDIA_ENRICH` | `on` | Backfill per-event posters from Wikipedia when the primary source has none. Set `off` for fastest refresh if you don't need per-event posters. |
| `STREAM_CACHE_REFRESH` | `off` | Legacy background warmer flag — should stay `off`. |

---

## 🛠️ Admin tools (since 0.35.0)

Two GUI tools under `/admin` let you tune matching and add new sports without code changes.

### Match editor (`/admin/match-editor`)

Per-promotion editor for matching rules. Add release-name aliases or noise-rejection patterns when a real release is being incorrectly rejected. Includes a test bench: paste a release title, pick an event, see whether it would match before saving.

- **Location aliases** — for MotoGP (more promotions coming). If the TSDB event is "United Kingdom" but releases call it "BritishGP" or "Silverstone", add those aliases on the row for "united kingdom".
- **Noise patterns** — extra regex patterns applied per-promotion during the noise filter stage. Use sparingly; the global defaults already cover vlogs, interviews, press conferences, etc.
- **Hot-reload** — saving writes `data/match-overrides.json` and takes effect on the next `/stream` call. No container restart.
- **Defaults are additive** — overrides extend, never replace, the built-in tables. Clearing all overrides reverts to defaults.

### Promotions creator (`/admin/promotions`)

Add new sports without writing code. Works for any TSDB-tracked sport with simple name-based matching (NFL, NBA, MLB, NHL, soccer leagues, regional MMA promotions, etc.). Bespoke promotions like UFC / F1 / MotoGP / WWE / AEW / Boxing / ONE keep their hand-written matching in code — the generic template doesn't try to replace them.

- Built-in promotions show as **read-only** in the list (tagged "built-in").
- Custom promotions are tagged "custom" and have Edit / Delete buttons.
- The "Check TSDB" button on the add/edit form sanity-checks the league id against TSDB and returns a sample of recent events so you know you typed the right id (e.g. 4391 = NFL, 4387 = NBA, 4424 = MLB, 4380 = NHL, 4328 = English Premier League).
- New promotions appear immediately in the catalog list. Run a refresh from `/admin` to populate their events.
- Stored at `data/custom-promotions.json` — backed up alongside other state.

---

## 🧩 Adding a promotion (in code)

For sports needing bespoke matching logic (numbered events, multiple sessions per round, complex name parsing), add to `lib/promotions.js`. For TSDB-tracked sports with simple name matching, prefer the [Promotions creator](#promotions-creator-adminpromotions) above — no code or redeploy needed.

A promotion is a self-contained config object in `lib/promotions.js`:

- `id` / `idPrefix` / `name` — identifiers
- `source` — `{ type: 'thesportsdb', leagueId: '...' }` for TSDB-sourced sports, or a custom source module
- `classify(name)` — bucketise event types (PPV / Fight Night / Race / etc.)
- `shortHandle(name)` — short canonical event handle
- `searchTitles(event)` — array of short scene-style queries
- `isRelevantStreamTitle(title, event)` — relevance filter
- `buildAliases(name)` — full alias list
- `catalogs` — array of `{ id, name, filter, sort }` for the catalogs the promotion exposes
- `defaults` — fallback poster / fanart / logo
- `includeEvent(ev)` — boolean filter applied at refresh time
- `genres(ev)` — Stremio genres for the meta item
- `expandEvents(events)` — *(optional)* synthesise derived events from the source's data

Add the new promotion to the `all` array at the bottom of the file. Catalog, meta, and stream routes wire up automatically.

---

## License

MIT — see [LICENSE](./LICENSE).
