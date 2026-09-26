import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorktree } from '../src/git/git.ts';
import {
  commitPending,
  defaultTarget,
  integrationStatus,
  mergeIntoTarget,
  updateDeskFromTarget,
  type DeskRepo,
} from '../src/git/integration.ts';

let dir: string;
let project: string;
let desk: DeskRepo;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

function commitFile(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', message);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'workspace-integration-'));
  project = join(dir, 'project');
  execFileSync('git', ['init', '-q', '-b', 'main', project]);
  git(project, 'config', 'user.name', 'Test');
  git(project, 'config', 'user.email', 'test@example.com');
  commitFile(project, 'a.txt', 'one\ntwo\nthree\n', 'init');
  const workdir = await createWorktree(project, join(dir, 'worktrees', 'ada'), 'workspace/ada');
  desk = { projectPath: project, workdir, branch: 'workspace/ada' };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('desk integration', () => {
  it('reports the commits, files and pending changes of a desk', async () => {
    commitFile(desk.workdir, 'b.txt', 'new\n', 'add b');
    writeFileSync(join(desk.workdir, 'c.txt'), 'draft\n');
    const status = await integrationStatus('d1', desk, await defaultTarget(desk, 'main'), 'main');
    expect(status.target).toBe('main');
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(0);
    expect(status.commits.map((commit) => commit.subject)).toEqual(['add b']);
    expect(status.files).toEqual([{ path: 'b.txt', status: 'A', additions: 1, deletions: 0 }]);
    expect(status.uncommitted).toEqual([{ path: 'c.txt', status: '??' }]);
    expect(status.branches).toEqual(['main']);
    expect(status.targetWorktree).toBe(git(project, 'rev-parse', '--show-toplevel'));
  });

  it('fast-forwards the checked-out target inside its worktree', async () => {
    commitFile(desk.workdir, 'b.txt', 'new\n', 'add b');
    expect(await mergeIntoTarget(desk, 'main', 'merge')).toEqual({
      status: 'merged',
      commits: 1,
      fastForward: true,
    });
    expect(git(project, 'log', '--format=%s', '-1')).toBe('add b');
    expect(git(project, 'status', '--porcelain')).toBe('');
  });

  it('refuses to merge into a checkout with uncommitted changes', async () => {
    commitFile(desk.workdir, 'b.txt', 'new\n', 'add b');
    writeFileSync(join(project, 'a.txt'), 'edited by the user\n');
    await expect(mergeIntoTarget(desk, 'main', 'merge')).rejects.toMatchObject({ code: 'target_dirty' });
    expect(git(project, 'log', '--format=%s', '-1')).toBe('init');
  });

  it('merges into a branch nobody has checked out without touching any worktree', async () => {
    git(project, 'branch', 'release');
    commitFile(project, 'z.txt', 'main only\n', 'main moves on');
    git(project, 'checkout', '-q', 'release');
    commitFile(project, 'r.txt', 'release\n', 'release fix');
    git(project, 'checkout', '-q', 'main');
    commitFile(desk.workdir, 'b.txt', 'new\n', 'add b');

    const outcome = await mergeIntoTarget(desk, 'release', 'Merge ada');
    expect(outcome).toEqual({ status: 'merged', commits: 1, fastForward: false });
    expect(git(project, 'log', '--format=%s', '-1', 'release')).toBe('Merge ada');
    expect(git(project, 'show', 'release:b.txt')).toBe('new');
    expect(git(project, 'show', 'release:r.txt')).toBe('release');
    // The project folder stays on main, untouched.
    expect(git(project, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(project, 'status', '--porcelain')).toBe('');
  });

  it('predicts conflicts, refuses the merge and lets the desk catch up', async () => {
    commitFile(project, 'a.txt', 'one\nTWO (main)\nthree\n', 'main edit');
    commitFile(desk.workdir, 'a.txt', 'one\nTWO (desk)\nthree\n', 'desk edit');
    git(project, 'branch', 'side', 'main');

    const status = await integrationStatus('d1', desk, 'side', null);
    expect(status.conflicts).toEqual(['a.txt']);
    expect(await mergeIntoTarget(desk, 'side', 'merge')).toEqual({ status: 'conflicts', files: ['a.txt'] });
    expect(await mergeIntoTarget(desk, 'main', 'merge')).toEqual({ status: 'conflicts', files: ['a.txt'] });
    // The failed merge in the project folder was rolled back.
    expect(git(project, 'status', '--porcelain')).toBe('');

    expect(await updateDeskFromTarget(desk, 'main')).toEqual({ status: 'conflicts', files: ['a.txt'] });
    expect(git(desk.workdir, 'status', '--porcelain')).toBe('');
  });

  it('commits pending changes and brings new target commits into the desk', async () => {
    writeFileSync(join(desk.workdir, 'c.txt'), 'draft\n');
    await commitPending(desk, 'Save the draft');
    expect(git(desk.workdir, 'log', '--format=%s', '-1')).toBe('Save the draft');

    commitFile(project, 'z.txt', 'main\n', 'main moves on');
    expect(await updateDeskFromTarget(desk, 'main')).toMatchObject({ status: 'merged', commits: 1 });
    expect(git(desk.workdir, 'show', 'HEAD:z.txt')).toBe('main');
  });
});
