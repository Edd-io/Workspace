import type { RoomMessage } from '@workspace/shared';
import type { HookResponse } from '../sessions/sessionManager.ts';
import type { HookPayload } from '../sessions/stateMachine.ts';
import type { DeskRecord, OfficeStore } from '../store/officeStore.ts';
import type { BoardStore } from './boardStore.ts';

const MAX_TASK_LENGTH = 120;

function oneLine(text: string, max = MAX_TASK_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** What a desk is working on, as shown to colleagues and on the whiteboard. */
export function deskTopic(desk: DeskRecord): string | null {
  return desk.currentTask ?? desk.sessionTitle ?? (desk.lastPrompt ? oneLine(desk.lastPrompt) : null);
}

/**
 * Builds the room context injected into Claude sessions (hook `additionalContext`) and answers the
 * office MCP queries, so every desk knows who else works in its room and on what.
 */
export class RoomAwareness {
  private readonly store: OfficeStore;
  private readonly boards: BoardStore;
  /** Last room summary injected per desk: unchanged summaries are not repeated on every prompt. */
  private readonly lastSummary = new Map<string, string>();

  constructor(store: OfficeStore, boards: BoardStore) {
    this.store = store;
    this.boards = boards;
  }

  colleagues(desk: DeskRecord): DeskRecord[] {
    return this.store.listDesksInRoom(desk.roomId).filter((other) => other.id !== desk.id);
  }

  deskName(deskId: string | null): string {
    if (!deskId) return 'the human supervisor';
    return this.store.getDesk(deskId)?.name ?? 'a former colleague';
  }

  describeColleague(other: DeskRecord): string {
    const topic = deskTopic(other);
    const parts = [`${other.name} (${other.state})`];
    if (topic) parts.push(`working on: ${oneLine(topic)}`);
    if (other.branch) parts.push(`branch ${other.branch}`);
    return `- ${parts.join(' — ')}`;
  }

  formatMessages(messages: RoomMessage[]): string {
    return messages
      .map((message) => {
        const scope = message.toDeskId ? 'to you' : 'to the room';
        return `- From ${this.deskName(message.fromDeskId)} (${scope}): ${message.body}`;
      })
      .join('\n');
  }

  /** Room summary: colleagues and pinned notes. */
  summary(desk: DeskRecord): string {
    const room = this.store.getRoom(desk.roomId);
    const colleagues = this.colleagues(desk);
    const { notes } = this.boards.board(desk.roomId);
    const lines = [`You are desk "${desk.name}" in room "${room?.name ?? desk.roomId}".`];
    lines.push(
      colleagues.length > 0
        ? `Colleagues in this room:\n${colleagues.map((other) => this.describeColleague(other)).join('\n')}`
        : 'No other desk works in this room right now.',
    );
    if (notes.length > 0) {
      lines.push(
        `Pinned notes on the room board:\n${notes
          .map((note) => `- #${note.id} (${this.deskName(note.deskId)}): ${note.body}`)
          .join('\n')}`,
      );
    }
    return lines.join('\n');
  }

  /** Returns unread messages for a desk and marks them as read. */
  takeUnread(desk: DeskRecord): RoomMessage[] {
    const unread = this.boards.unreadMessages(desk.id);
    const last = unread.at(-1);
    if (last) this.boards.markRead(desk.id, last.id);
    return unread;
  }

  /** Hook responder: injects the room context and new messages into the Claude session. */
  respond(desk: DeskRecord, payload: HookPayload): HookResponse {
    const event = payload.hook_event_name;
    if (payload.agent_id) return {};
    const parts: string[] = [];

    if (event === 'SessionStart' || event === 'UserPromptSubmit') {
      const summary = this.summary(desk);
      if (event === 'SessionStart' || this.lastSummary.get(desk.id) !== summary) {
        parts.push(summary);
        this.lastSummary.set(desk.id, summary);
      }
    }
    if (event === 'SessionStart' || event === 'UserPromptSubmit' || event === 'PostToolUse') {
      const unread = this.takeUnread(desk);
      if (unread.length > 0) parts.push(`New messages from your colleagues:\n${this.formatMessages(unread)}`);
    }

    if (parts.length === 0) return {};
    return {
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: `<workspace-office>\n${parts.join('\n\n')}\n</workspace-office>`,
      },
    };
  }

  forget(deskId: string): void {
    this.lastSummary.delete(deskId);
  }
}
