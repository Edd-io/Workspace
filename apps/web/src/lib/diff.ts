/** Minimal parser of `git diff` output, for the integration dialog. */

export type DiffLineKind = 'hunk' | 'add' | 'del' | 'context' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffFile {
  path: string;
  binary: boolean;
  lines: DiffLine[];
}

function pathFromHeader(header: string): string {
  // "diff --git a/src/x.ts b/src/x.ts": the part after " b/" is the new path.
  const index = header.lastIndexOf(' b/');
  return index === -1 ? header.slice('diff --git '.length) : header.slice(index + 3);
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let inHunk = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: pathFromHeader(line), binary: false, lines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('@@')) {
      inHunk = true;
      current.lines.push({ kind: 'hunk', text: line });
    } else if (!inHunk) {
      if (line.startsWith('+++ b/')) current.path = line.slice(6);
      if (line.startsWith('Binary files')) current.binary = true;
    } else if (line.startsWith('+')) {
      current.lines.push({ kind: 'add', text: line.slice(1) });
    } else if (line.startsWith('-')) {
      current.lines.push({ kind: 'del', text: line.slice(1) });
    } else if (line.startsWith('\\')) {
      current.lines.push({ kind: 'meta', text: line });
    } else {
      current.lines.push({ kind: 'context', text: line.slice(1) });
    }
  }
  return files;
}
