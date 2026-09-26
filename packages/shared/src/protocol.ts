import { z } from 'zod';
import type { Desk, OfficeSummary, Room, RoomBoard } from './models.ts';
import type { FramePicture } from './pictures.ts';
import type { DeskStats, SubscriptionUsage, UsageAlert } from './usage.ts';

/**
 * WebSocket protocol between the web client and the server.
 * Every message is a JSON object with a `t` discriminator.
 */

export const TERMINAL_MODES = ['interactive', 'preview'] as const;
export type TerminalMode = (typeof TERMINAL_MODES)[number];

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('term.open'), deskId: z.string(), mode: z.enum(TERMINAL_MODES) }),
  z.object({ t: z.literal('term.close'), deskId: z.string(), mode: z.enum(TERMINAL_MODES) }),
  z.object({ t: z.literal('term.input'), deskId: z.string(), data: z.string().max(65_536) }),
  z.object({
    t: z.literal('term.resize'),
    deskId: z.string(),
    cols: z.number().int().min(20).max(500),
    rows: z.number().int().min(5).max(200),
  }),
  z.object({ t: z.literal('ping') }),
  /** Whether this tab is visible: phone notifications are only sent when nobody is watching. */
  z.object({ t: z.literal('presence'), visible: z.boolean() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/**
 * A preview frame: one entry per terminal row, each row being a list of runs
 * `[text, fg, bg, flags]` where colors are CSS colors (or null for default) and flags is a bitmask.
 */
export type PreviewRun = [text: string, fg: string | null, bg: string | null, flags: number];
export type PreviewFrame = PreviewRun[][];

export const PREVIEW_FLAG_BOLD = 1;
export const PREVIEW_FLAG_DIM = 2;
export const PREVIEW_FLAG_ITALIC = 4;
export const PREVIEW_FLAG_UNDERLINE = 8;
export const PREVIEW_FLAG_INVERSE = 16;

export type ServerMessage =
  | {
      t: 'office.snapshot';
      rooms: Room[];
      desks: Desk[];
      boards: RoomBoard[];
      usage: SubscriptionUsage;
      deskStats: Record<string, DeskStats>;
      pictures: FramePicture[];
    }
  | { t: 'pictures.update'; pictures: FramePicture[] }
  | { t: 'usage.update'; usage: SubscriptionUsage }
  | { t: 'usage.alert'; alert: UsageAlert }
  | { t: 'desk.stats'; deskId: string; stats: DeskStats }
  | { t: 'board.update'; board: RoomBoard }
  | { t: 'summary.update'; summary: OfficeSummary }
  | { t: 'room.upsert'; room: Room }
  | { t: 'room.removed'; roomId: string }
  | { t: 'desk.upsert'; desk: Desk }
  | { t: 'desk.removed'; deskId: string }
  | { t: 'term.snapshot'; deskId: string; data: string; cols: number; rows: number }
  | { t: 'term.data'; deskId: string; data: string }
  | {
      t: 'term.frame';
      deskId: string;
      cols: number;
      rows: number;
      cursor: [number, number];
      lines: PreviewFrame;
    }
  | { t: 'term.closed'; deskId: string; reason: 'offline' | 'removed' }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' };
