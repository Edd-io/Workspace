import { create } from 'zustand';
import type { Vec2 } from './layout';
import { pathLength } from './navigation';

/**
 * Trips of the characters away from their desk (coffee breaks, visits to a colleague, a note on the
 * whiteboard). A trip is a timeline of segments, so the pose of a character at any time is a pure
 * function of the trip: the frame rate does not matter.
 */

/** Walking speed of the Walk animation (see assets/blender/build_character.py). */
export const WALK_SPEED = 1.1;
/** Characters hurry back when their session needs the human. */
export const HURRY_SPEED = 1.6;
const STAND_UP_SECONDS = 0.6;

export type TripClip = 'Walk' | 'Stand' | 'StandDrink' | 'Talk';
export type TripPurpose = 'coffee' | 'visit' | 'board';

type Segment =
  | { kind: 'walk'; start: number; points: Vec2[]; length: number; speed: number }
  | { kind: 'stay'; start: number; duration: number; at: Vec2; yaw: number; clip: TripClip };

export interface Trip {
  deskId: string;
  purpose: TripPurpose;
  segments: Segment[];
  /** Time (s) the character is back in its chair. */
  end: number;
  /** Where the trip is headed, to keep two characters off the same spot. */
  destination: Vec2;
  returning: boolean;
}

export interface TripPose {
  x: number;
  z: number;
  yaw: number;
  clip: TripClip;
  /** Animation speed (walking faster when hurrying). */
  timeScale: number;
}

function segmentEnd(segment: Segment): number {
  return segment.kind === 'walk'
    ? segment.start + segment.length / segment.speed
    : segment.start + segment.duration;
}

function headingOf(points: Vec2[], fallback: number): number {
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]![0] - points[i - 1]![0];
    const dz = points[i]![1] - points[i - 1]![1];
    if (Math.hypot(dx, dz) > 0.01) return Math.atan2(dx, dz);
  }
  return fallback;
}

/** Assembles a trip: stand up, walk out, stay, walk back, sit down. */
export function planTrip(options: {
  deskId: string;
  purpose: TripPurpose;
  now: number;
  seatYaw: number;
  outbound: Vec2[];
  back: Vec2[];
  stay: { yaw: number; clip: TripClip; duration: number };
}): Trip {
  const { now, outbound, back, stay, seatYaw } = options;
  const segments: Segment[] = [];
  let time = now;
  const push = (segment: Segment) => {
    segments.push(segment);
    time = segmentEnd(segment);
  };
  push({
    kind: 'stay',
    start: time,
    duration: STAND_UP_SECONDS,
    at: outbound[0]!,
    yaw: seatYaw,
    clip: 'Stand',
  });
  push({ kind: 'walk', start: time, points: outbound, length: pathLength(outbound), speed: WALK_SPEED });
  const destination = outbound[outbound.length - 1]!;
  push({
    kind: 'stay',
    start: time,
    duration: stay.duration,
    at: destination,
    yaw: stay.yaw,
    clip: stay.clip,
  });
  push({ kind: 'walk', start: time, points: back, length: pathLength(back), speed: WALK_SPEED });
  push({
    kind: 'stay',
    start: time,
    duration: STAND_UP_SECONDS,
    at: back[back.length - 1]!,
    yaw: seatYaw,
    clip: 'Stand',
  });
  return {
    deskId: options.deskId,
    purpose: options.purpose,
    segments,
    end: time,
    destination,
    returning: false,
  };
}

/** Pose of the character at `time`, or null once the trip is over. */
export function tripPose(trip: Trip, time: number): TripPose | null {
  if (time >= trip.end) return null;
  const segment =
    [...trip.segments].reverse().find((candidate) => candidate.start <= time) ?? trip.segments[0]!;
  if (segment.kind === 'stay') {
    return { x: segment.at[0], z: segment.at[1], yaw: segment.yaw, clip: segment.clip, timeScale: 1 };
  }
  let remaining = Math.max(0, (time - segment.start) * segment.speed);
  const { points } = segment;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]!;
    const [bx, bz] = points[i]!;
    const length = Math.hypot(bx - ax, bz - az);
    if (remaining <= length || i === points.length - 1) {
      const t = length > 0 ? Math.min(1, remaining / length) : 1;
      return {
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        yaw: Math.atan2(bx - ax, bz - az),
        clip: 'Walk',
        timeScale: segment.speed / WALK_SPEED,
      };
    }
    remaining -= length;
  }
  const [x, z] = points[points.length - 1]!;
  return { x, z, yaw: headingOf(points, 0), clip: 'Walk', timeScale: 1 };
}

/** Cuts a trip short: from where the character is now, it hurries back along `back`. */
export function interruptTrip(trip: Trip, time: number, back: Vec2[], seatYaw: number): Trip {
  const kept = trip.segments.filter((segment) => segment.start < time);
  const segments: Segment[] = kept.map((segment) =>
    // The current segment ends now.
    segment.kind === 'stay'
      ? { ...segment, duration: Math.min(segment.duration, time - segment.start) }
      : segment,
  );
  const last = segments[segments.length - 1];
  if (last?.kind === 'walk') {
    // Truncate the walk at the current position.
    const pose = tripPose(trip, time);
    if (pose) {
      segments[segments.length - 1] = {
        kind: 'stay',
        start: last.start,
        duration: 0,
        at: [pose.x, pose.z],
        yaw: pose.yaw,
        clip: 'Walk',
      };
    }
  }
  const walk: Segment = {
    kind: 'walk',
    start: time,
    points: back,
    length: pathLength(back),
    speed: HURRY_SPEED,
  };
  const sit: Segment = {
    kind: 'stay',
    start: segmentEnd(walk),
    duration: STAND_UP_SECONDS,
    at: back[back.length - 1]!,
    yaw: seatYaw,
    clip: 'Stand',
  };
  return { ...trip, segments: [...segments, walk, sit], end: segmentEnd(sit), returning: true };
}

interface TripsState {
  trips: Record<string, Trip>;
  /** When each desk last came back from a trip (s), to space coffee breaks out. */
  lastTrip: Record<string, number>;
  start: (trip: Trip) => void;
  finish: (deskId: string, time: number) => void;
  replace: (trip: Trip) => void;
}

export const useTrips = create<TripsState>((set) => ({
  trips: {},
  lastTrip: {},
  start: (trip) => set((state) => ({ trips: { ...state.trips, [trip.deskId]: trip } })),
  replace: (trip) => set((state) => ({ trips: { ...state.trips, [trip.deskId]: trip } })),
  finish: (deskId, time) =>
    set((state) => {
      const { [deskId]: _done, ...trips } = state.trips;
      return { trips, lastTrip: { ...state.lastTrip, [deskId]: time } };
    }),
}));

/** Clock shared by the planner and the renderer (seconds). */
export const tripClock = (): number => performance.now() / 1000;
