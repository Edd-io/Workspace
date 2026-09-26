import type { Desk } from '@workspace/shared';

/** What a desk is working on: its declared task first, then the title Claude Code generated. */
export function deskTopic(desk: Desk): string | null {
  return desk.currentTask ?? desk.sessionTitle ?? null;
}
