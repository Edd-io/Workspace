import { EventEmitter } from 'node:events';
import type { Desk, DeskAttention, DeskMode, DeskState, PermissionMode, Room } from '@workspace/shared';
import type { Database } from '../db/database.ts';
import type { Blocker } from '../sessions/stateMachine.ts';

/** Desk row including server-only fields that are never sent to clients. */
export interface DeskRecord extends Desk {
  token: string;
  desiredRunning: boolean;
  initialPrompt: string | null;
  transcriptPath: string | null;
  inTurn: boolean;
  /** Tool uses waiting for the human (questions, permission prompts). */
  blockers: Blocker[];
}

export type DeskPatch = Partial<
  Pick<
    DeskRecord,
    | 'name'
    | 'state'
    | 'stateSince'
    | 'inTurn'
    | 'currentTask'
    | 'sessionTitle'
    | 'blockers'
    | 'currentTool'
    | 'lastPrompt'
    | 'lastAssistantMessage'
    | 'transcriptPath'
    | 'desiredRunning'
    | 'initialPrompt'
    | 'attention'
  >
>;

export interface DeskEvent {
  id: number;
  deskId: string;
  ts: number;
  kind: string;
  state: DeskState | null;
  data: unknown;
}

interface OfficeStoreEvents {
  roomUpsert: [Room];
  roomRemoved: [string];
  deskUpsert: [Desk];
  deskRemoved: [string];
  deskEvent: [DeskEvent];
}

type Row = Record<string, unknown>;

const DESK_COLUMNS: Record<keyof DeskPatch, string> = {
  name: 'name',
  state: 'state',
  stateSince: 'state_since',
  inTurn: 'in_turn',
  currentTask: 'current_task',
  sessionTitle: 'session_title',
  blockers: 'blockers',
  currentTool: 'current_tool',
  lastPrompt: 'last_prompt',
  lastAssistantMessage: 'last_assistant_message',
  transcriptPath: 'transcript_path',
  desiredRunning: 'desired_running',
  initialPrompt: 'initial_prompt',
  attention: 'attention',
};

function toRoom(row: Row): Room {
  return {
    id: row.id as string,
    name: row.name as string,
    projectPath: row.project_path as string,
    isGitRepo: row.is_git_repo === 1,
    accentColor: row.accent_color as string,
    position: row.position as number,
    createdAt: row.created_at as number,
  };
}

function toDeskRecord(row: Row): DeskRecord {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    name: row.name as string,
    slug: row.slug as string,
    mode: row.mode as DeskMode,
    workdir: row.workdir as string,
    branch: (row.branch as string | null) ?? null,
    sessionId: row.session_id as string,
    model: (row.model as string | null) ?? null,
    permissionMode: (row.permission_mode as PermissionMode | null) ?? null,
    appearanceSeed: row.appearance_seed as number,
    position: row.position as number,
    state: row.state as DeskState,
    stateSince: row.state_since as number,
    currentTask: (row.current_task as string | null) ?? null,
    sessionTitle: (row.session_title as string | null) ?? null,
    currentTool: (row.current_tool as string | null) ?? null,
    lastPrompt: (row.last_prompt as string | null) ?? null,
    lastAssistantMessage: (row.last_assistant_message as string | null) ?? null,
    attention: row.attention ? (JSON.parse(row.attention as string) as DeskAttention) : null,
    createdAt: row.created_at as number,
    token: row.token as string,
    desiredRunning: row.desired_running === 1,
    initialPrompt: (row.initial_prompt as string | null) ?? null,
    transcriptPath: (row.transcript_path as string | null) ?? null,
    inTurn: row.in_turn === 1,
    blockers: JSON.parse((row.blockers as string | undefined) ?? '[]') as Blocker[],
  };
}

/** Strips server-only fields before a desk leaves the server. */
export function toPublicDesk(record: DeskRecord): Desk {
  const {
    token: _token,
    desiredRunning: _desiredRunning,
    initialPrompt: _initialPrompt,
    transcriptPath: _transcriptPath,
    inTurn: _inTurn,
    blockers: _blockers,
    ...desk
  } = record;
  return desk;
}

function toSqlValue(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number;
}

export class OfficeStore extends EventEmitter<OfficeStoreEvents> {
  private readonly db: Database;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  // ---- settings -------------------------------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    return (row?.value as string | undefined) ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  // ---- rooms ----------------------------------------------------------------------------------

  listRooms(): Room[] {
    return (this.db.prepare('SELECT * FROM rooms ORDER BY position, created_at').all() as Row[]).map(toRoom);
  }

  getRoom(id: string): Room | null {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as Row | undefined;
    return row ? toRoom(row) : null;
  }

