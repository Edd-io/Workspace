import { EventEmitter } from 'node:events';
import type { RoomBoard, RoomMessage, RoomNote } from '@workspace/shared';
import type { Database } from '../db/database.ts';

/** Number of recent messages kept on a room board (older ones stay in the database). */
const BOARD_MESSAGES = 30;

type Row = Record<string, unknown>;

function toMessage(row: Row): RoomMessage {
  return {
    id: row.id as number,
    roomId: row.room_id as string,
    fromDeskId: (row.from_desk_id as string | null) ?? null,
    toDeskId: (row.to_desk_id as string | null) ?? null,
    body: row.body as string,
    createdAt: row.created_at as number,
  };
}

function toNote(row: Row): RoomNote {
  return {
    id: row.id as number,
    roomId: row.room_id as string,
    deskId: (row.desk_id as string | null) ?? null,
    body: row.body as string,
    createdAt: row.created_at as number,
  };
}

/** Messages and pinned notes shared by the desks of a room. */
export class BoardStore extends EventEmitter<{ boardChanged: [string]; messagePosted: [RoomMessage] }> {
  private readonly db: Database;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  board(roomId: string): RoomBoard {
    const notes = (
      this.db.prepare('SELECT * FROM room_notes WHERE room_id = ? ORDER BY id').all(roomId) as Row[]
    ).map(toNote);
    const messages = (
      this.db
        .prepare('SELECT * FROM room_messages WHERE room_id = ? ORDER BY id DESC LIMIT ?')
        .all(roomId, BOARD_MESSAGES) as Row[]
    )
      .map(toMessage)
      .reverse();
    return { roomId, notes, messages };
  }

  postMessage(roomId: string, fromDeskId: string | null, toDeskId: string | null, body: string): RoomMessage {
    const createdAt = Date.now();
    const result = this.db
      .prepare(
        'INSERT INTO room_messages (room_id, from_desk_id, to_desk_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(roomId, fromDeskId, toDeskId, body, createdAt);
    const message = { id: Number(result.lastInsertRowid), roomId, fromDeskId, toDeskId, body, createdAt };
    this.emit('boardChanged', roomId);
    this.emit('messagePosted', message);
    return message;
  }

  /** Messages addressed to a desk (directly or to the whole room) that it has not read yet. */
  unreadMessages(deskId: string): RoomMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM room_messages m JOIN desks d ON d.id = ?
         WHERE m.room_id = d.room_id AND m.id > d.last_read_message_id
           AND (m.to_desk_id IS NULL OR m.to_desk_id = d.id)
           AND (m.from_desk_id IS NULL OR m.from_desk_id <> d.id)
         ORDER BY m.id`,
      )
      .all(deskId) as Row[];
    return rows.map(toMessage);
  }

  markRead(deskId: string, messageId: number): void {
    this.db
      .prepare('UPDATE desks SET last_read_message_id = MAX(last_read_message_id, ?) WHERE id = ?')
      .run(messageId, deskId);
  }

  postNote(roomId: string, deskId: string | null, body: string): RoomNote {
    const createdAt = Date.now();
    const result = this.db
      .prepare('INSERT INTO room_notes (room_id, desk_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(roomId, deskId, body, createdAt);
    this.emit('boardChanged', roomId);
    return { id: Number(result.lastInsertRowid), roomId, deskId, body, createdAt };
  }

  removeNote(roomId: string, noteId: number): boolean {
    const result = this.db.prepare('DELETE FROM room_notes WHERE room_id = ? AND id = ?').run(roomId, noteId);
    if (result.changes > 0) this.emit('boardChanged', roomId);
    return result.changes > 0;
  }
}
