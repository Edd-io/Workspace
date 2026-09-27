import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  /** Absolute path of the `claude` executable. */
  claudeBin: string;
  /** Absolute path of the `tmux` executable. */
  tmuxBin: string;
  /** Node binary used to run the office MCP server (stable PATH entry, not a versioned install path). */
  nodeBin: string;
  /** Name of the dedicated tmux server socket (`tmux -L <name>`). */
  tmuxSocket: string;
  /** Base URL Claude Code hooks use to reach this server. */
  hookBaseUrl: string;
  /** Mark cookies `Secure` (set when served over HTTPS). */
  secureCookies: boolean;
  /** Record every raw hook payload to `<dataDir>/hook-log.jsonl` (test fixtures). */
  recordHooks: boolean;
  /** Variables whose names look like secrets but that desks may still see (see launchConfig.ts). */
  deskEnvPass: string[];
  defaultCols: number;
  defaultRows: number;
  /** Repository root (used to locate the office MCP server and the built web client). */
  repoRoot: string;
  webDistDir: string;
}

function resolveBinary(name: string, override: string | undefined): string {
  const candidate = override ?? name;
  if (isAbsolute(candidate)) return candidate;
  try {
    return execFileSync('/bin/sh', ['-c', `command -v ${candidate}`], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`Cannot find "${candidate}" in PATH. Set the matching WORKSPACE_*_BIN variable.`);
  }
}

function tryResolveBinary(name: string): string | null {
  try {
    return resolveBinary(name, undefined);
  } catch {
    return null;
  }
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.WORKSPACE_HOST ?? '127.0.0.1';
  const port = Number(env.WORKSPACE_PORT ?? 4317);
  const dataDir = resolve(expandHome(env.WORKSPACE_DATA_DIR ?? '~/.workspace'));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const hookHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return {
    host,
    port,
    dataDir,
    claudeBin: resolveBinary('claude', env.WORKSPACE_CLAUDE_BIN),
    tmuxBin: resolveBinary('tmux', env.WORKSPACE_TMUX_BIN),
    nodeBin: env.WORKSPACE_NODE_BIN ?? tryResolveBinary('node') ?? process.execPath,
    tmuxSocket: env.WORKSPACE_TMUX_SOCKET ?? 'workspace',
    hookBaseUrl: env.WORKSPACE_HOOK_BASE_URL ?? `http://${hookHost}:${port}`,
    secureCookies: env.WORKSPACE_SECURE_COOKIES === '1',
    recordHooks: env.WORKSPACE_RECORD_HOOKS === '1',
    deskEnvPass: (env.WORKSPACE_DESK_ENV_PASS ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)),
    defaultCols: 120,
    defaultRows: 36,
    repoRoot,
    webDistDir: join(repoRoot, 'apps/web/dist'),
  };
}
