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
- Offers an optional prelim/pre-show filter covering preliminary cards,
  countdowns, kickoff shows, and Zero Hour releases before preparation begins.
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
starts without a second click. Administrators can tune `TORBOX_USENET_PLAY_WAIT_MS` and
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
      ADMIN_USER: "operator"
      ADMIN_PASSWORD: "replace-with-a-strong-admin-password"
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
- The administrator can observe event/search titles, indexer display names, coarse
  result counts, processing states, timestamps, and pseudonymous configuration
  IDs in application logs. API keys, passwords, authorization headers, and
  credential-bearing URLs are centrally redacted. Container/platform access
  logs remain the administrator's responsibility.
- The service necessarily sends each user's API credentials to the provider
  they configured (their Newznab indexer and TorBox). NZB bytes are bounded,
  held briefly in memory, forwarded to that user's TorBox account after a
  click, and are not written to disk by NZB-Sport-Pro.

For a Cloudflare Tunnel deployment, keep the Compose port bound to
`127.0.0.1`, set an exact HTTPS `PUBLIC_URL`, use a distinct `SETUP_TOKEN`, and
do not create a public DNS record that exposes the origin by another route.
The complete edge-limit, backup/restore, smoke-test, and repository-protection
procedure is in [`docs/public-hosting.md`](docs/public-hosting.md).

### Backup and restore

The admin Health page downloads a timestamped archive of the complete
`/app/data` volume, including the encrypted public configuration store. Keep a
separate secure backup of the exact `SESSION_SECRET`; it is deliberately not
included in the downloadable archive. Neither half can restore public users by
itself.

For recovery, stop the application, restore the archive into an empty data
volume, configure the original `SESSION_SECRET`, and then start the container.
Check `/health` before reopening the tunnel. It returns HTTP 503 when the store
is malformed or cannot be decrypted with that secret, and HTTP 200 only after
the restored configurations pass their integrity check. Avoid extracting a
backup over a running or populated volume.

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

The private editing link cannot be recovered from an installed manifest. Users
must copy and store it before closing the initial configuration page if they
want to change services, catalogs, filters, or manifest settings later.

The configurator's **Test services** action does not save the form. It makes a
read-only TorBox library request and a one-result Newznab search against each
configured indexer, then reports provider-safe connection errors without
returning keys or response bodies to the browser. **Rotate manifest** immediately
invalidates the old install URL while retaining the private editing link.
**Delete configuration** permanently invalidates both URLs.

The admin dashboard is separate and optional. Set both `ADMIN_USER` and an
`ADMIN_PASSWORD` of at least 12 characters to enable an environment-managed
login at `/login`; those credentials are never written to the data volume and
become authoritative, so old stored accounts cannot access the admin dashboard.
Public users create private installs through `/configure`; they do not receive
dashboard accounts.
The authenticated admin surface contains privacy-safe public-configuration
management, metadata refresh, health, logs, and encrypted backup. Administrators
can disable, re-enable, or permanently delete configurations without exposing
their API keys or private editing links. Legacy scraper search, power
tools, match editing, promotion editing, content authoring, and source-setting
routes are disabled in NZB-Sport-Pro.

If environment credentials are omitted, `/setup` can create a stored fallback
administrator. When `PUBLIC_URL` is HTTPS, that fallback setup is disabled
until a non-empty `SETUP_TOKEN` is configured.

## Metadata shared with SeriousSportSync

SeriousSportSync remains the canonical metadata repository. Do not make
promotion, event-source, transformation, refresh-adapter, or collection-art
changes independently here.

[`metadata-sync.json`](metadata-sync.json) declares the shared boundary. The
scheduled `Sync SeriousSportSync metadata` workflow checks out both public
repositories every six hours, copies those paths, runs NSP compatibility
tests, and opens or updates a review pull request only when the accepted
metadata snapshot changed. Merging that PR triggers the normal verified NSP
container release; the sync workflow never pushes directly to `main`.

The admin **Metadata sync** page verifies the bundled files against the
recorded SHA-256 snapshot and shows the exact SSS commit, acceptance time, and
managed path coverage. It links to the sync workflow for pending upstream
reviews. Shared-file fixes found while working in NSP must be made in SSS first
because the next accepted sync deliberately replaces those managed paths.

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

Administrators of a public instance should still add normal reverse-proxy rate
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
