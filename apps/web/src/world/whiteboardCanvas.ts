import { DESK_STATE_COLORS, type Desk, type RoomBoard } from '@workspace/shared';
import { deskTopic } from '../lib/desk';

export const WHITEBOARD_WIDTH = 1024;
export const WHITEBOARD_HEIGHT = 680;
const HAND = '"Caveat", "Comic Sans MS", cursive';
const INK_BLUE = '#1f4e9c';
const INK_BLACK = '#23272e';
const INK_RED = '#c0392b';
const INK_GREEN = '#1e7a46';

export interface WhiteboardLabels {
  title: string;
  whoDoesWhat: string;
  notes: string;
  messages: string;
  nobody: string;
  noNotes: string;
  human: string;
  room: string;
}

/** Wraps text to a maximum width; returns at most `maxLines` lines (the last one ellipsized). */
function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1]!;
    while (last.length > 1 && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** Draws a room board as if written with markers on a whiteboard. */
export function drawWhiteboard(
  canvas: HTMLCanvasElement,
  board: RoomBoard | undefined,
  desks: Desk[],
  labels: WhiteboardLabels,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.fillStyle = '#fbfbf8';
  context.fillRect(0, 0, width, height);
  // Faint marker ghosts, like a board erased many times.
  context.fillStyle = 'rgba(120, 130, 150, 0.05)';
  for (let i = 0; i < 6; i++) context.fillRect(60 + i * 150, 80 + (i % 3) * 170, 220, 60);

  const margin = 36;
  const columnGap = 40;
  const columnWidth = (width - margin * 2 - columnGap) / 2;
  context.textBaseline = 'top';

  context.fillStyle = INK_BLUE;
  context.font = `700 50px ${HAND}`;
  context.fillText(labels.title, margin, 20);
  context.strokeStyle = INK_BLUE;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(margin, 78);
  context.lineTo(Math.min(width - margin, margin + context.measureText(labels.title).width + 20), 80);
  context.stroke();

  // Left column: who does what.
  let y = 100;
  context.fillStyle = INK_BLACK;
  context.font = `700 34px ${HAND}`;
  context.fillText(labels.whoDoesWhat, margin, y);
  y += 46;
  if (desks.length === 0) {
    context.font = `500 28px ${HAND}`;
    context.fillStyle = '#7f8691';
    context.fillText(labels.nobody, margin, y);
  }
  for (const desk of desks) {
    if (y > height - 60) break;
    context.fillStyle = DESK_STATE_COLORS[desk.state];
    context.beginPath();
    context.arc(margin + 9, y + 16, 8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = INK_BLACK;
    context.font = `700 30px ${HAND}`;
    context.fillText(desk.name, margin + 26, y);
    const topic = deskTopic(desk);
    if (topic) {
      context.font = `500 27px ${HAND}`;
      context.fillStyle = INK_BLUE;
      for (const line of wrap(context, topic, columnWidth - 26, 2)) {
        y += 30;
        context.fillText(line, margin + 26, y);
      }
    }
    y += 44;
  }

  // Right column: pinned notes, then recent messages.
  const right = margin + columnWidth + columnGap;
  y = 100;
  context.fillStyle = INK_RED;
  context.font = `700 34px ${HAND}`;
  context.fillText(labels.notes, right, y);
  y += 46;
  const notes = board?.notes ?? [];
  context.font = `500 27px ${HAND}`;
  if (notes.length === 0) {
    context.fillStyle = '#7f8691';
    context.fillText(labels.noNotes, right, y);
    y += 36;
  }
  for (const note of notes.slice(-5)) {
    context.fillStyle = INK_RED;
    const lines = wrap(context, note.body, columnWidth - 24, 2);
    context.fillText('•', right, y);
    for (const line of lines) {
      context.fillText(line, right + 20, y);
      y += 30;
    }
    y += 8;
  }

  y = Math.max(y + 16, 330);
  context.fillStyle = INK_GREEN;
  context.font = `700 34px ${HAND}`;
  context.fillText(labels.messages, right, y);
  y += 44;
  const deskNames = new Map(desks.map((desk) => [desk.id, desk.name]));
  const messages = (board?.messages ?? []).slice(-4);
  context.font = `500 25px ${HAND}`;
  for (const message of messages) {
    if (y > height - 50) break;
    const from = message.fromDeskId ? (deskNames.get(message.fromDeskId) ?? '?') : labels.human;
    const to = message.toDeskId ? (deskNames.get(message.toDeskId) ?? '?') : labels.room;
    context.fillStyle = INK_GREEN;
    context.fillText(`${from} → ${to}`, right, y);
    y += 28;
    context.fillStyle = INK_BLACK;
    for (const line of wrap(context, message.body, columnWidth - 10, 2)) {
      context.fillText(line, right + 10, y);
      y += 27;
    }
    y += 10;
  }
}
