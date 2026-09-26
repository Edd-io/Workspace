import { seededRandom } from './appearance';
import {
  CORRIDOR_HALF_WIDTH,
  DOOR_WIDTH,
  deskToWorld,
  WALL_HEIGHT,
  WALL_THICKNESS,
  type DeskLayout,
  type OfficeLayout,
  type RoomRect,
  type SpecialRoomLayout,
} from './layout';
import type { PropName } from './props/propLibrary';

/** One prop instance in the world. `rotation` is around Y; the prop's front faces +Z at 0. */
export interface PropPlacement {
  model: PropName;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale?: number;
  tilt?: number;
}

export const DESK_TOP = 0.74;
/** Where the web client draws the live screen, relative to the desk (local frame). */
export const SCREEN_CENTER: [number, number, number] = [0, DESK_TOP + 0.338, -0.22 + 0.0215];
export const STATUS_LAMP: [number, number, number] = [0.62, DESK_TOP, -0.26];
export const CHAIR: [number, number, number] = [0, 0, 0.72];
/** Where the seated character's root goes: on the front half of the seat, facing the desk. */
export const SEAT: [number, number, number] = [0, 0, 0.64];

function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function place(
  list: PropPlacement[],
  model: PropName,
  position: [number, number, number],
  rotation = 0,
  extra: Partial<PropPlacement> = {},
): void {
  list.push({ model, x: position[0], y: position[1], z: position[2], rotation, ...extra });
}

/** Places a prop given in a desk's local frame. */
function placeAtDesk(
  list: PropPlacement[],
  desk: DeskLayout,
  model: PropName,
  local: [number, number, number],
  localRotation = 0,
): void {
  place(list, model, deskToWorld(desk, local), desk.rotation + localRotation);
}

// ---- workstations ------------------------------------------------------------------------------

const CLUTTER_SLOTS: [number, number][] = [
  [-0.52, 0.08],
  [-0.6, -0.24],
  [-0.3, -0.3],
  [0.42, 0.2],
  [-0.38, 0.22],
];
const CLUTTER: PropName[] = [
  'mug',
  'mug_blue',
  'mug_yellow',
  'plant_small',
  'notebook',
  'headphones',
  'water_bottle',
  'paper_stack',
  'sticky_notes',
  'pen_holder',
];

export function deskProps(desk: DeskLayout): PropPlacement[] {
  const list: PropPlacement[] = [];
  const random = seededRandom(desk.desk.appearanceSeed);
  placeAtDesk(list, desk, 'desk', [0, 0, 0]);
  placeAtDesk(list, desk, 'office_chair', CHAIR, Math.PI + (random() - 0.5) * 0.12);
  placeAtDesk(list, desk, 'monitor', [0, DESK_TOP, -0.22]);
  placeAtDesk(list, desk, 'keyboard', [0, DESK_TOP, 0.1]);
  placeAtDesk(list, desk, 'mouse', [0.32, DESK_TOP, 0.12], (random() - 0.5) * 0.4);
  const slots = [...CLUTTER_SLOTS].sort(() => random() - 0.5);
  const count = 2 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const [x, z] = slots[i]!;
    const model = CLUTTER[Math.floor(random() * CLUTTER.length)]!;
    placeAtDesk(list, desk, model, [x, DESK_TOP, z], random() * Math.PI * 2);
  }
  if (random() < 0.35) placeAtDesk(list, desk, 'desk_lamp', [-0.62, DESK_TOP, -0.22], 0.2);
  if (random() < 0.5) placeAtDesk(list, desk, 'trash_bin', [0.9, 0, -0.15]);
  return list;
}

// ---- rooms -------------------------------------------------------------------------------------

interface RoomFrame {
  frontZ: number;
  backZ: number;
  /** Direction from the back wall toward the corridor. */
  toward: 1 | -1;
  /** Rotation for a prop whose front should face the corridor (i.e. its back against the back wall). */
  facingCorridor: number;
}

function frameOf(room: RoomRect): RoomFrame {
  const toward = room.towardCorridor;
  return {
    frontZ: toward === 1 ? room.z1 : room.z0,
    backZ: toward === 1 ? room.z0 : room.z1,
    toward,
    facingCorridor: toward === 1 ? 0 : Math.PI,
  };
}

const INSET = WALL_THICKNESS / 2;

function ceilingLights(list: PropPlacement[], room: RoomRect): void {
  const columns = Math.max(1, Math.round((room.x1 - room.x0) / 3));
  const rows = Math.max(1, Math.round((room.z1 - room.z0) / 3));
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const x = room.x0 + ((i + 0.5) * (room.x1 - room.x0)) / columns;
      const z = room.z0 + ((j + 0.5) * (room.z1 - room.z0)) / rows;
      place(list, 'ceiling_light', [x, WALL_HEIGHT - 0.05, z], 0);
    }
  }
}

