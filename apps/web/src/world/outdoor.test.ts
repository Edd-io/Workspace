import { describe, expect, it } from 'vitest';
import type { Desk, Room } from '@workspace/shared';
import { SEAT } from './decor';
import { computeLayout, deskToWorld, type Vec2 } from './layout';
import { NavGrid } from './navigation';
import { officeProps } from './decor';
import { computeOutdoor, GROUND_Y, terraceSpots } from './outdoor';

const room = (id: string, position: number): Room => ({
  id,
  name: id,
  projectPath: `/p/${id}`,
  isGitRepo: true,
  accentColor: '#e07a5f',
  position,
  createdAt: position,
  autoWake: true,
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
  role: null,
  sessionId: id,
  model: null,
  permissionMode: null,
  appearanceSeed: position,
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
  [room('a', 0), room('b', 1), room('c', 2)],
  [...Array.from({ length: 7 }, (_, i) => desk(`a${i}`, 'a', i)), desk('b0', 'b', 0), desk('c0', 'c', 0)],
);
const outdoor = computeOutdoor(layout);
const TALL = new Set(['tree_round', 'tree_birch', 'tree_conifer', 'street_lamp']);

const inside = ([x, z]: Vec2, rect: { x0: number; x1: number; z0: number; z1: number }, margin = 0) =>
  x > rect.x0 - margin && x < rect.x1 + margin && z > rect.z0 - margin && z < rect.z1 + margin;

describe('computeOutdoor', () => {
  it('keeps outdoor props out of the building and off the roads', () => {
    const rects = [...layout.rooms, { x0: layout.corridor.x0, x1: layout.corridor.x1, z0: -1.6, z1: 1.6 }];
    for (const prop of outdoor.props) {
      if (prop.model === 'entrance_canopy') continue;
      expect(
        rects.some((rect) => inside([prop.x, prop.z], rect, 0.3)),
        prop.model,
      ).toBe(false);
      if (!prop.model.startsWith('car_')) {
        expect(
          outdoor.roads.some((road) => inside([prop.x, prop.z], road)),
          prop.model,
        ).toBe(false);
      }
      expect(prop.y).toBeGreaterThanOrEqual(GROUND_Y);
    }
  });

  it('keeps tall things off the south side, between the overview camera and the building', () => {
    const { bounds } = layout;
    // The band between the building and the overview camera (the south street beyond it has lamps).
    const south = outdoor.props.filter(
      (prop) =>
        TALL.has(prop.model) &&
        prop.z > bounds.z1 + 2 &&
        prop.z < bounds.z1 + 25 &&
        prop.x > bounds.x0 - 6 &&
        prop.x < bounds.x1 + 3,
    );
    expect(south.map((prop) => prop.model)).toEqual([]);
    for (const neighbor of outdoor.neighbors) {
      const inFront =
        neighbor.z - neighbor.depth / 2 > bounds.z1 && neighbor.x + neighbor.width / 2 > bounds.x0;
      expect(inFront).toBe(false);
    }
  });

  it('lets characters walk from their desk to the terrace', () => {
    const grid = new NavGrid(layout, officeProps(layout));
    const entry = layout.desks.find((candidate) => candidate.desk.id === 'a6')!;
    const [x, , z] = deskToWorld(entry, SEAT);
    const spots = terraceSpots(layout);
    expect(spots.length).toBeGreaterThan(0);
    for (const spot of spots) {
      expect(grid.isFree(spot.position)).toBe(true);
      expect(grid.findPath([x, z], spot.position)).not.toBeNull();
    }
  });
});
