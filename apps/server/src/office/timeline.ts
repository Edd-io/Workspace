import type { DeskTimeline, Timeline } from '@workspace/shared';
import type { OfficeStore } from '../store/officeStore.ts';

/** Rebuilds each desk's state segments between `from` and `to` from the recorded events. */
export function buildTimeline(store: OfficeStore, from: number, to: number): Timeline {
  const events = store.timelineEvents(from, to);
  const desks: DeskTimeline[] = [];
  for (const desk of store.listDesks()) {
    const start = Math.max(from, desk.createdAt);
    if (start >= to) continue;
    const own = events.filter((event) => event.deskId === desk.id);
    let state = store.stateAt(desk.id, start) ?? 'offline';
    let segmentStart = start;
    const segments: DeskTimeline['segments'] = [];
    for (const event of own) {
      if (event.kind !== 'state' || !event.state || event.state === state) continue;
      if (event.ts > segmentStart) segments.push({ state, from: segmentStart, to: event.ts });
      state = event.state;
      segmentStart = event.ts;
    }
    segments.push({ state, from: segmentStart, to });
    desks.push({
      deskId: desk.id,
      segments,
      prompts: own.filter((event) => event.event === 'UserPromptSubmit').map((event) => event.ts),
    });
  }
  return { from, to, desks };
}
