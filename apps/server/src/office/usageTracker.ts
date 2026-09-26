import { EventEmitter } from 'node:events';
import {
  USAGE_ALERT_THRESHOLDS,
  USAGE_WINDOWS,
  type DeskStats,
  type SubscriptionUsage,
  type UsageAlert,
  type UsageWindow,
  type UsageWindowName,
} from '@workspace/shared';
import { z } from 'zod';

/**
 * Subscription usage and per-desk figures, fed by the status line of every desk's Claude Code
 * (each desk relays its status line JSON to the server). Every desk shares the same subscription:
 * the latest report wins.
 */

const windowSchema = z
  .object({ used_percentage: z.number(), resets_at: z.number() })
  .nullable()
  .optional()
  .catch(null);

/** The parts of Claude Code's status line input the office uses; everything else is ignored. */
export const statusLineSchema = z.object({
  model: z.object({ display_name: z.string().optional() }).nullable().optional().catch(null),
  context_window: z
    .object({ used_percentage: z.number().nullable().optional() })
    .nullable()
    .optional()
    .catch(null),
  cost: z
    .object({
      total_lines_added: z.number().optional(),
      total_lines_removed: z.number().optional(),
    })
    .nullable()
    .optional()
    .catch(null),
  rate_limits: z
    .object({ five_hour: windowSchema, seven_day: windowSchema })
    .nullable()
    .optional()
    .catch(null),
});
export type StatusLineInput = z.infer<typeof statusLineSchema>;

interface PersistedUsage {
  usage: SubscriptionUsage;
  /** Alerts already sent, as `${window}:${resetsAt}:${threshold}`. */
  alerted: string[];
}

interface Storage {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

interface UsageEvents {
  usage: [SubscriptionUsage];
  alert: [UsageAlert];
  deskStats: [string, DeskStats];
}

const STORAGE_KEY = 'subscription_usage';
const EMPTY: SubscriptionUsage = { fiveHour: null, sevenDay: null, reportedAt: null };

function toWindow(
  raw: { used_percentage: number; resets_at: number } | null | undefined,
): UsageWindow | null {
  if (!raw) return null;
  return { usedPercentage: Math.max(0, raw.used_percentage), resetsAt: raw.resets_at * 1000 };
}

const round = (value: number | null) => (value === null ? null : Math.round(value));

export class UsageTracker extends EventEmitter<UsageEvents> {
  private readonly storage: Storage;
  private state: PersistedUsage;
  private readonly stats = new Map<string, DeskStats>();

  constructor(storage: Storage) {
    super();
    this.storage = storage;
    const saved = storage.getSetting(STORAGE_KEY);
    this.state = saved ? (JSON.parse(saved) as PersistedUsage) : { usage: EMPTY, alerted: [] };
  }

  /** Current usage; windows whose reset time has passed are reported as empty. */
  usage(now = Date.now()): SubscriptionUsage {
    const { usage } = this.state;
    const live = (window: UsageWindow | null) => (window && window.resetsAt > now ? window : null);
    return { fiveHour: live(usage.fiveHour), sevenDay: live(usage.sevenDay), reportedAt: usage.reportedAt };
  }

  deskStats(): Record<string, DeskStats> {
    return Object.fromEntries(this.stats);
  }

  forgetDesk(deskId: string): void {
    this.stats.delete(deskId);
  }

  /** Takes one status line report of a desk. */
  report(deskId: string, input: StatusLineInput, now = Date.now()): void {
    const stats: DeskStats = {
      model: input.model?.display_name ?? null,
      contextPercent: round(input.context_window?.used_percentage ?? null),
      linesAdded: input.cost?.total_lines_added ?? null,
      linesRemoved: input.cost?.total_lines_removed ?? null,
    };
    const previous = this.stats.get(deskId);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(stats)) {
      this.stats.set(deskId, stats);
      this.emit('deskStats', deskId, stats);
    }

    const limits = input.rate_limits;
    if (!limits || (!limits.five_hour && !limits.seven_day)) return;
    const next: SubscriptionUsage = {
      fiveHour: toWindow(limits.five_hour),
      sevenDay: toWindow(limits.seven_day),
      reportedAt: now,
    };
    const changed = USAGE_WINDOWS.some((name) => {
      const before = this.state.usage[name];
      const after = next[name];
      return before?.usedPercentage !== after?.usedPercentage || before?.resetsAt !== after?.resetsAt;
    });
    this.state.usage = next;
    const alerts = this.newAlerts(next, now);
    // Only persist and broadcast actual changes: status lines refresh every minute per desk.
    if (changed || alerts.length > 0) {
      this.storage.setSetting(STORAGE_KEY, JSON.stringify(this.state));
      this.emit('usage', this.usage(now));
    }
    for (const alert of alerts) this.emit('alert', alert);
  }

  private newAlerts(usage: SubscriptionUsage, now: number): UsageAlert[] {
    const alerts: UsageAlert[] = [];
    // Forget the alerts of windows that have reset.
    this.state.alerted = this.state.alerted.filter((key) => Number(key.split(':')[1]) > now);
    for (const name of USAGE_WINDOWS) {
      const window = usage[name];
      if (!window) continue;
      // Only the highest threshold crossed: no double alert when a report jumps past both.
      const threshold = [...USAGE_ALERT_THRESHOLDS].reverse().find((value) => window.usedPercentage >= value);
      if (threshold === undefined) continue;
      const key = (value: number) => `${name}:${window.resetsAt}:${value}`;
      if (this.state.alerted.includes(key(threshold))) continue;
      for (const value of USAGE_ALERT_THRESHOLDS) {
        if (value <= threshold) this.state.alerted.push(key(value));
      }
      alerts.push({ window: name as UsageWindowName, threshold, ...window });
    }
    return alerts;
  }
}

/** Text Claude Code shows as the desk's status line (the terminal shows the office context). */
export function statusLineText(
  roomName: string,
  deskName: string,
  stats: DeskStats,
  usage: SubscriptionUsage,
): string {
  const parts = [`Workspace · ${roomName} / ${deskName}`];
  if (stats.contextPercent !== null) parts.push(`context ${stats.contextPercent}%`);
  if (usage.fiveHour) parts.push(`5h ${Math.round(usage.fiveHour.usedPercentage)}%`);
  if (usage.sevenDay) parts.push(`7d ${Math.round(usage.sevenDay.usedPercentage)}%`);
  return parts.join(' · ');
}
