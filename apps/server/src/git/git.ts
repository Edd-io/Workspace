import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, relative, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return stdout.trim();
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return (await git(path, ['rev-parse', '--is-inside-work-tree'])) === 'true';
  } catch {
    return false;
  }
}

export async function repoRoot(path: string): Promise<string> {
  return git(path, ['rev-parse', '--show-toplevel']);
}

async function hasCommits(root: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export class GitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Creates a worktree of the repository containing `projectPath` at `worktreePath` on `branch`.
 * Returns the directory the desk should work in (the project's sub-folder inside the worktree when
 * the room points to a sub-folder of the repository).
 */
export async function createWorktree(
  projectPath: string,
  worktreePath: string,
  branch: string,
): Promise<string> {
  const root = await repoRoot(projectPath);
  if (!(await hasCommits(root))) {
    throw new GitError('repo_without_commits', 'The repository has no commit yet; worktrees need one.');
  }
  mkdirSync(dirname(worktreePath), { recursive: true });
  if (await branchExists(root, branch)) {
    await git(root, ['worktree', 'add', worktreePath, branch]);
  } else {
    await git(root, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
  }
  return join(worktreePath, relative(root, projectPath));
}

export async function hasUncommittedChanges(path: string): Promise<boolean> {
  try {
    return (await git(path, ['status', '--porcelain'])) !== '';
  } catch {
    return false;
  }
}

/** Removes a worktree but always keeps its branch: the desk's work must never be lost. */
export async function removeWorktree(projectPath: string, worktreePath: string): Promise<void> {
  const root = await repoRoot(projectPath);
  await git(root, ['worktree', 'remove', '--force', worktreePath]);
}
