import { describe, expect, it } from 'vitest';
import type { Desk, Room } from '@workspace/shared';
import { buildColliders } from './collision';
import { loungeSpots, officeProps, SEAT } from './decor';
import { computeLayout, deskToWorld, type Vec2 } from './layout';
import { NavGrid, pathLength } from './navigation';
import { interruptTrip, planTrip, tripPose, WALK_SPEED } from './trips';

const room = (id: string, position: number): Room => ({
  id,
  name: id,
  projectPath: `/p/${id}`,
  isGitRepo: true,
  accentColor: '#e07a5f',
  position,
  createdAt: position,
});

const desk = (id: string, roomId: string, position: number): Desk => ({
  id,
  roomId,
  name: id,
  slug: id,
  mode: 'worktree',
  workdir: '/w',
  branch: null,
  baseBranch: null,
  sessionId: id,
  model: null,
  permissionMode: null,
  appearanceSeed: position * 7919,
  position,
  state: 'idle',
  stateSince: 0,
  currentTask: null,
  sessionTitle: null,
  currentTool: null,
  lastPrompt: null,
  lastAssistantMessage: null,
  attention: null,
  createdAt: 0,
});

const layout = computeLayout(
  [room('a', 0), room('b', 1)],
  [...Array.from({ length: 5 }, (_, i) => desk(`a${i}`, 'a', i)), desk('b0', 'b', 0)],
);
const props = officeProps(layout);
const grid = new NavGrid(layout, props);
const walls = buildColliders(layout, []);

function crossesWall(from: Vec2, to: Vec2): boolean {
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  return walls.some(
    ({ a, b }) => cross(from, to, a) * cross(from, to, b) < 0 && cross(a, b, from) * cross(a, b, to) < 0,
  );
}

describe('NavGrid', () => {
  const seat = (id: string): Vec2 => {
    const entry = layout.desks.find((candidate) => candidate.desk.id === id)!;
    const [x, , z] = deskToWorld(entry, SEAT);
    return [x, z];
  };

  it('walks from a desk in the back row to the lounge without going through walls', () => {
    const lounge = layout.rooms.find((entry) => entry.kind === 'lounge')!;
    const spot = loungeSpots(lounge)[0]!;
    const path = grid.findPath(seat('a4'), spot.position)!;
    expect(path).not.toBeNull();
    for (let i = 1; i < path.length; i++) expect(crossesWall(path[i - 1]!, path[i]!)).toBe(false);
    // Much longer than a straight line: it has to leave the room through its door.
    const straight = Math.hypot(spot.position[0] - seat('a4')[0], spot.position[1] - seat('a4')[1]);
    expect(pathLength(path)).toBeGreaterThan(straight);
  });

  it('reaches a colleague in another room and every lounge spot', () => {
    expect(grid.findPath(seat('a0'), seat('b0'))).not.toBeNull();
    const lounge = layout.rooms.find((entry) => entry.kind === 'lounge')!;
    for (const spot of loungeSpots(lounge)) {
      expect(grid.isFree(spot.position)).toBe(true);
      expect(grid.findPath(seat('b0'), spot.position)).not.toBeNull();
    }
  });
});

describe('trips', () => {
  const outbound: Vec2[] = [
    [0, 0],
    [3, 0],
    [3, 4],
  ];
  const back = [...outbound].reverse();
  const trip = planTrip({
    deskId: 'a0',
    purpose: 'coffee',
    now: 100,
    seatYaw: Math.PI,
    outbound,
    back,
    stay: { yaw: 0, clip: 'StandDrink', duration: 10 },
  });

  it('stands up, walks the path at walking speed, stays, comes back and ends', () => {
    expect(tripPose(trip, 100.2)?.clip).toBe('Stand');
    const walking = tripPose(trip, 100.6 + 3 / WALK_SPEED)!;
    expect(walking.clip).toBe('Walk');
    expect(walking.x).toBeCloseTo(3);
    expect(walking.z).toBeCloseTo(0);
    const arrival = 100.6 + 7 / WALK_SPEED;
    expect(tripPose(trip, arrival + 1)).toMatchObject({ x: 3, z: 4, clip: 'StandDrink' });
    expect(tripPose(trip, trip.end + 0.01)).toBeNull();
  });

  it('hurries back from wherever the character is when interrupted', () => {
    const now = 100.6 + 2 / WALK_SPEED;
    const pose = tripPose(trip, now)!;
    const hurried = interruptTrip(
      trip,
      now,
      [
        [pose.x, pose.z],
        [0, 0],
      ],
      Math.PI,
    );
    expect(hurried.returning).toBe(true);
    expect(tripPose(hurried, now + 0.01)?.timeScale).toBeGreaterThan(1);
    expect(hurried.end).toBeLessThan(trip.end);
    expect(tripPose(hurried, hurried.end - 0.1)).toMatchObject({ x: 0, z: 0, clip: 'Stand' });
  });
});
