# Workspace

A 3D office in the browser where each room is a project and each desk is a live Claude Code session.
See [`PLAN.md`](PLAN.md) for the design and roadmap, and [`IDEAS.md`](IDEAS.md) for the backlog.

## Requirements

- Node 24+, pnpm 10+
- `tmux` (sessions run in a dedicated tmux server so they survive restarts)
- `git`, `curl`
- Claude Code CLI (`claude`), logged in with the subscription that will be used by every desk

## Development

```sh
pnpm install
pnpm --filter @workspace/server set-password   # once
pnpm dev                                       # server on :4317 (+ web client once it exists)
pnpm test
pnpm typecheck
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `WORKSPACE_HOST` | `127.0.0.1` | Address the server binds to |
| `WORKSPACE_PORT` | `4317` | HTTP/WebSocket port |
| `WORKSPACE_DATA_DIR` | `~/.workspace` | Database, per-desk runtime files, worktrees |
| `WORKSPACE_TMUX_SOCKET` | `workspace` | Name of the dedicated tmux server socket |
| `WORKSPACE_CLAUDE_BIN` / `WORKSPACE_TMUX_BIN` / `WORKSPACE_NODE_BIN` | from `PATH` | Executables to use |
| `WORKSPACE_HOOK_BASE_URL` | `http://<host>:<port>` | URL Claude Code hooks call back |
| `WORKSPACE_SECURE_COOKIES` | unset | Set to `1` when served over HTTPS |
| `WORKSPACE_RECORD_HOOKS` | unset | Set to `1` to log raw hook payloads to `<data>/hook-log.jsonl` |
