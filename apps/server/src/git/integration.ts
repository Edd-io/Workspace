import type {
  IntegrationCommit,
  IntegrationDiff,
  IntegrationFile,
  IntegrationStatus,
  MergeOutcome,
  PullRequestInfo,
} from '@workspace/shared';
import { currentBranch, git, repoRoot, run } from './git.ts';

/**
 * Integrating a worktree desk: comparing its branch with a target branch, merging it, or opening a
 * pull request. The desk branch is only ever read here, except by `commitPending` and
 * `updateDeskFromTarget` which work inside the desk's own worktree.
 */

export class IntegrationError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export interface DeskRepo {
  /** Folder of the room's project (inside the main worktree of the repository). */
  projectPath: string;
  /** Folder the desk works in (inside its own worktree). */
  workdir: string;
  branch: string;
}

const DIFF_LIMIT = 1_500_000;
const MAX_COMMITS = 100;

async function revParse(root: string, ref: string): Promise<string | null> {
  const result = await run('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function localBranches(root: string): Promise<string[]> {
  const output = await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  return output.split('\n').filter(Boolean);
}

/** Path of the worktree that has `branch` checked out, if any. */
async function worktreeOf(root: string, branch: string): Promise<string | null> {
  const output = await git(root, ['worktree', 'list', '--porcelain']);
  let path: string | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

async function trackedChanges(path: string): Promise<boolean> {
  return (await git(path, ['status', '--porcelain', '--untracked-files=no'])) !== '';
}

/** Default target: the base branch the desk started from, else the project's current branch. */
export async function defaultTarget(repo: DeskRepo, baseBranch: string | null): Promise<string> {
  const root = await repoRoot(repo.projectPath);
  const branches = (await localBranches(root)).filter((name) => !isDeskBranch(name));
  if (baseBranch && branches.includes(baseBranch)) return baseBranch;
  const current = await currentBranch(root);
  if (current && branches.includes(current)) return current;
  return ['main', 'master', 'develop'].find((name) => branches.includes(name)) ?? branches[0] ?? 'main';
}

function parseStatusLines(output: string): { path: string; status: string }[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim() || '?', path: line.slice(3) }));
}

async function changedFiles(root: string, range: string): Promise<IntegrationFile[]> {
  const [names, numbers] = await Promise.all([
    git(root, ['diff', '--name-status', '--find-renames', range]),
    git(root, ['diff', '--numstat', '--find-renames', range]),
  ]);
  const stats = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const line of numbers.split('\n').filter(Boolean)) {
    const [added, deleted, ...rest] = line.split('\t');
    // Renames read "old => new" or "dir/{old => new}"; the name-status output gives the new path.
    const path = rest
      .join('\t')
      .replace(/\{[^}]* => ([^}]*)\}/, '$1')
      .replace(/^.* => /, '');
    stats.set(path, {
      additions: added === '-' ? null : Number(added),
      deletions: deleted === '-' ? null : Number(deleted),
    });
  }
  return names
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t');
      const path = paths[paths.length - 1]!;
      return {
        path,
        status: status!.charAt(0),
        ...(stats.get(path) ?? { additions: null, deletions: null }),
      };
    });
}

/**
 * Merges `branch` into `target` in memory (git ≥ 2.38, no checkout needed): the resulting tree, or
 * the files that would conflict.
 */
async function mergeTree(
  root: string,
  target: string,
  branch: string,
): Promise<{ tree: string; conflicts: [] } | { tree: null; conflicts: string[] }> {
  const result = await run('git', [
    '-C',
    root,
    'merge-tree',
    '--write-tree',
    '--name-only',
    '--no-messages',
    target,
    branch,
  ]);
  const [tree, ...files] = result.stdout.split('\n').filter(Boolean);
  if (result.code === 0 && tree) return { tree: tree.trim(), conflicts: [] };
  if (result.code === 1) return { tree: null, conflicts: files };
  throw new IntegrationError('merge_failed', result.stderr.trim() || 'git merge-tree failed.');
}

/** Desk branches are never offered as targets: another desk may be working on them. */
const isDeskBranch = (name: string) => name.startsWith('workspace/');

