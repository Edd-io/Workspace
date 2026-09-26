import type { Desk, Room } from '@workspace/shared';

/**
 * Floor plan of the office, computed from the room and desk lists. Units are meters, Y is up.
 *
 * A corridor runs along the X axis (|z| < CORRIDOR_HALF_WIDTH). The west end holds the user's
 * master office (north) and the lounge/kitchen (south); project rooms line the corridor east of
 * them, alternating north (−Z) and south (+Z). Each room is as deep as its content needs; the back
 * facade steps where neighbors differ. Inside a project room, desks face the corridor so their
 * screens are visible from the glass partition.
 */

export const CORRIDOR_HALF_WIDTH = 1.6;
export const WALL_HEIGHT = 2.8;
export const WALL_THICKNESS = 0.12;
export const DESKS_PER_ROW = 3;
export const DOOR_WIDTH = 1.0;
const DESK_PITCH_X = 2.6;
const DESK_PITCH_Z = 3.0;
const ROOM_PADDING_X = 1.7;
const ROOM_PADDING_BACK = 2.0;
const ROOM_PADDING_FRONT = 2.2;
const MIN_ROOM_WIDTH = 7.5;
const MIN_ROOM_DEPTH = 7.5;
const SPECIAL_ROOM_WIDTH = 9;
const SPECIAL_ROOM_DEPTH = 8;
const WINDOW_WIDTH = 1.4;
const TERRACE_DOOR_WIDTH = 1.2;
/** The lounge's terrace door starts this far from the east end of its back wall. */
const LOUNGE_TERRACE_DOOR_FROM_END = 3.4;
const WEST_X = -SPECIAL_ROOM_WIDTH;
const PLACEHOLDER_WIDTH = 7.5;

export type RoomSide = 'north' | 'south';
export type Vec2 = [number, number];

export interface RoomRect {
  /** Min/max X and Z of the floor. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  side: RoomSide;
  /** +1 when the corridor is toward +Z (north rooms), −1 otherwise. */
  towardCorridor: 1 | -1;
  /** Windows of the back wall, as offsets from x0 (filled when walls are built). */
  backWindows: { offset: number; width: number }[];
  /** Door of the back wall to the outside (the lounge's terrace), as an offset from x0. */
  backDoor: { offset: number; width: number } | null;
}

export interface ProjectRoomLayout extends RoomRect {
  kind: 'project';
  room: Room;
  /** Next free desk slot, used to show the "add desk" placeholder. */
  nextSlot: { x: number; z: number; rotation: number };
  /** Standing whiteboard in the back corner, facing the corridor. */
  whiteboard: { x: number; z: number; rotation: number };
}

export interface SpecialRoomLayout extends RoomRect {
  kind: 'master' | 'lounge' | 'placeholder';
}

export type RoomLayout = ProjectRoomLayout | SpecialRoomLayout;

export interface DeskLayout {
  desk: Desk;
  roomId: string;
  x: number;
  z: number;
  /** Rotation around Y; the desk's local +Z (where the chair is) points toward the corridor. */
  rotation: number;
}

export type WallKind = 'solid' | 'exterior' | 'glass';

/** A straight wall from `a` to `b` (floor plan), with openings measured along it from `a`. */
export interface Wall {
  a: Vec2;
  b: Vec2;
  kind: WallKind;
  doors: { offset: number; width: number }[];
  /** Exterior walls get windows. */
  windows: { offset: number; width: number }[];
}

export interface OfficeLayout {
  rooms: RoomLayout[];
  projectRooms: ProjectRoomLayout[];
  desks: DeskLayout[];
  walls: Wall[];
  corridor: { x0: number; x1: number };
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** Where a visitor enters the building (walk mode start). */
  entrance: Vec2;
}

function slotPosition(
  index: number,
  columns: number,
  room: { x: number; frontZ: number; towardCorridor: 1 | -1 },
): { x: number; z: number; rotation: number } {
  const column = index % DESKS_PER_ROW;
  const row = Math.floor(index / DESKS_PER_ROW);
  const x = room.x + (column - (columns - 1) / 2) * DESK_PITCH_X;
  // Row 0 is the one closest to the corridor.
  const z = room.frontZ - room.towardCorridor * (ROOM_PADDING_FRONT + row * DESK_PITCH_Z + 0.5);
  return { x, z, rotation: room.towardCorridor === 1 ? 0 : Math.PI };
}

/** Evenly spaced windows between `start` and `end` (offsets along a wall), none if too short. */
function windowsBetween(start: number, end: number): { offset: number; width: number }[] {
  const length = end - start;
  if (length < 2.2) return [];
  const count = Math.max(1, Math.floor((length - 0.8) / 2.2));
  const pitch = length / count;
  return Array.from({ length: count }, (_, i) => ({
    offset: start + pitch * (i + 0.5) - WINDOW_WIDTH / 2,
    width: WINDOW_WIDTH,
  }));
}

