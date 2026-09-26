import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findFolded,
  fold,
  lineChanges,
  looseRegex,
  searchTranscript,
  TranscriptIndex,
} from '../src/office/transcripts.ts';

const line = (entry: unknown) => `${JSON.stringify(entry)}\n`;
const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 10, minute)).toISOString();

function assistant(minute: number, id: string, content: unknown[], output = 10, context = 1000) {
  return line({
    type: 'assistant',
    timestamp: at(minute),
    message: {
      id,
      content,
      usage: { input_tokens: 2, cache_read_input_tokens: context - 2, output_tokens: output },
    },
  });
}

function toolResult(minute: number, id: string, isError = false) {
  return line({
    type: 'user',
    timestamp: at(minute),
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'ok' }] },
  });
}

describe('lineChanges', () => {
  it('counts lines present on one side only', () => {
    expect(lineChanges('Edit', { old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' })).toEqual({
      added: 2,
      removed: 1,
    });
    expect(lineChanges('Write', { content: 'one\ntwo\n' })).toEqual({ added: 2, removed: 0 });
    expect(lineChanges('Read', { file_path: '/x' })).toBeNull();
  });
});

describe('TranscriptIndex', () => {
  it('counts each message once, skips failed edits and reads only what was appended', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'transcript-')), 's.jsonl');
    writeFileSync(
      path,
      assistant(1, 'm1', [{ type: 'text', text: 'Let me edit.' }]) +
        assistant(1, 'm1', [
          { type: 'tool_use', id: 't1', name: 'Edit', input: { old_string: 'x', new_string: 'y\nz' } },
        ]) +
        toolResult(2, 't1') +
        assistant(3, 'm2', [{ type: 'tool_use', id: 't2', name: 'Write', input: { content: 'a\nb' } }]) +
        toolResult(4, 't2', true),
    );
    const index = new TranscriptIndex();
    let summary = (await index.summary(path))!;
    expect(summary.turns.map((turn) => turn.output)).toEqual([10, 10]);
    expect(summary.edits).toEqual([{ ts: Date.parse(at(1)), added: 2, removed: 1 }]);

    // A partial last line waits for the rest.
    appendFileSync(path, assistant(5, 'm3', [{ type: 'text', text: 'Done.' }], 7, 5000).slice(0, 20));
    summary = (await index.summary(path))!;
    expect(summary.turns).toHaveLength(2);
    appendFileSync(path, assistant(5, 'm3', [{ type: 'text', text: 'Done.' }], 7, 5000).slice(20));
    summary = (await index.summary(path))!;
    expect(summary.turns.at(-1)).toEqual({ ts: Date.parse(at(5)), output: 7, context: 5000 });
  });
});

describe('search', () => {
  it('ignores case and accents', () => {
    expect(fold('Tâche Réglée')).toBe('tache reglee');
    const text = 'Il reste une tâche à finir';
    const range = findFolded(text, fold('TACHE'))!;
    expect(text.slice(...range)).toBe('tâche');
  });

  it('finds prompts and answers, not tool output or wake-ups', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'transcript-')), 's.jsonl');
    writeFileSync(
      path,
      line({ type: 'user', timestamp: at(1), message: { content: 'Migre la base vers Postgres' } }) +
        assistant(2, 'm1', [{ type: 'text', text: 'La migration Postgres est faite.' }]) +
        line({
          type: 'user',
          timestamp: at(3),
          message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'postgres logs' }] },
        }) +
        line({ type: 'user', timestamp: at(4), message: { content: '[Workspace] postgres wake-up' } }),
    );
    const hits = await searchTranscript(path, 'ken', 'postgres');
    expect(hits.map((hit) => [hit.role, hit.match])).toEqual([
      ['user', 'Postgres'],
      ['assistant', 'Postgres'],
    ]);
    expect(hits[1]).toMatchObject({ before: 'La migration ', after: ' est faite.' });
  });
});

describe('looseRegex', () => {
  it('matches any case and accent, and escapes regular expression syntax', () => {
    expect('La TÂCHE est finie'.match(looseRegex(fold('tache')))?.[0]).toBe('TÂCHE');
    expect(looseRegex(fold('a.b-c (d)')).test('a.b-c (d)')).toBe(true);
    expect(looseRegex(fold('a.b')).test('axb')).toBe(false);
  });
});
