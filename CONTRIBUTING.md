# Contributing to Workspace

Thanks for your interest! Bug reports, ideas and pull requests are welcome. This guide explains how
to set up the project, the few rules the codebase follows, and what a pull request should contain.

## Before you start

- **Bugs**: open an issue with what you did, what you expected and what happened (browser, OS,
  Claude Code version, and a screenshot for anything visual).
- **Features**: open an issue first for anything larger than a small fix, so we can agree on the
  approach before you spend time on it. [`PLAN.md`](PLAN.md) holds the roadmap and
  [`IDEAS.md`](IDEAS.md) the backlog: an idea listed there is a good place to start.
- **Security issues**: please do not open a public issue; report them privately through GitHub's
  private vulnerability reporting ("Report a vulnerability" in the Security tab). Remember that
  anyone who can log in to Workspace gets a shell on the server, so authentication, the WebSocket
  and anything that runs commands deserve extra care.

## Setting up

Requirements: Node 24+, pnpm 10+, `tmux`, `git`, `curl`, and the Claude Code CLI logged in.

```sh
pnpm install
pnpm set-password
pnpm dev              # server on :4317, web client on http://localhost:5317
```

**Test against an isolated instance, never your real office.** Desks run real Claude Code sessions
and Workspace keeps its state in a data directory and a tmux server; give the test instance its own:

```sh
# Server (apps/server)
WORKSPACE_DATA_DIR=/tmp/ws-test/data WORKSPACE_PORT=4318 WORKSPACE_TMUX_SOCKET=workspace-test \
  node --watch --disable-warning=ExperimentalWarning src/index.ts
# Client (apps/web)
WORKSPACE_PORT=4318 npx vite --port 5318
```

Set its password with the same `WORKSPACE_DATA_DIR` in front of `pnpm set-password`. When you stop
it, kill the process listening on its port and its tmux server (`tmux -L workspace-test kill-server`).

## Project rules

The codebase follows a few rules; pull requests are expected to keep them.

- **English everywhere**: code, identifiers, comments, docs, commit messages and log lines. The only
  other language lives in the web client's locale files (`apps/web/src/locales/<lang>/`).
- **No hardcoded user-facing strings** in the web client: every text goes through i18n (`t('…')`),
  including text drawn on 3D textures, and every key exists in both `fr` and `en`.
- **Generated assets**: 3D models come from the Blender scripts in `assets/blender/`, sounds from
  `assets/audio/build_sounds.py` (CC0 recordings only, credited in `assets/audio/CREDITS.md`). Never
  commit a binary asset edited by hand: change the script and regenerate.
- **Portable server**: production targets Linux. No macOS-only APIs or paths; every path comes from
  the configuration (`WORKSPACE_DATA_DIR`, …).
- **Never touch a user's project directly**: desks work in git worktrees, or in the project folder
  only when a desk is explicitly configured that way.
- **Keep the plan alive**: tick the boxes of [`PLAN.md`](PLAN.md) that your change completes, and put
  ideas you discussed but did not implement in [`IDEAS.md`](IDEAS.md).

The same rules are in [`CLAUDE.md`](CLAUDE.md), which Claude Code reads automatically if you use it
to work on the project.

## Code style

- TypeScript strict, ESM only; Prettier formats everything (`pnpm format`).
- Write code that reads like the code around it: same naming, same idioms, comments that explain
  *why* rather than what.
- Protocol types and schemas shared by the server and the client go in `packages/shared`.
- Server logic gets unit tests (Vitest, `apps/server/test/`), pure client logic too
  (`apps/web/src/**/*.test.ts`). Changes to the hook state machine start from recorded payloads
  (`WORKSPACE_RECORD_HOOKS=1` writes them to `<data dir>/hook-log.jsonl`).

## Before opening a pull request

```sh
pnpm format
pnpm typecheck
pnpm test
pnpm build
```

For changes to the interface or the 3D world, also check them in a browser on your test instance,
and run the smoke test against a production build (`pnpm build`, then start the test server, then
`SMOKE_URL=http://127.0.0.1:4318 SMOKE_PASSWORD=... pnpm smoke`). If your change alters what the
README screenshots show, retake them with `pnpm screenshots` (see the README).

## Pull requests

- Branch from **`dev`** and open the pull request against **`dev`**; `main` only receives `dev`
  once it is stable.
- Keep a pull request focused on one change; split unrelated fixes.
- Commit messages: a short summary in the imperative mood ("Fix…", "Add…"), then a body explaining
  why when it is not obvious.
- Describe what changed and how you tested it; add screenshots for anything visual.
