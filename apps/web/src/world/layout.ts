import type { Desk, Room } from '@workspace/shared';

/**
 * Floor plan of the office, computed from the room and desk lists. Units are meters, Y is up.
 * A corridor runs along the X axis; project rooms line both sides of it, alternating north (−Z) and
 * south (+Z). Inside a room, desks face the corridor so screens are visible from the doorway.
 */

export const CORRIDOR_HALF_WIDTH = 1.6;
export const WALL_HEIGHT = 2.8;
export const DESKS_PER_ROW = 3;
const DESK_PITCH_X = 2.6;
const DESK_PITCH_Z = 3.0;
const ROOM_PADDING_X = 1.6;
const ROOM_PADDING_BACK = 1.8;
const ROOM_PADDING_FRONT = 2.2;
const MIN_ROOM_WIDTH = 7;
const MIN_ROOM_DEPTH = 6.5;
const ROOM_GAP = 0.2;
const CORRIDOR_START_X = 0;

export type RoomSide = 'north' | 'south';

export interface RoomLayout {
  room: Room;
  side: RoomSide;
  /** Center of the room floor. */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Direction from the room center toward the corridor (+1 for north rooms, −1 for south rooms). */
  towardCorridor: 1 | -1;
  /** Next free desk slot, used to show the "add desk" placeholder. */
  nextSlot: { x: number; z: number; rotation: number };
  /** Standing whiteboard in the back corner, facing the corridor. */
  whiteboard: { x: number; z: number; rotation: number };
}

export interface DeskLayout {
  desk: Desk;
  roomId: string;
  x: number;
  z: number;
  /** Rotation around Y; the desk's local +Z (where the chair is) points toward the corridor. */
  rotation: number;
}

export interface OfficeLayout {
  rooms: RoomLayout[];
  desks: DeskLayout[];
  corridor: { minX: number; maxX: number };
}

function slotPosition(
  index: number,
  columns: number,
  room: { x: number; z: number; depth: number; towardCorridor: 1 | -1 },
): { x: number; z: number; rotation: number } {
  const column = index % DESKS_PER_ROW;
  const row = Math.floor(index / DESKS_PER_ROW);
  const x = room.x + (column - (columns - 1) / 2) * DESK_PITCH_X;
  // Row 0 is the one closest to the corridor.
  const frontEdge = room.z + (room.depth / 2) * room.towardCorridor;
  const z = frontEdge - room.towardCorridor * (ROOM_PADDING_FRONT + row * DESK_PITCH_Z + 0.5);
  return { x, z, rotation: room.towardCorridor === 1 ? 0 : Math.PI };
}

export function computeLayout(rooms: Room[], desks: Desk[]): OfficeLayout {
  const desksByRoom = new Map<string, Desk[]>();
  for (const desk of desks) {
    const list = desksByRoom.get(desk.roomId) ?? [];
    list.push(desk);
    desksByRoom.set(desk.roomId, list);
  }

  const cursor: Record<RoomSide, number> = { north: CORRIDOR_START_X, south: CORRIDOR_START_X };
  const roomLayouts: RoomLayout[] = [];
  const deskLayouts: DeskLayout[] = [];

  rooms.forEach((room, index) => {
    const roomDesks = (desksByRoom.get(room.id) ?? []).sort((a, b) => a.position - b.position);
    // One extra slot for the "add desk" placeholder.
    const slots = roomDesks.length + 1;
    const columns = Math.min(slots, DESKS_PER_ROW);
    const rows = Math.ceil(slots / DESKS_PER_ROW);
    const width = Math.max(MIN_ROOM_WIDTH, columns * DESK_PITCH_X + ROOM_PADDING_X * 2);
    const depth = Math.max(MIN_ROOM_DEPTH, rows * DESK_PITCH_Z + ROOM_PADDING_FRONT + ROOM_PADDING_BACK - 1);

    const side: RoomSide = index % 2 === 0 ? 'north' : 'south';
    const towardCorridor: 1 | -1 = side === 'north' ? 1 : -1;
    const x = cursor[side] + width / 2;
    cursor[side] += width + ROOM_GAP;
    const z = -towardCorridor * (CORRIDOR_HALF_WIDTH + depth / 2);

    const geometry = { x, z, depth, towardCorridor };
    roomDesks.forEach((desk, slot) => {
      const position = slotPosition(slot, columns, geometry);
      deskLayouts.push({ desk, roomId: room.id, ...position });
    });
    roomLayouts.push({
      room,
      side,
      x,
      z,
      width,
      depth,
      towardCorridor,
      nextSlot: slotPosition(roomDesks.length, columns, geometry),
      whiteboard: {
        x: x + width / 2 - 1.3,
        z: z - towardCorridor * (depth / 2 - 0.55),
        rotation: towardCorridor === 1 ? 0 : Math.PI,
      },
    });
  });

  const maxX = Math.max(cursor.north, cursor.south, CORRIDOR_START_X + 8);
  return { rooms: roomLayouts, desks: deskLayouts, corridor: { minX: CORRIDOR_START_X - 4, maxX: maxX + 2 } };
}

/** Converts a point from a desk's local frame (chair toward +Z) to world space. */
export function deskToWorld(desk: DeskLayout, local: [number, number, number]): [number, number, number] {
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
    position: deskToWorld(desk, [0.55, 1.55, 1.45]),
    target: deskToWorld(desk, [0.05, 1.05, -0.22]),
  };
}
