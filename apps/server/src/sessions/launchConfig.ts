import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Room } from '@workspace/shared';
import type { DeskRecord } from '../store/officeStore.ts';

/** Every hook event the server listens to. All of them are sent to the same HTTP endpoint. */
export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'TaskCreated',
  'TaskCompleted',
] as const;

export interface LaunchContext {
  desk: DeskRecord;
  room: Room;
  claudeBin: string;
  hookBaseUrl: string;
  dataDir: string;
  /** Office MCP server entry point, started by Claude Code with the Node binary running the server. */
  officeMcp: { nodePath: string; scriptPath: string } | null;
  systemPrompt: string;
  /** Variables that look like secrets but the session may see (`WORKSPACE_DESK_ENV_PASS`). */
  envPass: string[];
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Always kept: the office's own variables, Claude Code's configuration and credentials, the SSH agent. */
const KEPT_VARIABLES = ['WORKSPACE_*', 'CLAUDE_*', 'ANTHROPIC_*', 'SSH_AUTH_SOCK'];
/** Words that make a variable name look like a secret. */
const SECRET_WORDS = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'API_KEY',
  'APIKEY',
  'PRIVATE_KEY',
  'CREDENTIAL',
  'ACCESS_KEY',
  'SESSION_KEY',
  'AUTH_KEY',
];

/**
 * Shell lines removing from the environment a session inherits (the server's, through tmux) every
 * variable whose name looks like a secret, except Claude Code's own and the names in `pass`. Names
 * are read at launch, so variables of an older tmux server are caught too.
 */
export function secretScrubLines(pass: string[]): string[] {
  const keep = [...KEPT_VARIABLES, ...pass.filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))];
  const secret = SECRET_WORDS.flatMap((word) => [`*${word}*`, `*${word.toLowerCase()}*`]);
  return [
    `for name in $(env | sed -n 's/^\\([A-Za-z_][A-Za-z0-9_]*\\)=.*/\\1/p'); do`,
    '  case "$name" in',
    `    ${keep.join('|')}) ;;`,
    `    ${secret.join('|')}) unset "$name" ;;`,
    '  esac',
    'done',
  ];
}

export function deskDir(dataDir: string, deskId: string): string {
  return join(dataDir, 'desks', deskId);
}

/** Events Claude Code does not deliver through `http` hooks (verified empirically); relayed with curl. */
const COMMAND_ONLY_EVENTS = new Set<string>(['SessionStart']);

/** How often (seconds) the status line is refreshed even when nothing happens in the session. */
const STATUS_LINE_REFRESH_S = 60;

export function buildHookSettings(hookUrl: string, statusUrl?: string): object {
  const httpHook = {
    type: 'http',
    url: hookUrl,
    headers: { Authorization: 'Bearer $WORKSPACE_DESK_TOKEN' },
    allowedEnvVars: ['WORKSPACE_DESK_TOKEN'],
    timeout: 10,
  };
  const commandHook = {
    type: 'command',
    command:
      `curl -sS --max-time 8 -X POST -H 'content-type: application/json' ` +
      `-H "Authorization: Bearer $WORKSPACE_DESK_TOKEN" --data-binary @- ${shellQuote(hookUrl)} || true`,
    timeout: 10,
  };
  // The status line input carries the subscription usage and the context size: the server keeps
  // them and answers with the line to print. curl is lighter than node for a command run this often.
  const statusLine = statusUrl && {
    type: 'command',
    command:
      `curl -s --max-time 2 -X POST -H 'content-type: application/json' ` +
      `-H "Authorization: Bearer $WORKSPACE_DESK_TOKEN" --data-binary @- ${shellQuote(statusUrl)} || true`,
    refreshInterval: STATUS_LINE_REFRESH_S,
  };
  return {
    // The office tools only reach the Workspace server: never ask the human before using them.
    permissions: { allow: ['mcp__office'] },
    ...(statusLine ? { statusLine } : {}),
    hooks: Object.fromEntries(
      HOOK_EVENTS.map((event) => [
        event,
        [{ hooks: [COMMAND_ONLY_EVENTS.has(event) ? commandHook : httpHook] }],
      ]),
    ),
  };
}

/** Claude Code stores transcripts under `~/.claude/projects/<cwd with non-alphanumerics as "-">/`. */
export function defaultTranscriptPath(workdir: string, sessionId: string): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return join(configDir, 'projects', workdir.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
}

/** A conversation exists on disk → resume it; otherwise start a new one with our fixed id. */
export function conversationExists(desk: DeskRecord): boolean {
  const candidates = [desk.transcriptPath, defaultTranscriptPath(desk.workdir, desk.sessionId)];
  return candidates.some((path) => path !== null && existsSync(path));
}

/**
 * Writes the per-desk runtime files (settings, system prompt, launch script) and returns the
 * command tmux must run.
 */
export function writeLaunchFiles(context: LaunchContext): string {
  const { desk } = context;
  const dir = deskDir(context.dataDir, desk.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const settingsPath = join(dir, 'settings.json');
  writeFileSync(
    settingsPath,
    JSON.stringify(
      buildHookSettings(
        `${context.hookBaseUrl}/internal/hooks/${desk.id}`,
        `${context.hookBaseUrl}/internal/office/${desk.id}/status`,
      ),
      null,
      2,
    ),
  );

  let mcpConfigPath: string | null = null;
  if (context.officeMcp) {
    mcpConfigPath = join(dir, 'mcp.json');
    const office = {
      type: 'stdio',
      command: context.officeMcp.nodePath,
      args: ['--disable-warning=ExperimentalWarning', context.officeMcp.scriptPath],
      env: {
        WORKSPACE_URL: context.hookBaseUrl,
        WORKSPACE_DESK_ID: desk.id,
        WORKSPACE_DESK_TOKEN: desk.token,
      },
    };
    writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { office } }, null, 2), { mode: 0o600 });
  }

  const promptPath = join(dir, 'system-prompt.md');
  writeFileSync(promptPath, context.systemPrompt);

  const resume = conversationExists(desk);
  const args: string[] = [
    resume ? '--resume' : '--session-id',
    desk.sessionId,
    // No `--name`: Claude Code then generates a session title from the conversation, which the
    // UserPromptSubmit hook reports and the office shows as the desk's current topic.
    '--settings',
    settingsPath,
  ];
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
  if (desk.model) args.push('--model', desk.model);
  if (desk.permissionMode) args.push('--permission-mode', desk.permissionMode);
  if (!resume && desk.initialPrompt) args.push(desk.initialPrompt);

  const script = [
    '#!/bin/sh',
    '# Generated by Workspace for one desk. Regenerated on every launch: do not edit.',
    '# Variables that look like secrets stay out of the session (see README, "Secrets and isolation").',
    ...secretScrubLines(context.envPass),
    `export WORKSPACE_URL=${shellQuote(context.hookBaseUrl)}`,
    `export WORKSPACE_DESK_ID=${shellQuote(desk.id)}`,
    `export WORKSPACE_DESK_TOKEN=${shellQuote(desk.token)}`,
    'export COLORTERM=truecolor',
    `cd ${shellQuote(desk.workdir)} || exit 97`,
    `exec ${shellQuote(context.claudeBin)} ${args.map(shellQuote).join(' ')} --append-system-prompt "$(cat ${shellQuote(promptPath)})"`,
    '',
  ].join('\n');
  const scriptPath = join(dir, 'launch.sh');
  writeFileSync(scriptPath, script, { mode: 0o700 });
  chmodSync(scriptPath, 0o700);
  return `/bin/sh ${shellQuote(scriptPath)}`;
}
