import { DESK_STATE_COLORS, type Desk, type Room, type Timeline } from '@workspace/shared';

export interface TimelineRow {
  kind: 'room' | 'desk';
  label: string;
  deskId?: string;
  y: number;
  height: number;
}

export interface TimelineGeometry {
  rows: TimelineRow[];
  labelWidth: number;
  x0: number;
  x1: number;
  from: number;
  to: number;
}

export interface TimelineStyle {
  background: string;
  text: string;
  muted: string;
  grid: string;
  font: string;
  rowHeight: number;
  labelWidth: number;
  padding: number;
}

export const PANEL_STYLE: TimelineStyle = {
  background: '#161a20',
  text: '#e8ecf1',
  muted: '#8b95a3',
  grid: 'rgba(255,255,255,0.08)',
  font: 'Inter, sans-serif',
  rowHeight: 26,
  labelWidth: 170,
  padding: 12,
};

/** Rows of the timeline: one header per room, one bar per desk. */
export function timelineRows(
  rooms: Room[],
  desks: Record<string, Desk>,
  timeline: Timeline,
  style: TimelineStyle,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let y = style.padding + 22;
  const present = new Set(timeline.desks.map((entry) => entry.deskId));
  for (const room of rooms) {
    const roomDesks = Object.values(desks)
      .filter((desk) => desk.roomId === room.id && present.has(desk.id))
      .sort((a, b) => a.position - b.position);
    if (roomDesks.length === 0) continue;
    rows.push({ kind: 'room', label: room.name, y, height: style.rowHeight * 0.8 });
    y += style.rowHeight * 0.8;
    for (const desk of roomDesks) {
      rows.push({ kind: 'desk', label: desk.name, deskId: desk.id, y, height: style.rowHeight });
      y += style.rowHeight;
    }
  }
  return rows;
}

export function timelineHeight(rows: TimelineRow[], style: TimelineStyle): number {
  const last = rows.at(-1);
  return (last ? last.y + last.height : style.padding + 40) + style.padding;
}

/** Draws per-desk state bars over time, with prompt ticks and an hour grid. */
export function drawTimeline(
  context: CanvasRenderingContext2D,
  timeline: Timeline,
  rows: TimelineRow[],
  width: number,
  height: number,
  style: TimelineStyle,
  language: string,
): TimelineGeometry {
  const x0 = style.padding + style.labelWidth;
  const x1 = width - style.padding;
  const span = timeline.to - timeline.from || 1;
  const px = (ts: number) => x0 + ((ts - timeline.from) / span) * (x1 - x0);

  context.fillStyle = style.background;
  context.fillRect(0, 0, width, height);
  context.textBaseline = 'middle';

  // Hour grid and labels.
  const hourMs = 3600_000;
  const stepHours = span > 12 * hourMs ? 2 : span > 4 * hourMs ? 1 : 0.5;
  const step = stepHours * hourMs;
  const format = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' });
  context.font = `400 11px ${style.font}`;
  context.textAlign = 'center';
  for (let ts = Math.ceil(timeline.from / step) * step; ts <= timeline.to; ts += step) {
    const x = px(ts);
    context.strokeStyle = style.grid;
    context.beginPath();
    context.moveTo(x, style.padding + 16);
    context.lineTo(x, height - style.padding);
    context.stroke();
    context.fillStyle = style.muted;
    context.fillText(format.format(ts), x, style.padding + 6);
  }

  const rowsByDesk = new Map(rows.filter((row) => row.deskId).map((row) => [row.deskId!, row]));
  for (const row of rows) {
    context.textAlign = 'left';
    if (row.kind === 'room') {
      context.fillStyle = style.muted;
      context.font = `600 11px ${style.font}`;
      context.fillText(row.label.toUpperCase(), style.padding, row.y + row.height / 2);
      continue;
    }
    context.fillStyle = style.text;
    context.font = `500 13px ${style.font}`;
    context.fillText(row.label, style.padding + 8, row.y + row.height / 2, style.labelWidth - 16);
  }

  for (const desk of timeline.desks) {
    const row = rowsByDesk.get(desk.deskId);
    if (!row) continue;
    const top = row.y + 4;
    const barHeight = row.height - 8;
    context.fillStyle = 'rgba(255,255,255,0.04)';
    context.fillRect(x0, top, x1 - x0, barHeight);
    for (const segment of desk.segments) {
      if (segment.state === 'offline') continue;
      const start = px(segment.from);
      const end = Math.max(start + 1, px(segment.to));
      context.fillStyle = DESK_STATE_COLORS[segment.state];
      context.fillRect(start, top, end - start, barHeight);
    }
    context.fillStyle = 'rgba(255,255,255,0.9)';
    for (const prompt of desk.prompts) context.fillRect(px(prompt) - 0.75, top - 2, 1.5, 5);
  }

  // "Now" marker.
  context.strokeStyle = '#ffffff';
  context.globalAlpha = 0.5;
  context.beginPath();
  context.moveTo(px(timeline.to), style.padding + 16);
  context.lineTo(px(timeline.to), height - style.padding);
  context.stroke();
  context.globalAlpha = 1;

  return { rows, labelWidth: style.labelWidth, x0, x1, from: timeline.from, to: timeline.to };
}

/** Finds the desk row and time under a point (canvas CSS pixels). */
export function hitTimeline(
  geometry: TimelineGeometry,
  x: number,
  y: number,
): { deskId: string; ts: number } | null {
  const row = geometry.rows.find(
    (entry) => entry.kind === 'desk' && y >= entry.y && y < entry.y + entry.height,
  );
  if (!row?.deskId || x < geometry.x0 || x > geometry.x1) return null;
  const ts =
    geometry.from + ((x - geometry.x0) / (geometry.x1 - geometry.x0)) * (geometry.to - geometry.from);
  return { deskId: row.deskId, ts };
}