export async function integrationStatus(
  deskId: string,
  repo: DeskRepo,
  target: string,
  baseBranch: string | null,
): Promise<IntegrationStatus> {
  const root = await repoRoot(repo.projectPath);
  const branches = (await localBranches(root)).filter((name) => !isDeskBranch(name));
  if (!(await revParse(root, `refs/heads/${repo.branch}`))) {
    throw new IntegrationError('branch_missing', `The desk branch ${repo.branch} does not exist.`);
  }
  if (!branches.includes(target)) {
    throw new IntegrationError('target_missing', `The branch ${target} does not exist.`, { target });
  }
  const range = `${target}...${repo.branch}`;
  const [counts, log, files, status, targetWorktree] = await Promise.all([
    git(root, ['rev-list', '--left-right', '--count', range]),
    git(root, [
      'log',
      `--max-count=${MAX_COMMITS}`,
      '--format=%H%x1f%s%x1f%an%x1f%ct',
      `${target}..${repo.branch}`,
    ]),
    changedFiles(root, range),
    // Not trimmed: porcelain lines start with a status column that may be a space.
    run('git', ['-C', repo.workdir, 'status', '--porcelain']).then((result) => result.stdout),
    worktreeOf(root, target),
  ]);
  const [behind, ahead] = counts.split(/\s+/).map(Number) as [number, number];
  const commits: IntegrationCommit[] = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, author, date] = line.split('\x1f');
      return { sha: sha!, subject: subject!, author: author!, date: Number(date) * 1000 };
    });
  const conflicts = ahead > 0 && behind > 0 ? (await mergeTree(root, target, repo.branch)).conflicts : [];
  return {
    deskId,
    branch: repo.branch,
    target,
    baseBranch,
    branches,
    ahead,
    behind,
    commits,
    files,
    uncommitted: parseStatusLines(status),
    conflicts,
    targetWorktree,
    targetWorktreeDirty: targetWorktree ? await trackedChanges(targetWorktree) : false,
  };
}

export async function integrationDiff(repo: DeskRepo, target: string): Promise<IntegrationDiff> {
  const root = await repoRoot(repo.projectPath);
  const [committed, uncommitted, untracked] = await Promise.all([
    git(root, ['diff', '--no-color', '--find-renames', `${target}...${repo.branch}`]),
    git(repo.workdir, ['diff', '--no-color', 'HEAD']),
    git(repo.workdir, ['ls-files', '--others', '--exclude-standard']),
  ]);
  const truncated = committed.length > DIFF_LIMIT || uncommitted.length > DIFF_LIMIT;
  return {
    committed: committed.slice(0, DIFF_LIMIT),
    uncommitted: uncommitted.slice(0, DIFF_LIMIT),
    untracked: untracked.split('\n').filter(Boolean),
    truncated,
  };
}

/** Commits everything the desk left uncommitted in its worktree. */
export async function commitPending(repo: DeskRepo, message: string): Promise<void> {
  await git(repo.workdir, ['add', '--all']);
  const result = await run('git', ['-C', repo.workdir, 'commit', '--quiet', '-m', message]);
  if (result.code !== 0)
    throw new IntegrationError('commit_failed', result.stderr.trim() || result.stdout.trim());
}

/**
 * Merges the desk branch into `target`. When a worktree has the target checked out (typically the
 * project folder itself), the merge runs there and only if it has no uncommitted changes; otherwise
 * the target ref is moved without touching any checkout.
 */
export async function mergeIntoTarget(
  repo: DeskRepo,
  target: string,
  message: string,
): Promise<MergeOutcome> {
  if (isDeskBranch(target))
    throw new IntegrationError('target_missing', `${target} is a desk branch.`, { target });
  const root = await repoRoot(repo.projectPath);
  const targetSha = await revParse(root, `refs/heads/${target}`);
  const branchSha = await revParse(root, `refs/heads/${repo.branch}`);
  if (!targetSha)
    throw new IntegrationError('target_missing', `The branch ${target} does not exist.`, { target });
  if (!branchSha)
    throw new IntegrationError('branch_missing', `The desk branch ${repo.branch} does not exist.`);
  const commits = Number(await git(root, ['rev-list', '--count', `${target}..${repo.branch}`]));
  if (commits === 0) return { status: 'up_to_date' };
  const fastForward = (await git(root, ['merge-base', target, repo.branch])) === targetSha;

  const checkout = await worktreeOf(root, target);
  if (checkout) {
    if (await trackedChanges(checkout)) {
      throw new IntegrationError('target_dirty', `${checkout} has uncommitted changes.`, { path: checkout });
    }
    const result = await run('git', ['-C', checkout, 'merge', '--no-edit', '-m', message, repo.branch]);
    if (result.code !== 0) {
      const conflicted = await git(checkout, ['diff', '--name-only', '--diff-filter=U']).catch(() => '');
      await run('git', ['-C', checkout, 'merge', '--abort']);
      const files = conflicted.split('\n').filter(Boolean);
      if (files.length > 0) return { status: 'conflicts', files };
      throw new IntegrationError('merge_failed', result.stderr.trim() || result.stdout.trim());
    }
    return { status: 'merged', commits, fastForward };
  }

  if (fastForward) {
    await git(root, ['update-ref', '-m', message, `refs/heads/${target}`, branchSha, targetSha]);
    return { status: 'merged', commits, fastForward: true };
  }
  const merged = await mergeTree(root, target, repo.branch);
  if (!merged.tree) return { status: 'conflicts', files: merged.conflicts };
  const commit = await run('git', [
    '-C',
    root,
    'commit-tree',
    merged.tree,
    '-p',
    targetSha,
    '-p',
    branchSha,
    '-m',
    message,
  ]);
  if (commit.code !== 0) throw new IntegrationError('merge_failed', commit.stderr.trim());
  // The expected old value makes this fail instead of losing commits if the target moved meanwhile.
  await git(root, ['update-ref', '-m', message, `refs/heads/${target}`, commit.stdout.trim(), targetSha]);
  return { status: 'merged', commits, fastForward: false };
}

