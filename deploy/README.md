# Hider deployment (as built)

```
Telegram client ──HTTPS──> nginx on 51.77.71.48 (51-77-71-48.sslip.io, Let's Encrypt, own vhost)
                                  │ proxy_pass 127.0.0.1:18002
                                  ▼   (reverse SSH tunnel, opened FROM Jino by user `hider-tg`, forward-only)
Jino  ~/hider/bot  (Express + grammY, plain HTTP on 127.0.0.1:50002, BIND_LOCAL=1, SQLite)
Jino  ~/hider/tg   tg-proxy.js: SSH client → Telegram Bot API forwarder (127.0.0.1:8081) + the reverse tunnel above
Jino  ~/hider-relay  relay.js (wss :50001) → asks the bot at 127.0.0.1:50003 to verify username + license key + HWID
Desktop app ──wss──> Jino :50001 (identity-pinned secure channel)
```

Why the Mini App is not served from Jino directly: Jino cannot reach api.telegram.org, and clients behind a
VPN/proxy could not reach Jino's IP at all, while the VPS address is reachable.

Supervision on Jino: the hosting cron runs `~/hider-relay/ensure.sh` every minute, which calls `~/hider/ensure.sh`
(starts the tg-proxy and bot supervisors if not running; renews the Jino TLS cert after 60 days).

Bot `.env` (not in git): `BOT_TOKEN, PORT, WEBAPP_URL, ADMIN_IDS, TG_API_ROOT, RELAY_SECRET, INTERNAL_PORT, BIND_LOCAL, APP_EXE`.
`TUNNEL=1` (Cloudflare quick tunnel) is still supported by the code but was NOT used: quick tunnels from Jino
were not reliably routable. `BOT_POLLING=0` runs the bot web-only.

Rollback of the Mini App cutover: on 51.77.71.48 `systemctl enable --now hider-new`; on Jino set `BOT_POLLING=0` in
`~/hider/bot/.env` and restart the bot (old DB/env backups: `/root/hider-migration-backup-*` and `~/hider-backups`).
