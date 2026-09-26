import {
  ATTENTION_STATES,
  STATS_PERIOD_MS,
  type DeskPeriodStats,
  type OfficeStats,
  type SearchResult,
  type StatsPeriod,
} from '@workspace/shared';
import type { OfficeStore } from '../store/officeStore.ts';
import { stateSegments } from './timeline.ts';
import { searchTranscript, TranscriptIndex, transcriptsOf } from './transcripts.ts';

const SEARCH_LIMIT = 60;

/** Per-desk statistics and search across every desk's conversations. */
export class Insights {
  private readonly store: OfficeStore;
  private readonly transcripts = new TranscriptIndex();

  constructor(store: OfficeStore) {
    this.store = store;
  }

  async stats(period: StatsPeriod, to = Date.now()): Promise<OfficeStats> {
    const from = to - STATS_PERIOD_MS[period];
    const events = this.store.timelineEvents(from, to);
    const counts = this.store.eventCounts(from, to);
    const desks: DeskPeriodStats[] = [];
    for (const desk of this.store.listDesks()) {
      let workingMs = 0;
      let waitingMs = 0;
      for (const segment of stateSegments(this.store, desk, events, from, to)) {
        const length = segment.to - segment.from;
        if (segment.state === 'working' || segment.state === 'compacting') workingMs += length;
        else if (ATTENTION_STATES.has(segment.state)) waitingMs += length;
      }
      let linesAdded = 0;
      let linesRemoved = 0;
      let outputTokens = 0;
      for (const path of transcriptsOf(this.store, desk)) {
        const summary = await this.transcripts.summary(path);
        if (!summary) continue;
        for (const turn of summary.turns) {
          if (turn.ts >= from && turn.ts <= to) outputTokens += turn.output;
        }
        for (const edit of summary.edits) {
          if (edit.ts < from || edit.ts > to) continue;
          linesAdded += edit.added;
          linesRemoved += edit.removed;
        }
      }
      const current = desk.transcriptPath ? await this.transcripts.summary(desk.transcriptPath) : null;
      desks.push({
        deskId: desk.id,
        workingMs,
        waitingMs,
        linesAdded,
        linesRemoved,
        outputTokens,
        contextTokens: current?.turns.at(-1)?.context ?? null,
        ...(counts.get(desk.id) ?? {
          prompts: 0,
          toolCalls: 0,
          compactions: 0,
          wakes: 0,
          delegations: 0,
          merges: 0,
          pullRequests: 0,
        }),
      });
    }
    return { period, from, to, desks };
  }

  /** Prompts and answers containing `query` (case and accents ignored), newest first. */
  async search(query: string, roomId?: string): Promise<SearchResult> {
    const hits = [];
    for (const desk of this.store.listDesks()) {
      if (roomId && desk.roomId !== roomId) continue;
      for (const path of transcriptsOf(this.store, desk)) {
        hits.push(...(await searchTranscript(path, desk.id, query)));
      }
    }
    hits.sort((a, b) => b.ts - a.ts);
    return { query, hits: hits.slice(0, SEARCH_LIMIT), truncated: hits.length > SEARCH_LIMIT };
  }
}
