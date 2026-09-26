import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, relative, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command without throwing on a non-zero exit code (merge-tree reports conflicts that way). */
export async function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: 64 * 1024 * 1024,
      // Never wait for a credential prompt: the server has no terminal.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    if (failure.code === 'ENOENT') return { code: 127, stdout: '', stderr: `${command}: command not found` };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
    };
  }
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

/** Branch checked out at `path`, or null when HEAD is detached. */
export async function currentBranch(path: string): Promise<string | null> {
  try {
    return (await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'])) || null;
  } catch {
    return null;
  }
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
  // `root` comes back with symlinks resolved (e.g. /var → /private/var on macOS): resolve the project
  // path too, or the relative path climbs out of the worktree back into the project folder itself.
  const inside = relative(root, realpathSync(projectPath));
  if (inside.startsWith('..')) {
    throw new GitError('worktree_failed', `${projectPath} is not inside the repository ${root}.`);
  }
  return join(worktreePath, inside);
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
