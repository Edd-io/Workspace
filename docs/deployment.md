# Deploying Workspace on a Linux server

Workspace runs as one Node process (HTTP + WebSocket) plus one tmux server hosting every desk's
Claude Code session. Everything a desk does runs as the Linux user of the service: **anyone who can
log in to Workspace gets a shell as that user**. Use a dedicated user, a strong password, HTTPS, and
only expose it on a network you trust (VPN / Tailscale) until two-factor authentication exists.

## 1. Requirements

- Node 24+ and pnpm 10+
- `tmux`, `git`, `curl`
- Build tools in case `node-pty` has no prebuilt binary for the platform: `python3`, `make`, `g++`
- Claude Code CLI installed for the service user and logged in with the subscription the desks
  will use:
  - interactively once: `sudo -u workspace -i claude` then `/login`, or
  - headless: `claude setup-token` on a machine with a browser, then set
    `CLAUDE_CODE_OAUTH_TOKEN` in the service environment.
- Blender is **not** needed on the server (3D assets are committed; see `assets/blender/README.md`).

```sh
sudo useradd --create-home --shell /bin/bash workspace
sudo -u workspace -i
git clone <repository> ~/workspace && cd ~/workspace
pnpm install
pnpm build
pnpm set-password
```

## 2. systemd service

`/etc/systemd/system/workspace.service`:

```ini
[Unit]
Description=Workspace (3D office of Claude Code sessions)
After=network-online.target
Wants=network-online.target

[Service]
User=workspace
WorkingDirectory=/home/workspace/workspace
Environment=NODE_ENV=production
Environment=WORKSPACE_HOST=127.0.0.1
Environment=WORKSPACE_PORT=4317
Environment=WORKSPACE_DATA_DIR=/home/workspace/.workspace
Environment=WORKSPACE_SECURE_COOKIES=1
# Environment=CLAUDE_CODE_OAUTH_TOKEN=...   (if you used `claude setup-token`)
ExecStart=/usr/bin/env pnpm start
Restart=always
RestartSec=3
# Only stop the Node process: the tmux server (and every desk session) keeps running while the
# service restarts, and the server re-attaches to it on start.
KillMode=process

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now workspace
journalctl -u workspace -f
```

After a machine reboot the tmux server is gone: on start, Workspace relaunches every desk that was
running with `claude --resume <session id>`, so conversations continue.

## 3. HTTPS and WebSocket (reverse proxy)

Keep Workspace bound to `127.0.0.1` and put a TLS reverse proxy in front. Caddy example
(`/etc/caddy/Caddyfile`), WebSocket upgrades included:

```
office.example.com {
    reverse_proxy 127.0.0.1:4317
}
```

With nginx, forward `Upgrade`/`Connection` headers for `/ws` and keep the `Host` header (the
WebSocket endpoint rejects foreign origins). Alternatively, `tailscale serve --bg 4317` exposes it
on your tailnet only.

## 4. Updating

```sh
sudo -u workspace -i
cd ~/workspace && git pull && pnpm install && pnpm build
sudo systemctl restart workspace   # desk sessions survive (KillMode=process)
```

## 5. Backups

Everything lives in `WORKSPACE_DATA_DIR`:

- `workspace.db` (SQLite, WAL mode): rooms, desks, events, boards, summary — back it up with
  `sqlite3 workspace.db ".backup backup.db"`;
- `desks/` (generated per-desk launch files, regenerated on launch);
- `worktrees/` (git worktrees: the work itself is on each desk's `workspace/*` branch in the project
  repository, never deleted by Workspace).

Claude Code conversations are in the service user's `~/.claude/projects/`.

## 6. Checks

```sh
curl -s http://127.0.0.1:4317/api/auth/me     # {"authenticated":false,"passwordSet":true}
tmux -L workspace ls                           # one session per running desk
SMOKE_URL=https://office.example.com SMOKE_PASSWORD=... pnpm smoke   # from a machine with Chrome
```