  insertRoom(room: Room): void {
    this.db
      .prepare(
        `INSERT INTO rooms (id, name, project_path, is_git_repo, accent_color, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        room.id,
        room.name,
        room.projectPath,
        room.isGitRepo ? 1 : 0,
        room.accentColor,
        room.position,
        room.createdAt,
      );
    this.emit('roomUpsert', room);
  }

  updateRoom(id: string, patch: { name?: string; accentColor?: string }): Room | null {
    if (patch.name !== undefined)
      this.db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.accentColor !== undefined) {
      this.db.prepare('UPDATE rooms SET accent_color = ? WHERE id = ?').run(patch.accentColor, id);
    }
    const room = this.getRoom(id);
    if (room) this.emit('roomUpsert', room);
    return room;
  }

  deleteRoom(id: string): void {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    this.emit('roomRemoved', id);
  }

  nextRoomPosition(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM rooms').get() as Row;
    return row.next as number;
  }

  // ---- desks ----------------------------------------------------------------------------------

  listDesks(): DeskRecord[] {
    return (this.db.prepare('SELECT * FROM desks ORDER BY room_id, position').all() as Row[]).map(
      toDeskRecord,
    );
  }

  listDesksInRoom(roomId: string): DeskRecord[] {
    return (
      this.db.prepare('SELECT * FROM desks WHERE room_id = ? ORDER BY position').all(roomId) as Row[]
    ).map(toDeskRecord);
  }

  getDesk(id: string): DeskRecord | null {
    const row = this.db.prepare('SELECT * FROM desks WHERE id = ?').get(id) as Row | undefined;
    return row ? toDeskRecord(row) : null;
  }

  insertDesk(desk: DeskRecord): void {
    this.db
      .prepare(
        `INSERT INTO desks (id, room_id, name, slug, mode, workdir, branch, session_id, model, permission_mode,
           appearance_seed, position, token, desired_running, initial_prompt, transcript_path, state, state_since,
           in_turn, current_task, current_tool, last_prompt, last_assistant_message, created_at, blockers, session_title,
           attention)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        desk.id,
        desk.roomId,
        desk.name,
        desk.slug,
        desk.mode,
        desk.workdir,
        desk.branch,
        desk.sessionId,
        desk.model,
        desk.permissionMode,
        desk.appearanceSeed,
        desk.position,
        desk.token,
        desk.desiredRunning ? 1 : 0,
        desk.initialPrompt,
        desk.transcriptPath,
        desk.state,
        desk.stateSince,
        desk.inTurn ? 1 : 0,
        desk.currentTask,
        desk.currentTool,
        desk.lastPrompt,
        desk.lastAssistantMessage,
        desk.createdAt,
        JSON.stringify(desk.blockers),
        desk.sessionTitle,
        desk.attention ? JSON.stringify(desk.attention) : null,
      );
    this.emit('deskUpsert', toPublicDesk(desk));
  }

  updateDesk(id: string, patch: DeskPatch): DeskRecord | null {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [
      keyof DeskPatch,
      unknown,
    ][];
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${DESK_COLUMNS[key]} = ?`).join(', ');
      this.db
        .prepare(`UPDATE desks SET ${assignments} WHERE id = ?`)
        .run(...entries.map(([, value]) => toSqlValue(value)), id);
    }
    const desk = this.getDesk(id);
    if (desk && entries.length > 0) this.emit('deskUpsert', toPublicDesk(desk));
    return desk;
  }

  deleteDesk(id: string): void {
    this.db.prepare('DELETE FROM desks WHERE id = ?').run(id);
    this.emit('deskRemoved', id);
  }

  nextDeskPosition(roomId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM desks WHERE room_id = ?')
      .get(roomId) as Row;
    return row.next as number;
  }

  // ---- events ---------------------------------------------------------------------------------

  addDeskEvent(deskId: string, kind: string, state: DeskState | null, data: unknown, ts = Date.now()): void {
    const result = this.db
      .prepare('INSERT INTO desk_events (desk_id, ts, kind, state, data) VALUES (?, ?, ?, ?, ?)')
      .run(deskId, ts, kind, state, data === undefined ? null : JSON.stringify(data));
    this.emit('deskEvent', { id: Number(result.lastInsertRowid), deskId, ts, kind, state, data });
  }

  /** State changes and prompts of every desk between `from` and `to`, oldest first. */
  timelineEvents(
    from: number,
    to: number,
  ): { deskId: string; ts: number; kind: string; state: DeskState | null; event: string | null }[] {
    const rows = this.db
      .prepare(
        `SELECT desk_id, ts, kind, state, json_extract(data, '$.event') AS event FROM desk_events
         WHERE ts >= ? AND ts <= ? AND (kind = 'state' OR (kind = 'hook' AND json_extract(data, '$.event') = 'UserPromptSubmit'))
         ORDER BY ts, id`,
      )
      .all(from, to) as Row[];
    return rows.map((row) => ({
      deskId: row.desk_id as string,
      ts: row.ts as number,
      kind: row.kind as string,
      state: (row.state as DeskState | null) ?? null,
      event: (row.event as string | null) ?? null,
    }));
  }

  /** The state a desk was in at `ts` (latest state change before it), if known. */
  stateAt(deskId: string, ts: number): DeskState | null {
    const row = this.db
      .prepare(
        `SELECT state FROM desk_events WHERE desk_id = ? AND kind = 'state' AND ts < ? ORDER BY ts DESC, id DESC LIMIT 1`,
      )
      .get(deskId, ts) as Row | undefined;
    return (row?.state as DeskState | undefined) ?? null;
  }

  listDeskEvents(options: { deskId?: string; since?: number; limit?: number }): DeskEvent[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.deskId) {
      clauses.push('desk_id = ?');
      params.push(options.deskId);
    }
    if (options.since !== undefined) {
      clauses.push('ts >= ?');
      params.push(options.since);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM desk_events ${where} ORDER BY ts DESC, id DESC LIMIT ?`)
      .all(...params, options.limit ?? 500) as Row[];
    return rows.map((row) => ({
      id: row.id as number,
      deskId: row.desk_id as string,
      ts: row.ts as number,
      kind: row.kind as string,
      state: (row.state as DeskState | null) ?? null,
      data: row.data ? JSON.parse(row.data as string) : null,
    }));
  }
}
