import { z } from 'zod';

/** A commit of a desk branch that its target branch does not have yet. */
export interface IntegrationCommit {
  sha: string;
  subject: string;
  author: string;
  date: number;
}

export interface IntegrationFile {
  path: string;
  /** Git status letter: A(dded), M(odified), D(eleted), R(enamed)… */
  status: string;
  /** Null for binary files. */
  additions: number | null;
  deletions: number | null;
}

/** Everything the integration dialog needs to integrate a worktree desk into a target branch. */
export interface IntegrationStatus {
  deskId: string;
  branch: string;
  target: string;
  /** Branch the desk started from, when known. */
  baseBranch: string | null;
  /** Local branches that can be targeted (the desk's own branch excluded). */
  branches: string[];
  /** Commits on the desk branch missing from the target, and the other way around. */
  ahead: number;
  behind: number;
  commits: IntegrationCommit[];
  files: IntegrationFile[];
  /** Changes the desk has not committed yet (`git status --porcelain` lines). */
  uncommitted: { path: string; status: string }[];
  /** Files that would conflict when merging the desk branch into the target. */
  conflicts: string[];
  /** Worktree that has the target branch checked out (the merge then happens there). */
  targetWorktree: string | null;
  /** That worktree has uncommitted changes to tracked files: merging there is refused. */
  targetWorktreeDirty: boolean;
}

export type PullRequestUnavailableReason = 'no_remote' | 'no_gh' | 'gh_not_authenticated';

export interface PullRequestInfo {
  available: boolean;
  reason: PullRequestUnavailableReason | null;
  remote: string | null;
  /** Open pull request of the desk branch, if any. */
  existingUrl: string | null;
}

export interface IntegrationDiff {
  /** Unified diff of the commits (`target...branch`). */
  committed: string;
  /** Unified diff of the uncommitted changes of the desk worktree. */
  uncommitted: string;
  untracked: string[];
  truncated: boolean;
}

export type MergeOutcome =
  | { status: 'merged'; commits: number; fastForward: boolean }
  | { status: 'up_to_date' }
  | { status: 'conflicts'; files: string[] };

export const integrationTargetSchema = z.object({
  target: z.string().trim().min(1).max(250),
});

export const commitPendingSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export const pullRequestSchema = z.object({
  target: z.string().trim().min(1).max(250),
  title: z.string().trim().min(1).max(250),
  body: z.string().max(20_000).default(''),
});

/** A prompt typed into a desk's terminal on the user's behalf (only when the desk is idle). */
export const deskPromptSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});
