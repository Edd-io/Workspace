import { WALL_HEIGHT, WALL_THICKNESS, type Wall } from '../layout';

export type WallMaterial = 'wall' | 'frame' | 'glass' | 'trim';

/** An axis-aligned (in the wall's frame) box, rotated around Y by `rotation`. */
export interface WallBox {
  center: [number, number, number];
  size: [number, number, number];
  rotation: number;
  material: WallMaterial;
  /**
   * Whether to draw the box's faces at its start and end along the wall. An end face pressed against
   * a neighboring box is never visible, except edge-on along the seam where it flickers as a dotted
   * line: those are left out.
   */
  ends: [boolean, boolean];
}

const DOOR_HEIGHT = 2.1;
const SILL = 0.9;
const WINDOW_HEAD = 2.3;
const GLASS_BASE = 0.08;
const GLASS_TOP = 2.45;
const MULLION_PITCH = 1.3;
const FRAME = 0.05;
const TRIM_HEIGHT = 0.08;
/** Window frames stand 5 mm proud of both wall faces and cover the sides of the opening. */
const WINDOW_FRAME_DEPTH = WALL_THICKNESS + 0.01;

type Interval = [number, number];

function subtract(span: Interval, holes: Interval[]): Interval[] {
  let pieces: Interval[] = [span];
  for (const [h0, h1] of holes) {
    pieces = pieces.flatMap(([p0, p1]) => {
      if (h1 <= p0 || h0 >= p1) return [[p0, p1] as Interval];
      const out: Interval[] = [];
      if (h0 > p0) out.push([p0, h0]);
      if (h1 < p1) out.push([h1, p1]);
      return out;
    });
  }
  return pieces.filter(([p0, p1]) => p1 - p0 > 0.001);
}

const samePoint = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001;
const touches = (intervals: Interval[], offset: number) =>
  intervals.some(([i0, i1]) => Math.abs(offset - i0) < 0.001 || Math.abs(offset - i1) < 0.001);

function direction(wall: Wall): [number, number] {
  const dx = wall.b[0] - wall.a[0];
  const dz = wall.b[1] - wall.a[1];
  const length = Math.hypot(dx, dz);
  return [dx / length, dz / length];
}

/**
 * Whether each end of `wall` continues straight into another wall of the same family (glass or
 * opaque): the two then read as one wall and the faces between them are left out.
 */
function continuedEnds(wall: Wall, walls: Wall[]): [boolean, boolean] {
  const [ux, uz] = direction(wall);
  const glass = wall.kind === 'glass';
  const continues = (point: [number, number]) =>
    walls.some((other) => {
      if (other === wall || (other.kind === 'glass') !== glass) return false;
      if (!samePoint(other.a, point) && !samePoint(other.b, point)) return false;
      const [vx, vz] = direction(other);
      return Math.abs(ux * vz - uz * vx) < 0.001;
    });
  return [continues(wall.a), continues(wall.b)];
}

/**
 * Splits the office walls into boxes. Everything above `cut` is dropped, which gives the
 * "dollhouse" cutaway used by the overview camera.
 */