/** One radiator centered under each window of the back wall (except over `skip` ranges). */
function backWallRadiators(
  list: PropPlacement[],
  room: RoomRect,
  frame: RoomFrame,
  skip: [number, number][] = [],
) {
  for (const window of room.backWindows) {
    const x = room.x0 + window.offset + window.width / 2;
    if (skip.some(([a, b]) => x > a && x < b)) continue;
    place(list, 'radiator', [x, 0, frame.backZ + frame.toward * (INSET + 0.06)], frame.facingCorridor);
  }
}

/** Rotation that makes a prop (front toward +Z) face from `from` toward `to` on the floor. */
function facing(from: [number, number], to: [number, number]): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1]);
}

const POSTERS: PropName[] = ['poster_a', 'poster_b', 'poster_c'];

export function projectRoomProps(room: RoomRect, seed: string, whiteboardX: number): PropPlacement[] {
  const list: PropPlacement[] = [];
  const random = seededRandom(hashString(seed));
  const frame = frameOf(room);
  const back = (offset: number) => frame.backZ + frame.toward * (INSET + offset);
  const front = (offset: number) => frame.frontZ - frame.toward * (INSET + offset);

  // Storage in the windowless corner of the back wall (see BACK_WALL_SOLID).
  place(list, 'bookshelf', [room.x0 + 0.6, 0, back(0.17)], frame.facingCorridor);
  if (random() < 0.6) {
    place(list, 'bookshelf', [room.x0 + 1.55, 0, back(0.17)], frame.facingCorridor);
  } else {
    place(list, 'printer_stand', [room.x0 + 1.45, 0, back(0.26)], frame.facingCorridor);
    place(list, 'printer', [room.x0 + 1.45, 0.7, back(0.26)], frame.facingCorridor);
    place(list, 'filing_cabinet', [room.x0 + 2.08, 0, back(0.31)], frame.facingCorridor);
  }
  place(list, 'plant_tall', [room.x1 - 0.4, 0, back(0.35)], 0);

  // Near the corridor: plant and coat rack by the door.
  place(list, 'plant_snake', [room.x1 - 0.45, 0, front(0.35)], random() * Math.PI);
  place(list, 'coat_rack', [room.x0 + 0.4, 0, front(0.4)], random() * Math.PI);
  if (random() < 0.5) place(list, 'umbrella_stand', [room.x0 + 0.35, 0, front(0.95)], 0);

  // The west wall is shared with the previous room at least as deep as the minimum room depth:
  // clock and posters go there, never on a wall with windows. π/2 makes a prop face +X.
  const wallX = room.x0 + INSET + 0.015;
  place(list, 'wall_clock', [room.x0 + INSET + 0.02, 2.15, front(1.6)], Math.PI / 2);
  place(list, POSTERS[Math.floor(random() * 3)]!, [wallX, 1.6, front(2.9)], Math.PI / 2);
  if (random() < 0.6) place(list, POSTERS[Math.floor(random() * 3)]!, [wallX, 1.6, front(4.1)], Math.PI / 2);
  place(list, 'fire_extinguisher', [room.x1 - INSET - 0.1, 0.05, front(1.3)], -Math.PI / 2);

  backWallRadiators(list, room, frame);
  ceilingLights(list, room);
  return list;
}

/** Pose of the user's desk in the master room: the chair is against the back wall, facing the door. */
export function masterDeskPose(room: RoomRect): { x: number; z: number; rotation: number } {
  const frame = frameOf(room);
  return {
    x: (room.x0 + room.x1) / 2,
    z: frame.backZ + frame.toward * (INSET + 2.1),
    // The desk's local +Z (chair side) points toward the back wall.
    rotation: frame.facingCorridor + Math.PI,
  };
}

/** Wall TV of the master office: on the east wall, facing west, above the lounge corner. */
export function masterTvPose(room: RoomRect): { position: [number, number, number]; rotation: number } {
  const frame = frameOf(room);
  return {
    position: [room.x1 - INSET - 0.03, 1.12, (room.z0 + room.z1) / 2 + frame.toward * 0.4],
    rotation: -Math.PI / 2,
  };
}

/** The three monitors of the master desk (map, summary, inbox), in the desk's local frame. */
export const MASTER_MONITORS: { x: number; angle: number }[] = [
  { x: -0.72, angle: 0.28 },
  { x: 0, angle: 0 },
  { x: 0.72, angle: -0.28 },
];

