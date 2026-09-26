import { open } from 'node:fs/promises';

/** Reads the last `bytes` of a file (whole lines only). */
export async function readTail(path: string, bytes = 256 * 1024): Promise<string[]> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // First line is probably truncated.
    return lines.filter((line) => line.trim() !== '');
  } finally {
    await handle.close();
  }
}

/** Latest AI-generated conversation title recorded by Claude Code in a transcript, if any. */
export async function latestAiTitle(transcriptPath: string): Promise<string | null> {
  let lines: string[];
  try {
    lines = await readTail(transcriptPath);
  } catch {
    return null;
  }
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!;
    if (!line.includes('"ai-title"')) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; aiTitle?: string };
      if (entry.type === 'ai-title' && entry.aiTitle) return entry.aiTitle;
    } catch {
      // Ignore malformed lines.
    }
  }
  return null;
}
