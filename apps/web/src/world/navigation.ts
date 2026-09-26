import { buildColliders, type Segment } from './collision';
import type { PropPlacement } from './decor';
import type { OfficeLayout, Vec2 } from './layout';

/**
 * Walkable floor of the office for the characters: a grid over the building where cells too close to
 * a wall or a piece of furniture are blocked, searched with A*. Only cells reachable from the entrance
 * count as free, so the insides of big furniture never become destinations.
 */

const CELL = 0.15;
/** The grid reaches this far outside the building (the lounge's terrace). */
const MARGIN = 7;
/** Half the width of a character, plus a little margin. */
const CLEARANCE = 0.27;

interface Node {
  index: number;
  f: number;
}

/** Minimal binary heap on `f`. */
class Heap {
  private readonly items: Node[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: Node): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.f <= items[i]!.f) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): Node {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left]!.f < items[smallest]!.f) smallest = left;
        if (right < items.length && items[right]!.f < items[smallest]!.f) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i]!, items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

function distanceToSegment(x: number, z: number, { a, b }: Segment): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const lengthSquared = abx * abx + abz * abz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / lengthSquared));
  return Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t));
}

export class NavGrid {
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  /** 1 where a character can stand. */
  readonly free: Uint8Array;

  constructor(layout: OfficeLayout, props: PropPlacement[]) {
    const { bounds } = layout;
    this.x0 = bounds.x0 - MARGIN;
    this.z0 = bounds.z0 - MARGIN;
    this.cols = Math.ceil((bounds.x1 - bounds.x0 + 2 * MARGIN) / CELL);
    this.rows = Math.ceil((bounds.z1 - bounds.z0 + 2 * MARGIN) / CELL);
    const blocked = new Uint8Array(this.cols * this.rows);
    for (const segment of buildColliders(layout, props)) this.block(blocked, segment);

    // Free = reachable from the entrance.
    this.free = new Uint8Array(this.cols * this.rows);
    const start = this.indexOf(layout.entrance);
    if (start === null || blocked[start]) return;
    const queue = [start];
    this.free[start] = 1;
    while (queue.length > 0) {
      const index = queue.pop()!;
      for (const next of this.neighbors(index, false)) {
        if (!blocked[next] && !this.free[next]) {
          this.free[next] = 1;
          queue.push(next);
        }
      }
    }
  }

  private block(blocked: Uint8Array, segment: Segment): void {
    const minX = Math.min(segment.a[0], segment.b[0]) - CLEARANCE;
    const maxX = Math.max(segment.a[0], segment.b[0]) + CLEARANCE;
    const minZ = Math.min(segment.a[1], segment.b[1]) - CLEARANCE;
    const maxZ = Math.max(segment.a[1], segment.b[1]) + CLEARANCE;
    const c0 = Math.max(0, Math.floor((minX - this.x0) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((maxX - this.x0) / CELL));
    const r0 = Math.max(0, Math.floor((minZ - this.z0) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((maxZ - this.z0) / CELL));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const [x, z] = this.center(row * this.cols + col);
        if (distanceToSegment(x, z, segment) < CLEARANCE) blocked[row * this.cols + col] = 1;
      }
    }
  }

  private indexOf([x, z]: Vec2): number | null {
    const col = Math.floor((x - this.x0) / CELL);
    const row = Math.floor((z - this.z0) / CELL);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return row * this.cols + col;
  }

  center(index: number): Vec2 {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    return [this.x0 + (col + 0.5) * CELL, this.z0 + (row + 0.5) * CELL];
  }

  isFree(point: Vec2): boolean {
    const index = this.indexOf(point);
    return index !== null && this.free[index] === 1;
  }

  private *neighbors(index: number, diagonals: boolean): Generator<number> {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if ((dr === 0 && dc === 0) || (!diagonals && dr !== 0 && dc !== 0)) continue;
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
        // No corner cutting: a diagonal step needs both sides free.
        if (dr !== 0 && dc !== 0 && (!this.free[row * this.cols + c] || !this.free[r * this.cols + col]))
          continue;
        yield r * this.cols + c;
      }
    }
  }

  /** Closest free cell to `point` (breadth-first, through blocked cells). */
  nearestFree(point: Vec2): number | null {
    const origin = this.indexOf(point);
    if (origin === null) return null;
    if (this.free[origin]) return origin;
    const seen = new Set([origin]);
    let frontier = [origin];
    while (frontier.length > 0) {
      const next: number[] = [];
      let best: number | null = null;
      let bestDistance = Infinity;
      for (const index of frontier) {
        for (const neighbor of this.neighbors(index, false)) {
          if (seen.has(neighbor)) continue;
          seen.add(neighbor);
          if (this.free[neighbor]) {
            const [x, z] = this.center(neighbor);
            const distance = Math.hypot(x - point[0], z - point[1]);
            if (distance < bestDistance) {
              best = neighbor;
              bestDistance = distance;
            }
          } else {
            next.push(neighbor);
          }
        }
      }
      if (best !== null) return best;
      frontier = next;
    }
    return null;
  }

  private lineOfSight(from: Vec2, to: Vec2): boolean {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.ceil(length / (CELL / 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.isFree([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t])) return false;
    }
    return true;
  }

  /**
   * Walking path from `from` to `to` (both may be inside furniture, e.g. a chair: the path then starts
   * and ends with a short step out of it). Null when the destination cannot be reached.
   */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const start = this.nearestFree(from);
    const goal = this.nearestFree(to);
    if (start === null || goal === null) return null;
    const cameFrom = new Map<number, number>();
    const cost = new Map<number, number>([[start, 0]]);
    const [gx, gz] = this.center(goal);
    const heuristic = (index: number) => {
      const [x, z] = this.center(index);
      const dx = Math.abs(x - gx);
      const dz = Math.abs(z - gz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    const open = new Heap();
    open.push({ index: start, f: heuristic(start) });
    const closed = new Set<number>();
    let found = start === goal;
    while (open.size > 0 && !found) {
      const { index } = open.pop();
      if (closed.has(index)) continue;
      if (index === goal) {
        found = true;
        break;
      }
      closed.add(index);
      const [x, z] = this.center(index);
      for (const next of this.neighbors(index, true)) {
        if (!this.free[next] || closed.has(next)) continue;
        const [nx, nz] = this.center(next);
        const tentative = cost.get(index)! + Math.hypot(nx - x, nz - z);
        if (tentative < (cost.get(next) ?? Infinity)) {
          cost.set(next, tentative);
          cameFrom.set(next, index);
          open.push({ index: next, f: tentative + heuristic(next) });
        }
      }
    }
    if (!found) return null;

    const cells: Vec2[] = [];
    for (let index: number | undefined = goal; index !== undefined; index = cameFrom.get(index)) {
      cells.push(this.center(index));
      if (index === start) break;
    }
    cells.reverse();

    // String pulling: keep only the corners of the grid path.
    const smooth: Vec2[] = [cells[0]!];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let next = cells.length - 1;
      while (next > anchor + 1 && !this.lineOfSight(cells[anchor]!, cells[next]!)) next--;
      smooth.push(cells[next]!);
      anchor = next;
    }
    const points = [from, ...smooth, to];
    // Drop points closer than a few centimeters to the previous one.
    return points.filter(
      (point, index) =>
        index === 0 || Math.hypot(point[0] - points[index - 1]![0], point[1] - points[index - 1]![1]) > 0.05,
    );
  }
}

/** Total length of a path. */
export function pathLength(points: Vec2[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return length;
}
