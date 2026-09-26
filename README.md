# Workspace

A 3D office in the browser where each room is a project and each desk is a live Claude Code session.
See [`PLAN.md`](PLAN.md) for the design and roadmap, [`IDEAS.md`](IDEAS.md) for the backlog and
[`docs/deployment.md`](docs/deployment.md) to run it on a Linux server.

## Requirements

- Node 24+, pnpm 10+
- `tmux` (sessions run in a dedicated tmux server so they survive restarts)
- `git`, `curl`
- Claude Code CLI (`claude`), logged in with the subscription that will be used by every desk
- Blender 5.1+ only to regenerate the 3D assets (`assets/blender/`)

## Development

```sh
pnpm install
pnpm set-password     # once
pnpm dev              # server on :4317 + Vite on :5317 (open http://localhost:5317)
pnpm test
pnpm typecheck
```

## Production

```sh
pnpm build            # builds the web client; the server then serves it
pnpm start            # http://127.0.0.1:4317
SMOKE_URL=http://127.0.0.1:4317 SMOKE_PASSWORD=... pnpm smoke   # browser smoke test (installed Chrome)
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

## Using the office

- **Overview** (default): the building seen from above with walls cut away. Click a desk to fly to
  it and open its terminal, a whiteboard to open the room board, `+` placeholders to add desks or
  rooms. `Esc` goes back to the overview.
- **Walk** (`V` or the top bar): first-person visit. Click to look around, WASD / ZQSD / arrows to
  move, Shift to run, `E` or click to use the desk, whiteboard or screen in front of you.
- **Master office** (at the entrance): live map, Haiku briefing, inbox and the day's timeline.
- **Settings** (⚙ in the top bar): graphics quality (Eco / Normal / Max — the office only redraws at
  full rate while you move around; Eco keeps laptops cool), sound, browser notifications, language.
- **Subscription gauge** (top bar and master office map): 5-hour and weekly usage of the Claude
  subscription, relayed by the desks' status lines, with alerts at 80 % and 95 %.
- **Integrate a desk's work** (desk menu or terminal header): diff, merge into a branch, or pull
  request through `gh`.
- **Living office**: the light follows the time of day; idle characters take coffee breaks in the
  lounge, walk to a colleague they message or to the whiteboard, and hurry back when needed.
- Desk lamps: blue = working, orange = needs you, green = idle, purple = compacting,
  yellow = usage limit, red = error, off = stopped.