function projectDepth(deskCount: number): number {
  const rows = Math.ceil((deskCount + 1) / DESKS_PER_ROW);
  return Math.max(MIN_ROOM_DEPTH, rows * DESK_PITCH_Z + ROOM_PADDING_FRONT + ROOM_PADDING_BACK - 0.5);
}

/**
 * Windowless stretches at both ends of each room kind's back wall, in meters from x0 and from x1:
 * tall furniture and the standing whiteboard go there, never in front of a window.
 */
export const BACK_WALL_SOLID: Record<RoomLayout['kind'], [number, number]> = {
  project: [2.3, 2.8],
  master: [2.5, 0.4],
  lounge: [1.2, 0.4],
  placeholder: [2.2, 0.4],
};

export function computeLayout(rooms: Room[], desks: Desk[]): OfficeLayout {
  const desksByRoom = new Map<string, Desk[]>();
  for (const desk of desks) {
    const list = desksByRoom.get(desk.roomId) ?? [];
    list.push(desk);
    desksByRoom.set(desk.roomId, list);
  }
  const bySide: Record<RoomSide, Room[]> = { north: [], south: [] };
  rooms.forEach((room, index) => bySide[index % 2 === 0 ? 'north' : 'south'].push(room));

  // Every room has its own depth, sized to its content.
  const rect = (side: RoomSide, x0: number, x1: number, depth: number): RoomRect => {
    const towardCorridor: 1 | -1 = side === 'north' ? 1 : -1;
    const near = CORRIDOR_HALF_WIDTH * -towardCorridor;
    const far = (CORRIDOR_HALF_WIDTH + depth) * -towardCorridor;
    return {
      x0,
      x1,
      z0: Math.min(near, far),
      z1: Math.max(near, far),
      side,
      towardCorridor,
      backWindows: [],
      backDoor: null,
    };
  };

  const roomLayouts: RoomLayout[] = [
    { kind: 'master', ...rect('north', WEST_X, 0, SPECIAL_ROOM_DEPTH) },
    { kind: 'lounge', ...rect('south', WEST_X, 0, SPECIAL_ROOM_DEPTH) },
  ];
  const projectRooms: ProjectRoomLayout[] = [];
  const deskLayouts: DeskLayout[] = [];
  const cursor: Record<RoomSide, number> = { north: 0, south: 0 };

  for (const side of ['north', 'south'] as const) {
    for (const room of bySide[side]) {
      const roomDesks = (desksByRoom.get(room.id) ?? []).sort((a, b) => a.position - b.position);
      const slots = roomDesks.length + 1;
      const columns = Math.min(slots, DESKS_PER_ROW);
      const width = Math.max(MIN_ROOM_WIDTH, columns * DESK_PITCH_X + ROOM_PADDING_X * 2);
      const base = rect(side, cursor[side], cursor[side] + width, projectDepth(roomDesks.length));
      cursor[side] += width;
      const frontZ = base.towardCorridor === 1 ? base.z1 : base.z0;
      const backZ = base.towardCorridor === 1 ? base.z0 : base.z1;
      const geometry = { x: (base.x0 + base.x1) / 2, frontZ, towardCorridor: base.towardCorridor };
      roomDesks.forEach((desk, slot) => {
        deskLayouts.push({ desk, roomId: room.id, ...slotPosition(slot, columns, geometry) });
      });
      const layout: ProjectRoomLayout = {
        kind: 'project',
        room,
        ...base,
        nextSlot: slotPosition(roomDesks.length, columns, geometry),
        whiteboard: {
          x: base.x1 - 1.75,
          z: backZ + base.towardCorridor * 0.6,
          rotation: base.towardCorridor === 1 ? 0 : Math.PI,
        },
      };
      projectRooms.push(layout);
      roomLayouts.push(layout);
    }
  }

  // The next room will be created on the side with fewer rooms: show an empty shell there.
  const nextSide: RoomSide = rooms.length % 2 === 0 ? 'north' : 'south';
  roomLayouts.push({
    kind: 'placeholder',
    ...rect(nextSide, cursor[nextSide], cursor[nextSide] + PLACEHOLDER_WIDTH, MIN_ROOM_DEPTH),
  });
  cursor[nextSide] += PLACEHOLDER_WIDTH;
  const east = Math.max(cursor.north, cursor.south);

  // ---- walls -------------------------------------------------------------------------------
  const walls: Wall[] = [];
  const addWall = (
    a: Vec2,
    b: Vec2,
    kind: WallKind,
    doors: Wall['doors'] = [],
    windows: Wall['windows'] = [],
  ) => {
    walls.push({ a, b, kind, doors, windows });
  };
  // Side exterior walls run from the corridor (a) to the back (b): keep both corners solid for
  // what stands or hangs there (coat rack, fire extinguisher, back-corner furniture).
  const exterior = (a: Vec2, b: Vec2) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    addWall(a, b, 'exterior', [], windowsBetween(1.6, length - 1.0));
  };

  for (const side of ['north', 'south'] as const) {
    const sideRooms = roomLayouts.filter((room) => room.side === side).sort((a, b) => a.x0 - b.x0);
    const toward = side === 'north' ? 1 : -1;
    const corridorZ = CORRIDOR_HALF_WIDTH * -toward;
    const backOf = (room: RoomRect) => (toward === 1 ? room.z0 : room.z1);
    const depthOf = (room: RoomRect) => room.z1 - room.z0;

    sideRooms.forEach((room, index) => {
      // Back wall (exterior), windows kept out of its solid ends.
      const backZ = backOf(room);
      const width = room.x1 - room.x0;
      const [solidStart, solidEnd] = BACK_WALL_SOLID[room.kind];
      if (room.kind === 'lounge') {
        // A glass door to the terrace, between the windows.
        room.backDoor = { offset: width - LOUNGE_TERRACE_DOOR_FROM_END, width: TERRACE_DOOR_WIDTH };
        room.backWindows = [
          ...windowsBetween(solidStart + 0.1, room.backDoor.offset - 0.3),
          ...windowsBetween(room.backDoor.offset + TERRACE_DOOR_WIDTH + 0.3, width - solidEnd),
        ];
      } else {
        room.backWindows = windowsBetween(solidStart + 0.1, width - solidEnd);
      }
      addWall(
        [room.x0, backZ],
        [room.x1, backZ],
        'exterior',
        room.backDoor ? [room.backDoor] : [],
        room.backWindows,
      );

      // West side: gable for the first room.
      if (index === 0) exterior([room.x0, corridorZ], [room.x0, backZ]);
      // East side: shared with the next room up to the shallower depth, then a step (exterior).
      const next = sideRooms[index + 1];
      if (next) {
        const shallow = depthOf(room) <= depthOf(next) ? room : next;
        const deep = shallow === room ? next : room;
        addWall([room.x1, corridorZ], [room.x1, backOf(shallow)], 'solid');
        if (depthOf(deep) - depthOf(shallow) > 0.01)
          exterior([room.x1, backOf(shallow)], [room.x1, backOf(deep)]);
      } else {
        exterior([room.x1, corridorZ], [room.x1, backZ]);
      }

      // Corridor side.
      if (room.kind === 'lounge') {
        // The lounge is open on the corridor, apart from two short wall returns.
        addWall([room.x0, corridorZ], [room.x0 + 1.2, corridorZ], 'solid');
        addWall([room.x1 - 1.2, corridorZ], [room.x1, corridorZ], 'solid');
      } else if (room.kind === 'placeholder') {
        addWall([room.x0, corridorZ], [room.x1, corridorZ], 'glass', [{ offset: width / 2 - 1.5, width: 3 }]);
      } else {
        const kind: WallKind = room.kind === 'master' ? 'solid' : 'glass';
        // Door near the end of the room closest to the entrance.
        addWall([room.x0, corridorZ], [room.x1, corridorZ], kind, [{ offset: 1.0, width: DOOR_WIDTH }]);
      }
    });
    // Corridor wall where this side stops before the other one.
    const end = Math.max(...sideRooms.map((room) => room.x1));
    if (end < east) exterior([end, corridorZ], [east, corridorZ]);
  }
  // Corridor ends: glass entrance to the west, window wall to the east.
  addWall([WEST_X, -CORRIDOR_HALF_WIDTH], [WEST_X, CORRIDOR_HALF_WIDTH], 'glass', [
    { offset: CORRIDOR_HALF_WIDTH - 0.9, width: 1.8 },
  ]);
  addWall(
    [east, -CORRIDOR_HALF_WIDTH],
    [east, CORRIDOR_HALF_WIDTH],
    'exterior',
    [],
    windowsBetween(0, 2 * CORRIDOR_HALF_WIDTH),
  );

  return {
    rooms: roomLayouts,
    projectRooms,
    desks: deskLayouts,
    walls,
    corridor: { x0: WEST_X, x1: east },
    bounds: {
      x0: WEST_X,
      x1: east,
      z0: Math.min(...roomLayouts.map((room) => room.z0)),
      z1: Math.max(...roomLayouts.map((room) => room.z1)),
    },
    entrance: [WEST_X + 1.2, 0],
  };
}

/** Converts a point from a desk's local frame (chair toward +Z) to world space. */
export function deskToWorld(
  desk: Pick<DeskLayout, 'x' | 'z' | 'rotation'>,
  local: [number, number, number],
): [number, number, number] {
  const cos = Math.cos(desk.rotation);
  const sin = Math.sin(desk.rotation);
  const [x, y, z] = local;
  return [desk.x + x * cos + z * sin, y, desk.z - x * sin + z * cos];
}

/** Camera pose looking at a desk's monitor over the character's right shoulder. */
export function deskCameraPose(desk: DeskLayout): {
  position: [number, number, number];
  target: [number, number, number];
} {
  return {
    position: deskToWorld(desk, [0.78, 1.72, 1.35]),
    target: deskToWorld(desk, [0.02, 1.05, -0.22]),
  };
}

export function roomCenter(room: RoomRect): Vec2 {
  return [(room.x0 + room.x1) / 2, (room.z0 + room.z1) / 2];
}
