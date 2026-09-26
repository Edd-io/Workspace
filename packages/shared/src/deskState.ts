export const DESK_STATES = [
  'starting',
  'idle',
  'working',
  'question',
  'compacting',
  'limited',
  'error',
  'offline',
] as const;

export type DeskState = (typeof DESK_STATES)[number];

/** Lamp color for each state, shared by the 3D lamps, the 2D map and the timeline. */
export const DESK_STATE_COLORS: Record<DeskState, string> = {
  starting: '#e8e8e8',
  idle: '#3ddc84',
  working: '#3b8bff',
  question: '#ff9f1a',
  compacting: '#a66bff',
  limited: '#ffd23f',
  error: '#ff4d4f',
  offline: '#4a4f57',
};

/** States in which the desk is waiting for the human. */
export const ATTENTION_STATES: ReadonlySet<DeskState> = new Set(['question', 'error', 'limited']);
