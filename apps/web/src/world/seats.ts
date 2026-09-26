import type { PropPlacement } from './decor';
import type { PropName } from './props/propLibrary';

/** Somewhere the visitor can sit down in walk mode. */
export interface Seat {
  /** Eye position once seated. */
  eye: [number, number, number];
  /** Camera yaw looking out of the seat; null for round stools (keep looking where you were). */
  yaw: number | null;
  /** The point to aim at to sit: the middle of the seat cushion. */
  target: [number, number, number];
}

interface SeatShape {
  /** Height of the seat top above the prop's base. */
  height: number;
  /** Local x of each place (sofas and benches seat several people). */
  places: number[];
  /** Local z of the cushion center, and of the seated eyes (a bit back, toward the backrest). */
  cushionZ: number;
  eyeZ: number;
  /** Seated eye height above the seat top (lower on a bean bag, which gives way). */
  eyeAbove?: number;
  /** The seat has a front (props face +Z); stools do not. */
  facing: boolean;
}

const EYE_ABOVE_SEAT = 0.72;

/** Seat geometry of the models one can sit on (see assets/blender/props). */
const SHAPES: Partial<Record<PropName, SeatShape>> = {
  office_chair: { height: 0.5, places: [0], cushionZ: 0, eyeZ: -0.06, facing: true },
  sofa: { height: 0.44, places: [-0.45, 0.45], cushionZ: 0.07, eyeZ: -0.02, facing: true },
  armchair: { height: 0.44, places: [0], cushionZ: 0.07, eyeZ: -0.02, facing: true },
  bean_bag: { height: 0.4, places: [0], cushionZ: 0.05, eyeZ: -0.02, eyeAbove: 0.62, facing: true },
  bar_stool: { height: 0.75, places: [0], cushionZ: 0, eyeZ: 0, facing: false },
  bench: { height: 0.47, places: [-0.4, 0.4], cushionZ: 0, eyeZ: -0.08, facing: true },
  outdoor_chair: { height: 0.475, places: [0], cushionZ: 0, eyeZ: -0.05, facing: true },
};

/** Every free seat among the props. Desk chairs belong to the desks' characters, except `seat` ones. */
export function seatsOf(props: PropPlacement[]): Seat[] {
  const seats: Seat[] = [];
  for (const prop of props) {
    const shape = SHAPES[prop.model];
    if (!shape || (prop.model === 'office_chair' && !prop.seat)) continue;
    const scale = prop.scale ?? 1;
    const cos = Math.cos(prop.rotation);
    const sin = Math.sin(prop.rotation);
    // Local (x, z) → world, as for collision footprints.
    const world = (x: number, z: number): [number, number] => [
      prop.x + (x * cos + z * sin) * scale,
      prop.z + (-x * sin + z * cos) * scale,
    ];
    const top = prop.y + shape.height * scale;
    for (const place of shape.places) {
      const [tx, tz] = world(place, shape.cushionZ);
      const [ex, ez] = world(place, shape.eyeZ);
      seats.push({
        target: [tx, top, tz],
        eye: [ex, top + (shape.eyeAbove ?? EYE_ABOVE_SEAT), ez],
        // The camera looks along −Z rotated by yaw; the seat faces +Z rotated by the prop's rotation.
        yaw: shape.facing ? prop.rotation + Math.PI : null,
      });
    }
  }
  return seats;
}

/**
 * The seat the viewer aims at: the one whose cushion is closest to the view ray, within `reach`
 * along it and `tolerance` across it. `origin` and `direction` (normalized) describe the ray.
 */
export function aimedSeat(
  seats: Seat[],
  origin: [number, number, number],
  direction: [number, number, number],
  reach: number,
  tolerance = 0.4,
): { seat: Seat; distance: number } | null {
  let best: { seat: Seat; distance: number; miss: number } | null = null;
  for (const seat of seats) {
    const offset = seat.target.map((value, index) => value - origin[index]!) as [number, number, number];
    const along = offset[0] * direction[0] + offset[1] * direction[1] + offset[2] * direction[2];
    if (along <= 0 || along > reach) continue;
    const miss = Math.hypot(
      offset[0] - direction[0] * along,
      offset[1] - direction[1] * along,
      offset[2] - direction[2] * along,
    );
    if (miss > tolerance || (best && miss >= best.miss)) continue;
    best = { seat, distance: along, miss };
  }
  return best && { seat: best.seat, distance: best.distance };
}
