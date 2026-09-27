import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeskState, TerminalMode } from '@workspace/shared';
import type { Config } from '../config.ts';
import { buildSystemPrompt } from '../office/systemPrompt.ts';
import type { DeskRecord, OfficeStore } from '../store/officeStore.ts';
import { DeskRuntime, type TerminalSubscriber } from './deskRuntime.ts';
import { writeLaunchFiles } from './launchConfig.ts';
import { reduceHook, type HookPayload } from './stateMachine.ts';
import { latestAiTitle } from './transcript.ts';
import type { TmuxHost } from './tmuxHost.ts';

const PANE_POLL_MS = 2000;
const PREVIEW_TICK_MS = 500;
const REATTACH_DELAY_MS = 1000;
const MAX_TEXT = 4000;
const TITLE_RETRY_MS = 8000;

function truncate(text: string | undefined, max = MAX_TEXT): string | undefined {
  if (text === undefined) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Hook output returned to Claude Code (JSON body of the HTTP hook response). */
export type HookResponse = Record<string, unknown>;

/** Extension point used by the office features to inject context into hook responses. */
export type HookResponder = (desk: DeskRecord, payload: HookPayload) => HookResponse;

/**
 * Owns the lifecycle of every desk session: launching, attaching, stopping, and turning hook
 * payloads into desk state.
 */
export class SessionManager {
  private readonly store: OfficeStore;
  private readonly host: TmuxHost;
  private readonly config: Config;
  private readonly runtimes = new Map<string, DeskRuntime>();
  private readonly timers: NodeJS.Timeout[] = [];
  private hookResponder: HookResponder = () => ({});

  constructor(store: OfficeStore, host: TmuxHost, config: Config) {
    this.store = store;
    this.host = host;
    this.config = config;
  }

  setHookResponder(responder: HookResponder): void {
    this.hookResponder = responder;
  }

  /** Re-attaches to sessions that survived a server restart and relaunches the others. */
  async init(): Promise<void> {
    for (const desk of this.store.listDesks()) {
      if (desk.desiredRunning) {
        await this.ensureRunning(desk.id).catch((error: unknown) => {
          console.error(`[sessions] cannot start desk ${desk.id}:`, error);
          this.setState(desk.id, 'error', { cause: 'launch_failed' });
        });
      } else if (desk.state !== 'offline') {
        this.setState(desk.id, 'offline', { cause: 'not_running' });
      }
    }
    this.timers.push(setInterval(() => void this.pollPanes(), PANE_POLL_MS));
    this.timers.push(setInterval(() => this.tickPreviews(), PREVIEW_TICK_MS));
  }

  shutdown(): void {
    for (const timer of this.timers) clearInterval(timer);
    // Detach only: the tmux sessions keep running while the server is down.
    for (const runtime of this.runtimes.values()) runtime.dispose();
    this.runtimes.clear();
  }

  private runtimeFor(deskId: string): DeskRuntime {
    let runtime = this.runtimes.get(deskId);
    if (!runtime) {
      runtime = new DeskRuntime(
        deskId,
        this.host,
        this.config.defaultCols,
        this.config.defaultRows,
        (detached) => this.onDetached(detached),
      );
      this.runtimes.set(deskId, runtime);
    }
    return runtime;
  }

  private launchCommand(desk: DeskRecord): string {
    const room = this.store.getRoom(desk.roomId);
    if (!room) throw new Error(`Room ${desk.roomId} not found`);
    return writeLaunchFiles({
      desk,
      room,
      claudeBin: this.config.claudeBin,
      hookBaseUrl: this.config.hookBaseUrl,
      dataDir: this.config.dataDir,
      officeMcp: {
        nodePath: this.config.nodeBin,
        scriptPath: join(this.config.repoRoot, 'packages/office-mcp/src/index.ts'),
      },
      systemPrompt: buildSystemPrompt(room, desk),
      envPass: this.config.deskEnvPass,
    });
  }

  /** Makes sure the desk's tmux session exists with a live Claude process, and attaches to it. */
  async ensureRunning(deskId: string): Promise<void> {
    const desk = this.store.getDesk(deskId);
    if (!desk) throw new Error(`Desk ${deskId} not found`);
    if (!desk.desiredRunning) this.store.updateDesk(deskId, { desiredRunning: true });

    const panes = await this.host.listPanes();
    const pane = panes.get(deskId);
    if (!pane) {
      await this.host.create(deskId, {
        cwd: desk.workdir,
        command: this.launchCommand(desk),
        cols: this.config.defaultCols,
        rows: this.config.defaultRows,
      });
      this.setState(deskId, 'starting', { cause: 'launch' });
    } else if (pane.dead) {
      await this.host.respawn(deskId, { cwd: desk.workdir, command: this.launchCommand(desk) });
      this.setState(deskId, 'starting', { cause: 'relaunch' });
    }
    this.runtimeFor(deskId).attach();
  }

  async stop(deskId: string): Promise<void> {
    this.store.updateDesk(deskId, { desiredRunning: false });
    const runtime = this.runtimes.get(deskId);
    runtime?.notifyClosed('offline');
    runtime?.detach();
    await this.host.kill(deskId);
    this.setState(deskId, 'offline', { cause: 'stopped' });
  }

  async restart(deskId: string): Promise<void> {
    const runtime = this.runtimes.get(deskId);
    runtime?.detach();
    await this.host.kill(deskId);
    this.store.updateDesk(deskId, { desiredRunning: true, inTurn: false, currentTool: null, blockers: [] });
    await this.ensureRunning(deskId);
  }

  /** Stops the session and forgets the runtime; used when a desk is deleted. */
  async remove(deskId: string): Promise<void> {
    const runtime = this.runtimes.get(deskId);
    runtime?.notifyClosed('removed');
    runtime?.dispose();
    this.runtimes.delete(deskId);
    await this.host.kill(deskId);
  }

  private onDetached(runtime: DeskRuntime): void {
    // The tmux client exited: the session was killed, or tmux itself went away.
    setTimeout(() => {
      void (async () => {
        if (this.runtimes.get(runtime.deskId) !== runtime) return;
        const desk = this.store.getDesk(runtime.deskId);
        if (!desk?.desiredRunning) return;
        if (await this.host.has(runtime.deskId)) {
          runtime.attach();
        } else {
          runtime.notifyClosed('offline');
          this.setState(runtime.deskId, 'offline', { cause: 'session_lost' });
        }
      })();
    }, REATTACH_DELAY_MS);
  }

  // ---- terminal access ------------------------------------------------------------------------

  async subscribe(deskId: string, subscriber: TerminalSubscriber, mode: TerminalMode): Promise<boolean> {
    const runtime = this.runtimes.get(deskId);
    if (!runtime) return false;
    await runtime.subscribe(subscriber, mode);
    return true;
  }

  unsubscribe(deskId: string, subscriber: TerminalSubscriber, mode?: TerminalMode): void {
    this.runtimes.get(deskId)?.unsubscribe(subscriber, mode);
  }

  unsubscribeAll(subscriber: TerminalSubscriber): void {
    for (const runtime of this.runtimes.values()) runtime.unsubscribe(subscriber);
  }

  input(deskId: string, data: string): void {
    this.runtimes.get(deskId)?.input(data);
  }

  /** Types a prompt into a desk's Claude Code and submits it. */
  sendPrompt(deskId: string, text: string): void {
    this.input(deskId, text.replace(/\s*\n\s*/g, ' '));
    // A separate Enter: sent together with the text it would be taken as part of a paste.
    setTimeout(() => this.input(deskId, '\r'), 150);
  }

  resize(deskId: string, cols: number, rows: number): void {
    this.runtimes.get(deskId)?.resize(cols, rows);
  }

  private tickPreviews(): void {
    for (const runtime of this.runtimes.values()) runtime.tickPreview();
  }

  // ---- state ----------------------------------------------------------------------------------

  private setState(deskId: string, state: DeskState, detail: Record<string, unknown>): void {
    const desk = this.store.getDesk(deskId);
    if (!desk || desk.state === state) return;
    const now = Date.now();
    const clearsAttention = state !== 'question' && state !== 'error' && state !== 'limited';
    this.store.updateDesk(deskId, {
      state,
      stateSince: now,
      ...(clearsAttention ? { attention: null } : {}),
    });
    this.store.addDeskEvent(deskId, 'state', state, { from: desk.state, ...detail }, now);
  }

  /** Detects dead Claude processes and desks stuck on a startup dialog. */
  private async pollPanes(): Promise<void> {
    const panes = await this.host.listPanes();
    for (const desk of this.store.listDesks()) {
      if (!desk.desiredRunning) continue;
      const pane = panes.get(desk.id);
      if (!pane) continue; // Handled by onDetached.
      if (pane.dead) {
        if (desk.state !== 'offline' && desk.state !== 'error') {
          const failed = pane.exitStatus !== null && pane.exitStatus !== 0;
          this.store.updateDesk(desk.id, {
            inTurn: false,
            currentTool: null,
            blockers: [],
            attention: failed ? { kind: 'error', text: `exit ${pane.exitStatus}` } : null,
          });
          this.setState(desk.id, failed ? 'error' : 'offline', {
            cause: 'process_exit',
            exitStatus: pane.exitStatus,
          });
        }
        continue;
      }
      if (desk.state === 'starting') {
        // First launch in a new folder shows a trust dialog before any hook fires.
        const screen = this.runtimes.get(desk.id)?.mirror.screenText() ?? '';
        if (/trust (this|the files in this) folder/i.test(screen)) {
          this.store.updateDesk(desk.id, { attention: { kind: 'trust', text: desk.workdir } });
          this.setState(desk.id, 'question', { cause: 'trust_dialog' });
        }
      }
    }
  }

  /** Picks up the conversation title Claude Code generates in the background. */
  private async refreshTitle(deskId: string): Promise<void> {
    const desk = this.store.getDesk(deskId);
    if (!desk?.transcriptPath) return;
    const title = await latestAiTitle(desk.transcriptPath);
    if (title && title !== desk.sessionTitle) this.store.updateDesk(deskId, { sessionTitle: title });
  }

  handleHook(deskId: string, payload: HookPayload): HookResponse {
    const desk = this.store.getDesk(deskId);
    if (!desk) return {};
    if (this.config.recordHooks) {
      appendFileSync(
        join(this.config.dataDir, 'hook-log.jsonl'),
        `${JSON.stringify({ deskId, ts: Date.now(), payload })}\n`,
      );
    }

    const effect = reduceHook({ state: desk.state, inTurn: desk.inTurn, blockers: desk.blockers }, payload);
    if (payload.hook_event_name === 'SessionStart' && payload.source === 'clear') {
      // A cleared conversation starts from scratch: forget the declared task and topic.
      this.store.updateDesk(deskId, { currentTask: null, sessionTitle: null });
    }
    const { state, ...rest } = effect;
    this.store.updateDesk(deskId, {
      ...rest,
      lastPrompt: truncate(effect.lastPrompt),
      lastAssistantMessage: truncate(effect.lastAssistantMessage),
    });
    this.store.addDeskEvent(deskId, 'hook', null, {
      event: payload.hook_event_name,
      tool: payload.tool_name,
      notification: payload.notification_type,
      error: payload.error_type,
      subagent: payload.agent_id ? true : undefined,
      prompt: truncate(payload.prompt, 500),
    });
    if (state) this.setState(deskId, state, { cause: payload.hook_event_name });
    if (payload.hook_event_name === 'Stop' || payload.hook_event_name === 'SessionStart') {
      // The title is generated asynchronously: look now and once more a bit later.
      void this.refreshTitle(deskId);
      setTimeout(() => void this.refreshTitle(deskId), TITLE_RETRY_MS);
    }

    const updated = this.store.getDesk(deskId);
    return updated ? this.hookResponder(updated, payload) : {};
  }
}