function masterRoomProps(room: SpecialRoomLayout): PropPlacement[] {
  const list: PropPlacement[] = [];
  const frame = frameOf(room);
  const back = (offset: number) => frame.backZ + frame.toward * (INSET + offset);
  const front = (offset: number) => frame.frontZ - frame.toward * (INSET + offset);
  const pose = masterDeskPose(room);
  const at = (local: [number, number, number]) => deskToWorld(pose, local);
  // Two desks side by side make a wide executive desk facing the door; the left one is turned
  // around so that both drawer pedestals end up at the outer ends.
  place(list, 'desk', at([-0.75, 0, 0]), pose.rotation + Math.PI);
  place(list, 'desk', at([0.75, 0, 0]), pose.rotation);
  place(list, 'office_chair', at([0, 0, 0.75]), pose.rotation + Math.PI);
  for (const monitor of MASTER_MONITORS) {
    const local: [number, number, number] = [monitor.x, DESK_TOP, -0.2 + Math.abs(monitor.angle) * 0.35];
    place(list, 'monitor', at(local), pose.rotation + monitor.angle);
  }
  place(list, 'keyboard', at([0, DESK_TOP, 0.12]), pose.rotation);
  place(list, 'mouse', at([0.34, DESK_TOP, 0.14]), pose.rotation);
  place(list, 'mug_yellow', at([-0.62, DESK_TOP, 0.2]), 0.6);
  place(list, 'plant_small', at([1.3, DESK_TOP, -0.2]), 0.3);
  place(list, 'desk_lamp', at([-1.3, DESK_TOP, -0.15]), pose.rotation + 0.4);
  place(list, 'notebook', at([0.75, DESK_TOP, 0.2]), pose.rotation - 0.2);
  place(list, 'bookshelf', [room.x0 + 0.8, 0, back(0.17)], frame.facingCorridor);
  place(list, 'bookshelf', [room.x0 + 1.75, 0, back(0.17)], frame.facingCorridor);
  place(list, 'plant_tall', [room.x1 - 0.6, 0, back(0.4)], 0.4);
  // Lounge corner facing the wall TV (timeline) on the east wall, shared with the first project room.
  const cz = (room.z0 + room.z1) / 2 + frame.toward * 0.4;
  place(list, 'rug', [room.x1 - 2.1, 0, cz], Math.PI / 2);
  place(list, 'sofa', [room.x1 - 3.15, 0, cz], Math.PI / 2);
  place(list, 'coffee_table', [room.x1 - 2.05, 0, cz], Math.PI / 2);
  place(list, 'floor_lamp', [room.x1 - 3.2, 0, cz - 1.35], 0);
  // Clock above the door, on the inside of the corridor wall.
  place(list, 'wall_clock', [room.x0 + 1.5, 2.45, front(0.02)], frame.facingCorridor + Math.PI);
  place(list, 'coat_rack', [room.x0 + 2.4, 0, front(0.4)], 0);
  const tv = masterTvPose(room);
  place(list, 'tv_screen', tv.position, tv.rotation);
  backWallRadiators(list, room, frame);
  ceilingLights(list, room);
  return list;
}

function loungeProps(room: SpecialRoomLayout): PropPlacement[] {
  const list: PropPlacement[] = [];
  const frame = frameOf(room);
  const back = (offset: number) => frame.backZ + frame.toward * (INSET + offset);
  const front = (offset: number) => frame.frontZ - frame.toward * (INSET + offset);
  // Kitchen along the back wall: the fridge in the windowless corner, the counter under the windows.
  place(list, 'fridge', [room.x0 + 0.45, 0, back(0.37)], frame.facingCorridor);
  const counterX = room.x0 + 2.05;
  place(list, 'kitchen_counter', [counterX, 0, back(0.33)], frame.facingCorridor);
  place(list, 'coffee_machine', [counterX - 0.3, 0.9, back(0.3)], frame.facingCorridor);
  place(list, 'microwave', [counterX + 0.25, 0.9, back(0.3)], frame.facingCorridor);
  place(list, 'trash_bin', [counterX + 1.5, 0, back(0.3)], 0);
  place(list, 'high_table', [room.x0 + 2.2, 0, back(2.2)], 0);
  place(list, 'fruit_bowl', [room.x0 + 2.2, 1.08, back(2.2)], 0);
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.4;
    const stool: [number, number] = [
      room.x0 + 2.2 + Math.cos(angle) * 0.62,
      back(2.2) + Math.sin(angle) * 0.62,
    ];
    place(list, 'bar_stool', [stool[0], 0, stool[1]], 0);
  }
  // Sofa corner around a coffee table.
  const cx = room.x1 - 2.6;
  const cz = (room.z0 + room.z1) / 2 + frame.toward * 0.3;
  const table: [number, number] = [cx + 0.1, cz];
  place(list, 'rug', [cx, 0, cz], Math.PI / 2);
  place(list, 'sofa', [cx + 1.25, 0, cz], -Math.PI / 2);
  const armchair: [number, number] = [cx - 0.5, cz - frame.toward * 1.25];
  place(list, 'armchair', [armchair[0], 0, armchair[1]], facing(armchair, table));
  place(list, 'coffee_table', [table[0], 0, table[1]], Math.PI / 2);
  const beanBag: [number, number] = [cx - 1.2, cz + frame.toward * 0.5];
  place(list, 'bean_bag', [beanBag[0], 0, beanBag[1]], facing(beanBag, table));
  place(list, 'floor_lamp', [room.x1 - 0.45, 0, back(0.45)], 0);
  place(list, 'plant_tall', [room.x1 - 0.55, 0, front(0.6)], 1.2);
  place(list, 'planter_box', [room.x0 + 0.85, 0, front(1.9)], Math.PI / 2);
  place(list, 'water_cooler', [room.x1 - INSET - 0.22, 0, back(1.4)], -Math.PI / 2);
  // Clock and poster on the inside of the two short wall returns along the corridor (always solid).
  const inward = frame.facingCorridor + Math.PI;
  place(list, 'wall_clock', [room.x0 + 0.6, 2.15, front(0.02)], inward);
  place(list, 'poster_a', [room.x1 - 0.6, 1.6, front(0.015)], inward);
  backWallRadiators(list, room, frame, [[counterX - 1.3, counterX + 1.3]]);
  ceilingLights(list, room);
  return list;
}

