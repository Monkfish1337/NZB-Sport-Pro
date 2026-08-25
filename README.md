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
- Keeps the original playback request alive through bounded signed redirects
  while TorBox processes, then redirects straight to the playable media URL.
  The same job is reused throughout, so no duplicate submission is created.
- Generates and downloads or copies a Nuvio collection containing the selected
  Combat Sports, Wrestling, Football, and Motorsport catalogs.
- Stores each public configuration as an authenticated-encrypted record and
  issues two separate capabilities: a use-only manifest token and a private
  editing token. The manifest cannot reveal the underlying API keys.
- Keeps NZB URLs and bytes in bounded server memory and out of client responses.
- Offers an optional per-user maximum result size, filtering oversized releases
  before NZB preparation and TorBox cache checks to favour quicker queue playback.
- Tests TorBox and Newznab settings before installation with one read-only
  request per service; the indexer check consumes one API search hit.
- Lets users rotate a manifest if its use-only URL is exposed, or permanently
  delete their encrypted configuration through the private editing link.
- Never downloads or proxies video data.

TorBox does not reliably expose its global Usenet cache for arbitrary personal
Newznab results. Consequently, `Instant Play` means an owned/completed TorBox
job. A positive shared-cache check is labelled as an attach-and-wait action,
not promised as immediate playback.

By default, a queue click can continue through the initial resolver request and
five continuations of up to 35 seconds each, covering roughly three and a half
minutes. The smaller redirect count leaves native players enough headroom for
the final TorBox/CDN hand-off. If TorBox finishes within that window, playback
starts without a second click. Operators can tune `TORBOX_USENET_PLAY_WAIT_MS` and
`TORBOX_USENET_WAIT_REDIRECTS`; the existing processing response remains the
fallback for exceptionally slow jobs or clients with a restrictive redirect
limit. NZB-Sport-Pro never proxies the video itself.

If TorBox reports a terminal Usenet state (for example a malformed NZB,
missing articles, failed processing, or an expired download), the wait stops
immediately. Container logs identify the TorBox job, release, state, and any
reason returned by TorBox, while the player receives a terminal error instead
of an endless processing loop.

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
      SETUP_TOKEN: "replace-with-a-separate-random-setup-secret"
      TRUST_PROXY_HEADERS: "cloudflare"
      TSDB_API_KEY: "123"
    volumes:
      - nzb_sport_pro_data:/app/data
    ports:
      - "127.0.0.1:7000:7000"

volumes:
  nzb_sport_pro_data:
~~~

### Public-hosting privacy boundary

- Each generated manifest contains a use-only identifier. It can search and
  resolve with that saved configuration, but it cannot retrieve the user's
  TorBox or Newznab credentials.
- The separate editing secret is kept after `#edit=` in the browser URL. URL
  fragments are not sent to this server, Cloudflare, or access logs; the page
  submits it in an authorization header only when loading or saving settings.
- TorBox and Newznab API keys are encrypted at rest in the persistent data
  volume. Back up `SESSION_SECRET` separately; losing it makes saved public
  configurations unreadable.
- The operator can observe event/search titles, indexer display names, coarse
  result counts, processing states, timestamps, and pseudonymous configuration
  IDs in application logs. API keys, passwords, authorization headers, and
  credential-bearing URLs are centrally redacted. Container/platform access
  logs remain the operator's responsibility.
- The service necessarily sends each user's API credentials to the provider
  they configured (their Newznab indexer and TorBox). NZB bytes are bounded,
  held briefly in memory, forwarded to that user's TorBox account after a
  click, and are not written to disk by NZB-Sport-Pro.

For a Cloudflare Tunnel deployment, keep the Compose port bound to
`127.0.0.1`, set an exact HTTPS `PUBLIC_URL`, use a distinct `SETUP_TOKEN`, and
do not create a public DNS record that exposes the origin by another route.

Start it with:

~~~bash
docker compose up -d
~~~

Visit the root page to open the public configurator. Users enter their own
services and receive a private manifest URL plus a separate private editing
link. Configurations are encrypted in the persistent data volume; no public
login account is created. Keep the manifest private because possession grants
use of its services, and protect the editing link because it can display and
change the saved credentials. Its `#edit=` fragment is not sent in HTTP request
paths or normal reverse-proxy access logs.

The configurator's **Test services** action does not save the form. It makes a
read-only TorBox library request and a one-result Newznab search against each
configured indexer, then reports provider-safe connection errors without
returning keys or response bodies to the browser. **Rotate manifest** immediately
invalidates the old install URL while retaining the private editing link.
**Delete configuration** permanently invalidates both URLs.

The operator dashboard is separate and optional. Visit `/setup` explicitly to
create its first administrator, then use `/login`, `/account`, and `/admin` for
the retained maintenance tools. When `PUBLIC_URL` is HTTPS, first-admin setup
is disabled until a non-empty `SETUP_TOKEN` is configured.

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

- the public encrypted configuration experience;
- user storage and credential handling;
- native Newznab discovery;
- TorBox Usenet cache/library checks and resolution;
- container/release branding.

The last imported source revision is recorded in
`.metadata-source.json`, making drift visible in reviews and bug reports.

## Security model

- A production `SESSION_SECRET` of at least 32 random characters is mandatory.
- Changing `SESSION_SECRET` invalidates every previously generated manifest and
  makes saved public configurations unreadable. Back it up securely.
- Public users have no login account. Their authenticated-encrypted
  configuration is stored in `data/public-configs.json` with mode `0600`.
- Installed manifests contain a use-only token. Editing requires a separate
  secret which is carried in a browser URL fragment rather than the request path.
- Public configurations accept HTTPS indexer endpoints only and reject private
  or local targets by default.
- Credential-bearing Newznab URLs are never emitted to Stremio or Nuvio.
- Resolve and queue actions use short-lived signed URLs.
- Each queue click acts only on the TorBox account belonging to that manifest.

Operators of a public instance should still add normal reverse-proxy rate
limits and abuse controls before advertising it widely.

## Development

Requires Node.js 24 or later.

~~~bash
npm ci
npm run test:public-page
npm run test:native-newznab
npm run test:manutd
npm run test:nuvio
~~~

The project is licensed under the MIT License.
