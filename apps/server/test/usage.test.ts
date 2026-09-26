import { describe, expect, it } from 'vitest';
import type { UsageAlert } from '@workspace/shared';
import { statusLineSchema, statusLineText, UsageTracker } from '../src/office/usageTracker.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getSetting: (key: string) => values.get(key) ?? null,
    setSetting: (key: string, value: string) => void values.set(key, value),
  };
}

const NOW = 1_800_000_000_000;
const inHours = (hours: number) => Math.round((NOW + hours * 3600_000) / 1000);

function report(fiveHour: number, sevenDay = 10) {
  return statusLineSchema.parse({
    session_id: 'x',
    model: { id: 'claude-opus', display_name: 'Opus' },
    context_window: { used_percentage: 33.6 },
    cost: { total_cost_usd: 1.2, total_lines_added: 12, total_lines_removed: 3 },
    rate_limits: {
      five_hour: { used_percentage: fiveHour, resets_at: inHours(2) },
      seven_day: { used_percentage: sevenDay, resets_at: inHours(90) },
    },
  });
}

describe('UsageTracker', () => {
  it('keeps the latest usage and each desk figures', () => {
    const tracker = new UsageTracker(memoryStorage());
    tracker.report('d1', report(42), NOW);
    expect(tracker.usage(NOW)).toEqual({
      fiveHour: { usedPercentage: 42, resetsAt: inHours(2) * 1000 },
      sevenDay: { usedPercentage: 10, resetsAt: inHours(90) * 1000 },
      reportedAt: NOW,
    });
    expect(tracker.deskStats()).toEqual({
      d1: { model: 'Opus', contextPercent: 34, linesAdded: 12, linesRemoved: 3 },
    });
    // Once a window has reset it no longer counts.
    expect(tracker.usage(NOW + 3 * 3600_000).fiveHour).toBeNull();
  });

  it('alerts once per threshold and window, and survives restarts', () => {
    const storage = memoryStorage();
    const alerts: UsageAlert[] = [];
    const tracker = new UsageTracker(storage);
    tracker.on('alert', (alert) => alerts.push(alert));
    tracker.report('d1', report(79), NOW);
    tracker.report('d1', report(81), NOW);
    tracker.report('d2', report(83), NOW);
    expect(alerts.map((alert) => [alert.window, alert.threshold])).toEqual([['fiveHour', 80]]);

    const restarted = new UsageTracker(storage);
    restarted.on('alert', (alert) => alerts.push(alert));
    restarted.report('d1', report(85), NOW);
    restarted.report('d1', report(96), NOW);
    expect(alerts.map((alert) => alert.threshold)).toEqual([80, 95]);
  });

  it('ignores reports without rate limits and malformed fields', () => {
    const tracker = new UsageTracker(memoryStorage());
    tracker.report('d1', statusLineSchema.parse({ rate_limits: { five_hour: 'nope' }, model: 3 }), NOW);
    expect(tracker.usage(NOW)).toEqual({ fiveHour: null, sevenDay: null, reportedAt: null });
    expect(tracker.deskStats().d1).toEqual({
      model: null,
      contextPercent: null,
      linesAdded: null,
      linesRemoved: null,
    });
  });

  it('writes a compact status line', () => {
    const tracker = new UsageTracker(memoryStorage());
    tracker.report('d1', report(42), NOW);
    expect(statusLineText('Demo', 'Ken', tracker.deskStats().d1!, tracker.usage(NOW))).toBe(
      'Workspace · Demo / Ken · context 34% · 5h 42% · 7d 10%',
    );
  });
});
