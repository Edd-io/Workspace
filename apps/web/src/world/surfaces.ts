import type { Surface } from '../features/sound/library';
import type { OfficeLayout } from './layout';
import { computeOutdoor } from './outdoor';

/** What the floor is made of at a point: parquet indoors and on the terrace, paving, or grass. */
export function surfaceFinder(layout: OfficeLayout): (x: number, z: number) => Surface {
  const outdoor = computeOutdoor(layout);
  const inside = (rect: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) =>
    x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1;
  return (x, z) => {
    if (inside(layout.bounds, x, z)) return 'wood';
    const surface = outdoor.surfaces.find((entry) => inside(entry, x, z));
    if (surface) return surface.kind === 'deck' ? 'wood' : 'concrete';
    return outdoor.roads.some((road) => inside(road, x, z)) ? 'concrete' : 'grass';
  };
}

/** 1 well inside the building, 0 outside, smooth across the walls. */
export function indoorness(layout: OfficeLayout, x: number, z: number): number {
  const { x0, x1, z0, z1 } = layout.bounds;
  const depth = Math.min(x - x0, x1 - x, z - z0, z1 - z);
  const t = Math.min(1, Math.max(0, (depth + 1.5) / 3));
  return t * t * (3 - 2 * t);
}
