import { readdirSync, statSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SearchHit } from '@workspace/shared';
import { defaultTranscriptPath } from '../sessions/launchConfig.ts';
import type { DeskRecord, OfficeStore } from '../store/officeStore.ts';

/**
 * What the desks' Claude Code transcripts (JSONL, append-only) say beyond the hooks: tokens, context
 * size, lines written, and the conversations themselves for the search.
 */

/** Prompts Workspace types itself (wake-ups) are not the human's. */
const OWN_PROMPT_PREFIX = '[Workspace]';

interface Turn {
  ts: number;
  output: number;
  context: number;
}

interface Edit {
  ts: number;
  added: number;
  removed: number;
}

/** Parsed so far from one transcript; grows as the file does. */
interface FileSummary {
  offset: number;
  turns: Turn[];
  edits: Edit[];
  seenMessages: Set<string>;
  pendingEdits: Map<string, Edit>;
}

interface TranscriptEntry {
  type?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: {
    id?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
  };
}

interface Block {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

/** Every transcript of a desk: the ones hooks reported, plus older ones of a worktree desk's folder. */
export function transcriptsOf(store: OfficeStore, desk: DeskRecord): string[] {
  const paths = new Set(store.deskTranscripts(desk.id));
  if (desk.transcriptPath) paths.add(desk.transcriptPath);
  if (desk.mode === 'worktree') {
    // The worktree folder only ever hosted this desk (created after the desk, in case of a reused name).
    const folder = dirname(desk.transcriptPath ?? defaultTranscriptPath(desk.workdir, desk.sessionId));
    try {
      for (const name of readdirSync(folder)) {
        if (!name.endsWith('.jsonl')) continue;
        const path = join(folder, name);
        if (statSync(path).mtimeMs >= desk.createdAt) paths.add(path);
      }
    } catch {
      // No conversation yet.
    }
  }
  return [...paths];
}

export class TranscriptIndex {
  private readonly files = new Map<string, FileSummary>();

  /** Parses what was appended to the transcript since the last call. */
  async summary(path: string): Promise<FileSummary | null> {
    let summary = this.files.get(path);
    let handle;
    try {
      handle = await open(path, 'r');
    } catch {
      return summary ?? null;
    }
    try {
      const { size } = await handle.stat();
      if (!summary || size < summary.offset) {
        summary = { offset: 0, turns: [], edits: [], seenMessages: new Set(), pendingEdits: new Map() };
        this.files.set(path, summary);
      }
      if (size === summary.offset) return summary;
      const buffer = Buffer.alloc(size - summary.offset);
      await handle.read(buffer, 0, buffer.length, summary.offset);
      // Only whole lines: the last one may still be being written.
      const end = buffer.lastIndexOf(0x0a);
      if (end < 0) return summary;
      for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
        if (line.trim()) parseLine(summary, line);
      }
      summary.offset += end + 1;
      return summary;
    } finally {
      await handle.close();
    }
  }
}

function parseLine(summary: FileSummary, line: string): void {
  let entry: TranscriptEntry;
  try {
    entry = JSON.parse(line) as TranscriptEntry;
  } catch {
    return;
  }
  if (entry.isSidechain || !entry.timestamp) return;
  const ts = Date.parse(entry.timestamp);
  const content = Array.isArray(entry.message?.content) ? (entry.message.content as Block[]) : [];
  if (entry.type === 'assistant') {
    // One entry per content block, all carrying the message's usage: count each message once.
    const id = entry.message?.id;
    const usage = entry.message?.usage;
    if (id && usage && !summary.seenMessages.has(id)) {
      summary.seenMessages.add(id);
      summary.turns.push({
        ts,
        output: usage.output_tokens ?? 0,
        context:
          (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0),
      });
    }
    for (const block of content) {
      if (block.type !== 'tool_use' || !block.id || !block.input) continue;
      const edit = lineChanges(block.name ?? '', block.input);
      if (edit) summary.pendingEdits.set(block.id, { ts, ...edit });
    }
  } else if (entry.type === 'user') {
    for (const block of content) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue;
      const edit = summary.pendingEdits.get(block.tool_use_id);
      if (!edit) continue;
      summary.pendingEdits.delete(block.tool_use_id);
      if (!block.is_error) summary.edits.push(edit);
    }
  }
}

