<p align="center">
  <img src="public/logo-banner.png" alt="SeriousSportSync" width="820">
</p>

# 📅 SeriousSportSync — Sports Metadata & Calendar Add-on

> A self-hosted Stremio/Nuvio add-on that turns combat sports, pro-wrestling and motorsport into proper meta items — with a built-in calendar of upcoming events and an optional handoff to your own Usenet stack for stream playback.
>
> 🎯 **Primarily designed for [Nuvio](https://github.com/zaarrak/Nuvio)** (a Stremio-compatible client tuned for sports/live content). Also works with **Stremio** and other compatible clients.

[![Version](https://img.shields.io/badge/version-0.31.1-blue.svg)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Nuvio](https://img.shields.io/badge/Nuvio-compatible-orange.svg)](#)
[![Stremio Add-on](https://img.shields.io/badge/Stremio-compatible-7b5bf5.svg)](https://www.stremio.com/)

---

## ⚠️ Disclaimer

> This project provides **event metadata** and constructs hand-off URLs to third-party services that the operator chooses to configure. It is published strictly for **educational and personal-use** purposes.
>
> SeriousSportSync **hosts no content**, ships **no indexers, no provider credentials, no playback layer**, and has **no affiliation** with any sport, league, broadcaster, indexer, or service. The operator brings their own accounts and is solely responsible for ensuring their use complies with the terms of those services and the laws of their jurisdiction.

---

## ✨ What it does

SeriousSportSync is a **sports metadata add-on and event calendar** for Nuvio / Stremio.

- 📅 **Calendar of upcoming events** for every supported sport — see what's airing this week or next month, browsable in Discover.
- 🏷️ **Proper meta items** for sports events that mainstream meta providers (IMDb / TMDb) don't index — so they actually appear as first-class entries rather than being unfindable.
- 🔎 **Smart per-event search aliases** built into each promotion (number, year, matchup, session) so name-matching indexers can find the right scene release for the right event.
- 🔌 **Handoff to your own playback stack** — the add-on constructs URLs that resolve through your configured **Usenet Ultimate** instance (or any compatible URL-based handoff target). The add-on never touches the playback path itself.

---

## 🏆 Covered sports

| Sport | Events | Catalogs |
|-------|--------|----------|
| 🥋 **UFC** | PPVs, Fight Nights, UFC on ABC/ESPN, DWCS | Recent + Upcoming |
| 🥊 **ONE Championship** | Numbered events, Fight Night, Friday Fights | Recent + Upcoming |
| 🎤 **WWE** | PLEs, named NXT events, Saturday Night's Main Event, Main Event mini-PLEs | Recent + Upcoming |
| 🤼 **AEW** | PPVs + Zero Hour pre-shows | Recent + Upcoming |
| 🏎️ **Formula 1** | Per-session items per Grand Prix weekend | Upcoming Races + Race / Qualifying / Sprint / Sprint Qualifying / Practice |
| 🏁 **MotoGP** | Per-session items per round | Upcoming Races + Race / Qualifying / Sprint / Practice |
| 🥊 **Boxing** | PPV cards from major promoters (Top Rank, PBC, Matchroom, MVPW, etc.) | Recent + Upcoming |

Adding another sport is a single self-contained entry in `lib/promotions.js`.

---

## 🔌 How it talks to your stack

```
   Nuvio / Stremio          ┌───────────────────────────────┐
   ──catalog / meta─────────►   SeriousSportSync             │
            ◄────rows────   │   metadata · calendar · cache │
                            └────────────┬──────────────────┘
                                         │ stream rows
                                         │ contain URLs
                                         ▼
                            Your Usenet Ultimate instance
                            (or any URL-compatible handoff target)
                                         │
                                         ▼
                            Resolves via NzbDAV / Usenet provider
                            → playable HTTP stream
```

The add-on **does not** run the indexer, downloader, or streaming layer. Each user provides the URL of a Usenet Ultimate (UU) instance they have access to (Elfhosted-hosted is the documented path; self-hosted alternatives are on the roadmap). The add-on builds a UU-shaped handoff URL embedding the search title and returns that as the stream row's URL. When the user presses play, their UU instance handles the download + serve.

---

## 🚀 Quick start (Docker)

```bash
git clone https://github.com/<your-user>/serioussportsync.git
cd serioussportsync
cp .env.example .env
# Minimum required: SESSION_SECRET (openssl rand -hex 32), ADMIN_USER,
# NEWSNAB_URL + NEWSNAB_API_KEY (your Newznab indexer for catalog searches).
docker compose up -d --build
```

The container listens on `:7000`. First-run setup:

1. 🔑 Open `http://<your-server>:7000/` — you'll get a login / first-run signup page. Create an account; if its username matches `ADMIN_USER`, it's auto-promoted.
2. 🛠️ In **Admin → Indexer sources**, confirm your Newznab endpoint + API key. These can also be set via env vars; the GUI overrides env.
3. 🔌 On your **account page**, paste your **Usenet Ultimate manifest URL** into the Services tab. Looks like `https://<your-uu>.elfhosted.com/stremio/<config>/manifest.json`. Save.
4. ✅ Copy your personal **install URL** from the account page and add it in **Nuvio** (or Stremio): **Add-ons → paste the URL → Install**.

The catalog/metadata side works without UU configured (you'll just see the help row in stream lists prompting you to set it up).

---

## ⚙️ Configuration

Everything is env-driven with sensible defaults (see [`.env.example`](./.env.example) for the full annotated list).

| Variable | Default | Purpose |
|----------|---------|---------|
| `SESSION_SECRET` | _(required, ≥32 chars)_ | Signs login cookies — generate with `openssl rand -hex 32`. The server refuses to boot if unset or too short. |
| `ADMIN_USER` | — | Username auto-promoted to admin on first signup. |
| `LOGIN_MAX_FAILS` / `LOGIN_WINDOW_MS` / `LOGIN_LOCKOUT_MS` | `5` / `900000` / `900000` | Per-IP login rate-limit. |
| `EVENT_WINDOW_START_DATE` | `2025-01-01` | Earliest date included in the catalog window. Usenet retention is multi-year, so older content remains accessible — extend back further if your indexer carries it. |
| `REFRESH_INTERVAL_HOURS` | `6` | How often the metadata cache is refreshed from upstream sources. |
| `NEWSNAB_URL` / `NEWSNAB_API_KEY` / `NEWSNAB_CATEGORIES` | — / — / `5000,5080,8000` | Newznab/Torznab v2 endpoint for catalog searches (NZBgeek, NZBfinder, etc). Admin-shared across all users. |
| `STREAM_MAX_ROWS` | `20` | Cap on rows returned per `/stream` request, after filtering + sorting. |
| `STREAM_CACHE_REFRESH` | `off` | Legacy background warmer flag. Should be `off` for 0.30.0+. |

---

## 🧩 Adding a promotion

A promotion is a self-contained config object in `lib/promotions.js`:

- `id` / `idPrefix` / `name` — identifiers
- `source` — `{ type: 'thesportsdb', leagueId: '...' }` for TSDB-sourced sports, or a custom source module
- `classify(name)` — bucketise event types (PPV / Fight Night / Race / etc.)
- `shortHandle(name)` — short canonical event handle
- `searchTitles(event)` — array of short scene-style queries for the Newznab indexer
- `isRelevantStreamTitle(title, event)` — relevance filter for indexer results
- `buildAliases(name)` — full alias list (legacy, still used by some downstream views)
- `catalogs` — array of `{ id, name, filter, sort }` for the catalogs the promotion exposes
- `defaults` — fallback poster / fanart / logo
- `includeEvent(ev)` — boolean filter applied at refresh time
- `genres(ev)` — Stremio genres for the meta item

Add the new promotion object to the `all` array at the bottom of the file. The catalog, meta, and stream routes wire up automatically.

---

## 🛣️ Roadmap

- **0.32.0** — exploration of a self-hostable UU-equivalent companion project so non-Elfhosted users get the same single-URL handoff experience.
- More sports promotions (NFL, NBA, soccer leagues) as community contributions come in.
- AIOStreams integration awaits an upstream change so non-IMDb catalogs can flow through their Newznab built-in.

---

## License

MIT — see [LICENSE](./LICENSE).
