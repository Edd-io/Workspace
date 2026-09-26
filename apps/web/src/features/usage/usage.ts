import {
  USAGE_WINDOWS,
  type SubscriptionUsage,
  type UsageWindow,
  type UsageWindowName,
} from '@workspace/shared';

/** Level of a usage window, for its color: calm, getting high, nearly exhausted. */
export type UsageLevel = 'ok' | 'high' | 'critical';

export function usageLevel(percent: number): UsageLevel {
  if (percent >= 85) return 'critical';
  if (percent >= 60) return 'high';
  return 'ok';
}

export const USAGE_COLORS: Record<UsageLevel, string> = {
  ok: '#3ddc84',
  high: '#ff9f1a',
  critical: '#ff4d4f',
};

/** Reset time as the viewer reads it: "18:40" today, "lun. 09:00" later. */
export function formatReset(window: UsageWindow, language: string, now = Date.now()): string {
  const date = new Date(window.resetsAt);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(language, {
    ...(sameDay ? {} : { weekday: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const WINDOW_LABEL_KEYS: Record<UsageWindowName, string> = {
  fiveHour: 'usage.fiveHour',
  sevenDay: 'usage.sevenDay',
};

export interface UsageBadgeLabels {
  title: string;
  fiveHour: string;
  sevenDay: string;
}

/** Usage badge drawn in the bottom-right corner of a canvas (the master office map screen). */
export function drawUsageBadge(
  context: CanvasRenderingContext2D,
  usage: SubscriptionUsage | null,
  labels: UsageBadgeLabels,
  width: number,
  height: number,
): void {
  const windows = USAGE_WINDOWS.flatMap((name) => {
    const window = usage?.[name];
    return window ? [{ label: name === 'fiveHour' ? labels.fiveHour : labels.sevenDay, window }] : [];
  });
  if (windows.length === 0) return;
  const boxWidth = 230;
  const rowHeight = 24;
  const boxHeight = 34 + windows.length * rowHeight;
  const x = width - boxWidth - 14;
  const y = height - boxHeight - 14;
  context.save();
  context.fillStyle = 'rgba(12, 15, 20, 0.82)';
  context.beginPath();
  context.roundRect(x, y, boxWidth, boxHeight, 10);
  context.fill();
  context.fillStyle = '#8b95a3';
  context.font = '600 15px Inter, sans-serif';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.fillText(labels.title, x + 12, y + 17);
  windows.forEach(({ label, window }, index) => {
    const rowY = y + 38 + index * rowHeight;
    const percent = Math.round(window.usedPercentage);
    context.fillStyle = '#c9d1d9';
    context.font = '500 15px Inter, sans-serif';
    context.fillText(label, x + 12, rowY);
    const barX = x + 56;
    const barWidth = 110;
    context.fillStyle = 'rgba(255, 255, 255, 0.12)';
    context.fillRect(barX, rowY - 4, barWidth, 8);
    context.fillStyle = USAGE_COLORS[usageLevel(percent)];
    context.fillRect(barX, rowY - 4, (barWidth * Math.min(100, percent)) / 100, 8);
    context.fillStyle = '#e6edf3';
    context.textAlign = 'right';
    context.fillText(`${percent}%`, x + boxWidth - 12, rowY);
    context.textAlign = 'left';
  });
  context.restore();
}
