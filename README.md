# NZB-Sport-Pro

NZB-Sport-Pro is a public-ready Stremio and Nuvio sports addon. It combines
SeriousSportSync's event metadata with private, per-user Newznab discovery and
TorBox Usenet playback.

The public homepage follows the Comet-style hosted-addon flow: add a TorBox API
key and up to five Newznab indexers, choose catalogs, then install or copy the
generated private manifest. There is no public signup or user dashboard.

## What it does

- Publishes upcoming and recent sports events as first-class catalog items.
- Searches only the current user's Newznab indexers when an event is opened.
- Reuses completed downloads already present in that user's TorBox library.
- Shows explicit Queue rows for everything else; nothing is added merely by
  browsing an event.
- Treats only completed downloads in the user's own TorBox library as instant.
  Shared-cache matches attach on click, while uncached results queue explicitly.
- Reuses an already-processing TorBox job and waits briefly for it to become
  playable, avoiding duplicate submissions on repeated clicks.
- Generates and downloads or copies a Nuvio collection containing the selected
  Combat Sports, Wrestling, Football, and Motorsport catalogs.
- Authenticated-encrypts TorBox and Newznab API keys inside the private manifest
  configuration URL; no public user record is created.
- Keeps NZB URLs and bytes in bounded server memory and out of client responses.
- Never downloads or proxies video data.

TorBox does not reliably expose its global Usenet cache for arbitrary personal
Newznab results. Consequently, `Instant Play` means an owned/completed TorBox
job. A positive shared-cache check is labelled as an attach-and-wait action,
not promised as immediate playback.

## Docker Compose

~~~yaml
services:
  nzb-sport-pro:
    image: ghcr.io/monkfish1337/nzb-sport-pro:latest
    container_name: nzb-sport-pro
    restart: unless-stopped
    environment:
      SESSION_SECRET: "replace-with-at-least-32-random-characters"
      PUBLIC_URL: "https://nzb-sport-pro.example.com"
      TSDB_API_KEY: "123"
    volumes:
      - nzb_sport_pro_data:/app/data
    ports:
      - "7000:7000"

volumes:
  nzb_sport_pro_data:
~~~

Start it with:

~~~bash
docker compose up -d
~~~

Visit the root page to open the stateless configurator. Users enter their own
services and receive a private manifest URL; credentials are not saved as an
account. Keep that URL private because possession grants use of its services.

The operator dashboard is separate and optional. Visit `/setup` explicitly to
create its first administrator, then use `/login`, `/account`, and `/admin` for
the retained maintenance tools.

## Metadata shared with SeriousSportSync

SeriousSportSync remains the canonical metadata repository. Do not make
promotion, event-source, transformation, refresh-adapter, or collection-art
changes independently here.

[`metadata-sync.json`](metadata-sync.json) declares the shared boundary. The
scheduled `Sync SeriousSportSync metadata` workflow checks out both public
repositories every six hours, copies those paths, runs metadata and playback
tests, and commits changes to NZB-Sport-Pro only when something changed.

Manual local sync:

~~~bash
node scripts/sync-metadata.js /path/to/Serioussportsync .
~~~

Product-specific code stays independent, including:

- the public stateless configuration experience;
- user storage and credential handling;
- native Newznab discovery;
- TorBox Usenet cache/library checks and resolution;
- container/release branding.

The last imported source revision is recorded in
`.metadata-source.json`, making drift visible in reviews and bug reports.

## Security model

- A production `SESSION_SECRET` of at least 32 random characters is mandatory.
- Changing `SESSION_SECRET` invalidates every previously generated manifest.
- Public users have no account or database record; their authenticated-encrypted
  configuration lives in the private manifest URL.
- Public configurations accept HTTPS indexer endpoints only and reject private
  or local targets by default.
- Credential-bearing Newznab URLs are never emitted to Stremio or Nuvio.
- Resolve and queue actions use short-lived signed URLs.
- Each queue click acts only on the TorBox account belonging to that manifest.

Operators of a public instance should still add normal reverse-proxy rate
limits and abuse controls before advertising it widely.

## Development

Requires Node.js 20 or later.

~~~bash
npm ci
npm run test:public-page
npm run test:native-newznab
npm run test:manutd
npm run test:nuvio
~~~

The project is licensed under the MIT License.