/** Lines added and removed by a file-editing tool call (lines present on one side only). */
export function lineChanges(
  tool: string,
  input: Record<string, unknown>,
): { added: number; removed: number } | null {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  if (tool === 'Write') return { added: countLines(text(input.content)), removed: 0 };
  const pairs =
    tool === 'Edit'
      ? [{ old_string: input.old_string, new_string: input.new_string }]
      : tool === 'MultiEdit' && Array.isArray(input.edits)
        ? (input.edits as { old_string?: unknown; new_string?: unknown }[])
        : null;
  if (!pairs) return null;
  let added = 0;
  let removed = 0;
  for (const pair of pairs) {
    const before = new Map<string, number>();
    for (const line of splitLines(text(pair.old_string))) before.set(line, (before.get(line) ?? 0) + 1);
    for (const line of splitLines(text(pair.new_string))) {
      const left = before.get(line) ?? 0;
      if (left > 0) before.set(line, left - 1);
      else added += 1;
    }
    for (const left of before.values()) removed += left;
  }
  return { added, removed };
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.replace(/\n$/, '').split('\n');
}

function countLines(text: string): number {
  return splitLines(text).length;
}

// ---- search --------------------------------------------------------------------------------------

const CONTEXT_BEFORE = 70;
const CONTEXT_AFTER = 150;

/** Lower case without accents, so "cafe" finds "café". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Where `foldedQuery` appears in `text`, in `text`'s own indices. */
export function findFolded(text: string, foldedQuery: string): [number, number] | null {
  let folded = '';
  const origin: number[] = [];
  for (let index = 0; index < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(index)!);
    for (const piece of fold(char)) {
      folded += piece;
      origin.push(index);
    }
    index += char.length;
  }
  origin.push(text.length);
  const at = folded.indexOf(foldedQuery);
  if (at < 0) return null;
  return [origin[at]!, origin[at + foldedQuery.length] ?? text.length];
}

function snippet(
  text: string,
  [start, end]: [number, number],
): Pick<SearchHit, 'before' | 'match' | 'after'> {
  const squash = (part: string) => part.replace(/\s+/g, ' ');
  const from = Math.max(0, start - CONTEXT_BEFORE);
  const to = Math.min(text.length, end + CONTEXT_AFTER);
  return {
    before: (from > 0 ? '…' : '') + squash(text.slice(from, start)).trimStart(),
    match: squash(text.slice(start, end)),
    after: squash(text.slice(end, to)).trimEnd() + (to < text.length ? '…' : ''),
  };
}

/** What a transcript line says that a human would search for: prompts and answers, not tool output. */
function searchableText(entry: TranscriptEntry): { role: 'user' | 'assistant'; text: string } | null {
  if (entry.isSidechain || entry.isMeta) return null;
  const content = entry.message?.content;
  if (entry.type === 'user') {
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? (content as Block[])
              .filter((block) => block.type === 'text')
              .map((block) => block.text ?? '')
              .join('\n')
          : '';
    if (!text || text.startsWith(OWN_PROMPT_PREFIX) || /^<(command|local-command)/.test(text)) return null;
    return { role: 'user', text };
  }
  if (entry.type === 'assistant' && Array.isArray(content)) {
    const text = (content as Block[])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');
    return text ? { role: 'assistant', text } : null;
  }
  return null;
}

/** Latin letters with diacritics, grouped by the letter they fold to (lower case). */
const VARIANTS = new Map<string, string>();
for (let code = 0xc0; code <= 0x17f; code++) {
  const char = String.fromCodePoint(code).toLowerCase();
  const base = fold(char);
  if (base.length === 1 && base !== char) VARIANTS.set(base, (VARIANTS.get(base) ?? base) + char);
}

/** A regular expression finding `foldedQuery` in raw text, whatever the case and accents. */
export function looseRegex(foldedQuery: string): RegExp {
  const source = [...foldedQuery]
    .map((char) => {
      const variants = VARIANTS.get(char);
      return variants ? `[${variants}]` : char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    })
    .join('');
  return new RegExp(source, 'giu');
}

/** The lines of `raw` that may contain the query (all of them when it has characters JSON escapes). */
function candidateLines(raw: string, query: string, folded: string): string[] {
  if (/["\\\u0000-\u001f]/.test(query)) return raw.split('\n');
  const pattern = looseRegex(folded);
  const lines: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    const start = raw.lastIndexOf('\n', match.index) + 1;
    let end = raw.indexOf('\n', match.index);
    if (end < 0) end = raw.length;
    lines.push(raw.slice(start, end));
    // One candidate per line is enough.
    pattern.lastIndex = end + 1;
  }
  return lines;
}

/** Hits of `query` in a transcript, oldest first. */
export async function searchTranscript(path: string, deskId: string, query: string): Promise<SearchHit[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const folded = fold(query);
  const hits: SearchHit[] = [];
  for (const line of candidateLines(raw, query, folded)) {
    if (!line) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }
    const found = searchableText(entry);
    if (!found || !entry.timestamp) continue;
    const range = findFolded(found.text, folded);
    if (!range) continue;
    hits.push({ deskId, ts: Date.parse(entry.timestamp), role: found.role, ...snippet(found.text, range) });
  }
  return hits;
}