export function buildWallBoxes(walls: Wall[], cut: number): WallBox[] {
  const boxes: WallBox[] = [];

  for (const wall of walls) {
    const dx = wall.b[0] - wall.a[0];
    const dz = wall.b[1] - wall.a[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const ux = dx / length;
    const uz = dz / length;
    // three.js rotation around Y that maps local +X onto the wall direction.
    const rotation = Math.atan2(-uz, ux);
    // Walls running along Z are a hair taller than walls along X: where walls overlap at a junction
    // their top faces (and baseboards) are never coplanar, which would flicker (z-fighting).
    const bias = Math.abs(uz) > Math.abs(ux) ? 0.004 : 0;
    const [startContinued, endContinued] = continuedEnds(wall, walls);

    const add = (
      from: number,
      to: number,
      y0: number,
      y1: number,
      material: WallMaterial,
      depth = WALL_THICKNESS,
      ends: [boolean, boolean] = [true, true],
    ) => {
      const reachesTop = y1 >= cut || y1 >= WALL_HEIGHT || y1 === TRIM_HEIGHT;
      const top = Math.min(y1, cut) + (reachesTop ? bias : 0);
      if (top - y0 <= 0.001 || to - from <= 0.001) return;
      const mid = (from + to) / 2;
      // Full-depth pieces meeting the next wall of a straight run have nothing to show there.
      const joins = material !== 'glass' && depth >= WALL_THICKNESS;
      boxes.push({
        center: [wall.a[0] + ux * mid, (y0 + top) / 2, wall.a[1] + uz * mid],
        size: [to - from, top - y0, depth],
        rotation,
        material,
        ends: [
          ends[0] && !(joins && startContinued && from < 0.001),
          ends[1] && !(joins && endContinued && to > length - 0.001),
        ],
      });
    };

    const doors: Interval[] = wall.doors.map((door) => [door.offset, door.offset + door.width]);
    const solidParts = subtract([0, length], doors);

    // A glass partition has one header over its whole length, doors included: no seam above them.
    if (wall.kind === 'glass') add(0, length, GLASS_TOP, WALL_HEIGHT, 'wall');
    for (const [d0, d1] of doors) {
      if (wall.kind === 'glass') {
        add(d0, d1, DOOR_HEIGHT, GLASS_TOP, 'glass', 0.02);
        add(d0, d1, DOOR_HEIGHT - FRAME, DOOR_HEIGHT, 'frame', WALL_THICKNESS * 0.8);
      } else {
        add(d0, d1, DOOR_HEIGHT, WALL_HEIGHT, 'wall', WALL_THICKNESS, [false, false]);
      }
      // Door jambs, which also cover the sides of the opening.
      add(d0 - FRAME / 2, d0 + FRAME / 2, 0, DOOR_HEIGHT, 'frame', WALL_THICKNESS + 0.02);
      add(d1 - FRAME / 2, d1 + FRAME / 2, 0, DOOR_HEIGHT, 'frame', WALL_THICKNESS + 0.02);
    }

    for (const [p0, p1] of solidParts) {
      if (wall.kind === 'glass') {
        add(p0, p1, 0, GLASS_BASE, 'frame');
        add(p0, p1, GLASS_BASE, GLASS_TOP, 'glass', 0.02);
        add(p0, p1, GLASS_TOP - FRAME, GLASS_TOP, 'frame', WALL_THICKNESS * 0.8);
        const mullions = Math.floor((p1 - p0) / MULLION_PITCH);
        for (let i = 1; i <= mullions; i++) {
          const x = p0 + ((p1 - p0) * i) / (mullions + 1);
          add(x - FRAME / 2, x + FRAME / 2, GLASS_BASE, GLASS_TOP, 'frame', 0.06);
        }
        add(p0, p0 + FRAME, GLASS_BASE, GLASS_TOP, 'frame', 0.06);
        add(p1 - FRAME, p1, GLASS_BASE, GLASS_TOP, 'frame', 0.06);
        continue;
      }

      const windows: Interval[] = wall.windows
        .map((window): Interval => [window.offset, window.offset + window.width])
        .filter(([w0, w1]) => w0 >= p0 && w1 <= p1);
      // Sides of doors and windows are covered by the jambs and window frames.
      const opening = (offset: number) => touches(doors, offset) || touches(windows, offset);
      for (const [s0, s1] of subtract([p0, p1], windows)) {
        add(s0, s1, 0, WALL_HEIGHT, 'wall', WALL_THICKNESS, [!opening(s0), !opening(s1)]);
      }
      for (const [w0, w1] of windows) {
        // Under the sill ledge, not up to its top: the two top faces would be coplanar.
        add(w0, w1, 0, SILL - 0.03, 'wall', WALL_THICKNESS, [false, false]);
        add(w0, w1, WINDOW_HEAD, WALL_HEIGHT, 'wall', WALL_THICKNESS, [false, false]);
        add(w0, w1, SILL, WINDOW_HEAD, 'glass', 0.02);
        add(w0 - 0.02, w1 + 0.02, SILL - 0.03, SILL, 'frame', WALL_THICKNESS + 0.08);
        add(w0, w1, WINDOW_HEAD - FRAME, WINDOW_HEAD, 'frame', WINDOW_FRAME_DEPTH);
        add(w0, w0 + FRAME, SILL, WINDOW_HEAD, 'frame', WINDOW_FRAME_DEPTH);
        add(w1 - FRAME, w1, SILL, WINDOW_HEAD, 'frame', WINDOW_FRAME_DEPTH);
        add((w0 + w1) / 2 - FRAME / 2, (w0 + w1) / 2 + FRAME / 2, SILL, WINDOW_HEAD, 'frame', 0.05);
      }
      // Baseboards on both faces.
      add(p0, p1, 0, TRIM_HEIGHT, 'trim', WALL_THICKNESS + 0.024);
    }
  }
  return boxes;
}
