import type { IPty } from 'node-pty';
import type { ServerMessage, TerminalMode } from '@workspace/shared';
import { TerminalMirror } from './terminalMirror.ts';
import type { TmuxHost } from './tmuxHost.ts';

/** A connected client watching or driving a desk terminal. */
export interface TerminalSubscriber {
  send(message: ServerMessage): void;
  /** False when the client's socket is congested; preview frames are skipped then. */
  canReceive(): boolean;
}

/** Output is coalesced for a few milliseconds to avoid one WebSocket message per tiny chunk. */
const OUTPUT_FLUSH_MS = 8;

/**
 * Live link between the server and one desk's tmux session: a PTY attached to tmux, a mirror of
 * the screen, and the clients subscribed to it.
 */
export class DeskRuntime {
  readonly deskId: string;
  readonly mirror: TerminalMirror;
  private readonly host: TmuxHost;
  private readonly onDetached: (runtime: DeskRuntime) => void;
  private pty: IPty | null = null;
  private readonly interactive = new Set<TerminalSubscriber>();
  private readonly previews = new Set<TerminalSubscriber>();
  private pendingOutput = '';
  private flushTimer: NodeJS.Timeout | null = null;
  private lastPreviewRevision = -1;

  constructor(
    deskId: string,
    host: TmuxHost,
    cols: number,
    rows: number,
    onDetached: (runtime: DeskRuntime) => void,
  ) {
    this.deskId = deskId;
    this.host = host;
    this.mirror = new TerminalMirror(cols, rows);
    this.onDetached = onDetached;
  }

  get attached(): boolean {
    return this.pty !== null;
  }

  attach(): void {
    if (this.pty) return;
    const pty = this.host.attach(this.deskId, this.mirror.cols, this.mirror.rows);
    this.pty = pty;
    pty.onData((data) => {
      // A detached tmux client still prints its last words ("[lost tty]"): not the session's screen.
      if (this.pty !== pty) return;
      this.mirror.write(data);
      if (this.interactive.size === 0) return;
      this.pendingOutput += data;
      this.flushTimer ??= setTimeout(() => this.flushOutput(), OUTPUT_FLUSH_MS);
    });
    pty.onExit(() => {
      if (this.pty !== pty) return;
      this.pty = null;
      this.flushOutput();
      this.onDetached(this);
    });
  }

  detach(): void {
    const pty = this.pty;
    this.pty = null;
    pty?.kill();
  }

  private flushOutput(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.pendingOutput === '') return;
    const message: ServerMessage = { t: 'term.data', deskId: this.deskId, data: this.pendingOutput };
    this.pendingOutput = '';
    for (const subscriber of this.interactive) subscriber.send(message);
  }

  input(data: string): void {
    this.pty?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.mirror.resize(cols, rows);
    this.pty?.resize(cols, rows);
  }

  async subscribe(subscriber: TerminalSubscriber, mode: TerminalMode): Promise<void> {
    if (mode === 'interactive') {
      this.flushOutput();
      await this.mirror.flush();
      this.interactive.add(subscriber);
      subscriber.send({
        t: 'term.snapshot',
        deskId: this.deskId,
        data: this.mirror.snapshot(),
        cols: this.mirror.cols,
        rows: this.mirror.rows,
      });
    } else {
      this.previews.add(subscriber);
      await this.mirror.flush();
      subscriber.send({ t: 'term.frame', deskId: this.deskId, ...this.mirror.frame() });
    }
  }

  unsubscribe(subscriber: TerminalSubscriber, mode?: TerminalMode): void {
    if (mode !== 'preview') this.interactive.delete(subscriber);
    if (mode !== 'interactive') this.previews.delete(subscriber);
  }

  /** Sends a new preview frame to preview subscribers if the screen changed. */
  tickPreview(): void {
    if (this.previews.size === 0 || this.mirror.revision === this.lastPreviewRevision) return;
    this.lastPreviewRevision = this.mirror.revision;
    const message: ServerMessage = { t: 'term.frame', deskId: this.deskId, ...this.mirror.frame() };
    for (const subscriber of this.previews) {
      if (subscriber.canReceive()) subscriber.send(message);
    }
  }

  notifyClosed(reason: 'offline' | 'removed'): void {
    for (const subscriber of new Set([...this.interactive, ...this.previews])) {
      subscriber.send({ t: 'term.closed', deskId: this.deskId, reason });
    }
  }

  dispose(): void {
    this.detach();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.interactive.clear();
    this.previews.clear();
    this.mirror.dispose();
  }
}
