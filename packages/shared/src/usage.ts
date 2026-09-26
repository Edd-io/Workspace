/** One usage window of the Claude subscription, as reported to Claude Code's status line. */
export interface UsageWindow {
  /** 0–100. */
  usedPercentage: number;
  /** When the window resets (ms since epoch). */
  resetsAt: number;
}

export const USAGE_WINDOWS = ['fiveHour', 'sevenDay'] as const;
export type UsageWindowName = (typeof USAGE_WINDOWS)[number];

/** Usage of the subscription shared by every desk (the latest report of any desk). */
export interface SubscriptionUsage {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  /** Time of the report the values come from (ms), null before the first one. */
  reportedAt: number | null;
}

/** Warning thresholds, in percent of a window. */
export const USAGE_ALERT_THRESHOLDS = [80, 95] as const;

export interface UsageAlert {
  window: UsageWindowName;
  threshold: number;
  usedPercentage: number;
  resetsAt: number;
}

/** Live figures of one desk's Claude Code session, from its status line. */
export interface DeskStats {
  model: string | null;
  /** Share of the context window in use (0–100). */
  contextPercent: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
}
