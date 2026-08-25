# Public-host completion checklist

## Origin and tunnel

Keep the supplied `127.0.0.1:7000:7000` binding and point Cloudflare Tunnel at
`http://localhost:7000`. Do not add a router port-forward or a second public
route to the origin.

```bash
node scripts/preflight-public-host.js .env
node scripts/smoke-public-host.js https://your-public-host
```

## Cloudflare edge limits

Open **Security → Security rules**, then **Create rule → Rate limiting rules**.
Use IP as the counting characteristic. Available periods, actions, and regex
operators depend on the Cloudflare plan.

| Purpose | Matching requests | Suggested edge limit |
| --- | --- | --- |
| Login | `POST /login` | 10/minute; block 10 minutes |
| Configuration | `POST` with path starting `/configure/` | 30/minute; block 10 minutes |
| Streams/resolves | Path contains `/stream/` or `/resolve/` | 120/minute; block 1 minute |

These are deliberately looser than the application limits. Start in log mode
when available and observe real traffic before blocking. Do not use browser
challenges on addon JSON or playback routes; media clients cannot solve them.

Current Cloudflare procedure:
<https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/>.

## Backup and recovery drill

The timer archives `/app/data` only. It excludes `.env`, because combining the
encrypted store with its `SESSION_SECRET` removes split-secret protection.

```bash
sudo NZB_STACK_DIR="$PWD" ./deploy/backup/install-backup.sh
sudo systemctl start nzb-sport-pro-backup.service
sudo journalctl -u nzb-sport-pro-backup.service --since='10 minutes ago'
```

Store `.env` separately. Test restoration into a disposable new volume before
launch; each archive contains its checksum and exact restore procedure.

## Launch smoke sequence

1. Confirm `/health` is HTTP 200 and the configuration store is healthy.
2. Create a disposable configuration with a test TorBox account and indexer.
3. Verify its manifest, catalog, discovery, queue/attach, and playback.
4. Edit it through the fragment-based private link.
5. Rotate it and confirm the old manifest stops working.
6. Disable and re-enable it from admin, checking access after each action.
7. Delete it and confirm both use and edit capabilities stop working.
8. Complete the separate host-level restore drill.

## Repository protection

`main` currently accepts direct pushes. Enable a GitHub ruleset only after
switching normal work to pull requests. Require `CI / test` and `CI / docker`,
block force pushes and deletion, and retain an administrator emergency bypass.
The container workflow already refuses publication until its own verification
job passes.