/** Brings the target's new commits into the desk branch (inside the desk's clean worktree). */
export async function updateDeskFromTarget(repo: DeskRepo, target: string): Promise<MergeOutcome> {
  if (await trackedChanges(repo.workdir)) {
    throw new IntegrationError('desk_dirty', 'The desk has uncommitted changes.');
  }
  const root = await repoRoot(repo.projectPath);
  const commits = Number(await git(root, ['rev-list', '--count', `${repo.branch}..${target}`]));
  if (commits === 0) return { status: 'up_to_date' };
  const fastForward =
    (await git(root, ['merge-base', target, repo.branch])) === (await revParse(root, repo.branch));
  const result = await run('git', ['-C', repo.workdir, 'merge', '--no-edit', target]);
  if (result.code !== 0) {
    const conflicted = await git(repo.workdir, ['diff', '--name-only', '--diff-filter=U']).catch(() => '');
    await run('git', ['-C', repo.workdir, 'merge', '--abort']);
    const files = conflicted.split('\n').filter(Boolean);
    if (files.length > 0) return { status: 'conflicts', files };
    throw new IntegrationError('merge_failed', result.stderr.trim() || result.stdout.trim());
  }
  return { status: 'merged', commits, fastForward };
}

// ---- pull requests (GitHub CLI) ------------------------------------------------------------------

let ghCheck: { at: number; reason: 'no_gh' | 'gh_not_authenticated' | null } | null = null;

async function ghProblem(): Promise<'no_gh' | 'gh_not_authenticated' | null> {
  if (ghCheck && Date.now() - ghCheck.at < 5 * 60_000) return ghCheck.reason;
  const result = await run('gh', ['auth', 'status'], { timeoutMs: 15_000 });
  const reason = result.code === 127 ? 'no_gh' : result.code !== 0 ? 'gh_not_authenticated' : null;
  ghCheck = { at: Date.now(), reason };
  return reason;
}

async function pickRemote(root: string): Promise<string | null> {
  const remotes = (await git(root, ['remote'])).split('\n').filter(Boolean);
  return remotes.includes('origin') ? 'origin' : (remotes[0] ?? null);
}

export async function pullRequestInfo(repo: DeskRepo): Promise<PullRequestInfo> {
  const root = await repoRoot(repo.projectPath);
  const remote = await pickRemote(root);
  if (!remote) return { available: false, reason: 'no_remote', remote: null, existingUrl: null };
  const problem = await ghProblem();
  if (problem) return { available: false, reason: problem, remote, existingUrl: null };
  const existing = await run(
    'gh',
    ['pr', 'list', '--head', repo.branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url'],
    { cwd: root, timeoutMs: 20_000 },
  );
  return { available: true, reason: null, remote, existingUrl: existing.stdout.trim() || null };
}

export async function createPullRequest(
  repo: DeskRepo,
  target: string,
  title: string,
  body: string,
): Promise<string> {
  const root = await repoRoot(repo.projectPath);
  const remote = await pickRemote(root);
  if (!remote) throw new IntegrationError('no_remote', 'The repository has no remote.');
  const problem = await ghProblem();
  if (problem) throw new IntegrationError(problem, 'The GitHub CLI is not available.');
  const push = await run('git', ['-C', root, 'push', '--set-upstream', remote, repo.branch], {
    timeoutMs: 120_000,
  });
  if (push.code !== 0) throw new IntegrationError('push_failed', push.stderr.trim());
  const created = await run(
    'gh',
    ['pr', 'create', '--base', target, '--head', repo.branch, '--title', title, '--body', body],
    { cwd: root, timeoutMs: 60_000 },
  );
  if (created.code !== 0)
    throw new IntegrationError('pr_failed', created.stderr.trim() || created.stdout.trim());
  const url = created.stdout.trim().split('\n').pop() ?? '';
  return url;
}
