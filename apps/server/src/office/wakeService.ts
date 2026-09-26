import type { RoomMessage } from '@workspace/shared';
import type { BoardStore } from './boardStore.ts';
import type { OfficeStore } from '../store/officeStore.ts';

/**
 * Wakes idle desks up when colleagues (or the human) write to them: a short prompt is typed into the
 * session, and the UserPromptSubmit hook then adds the unread messages to its context. Otherwise an
 * idle desk only reads its messages the next time the human prompts it.
 *
 * Rooms can turn it off. Each desk is woken at most MAX_WAKES times per WINDOW_MS, so two desks can
 * never keep answering each other and burn the subscription.
 */

/** Lets the sender's turn end and hooks settle before looking at the recipient. */
const WAKE_DELAY_MS = 2500;
export const MAX_WAKES = 4;
export const WINDOW_MS = 10 * 60_000;

export const WAKE_PROMPT =
  '[Workspace] New messages from your colleagues were added to your context. Handle them if they ' +
  'concern you; reply with send_message only when it is useful.';

export interface Prompter {
  sendPrompt(deskId: string, text: string): void;
}

export class WakeService {
  private readonly store: OfficeStore;
  private readonly boards: BoardStore;
  private readonly prompter: Prompter;
  private readonly delayMs: number;
  private readonly wakes = new Map<string, number[]>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastState = new Map<string, string>();

  constructor(store: OfficeStore, boards: BoardStore, prompter: Prompter, delayMs = WAKE_DELAY_MS) {
    this.store = store;
    this.boards = boards;
    this.prompter = prompter;
    this.delayMs = delayMs;
  }

  start(): void {
    this.boards.on('messagePosted', (message) => this.onMessage(message));
    // A desk that becomes idle with messages it has not read yet.
    for (const desk of this.store.listDesks()) this.lastState.set(desk.id, desk.state);
    this.store.on('deskUpsert', (desk) => {
      const previous = this.lastState.get(desk.id);
      this.lastState.set(desk.id, desk.state);
      if (desk.state === 'idle' && previous !== undefined && previous !== 'idle') this.schedule(desk.id);
    });
  }

  stop(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private onMessage(message: RoomMessage): void {
    const recipients = message.toDeskId
      ? [message.toDeskId]
      : this.store
          .listDesksInRoom(message.roomId)
          .map((desk) => desk.id)
          .filter((id) => id !== message.fromDeskId);
    for (const deskId of recipients) this.schedule(deskId);
  }

  private schedule(deskId: string): void {
    if (this.pending.has(deskId)) return;
    this.pending.set(
      deskId,
      setTimeout(() => {
        this.pending.delete(deskId);
        this.wake(deskId);
      }, this.delayMs),
    );
  }

  /** Wakes the desk up if it is idle, in a room that allows it, with unread messages, within its quota. */
  wake(deskId: string, now = Date.now()): boolean {
    const desk = this.store.getDesk(deskId);
    if (!desk || desk.state !== 'idle') return false;
    if (!this.store.getRoom(desk.roomId)?.autoWake) return false;
    if (this.boards.unreadMessages(deskId).length === 0) return false;
    const recent = (this.wakes.get(deskId) ?? []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= MAX_WAKES) {
      this.wakes.set(deskId, recent);
      return false;
    }
    recent.push(now);
    this.wakes.set(deskId, recent);
    this.prompter.sendPrompt(deskId, WAKE_PROMPT);
    this.store.addDeskEvent(deskId, 'wake', null, {});
    return true;
  }
}
