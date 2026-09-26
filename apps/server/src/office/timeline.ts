import type { DeskState, DeskTimeline, Timeline } from '@workspace/shared';
import type { DeskRecord, OfficeStore } from '../store/officeStore.ts';

type TimelineEvent = ReturnType<OfficeStore['timelineEvents']>[number];

/** A desk's state segments between `from` and `to`, from its recorded state changes. */
export function stateSegments(
  store: OfficeStore,
  desk: DeskRecord,
  events: TimelineEvent[],
  from: number,
  to: number,
): DeskTimeline['segments'] {
  const start = Math.max(from, desk.createdAt);
  if (start >= to) return [];
  let state: DeskState = store.stateAt(desk.id, start) ?? 'offline';
  let segmentStart = start;
  const segments: DeskTimeline['segments'] = [];
  for (const event of events) {
    if (event.deskId !== desk.id || event.kind !== 'state' || !event.state || event.state === state) continue;
    if (event.ts > segmentStart) segments.push({ state, from: segmentStart, to: event.ts });
    state = event.state;
    segmentStart = event.ts;
  }
  segments.push({ state, from: segmentStart, to });
  return segments;
}

/** Rebuilds each desk's state segments between `from` and `to` from the recorded events. */
export function buildTimeline(store: OfficeStore, from: number, to: number): Timeline {
  const events = store.timelineEvents(from, to);
  const desks: DeskTimeline[] = [];
  for (const desk of store.listDesks()) {
    if (Math.max(from, desk.createdAt) >= to) continue;
    const own = events.filter((event) => event.deskId === desk.id);
    desks.push({
      deskId: desk.id,
      segments: stateSegments(store, desk, own, from, to),
      prompts: own.filter((event) => event.event === 'UserPromptSubmit').map((event) => event.ts),
    });
  }
  return { from, to, desks };
}
