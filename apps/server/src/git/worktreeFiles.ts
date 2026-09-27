import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from './git.ts';

/**
 * Files a room copies into its worktree desks (typically `.env`): git never puts untracked files in
 * a worktree. Only files git ignores are allowed, so a copy can never end up in a commit.
 */

/** The files among `files` (relative to `dir`) that git does not ignore there. */
export async function notIgnored(dir: string, files: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const file of files) {
    // Exit code 0: ignored; 1: not ignored (tracked files included); 128: error.
    const check = await run('git', ['-C', dir, 'check-ignore', '--quiet', '--', file]);
    if (check.code !== 0) result.push(file);
  }
  return result;
}

/**
 * Copies `files` from the project folder into a desk's working directory. Files missing from the
 * project, already present in the worktree (the desk may have changed them) or not ignored there are
 * left out. Returns the files copied.
 */
export async function copyWorktreeFiles(
  projectPath: string,
  workdir: string,
  files: string[],
): Promise<string[]> {
  const unsafe = new Set(await notIgnored(workdir, files));
  const copied: string[] = [];
  for (const file of files) {
    const source = join(projectPath, file);
    const target = join(workdir, file);
    if (unsafe.has(file) || !existsSync(source) || existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, preserveTimestamps: true });
    copied.push(file);
  }
  return copied;
}
