import { EventEmitter } from 'node:events';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FRAME_ID_PATTERN,
  MAX_PICTURE_BYTES,
  PICTURE_TYPES,
  type FramePicture,
  type PictureType,
} from '@workspace/shared';
import type { Database } from '../db/database.ts';

/** Frames with a picture, at most (the office has a handful of frames). */
const MAX_PICTURES = 100;

const EXTENSIONS: Record<PictureType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type Row = Record<string, unknown>;

export class PictureError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Whether the bytes really are an image of the declared type (never trust the header alone). */
export function matchesType(type: PictureType, bytes: Buffer): boolean {
  if (type === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP';
}

/** Pictures the human put in the office's frames: files under `<dataDir>/pictures`, rows in the database. */
export class PictureStore extends EventEmitter<{ changed: [FramePicture[]] }> {
  private readonly db: Database;
  private readonly dir: string;

  constructor(db: Database, dataDir: string) {
    super();
    this.db = db;
    this.dir = join(dataDir, 'pictures');
  }

  list(): FramePicture[] {
    const rows = this.db
      .prepare('SELECT frame_id, updated_at FROM pictures ORDER BY frame_id')
      .all() as Row[];
    return rows.map((row) => ({
      frameId: row.frame_id as string,
      url: `/api/pictures/${row.frame_id as string}?v=${row.updated_at as number}`,
    }));
  }

  /** The file of a frame's picture, if it has one. */
  file(frameId: string): { path: string; type: PictureType } | null {
    if (!FRAME_ID_PATTERN.test(frameId)) return null;
    const row = this.db.prepare('SELECT mime FROM pictures WHERE frame_id = ?').get(frameId) as
      Row | undefined;
    if (!row) return null;
    const type = row.mime as PictureType;
    return { path: this.pathOf(frameId, type), type };
  }

  save(frameId: string, type: string, bytes: Buffer, now = Date.now()): FramePicture[] {
    if (!FRAME_ID_PATTERN.test(frameId)) throw new PictureError('invalid_frame', 'Unknown frame.');
    if (!(PICTURE_TYPES as readonly string[]).includes(type)) {
      throw new PictureError('unsupported_type', 'Only JPEG, PNG and WebP pictures are accepted.');
    }
    const pictureType = type as PictureType;
    if (bytes.length === 0 || bytes.length > MAX_PICTURE_BYTES || !matchesType(pictureType, bytes)) {
      throw new PictureError('invalid_picture', 'The file is not a valid picture.');
    }
    const previous = this.file(frameId);
    if (!previous) {
      const count = (this.db.prepare('SELECT COUNT(*) AS count FROM pictures').get() as Row).count as number;
      if (count >= MAX_PICTURES) throw new PictureError('too_many_pictures', 'Too many pictures.');
    }
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const path = this.pathOf(frameId, pictureType);
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, bytes, { mode: 0o600 });
    renameSync(temporary, path);
    if (previous && previous.path !== path) rmSync(previous.path, { force: true });
    this.db
      .prepare(
        `INSERT INTO pictures (frame_id, mime, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (frame_id) DO UPDATE SET mime = excluded.mime, updated_at = excluded.updated_at`,
      )
      .run(frameId, pictureType, now);
    return this.changed();
  }

  remove(frameId: string): FramePicture[] {
    const previous = this.file(frameId);
    if (!previous) return this.list();
    this.db.prepare('DELETE FROM pictures WHERE frame_id = ?').run(frameId);
    rmSync(previous.path, { force: true });
    return this.changed();
  }

  private pathOf(frameId: string, type: PictureType): string {
    return join(this.dir, `${frameId}.${EXTENSIONS[type]}`);
  }

  private changed(): FramePicture[] {
    const pictures = this.list();
    this.emit('changed', pictures);
    return pictures;
  }
}