function placeholderProps(room: SpecialRoomLayout): PropPlacement[] {
  const list: PropPlacement[] = [];
  const frame = frameOf(room);
  const back = (offset: number) => frame.backZ + frame.toward * (INSET + offset);
  place(list, 'storage_boxes', [room.x0 + 1.0, 0, back(0.35)], 0.2);
  place(list, 'storage_boxes', [room.x0 + 1.7, 0, back(0.3)], -0.3, { scale: 0.8 });
  place(list, 'desk', [room.x1 - 1.4, 0, back(1.2)], frame.facingCorridor + 0.5);
  return list;
}

function corridorProps(layout: OfficeLayout): PropPlacement[] {
  const list: PropPlacement[] = [];
  const { x0, x1 } = layout.corridor;
  const wallZ = CORRIDOR_HALF_WIDTH - INSET;
  place(list, 'umbrella_stand', [x0 + 0.4, 0, -wallZ + 0.3], 0);
  place(list, 'plant_tall', [x0 + 0.5, 0, wallZ - 0.4], 0);
  place(list, 'plant_tall', [x1 - 0.5, 0, -wallZ + 0.4], 2);
  place(list, 'water_cooler', [x1 - 0.4, 0, wallZ - 0.3], -Math.PI / 2);
  for (let x = x0 + 1.5; x < x1 - 0.5; x += 3)
    place(list, 'ceiling_light', [x, WALL_HEIGHT - 0.05, 0], Math.PI / 2);
  return list;
}

/** Open door leaves in every room doorway, swung into the room. */
function doorProps(layout: OfficeLayout): PropPlacement[] {
  const list: PropPlacement[] = [];
  for (const wall of layout.walls) {
    const dx = wall.b[0] - wall.a[0];
    const dz = wall.b[1] - wall.a[1];
    const length = Math.hypot(dx, dz);
    const [ux, uz] = [dx / length, dz / length];
    // Room doors are on corridor walls (|z| = corridor half width): the room is away from the corridor.
    if (Math.abs(uz) > 0.01 || Math.abs(Math.abs(wall.a[1]) - CORRIDOR_HALF_WIDTH) > 0.01) continue;
    const inward: [number, number] = [0, Math.sign(wall.a[1])];
    for (const door of wall.doors) {
      if (Math.abs(door.width - DOOR_WIDTH) > 0.01) continue;
      const hinge: [number, number] = [
        wall.a[0] + ux * (door.offset + 0.06),
        wall.a[1] + uz * (door.offset + 0.06),
      ];
      const center: [number, number, number] = [
        hinge[0] + inward[0] * 0.48,
        0,
        hinge[1] + inward[1] * 0.48 + inward[1] * WALL_THICKNESS * 0.5,
      ];
      place(list, 'door', center, Math.atan2(-inward[1], inward[0]));
    }
  }
  return list;
}

/** Every static prop of the office (desks included). */
export function officeProps(layout: OfficeLayout): PropPlacement[] {
  const list: PropPlacement[] = [];
  for (const desk of layout.desks) list.push(...deskProps(desk));
  for (const room of layout.rooms) {
    if (room.kind === 'project') list.push(...projectRoomProps(room, room.room.id, room.whiteboard.x));
    else if (room.kind === 'master') list.push(...masterRoomProps(room));
    else if (room.kind === 'lounge') list.push(...loungeProps(room));
    else list.push(...placeholderProps(room));
  }
  list.push(...corridorProps(layout));
  list.push(...doorProps(layout));
  return list;
}
