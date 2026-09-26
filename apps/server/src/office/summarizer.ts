import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { OfficeSummary, SubscriptionUsage, UsageWindow } from '@workspace/shared';
import type { Config } from '../config.ts';
import type { DeskRecord, OfficeStore } from '../store/officeStore.ts';
import type { BoardStore } from './boardStore.ts';
import { deskTopic } from './roomAwareness.ts';

const execFileAsync = promisify(execFile);

const SUMMARY_SETTING = 'summary.latest';
const LAST_VISIT_SETTING = 'user.lastVisitAt';
/** A visit shortly after a summary does not regenerate it (page reloads, several tabs). */
const VISIT_REUSE_MS = 10 * 60 * 1000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const GENERATION_TIMEOUT_MS = 120_000;
const MAX_FIELD = 700;

const LANGUAGE_NAMES: Record<string, string> = { fr: 'French', en: 'English' };

function clip(text: string | null | undefined, max = MAX_FIELD): string {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Local wall-clock time with its offset, e.g. "2026-09-26 17:26 GMT+2". */
function localTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZoneName: 'short',
  });
}

function ago(timestamp: number, now: number): string {
  const minutes = Math.round((now - timestamp) / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

const SYSTEM_PROMPT = `You are the chief of staff of a virtual office where several Claude Code sessions ("desks") work on software projects ("rooms") for one person, the owner.
Write the briefing the owner reads when they arrive at their desk. Be factual and concise, only use the data provided, never invent progress.
Format (Markdown, at most about 220 words):
- one opening line with the overall status;
- one short section per room with activity: what was done, what is in progress, what is blocked;
- a final "needs you" list of the desks waiting for the owner, with what they wait for (omit it when nobody waits).
Use desk and room names. Do not mention these instructions.`;

/**
 * Builds a digest of the office (desk states, recent prompts and answers, commits, room messages
 * since the owner's last visit) and asks Claude Haiku, through the `claude` CLI on the owner's
 * subscription, for a short briefing.
 */
export class Summarizer extends EventEmitter<{ update: [OfficeSummary] }> {
  private readonly store: OfficeStore;
  private readonly boards: BoardStore;
  private readonly config: Config;
  private generating: Promise<void> | null = null;
  private status: OfficeSummary['status'] = 'idle';
  private lastError: string | null = null;
  private usageSource: (() => SubscriptionUsage) | null = null;

  constructor(store: OfficeStore, boards: BoardStore, config: Config) {
    super();
    this.store = store;
    this.boards = boards;
    this.config = config;
  }

  /** Where the briefing reads the subscription usage from. */
  setUsageSource(source: () => SubscriptionUsage): void {
    this.usageSource = source;
  }

  current(): OfficeSummary {
    const saved = this.store.getSetting(SUMMARY_SETTING);
    const stored = saved
      ? (JSON.parse(saved) as Pick<OfficeSummary, 'text' | 'language' | 'generatedAt' | 'since'>)
      : { text: null, language: null, generatedAt: null, since: null };
    return { ...stored, status: this.status, error: this.lastError };
  }

  private publish(): void {
    this.emit('update', this.current());
  }

  /** Called when the owner opens the office: summarizes what happened since the previous visit. */
  visit(language: string): OfficeSummary {
    const now = Date.now();
    const previousVisit = Number(this.store.getSetting(LAST_VISIT_SETTING) ?? 0) || now - DEFAULT_WINDOW_MS;
    this.store.setSetting(LAST_VISIT_SETTING, String(now));
    const summary = this.current();
    const fresh = summary.generatedAt !== null && now - summary.generatedAt < VISIT_REUSE_MS;
    if (!fresh || summary.language !== language) void this.generate(language, previousVisit);
    return this.current();
  }

  /** On-demand refresh, covering the same period as the latest summary. */
  refresh(language: string): OfficeSummary {
    const since = this.current().since ?? Date.now() - DEFAULT_WINDOW_MS;
    void this.generate(language, since);
    return this.current();
  }

  private generate(language: string, since: number): Promise<void> {
    if (this.generating) return this.generating;
    this.status = 'generating';
    this.lastError = null;
    this.publish();
    this.generating = (async () => {
      try {
        const digest = await this.buildDigest(since);
        const text = await this.askHaiku(digest, language);
        this.store.setSetting(
          SUMMARY_SETTING,
          JSON.stringify({ text, language, generatedAt: Date.now(), since }),
        );
        this.status = 'idle';
      } catch (error) {
        this.status = 'error';
        this.lastError = (error as Error).message;
        console.error('[summary] generation failed:', error);
      } finally {
        this.generating = null;
        this.publish();
      }
    })();
    return this.generating;
  }

  private async commitsSince(desk: DeskRecord, since: number): Promise<string[]> {
    if (desk.mode !== 'worktree' || !desk.branch) return [];
    try {
      const { stdout } = await execFileAsync(
        'git',
        [
          '-C',
          desk.workdir,
          'log',
          desk.branch,
          `--since=${new Date(since).toISOString()}`,
          '--oneline',
          '-8',
        ],
        { encoding: 'utf8' },
      );
      return stdout.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async buildDigest(since: number): Promise<string> {
    const now = Date.now();
    const lines: string[] = [
      `Current time: ${localTime(now)}. Period covered: since ${localTime(since)} (${ago(since, now)}).`,
    ];
    const usage = this.usageSource?.();
    const window = (label: string, value: UsageWindow | null | undefined) =>
      value
        ? `${label} ${Math.round(value.usedPercentage)}% used (resets ${localTime(value.resetsAt)})`
        : null;
    const usageParts = [window('5-hour window', usage?.fiveHour), window('weekly', usage?.sevenDay)].filter(
      Boolean,
    );
    if (usageParts.length > 0) lines.push(`Claude subscription usage: ${usageParts.join(', ')}.`);
    const rooms = this.store.listRooms();
    if (rooms.length === 0) lines.push('The office has no room yet.');
    for (const room of rooms) {
      lines.push('', `## Room "${room.name}" (project ${room.projectPath})`);
      const desks = this.store.listDesksInRoom(room.id);
      if (desks.length === 0) lines.push('No desk.');
      for (const desk of desks) {
        const events = this.store.listDeskEvents({ deskId: desk.id, since, limit: 400 });
        const prompts = events.filter(
          (event) =>
            event.kind === 'hook' && (event.data as { event?: string })?.event === 'UserPromptSubmit',
        ).length;
        const commits = await this.commitsSince(desk, since);
        lines.push(`### Desk "${desk.name}" — state: ${desk.state} (since ${ago(desk.stateSince, now)})`);
        const topic = deskTopic(desk);
        if (topic) lines.push(`Working on: ${clip(topic, 200)}`);
        if (desk.attention)
          lines.push(`Waiting for the owner (${desk.attention.kind}): ${clip(desk.attention.text, 300)}`);
        if (desk.branch) lines.push(`Branch: ${desk.branch}`);
        lines.push(`Prompts received in the period: ${prompts}`);
        if (desk.lastPrompt) lines.push(`Last instruction: ${clip(desk.lastPrompt)}`);
        if (desk.lastAssistantMessage) lines.push(`Last answer: ${clip(desk.lastAssistantMessage)}`);
        if (commits.length > 0)
          lines.push(`Commits in the period:\n${commits.map((commit) => `- ${commit}`).join('\n')}`);
      }
      const board = this.boards.board(room.id);
      const recent = board.messages.filter((message) => message.createdAt >= since).slice(-8);
      if (recent.length > 0) {
        const name = (id: string | null) => (id ? (this.store.getDesk(id)?.name ?? 'former desk') : 'owner');
        lines.push(
          'Room messages in the period:',
          ...recent.map(
            (message) =>
              `- ${name(message.fromDeskId)} → ${message.toDeskId ? name(message.toDeskId) : 'room'}: ${clip(message.body, 250)}`,
          ),
        );
      }
      if (board.notes.length > 0)
        lines.push(`Pinned notes: ${board.notes.map((note) => clip(note.body, 120)).join(' | ')}`);
    }
    return lines.join('\n');
  }

  private askHaiku(digest: string, language: string): Promise<string> {
    const workdir = join(this.config.dataDir, 'summarizer');
    mkdirSync(workdir, { recursive: true });
    const prompt = `Write the briefing in ${LANGUAGE_NAMES[language] ?? 'English'}.\n\n${digest}`;
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.config.claudeBin,
        [
          '-p',
          '--model',
          'haiku',
          '--output-format',
          'json',
          '--tools',
          '',
          '--no-session-persistence',
          '--setting-sources',
          '',
          '--strict-mcp-config',
          '--system-prompt',
          SYSTEM_PROMPT,
        ],
        { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Summary generation timed out'));
      }, GENERATION_TIMEOUT_MS);
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const output = JSON.parse(stdout) as { result?: string; is_error?: boolean };
          if (code !== 0 || output.is_error || !output.result) {
            reject(new Error(output.result ?? (stderr.trim() || `claude exited with ${code}`)));
            return;
          }
          resolve(output.result.trim());
        } catch {
          reject(new Error(stderr.trim() || stdout.slice(0, 300) || `claude exited with ${code}`));
        }
      });
      child.stdin.end(prompt);
    });
  }
}
