import { z } from 'zod';

/** Statistics periods: the last 24 hours, 7 days or 30 days. */
export const STATS_PERIODS = ['day', 'week', 'month'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

export const STATS_PERIOD_MS: Record<StatsPeriod, number> = {
  day: 24 * 3600_000,
  week: 7 * 24 * 3600_000,
  month: 30 * 24 * 3600_000,
};

export interface DeskPeriodStats {
  deskId: string;
  /** Time spent working or compacting. */
  workingMs: number;
  /** Time spent waiting for the human (question, permission, error, usage limit). */
  waitingMs: number;
  /** Prompts typed by the human (wake-ups excluded). */
  prompts: number;
  toolCalls: number;
  /** Lines written through Edit / Write tool calls that succeeded. */
  linesAdded: number;
  linesRemoved: number;
  outputTokens: number;
  /** Size of the conversation's context at its latest turn, whatever the period. */
  contextTokens: number | null;
  compactions: number;
  wakes: number;
  /** Tasks colleagues handed to this desk with `delegate`. */
  delegations: number;
  merges: number;
  pullRequests: number;
}

export interface OfficeStats {
  period: StatsPeriod;
  from: number;
  to: number;
  desks: DeskPeriodStats[];
}

export const statsQuerySchema = z.object({ period: z.enum(STATS_PERIODS).default('day') });

export interface SearchHit {
  deskId: string;
  ts: number;
  role: 'user' | 'assistant';
  /** Text around the match, split so the match can be highlighted. */
  before: string;
  match: string;
  after: string;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  /** More hits exist than the ones returned. */
  truncated: boolean;
}

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  roomId: z.string().optional(),
});
