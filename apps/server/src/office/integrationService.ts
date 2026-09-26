import type { IntegrationDiff, IntegrationStatus, MergeOutcome, PullRequestInfo } from '@workspace/shared';
import {
  commitPending,
  createPullRequest,
  defaultTarget,
  integrationDiff,
  integrationStatus,
  mergeIntoTarget,
  pullRequestInfo,
  updateDeskFromTarget,
  type DeskRepo,
} from '../git/integration.ts';
import type { SessionManager } from '../sessions/sessionManager.ts';
import type { DeskRecord, OfficeStore } from '../store/officeStore.ts';
import { OfficeError } from './officeService.ts';

/** Desk states during which Claude may be writing to the worktree. */
const BUSY_STATES = new Set(['working', 'compacting', 'starting']);

/** Integration of worktree desks into their project (see git/integration.ts). */
export class IntegrationService {
  private readonly store: OfficeStore;
  private readonly sessions: SessionManager;

  constructor(store: OfficeStore, sessions: SessionManager) {
    this.store = store;
    this.sessions = sessions;
  }

  private resolve(deskId: string): { desk: DeskRecord; repo: DeskRepo } {
    const desk = this.store.getDesk(deskId);
    if (!desk) throw new OfficeError('desk_not_found', 'Desk not found.', 404);
    const room = this.store.getRoom(desk.roomId);
    if (!room) throw new OfficeError('room_not_found', 'Room not found.', 404);
    if (desk.mode !== 'worktree' || !desk.branch) {
      throw new OfficeError('not_a_worktree_desk', 'This desk works directly in the project folder.', 409);
    }
    return { desk, repo: { projectPath: room.projectPath, workdir: desk.workdir, branch: desk.branch } };
  }

  private ensureNotBusy(desk: DeskRecord): void {
    if (BUSY_STATES.has(desk.state)) {
      throw new OfficeError('desk_busy', 'The desk is working: wait until it is done.', 409);
    }
  }

  async status(deskId: string, target?: string): Promise<IntegrationStatus> {
    const { desk, repo } = this.resolve(deskId);
    return integrationStatus(
      desk.id,
      repo,
      target ?? (await defaultTarget(repo, desk.baseBranch)),
      desk.baseBranch,
    );
  }

  async diff(deskId: string, target: string): Promise<IntegrationDiff> {
    return integrationDiff(this.resolve(deskId).repo, target);
  }

  async commit(deskId: string, message: string): Promise<void> {
    const { desk, repo } = this.resolve(deskId);
    this.ensureNotBusy(desk);
    await commitPending(repo, message);
    this.store.addDeskEvent(desk.id, 'integration', null, { action: 'commit' });
  }

  async merge(deskId: string, target: string): Promise<MergeOutcome> {
    const { desk, repo } = this.resolve(deskId);
    const outcome = await mergeIntoTarget(
      repo,
      target,
      `Merge the work of desk ${desk.name} (${repo.branch})`,
    );
    if (outcome.status === 'merged') {
      this.store.addDeskEvent(desk.id, 'integration', null, {
        action: 'merge',
        target,
        commits: outcome.commits,
      });
    }
    return outcome;
  }

  async updateFromTarget(deskId: string, target: string): Promise<MergeOutcome> {
    const { desk, repo } = this.resolve(deskId);
    this.ensureNotBusy(desk);
    return updateDeskFromTarget(repo, target);
  }

  async pullRequestInfo(deskId: string): Promise<PullRequestInfo> {
    return pullRequestInfo(this.resolve(deskId).repo);
  }

  async createPullRequest(
    deskId: string,
    target: string,
    title: string,
    body: string,
  ): Promise<{ url: string }> {
    const { desk, repo } = this.resolve(deskId);
    const url = await createPullRequest(repo, target, title, body);
    this.store.addDeskEvent(desk.id, 'integration', null, { action: 'pull_request', target, url });
    return { url };
  }

  /** Types a prompt into the desk's session; only when it is idle, so nothing half-typed gets mixed in. */
  sendPrompt(deskId: string, text: string): void {
    const desk = this.store.getDesk(deskId);
    if (!desk) throw new OfficeError('desk_not_found', 'Desk not found.', 404);
    if (desk.state !== 'idle')
      throw new OfficeError('desk_not_idle', 'The desk is not waiting for a prompt.', 409);
    this.sessions.sendPrompt(desk.id, text);
  }
}
