import { WALL_HEIGHT, WALL_THICKNESS, type Wall } from '../layout';

export type WallMaterial = 'wall' | 'frame' | 'glass' | 'trim';

/** An axis-aligned (in the wall's frame) box, rotated around Y by `rotation`. */
export interface WallBox {
  center: [number, number, number];
  size: [number, number, number];
  rotation: number;
  material: WallMaterial;
}

const DOOR_HEIGHT = 2.1;
const SILL = 0.9;
const WINDOW_HEAD = 2.3;
const GLASS_BASE = 0.08;
const GLASS_TOP = 2.45;
const MULLION_PITCH = 1.3;
const FRAME = 0.05;
const TRIM_HEIGHT = 0.08;

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

    const add = (
      from: number,
      to: number,
      y0: number,
      y1: number,
      material: WallMaterial,
      depth = WALL_THICKNESS,
    ) => {
      const top = Math.min(y1, cut);
      if (top - y0 <= 0.001 || to - from <= 0.001) return;
      const mid = (from + to) / 2;
      boxes.push({
        center: [wall.a[0] + ux * mid, (y0 + top) / 2, wall.a[1] + uz * mid],
        size: [to - from, top - y0, depth],
        rotation,
        material,
      });
    };

    const doors: Interval[] = wall.doors.map((door) => [door.offset, door.offset + door.width]);
    const solidParts = subtract([0, length], doors);

    for (const [d0, d1] of doors) {
      if (wall.kind === 'glass') {
        add(d0, d1, GLASS_TOP, WALL_HEIGHT, 'wall');
        add(d0, d1, DOOR_HEIGHT, GLASS_TOP, 'glass', 0.02);
        add(d0, d1, DOOR_HEIGHT - FRAME, DOOR_HEIGHT, 'frame', WALL_THICKNESS * 0.8);
      } else {
        add(d0, d1, DOOR_HEIGHT, WALL_HEIGHT, 'wall');
      }
      // Door jambs.
      add(d0 - FRAME / 2, d0 + FRAME / 2, 0, DOOR_HEIGHT, 'frame', WALL_THICKNESS + 0.02);
      add(d1 - FRAME / 2, d1 + FRAME / 2, 0, DOOR_HEIGHT, 'frame', WALL_THICKNESS + 0.02);
    }

    for (const [p0, p1] of solidParts) {
      if (wall.kind === 'glass') {
        add(p0, p1, 0, GLASS_BASE, 'frame');
        add(p0, p1, GLASS_BASE, GLASS_TOP, 'glass', 0.02);
        add(p0, p1, GLASS_TOP, WALL_HEIGHT, 'wall');
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
      for (const [s0, s1] of subtract([p0, p1], windows)) add(s0, s1, 0, WALL_HEIGHT, 'wall');
      for (const [w0, w1] of windows) {
        add(w0, w1, 0, SILL, 'wall');
        add(w0, w1, WINDOW_HEAD, WALL_HEIGHT, 'wall');
        add(w0, w1, SILL, WINDOW_HEAD, 'glass', 0.02);
        add(w0 - 0.02, w1 + 0.02, SILL - 0.03, SILL, 'frame', WALL_THICKNESS + 0.08);
        add(w0, w1, WINDOW_HEAD - FRAME, WINDOW_HEAD, 'frame', WALL_THICKNESS * 0.9);
        add(w0, w0 + FRAME, SILL, WINDOW_HEAD, 'frame', WALL_THICKNESS * 0.9);
        add(w1 - FRAME, w1, SILL, WINDOW_HEAD, 'frame', WALL_THICKNESS * 0.9);
        add((w0 + w1) / 2 - FRAME / 2, (w0 + w1) / 2 + FRAME / 2, SILL, WINDOW_HEAD, 'frame', 0.05);
      }
      // Baseboards on both faces.
      add(p0, p1, 0, TRIM_HEIGHT, 'trim', WALL_THICKNESS + 0.024);
    }
  }
  return boxes;
}
