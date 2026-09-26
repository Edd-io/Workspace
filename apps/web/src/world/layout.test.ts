import { describe, expect, it } from 'vitest';
import type { Desk, Room } from '@workspace/shared';
import { buildColliders, resolveCollisions } from './collision';
import { officeProps } from './decor';
import { computeLayout, deskToWorld } from './layout';

function room(id: string, position: number): Room {
  return {
    id,
    name: id,
    projectPath: `/p/${id}`,
    isGitRepo: true,
    accentColor: '#e07a5f',
    position,
    createdAt: position,
  };
}

function desk(id: string, roomId: string, position: number): Desk {
  return {
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
  };
}

const rooms = [room('a', 0), room('b', 1), room('c', 2)];
const desks = [
  ...Array.from({ length: 7 }, (_, i) => desk(`a${i}`, 'a', i)),
  ...Array.from({ length: 2 }, (_, i) => desk(`b${i}`, 'b', i)),
];

describe('computeLayout', () => {
  const layout = computeLayout(rooms, desks);

  it('places every desk inside its room, clear of the walls', () => {
    for (const entry of layout.desks) {
      const home = layout.projectRooms.find((candidate) => candidate.room.id === entry.roomId)!;
      for (const corner of [
        [-0.75, 0, -0.4],
        [0.75, 0, -0.4],
        [0, 0, 1.1],
      ] as [number, number, number][]) {
        const [x, , z] = deskToWorld(entry, corner);
        expect(x).toBeGreaterThan(home.x0 + 0.1);
        expect(x).toBeLessThan(home.x1 - 0.1);
        expect(z).toBeGreaterThan(home.z0 + 0.1);
        expect(z).toBeLessThan(home.z1 - 0.1);
      }
    }
  });

  it('keeps desks apart', () => {
    for (const a of layout.desks) {
      for (const b of layout.desks) {
        if (a === b) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2);
      }
    }
  });

  it('alternates rooms on both sides and adds master, lounge and one empty room', () => {
    const sideOf = (id: string) => layout.projectRooms.find((entry) => entry.room.id === id)?.side;
    expect([sideOf('a'), sideOf('b'), sideOf('c')]).toEqual(['north', 'south', 'north']);
    expect(layout.rooms.filter((entry) => entry.kind === 'placeholder')).toHaveLength(1);
    expect(layout.rooms.some((entry) => entry.kind === 'master')).toBe(true);
    expect(layout.rooms.some((entry) => entry.kind === 'lounge')).toBe(true);
  });

  it('keeps tall furniture, wall decorations and whiteboards away from windows', () => {
    const blocking = new Set([
      'bookshelf',
      'fridge',
      'water_cooler',
      'filing_cabinet',
      'coat_rack',
      'wall_clock',
      'poster_a',
      'poster_b',
      'poster_c',
      'tv_screen',
      'fire_extinguisher',
    ]);
    const obstacles = [
      ...officeProps(layout)
        .filter((prop) => blocking.has(prop.model))
        .map((prop) => ({ name: prop.model, x: prop.x, z: prop.z, halfWidth: 0.3 })),
      ...layout.projectRooms.map((entry) => ({
        name: 'whiteboard',
        x: entry.whiteboard.x,
        z: entry.whiteboard.z,
        halfWidth: 0.9,
      })),
    ];
    for (const wall of layout.walls) {
      const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
      const ux = (wall.b[0] - wall.a[0]) / length;
      const uz = (wall.b[1] - wall.a[1]) / length;
      for (const window of wall.windows) {
        for (const obstacle of obstacles) {
          const dx = obstacle.x - wall.a[0];
          const dz = obstacle.z - wall.a[1];
          const along = dx * ux + dz * uz;
          const distance = Math.abs(dx * uz - dz * ux);
          const overlaps =
            along + obstacle.halfWidth > window.offset &&
            along - obstacle.halfWidth < window.offset + window.width;
          expect(overlaps && distance < 1, `${obstacle.name} at ${obstacle.x},${obstacle.z}`).toBe(false);
        }
      }
    }
  });

  it('lets a visitor stand in the corridor but not walk through walls', () => {
    const colliders = buildColliders(layout, officeProps(layout));
    const [x, z] = resolveCollisions(layout.entrance, 0.28, colliders);
    expect(Math.hypot(x - layout.entrance[0], z - layout.entrance[1])).toBeLessThan(0.01);
    // Standing inside the north corridor wall gets pushed out of it.
    const pushed = resolveCollisions([4, -1.6], 0.28, colliders);
    expect(Math.abs(pushed[1] + 1.6)).toBeGreaterThan(0.2);
  });
});
