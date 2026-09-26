import type { PropPlacement } from './decor';
import type { OfficeLayout, Vec2 } from './layout';
import type { PropName } from './props/propLibrary';

export interface Segment {
  a: Vec2;
  b: Vec2;
}

/** Footprints (width along the prop's X, depth along its Z) of the props a visitor cannot cross. */
const FOOTPRINTS: Partial<Record<PropName, [number, number]>> = {
  desk: [1.5, 0.75],
  office_chair: [0.55, 0.55],
  bookshelf: [0.9, 0.32],
  filing_cabinet: [0.45, 0.6],
  printer_stand: [0.6, 0.5],
  plant_tall: [0.45, 0.45],
  plant_snake: [0.35, 0.35],
  coat_rack: [0.35, 0.35],
  sofa: [2.0, 0.85],
  armchair: [0.8, 0.8],
  coffee_table: [1.1, 0.6],
  kitchen_counter: [2.44, 0.66],
  fridge: [0.7, 0.7],
  water_cooler: [0.34, 0.34],
  high_table: [0.8, 0.8],
  bar_stool: [0.4, 0.4],
  bean_bag: [0.8, 0.8],
  planter_box: [1.2, 0.35],
  storage_boxes: [0.5, 0.4],
  floor_lamp: [0.3, 0.3],
  meeting_table: [2.4, 1.1],
  umbrella_stand: [0.24, 0.24],
};

function subtract(span: [number, number], holes: [number, number][]): [number, number][] {
  let pieces: [number, number][] = [span];
  for (const [h0, h1] of holes) {
    pieces = pieces.flatMap(([p0, p1]): [number, number][] => {
      if (h1 <= p0 || h0 >= p1) return [[p0, p1]];
      const out: [number, number][] = [];
      if (h0 > p0) out.push([p0, h0]);
      if (h1 < p1) out.push([h1, p1]);
      return out;
    });
  }
  return pieces;
}

/** Everything that blocks a visitor: walls (minus door openings) and bulky furniture. */
export function buildColliders(
  layout: OfficeLayout,
  props: PropPlacement[],
  extra: Segment[] = [],
): Segment[] {
  const segments: Segment[] = [...extra];
  for (const wall of layout.walls) {
    const dx = wall.b[0] - wall.a[0];
    const dz = wall.b[1] - wall.a[1];
    const length = Math.hypot(dx, dz);
    const ux = dx / length;
    const uz = dz / length;
    const openings = wall.doors.map((door): [number, number] => [door.offset, door.offset + door.width]);
    for (const [p0, p1] of subtract([0, length], openings)) {
      segments.push({
        a: [wall.a[0] + ux * p0, wall.a[1] + uz * p0],
        b: [wall.a[0] + ux * p1, wall.a[1] + uz * p1],
      });
    }
  }
  for (const prop of props) {
    const footprint = FOOTPRINTS[prop.model];
    if (!footprint || prop.y > 0.1) continue;
    const scale = prop.scale ?? 1;
    const hw = (footprint[0] * scale) / 2;
    const hd = (footprint[1] * scale) / 2;
    const cos = Math.cos(prop.rotation);
    const sin = Math.sin(prop.rotation);
    const corner = (x: number, z: number): Vec2 => [prop.x + x * cos + z * sin, prop.z - x * sin + z * cos];
    const corners = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
    for (let i = 0; i < 4; i++) segments.push({ a: corners[i]!, b: corners[(i + 1) % 4]! });
  }
  return segments;
}

/** Pushes a circle of `radius` at `position` out of every segment it overlaps. */
export function resolveCollisions(position: Vec2, radius: number, segments: Segment[]): Vec2 {
  let [x, z] = position;
  for (let iteration = 0; iteration < 3; iteration++) {
    let moved = false;
    for (const { a, b } of segments) {
      const abx = b[0] - a[0];
      const abz = b[1] - a[1];
      const lengthSquared = abx * abx + abz * abz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / lengthSquared));
      const px = a[0] + abx * t;
      const pz = a[1] + abz * t;
      const dx = x - px;
      const dz = z - pz;
      const distance = Math.hypot(dx, dz);
      if (distance < radius) {
        const push = radius - distance;
        if (distance > 1e-6) {
          x += (dx / distance) * push;
          z += (dz / distance) * push;
        } else {
          // Exactly on the segment: push along its normal.
          const length = Math.sqrt(lengthSquared);
          x += (-abz / length) * push;
          z += (abx / length) * push;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return [x, z];
}
