import { describe, expect, it } from 'vitest';
import { WALL_HEIGHT, type Wall } from '../layout';
import { buildWallBoxes } from './buildWalls';

const wall = (a: [number, number], b: [number, number], extra: Partial<Wall> = {}): Wall => ({
  a,
  b,
  kind: 'exterior',
  doors: [],
  windows: [],
  ...extra,
});

describe('buildWallBoxes', () => {
  it('leaves out the faces between the pieces around a window', () => {
    const boxes = buildWallBoxes(
      [wall([0, 0], [6, 0], { windows: [{ offset: 2, width: 1.4 }] })],
      WALL_HEIGHT,
    );
    const walls = boxes.filter((box) => box.material === 'wall');
    // Two full-height sides (free outer ends only) and the pieces under and above the window.
    expect(walls).toHaveLength(4);
    const [left, right] = walls.filter((box) => box.size[1] > 2.7).sort((a, b) => a.center[0] - b.center[0]);
    expect(left!.ends).toEqual([true, false]);
    expect(right!.ends).toEqual([false, true]);
    for (const filler of walls.filter((box) => box.size[1] < 2.7))
      expect(filler.ends).toEqual([false, false]);
  });

  it('joins straight runs of walls of the same family but keeps free ends and corners', () => {
    const boxes = buildWallBoxes(
      [
        wall([0, 0], [4, 0]),
        wall([4, 0], [8, 0]),
        wall([8, 0], [8, 4]),
        wall([0, 5], [3, 5], { kind: 'glass' }),
      ],
      WALL_HEIGHT,
    );
    const fullWalls = boxes.filter((box) => box.material === 'wall' && box.size[1] > 2.7);
    const at = (x: number, z: number) =>
      fullWalls.find((box) => Math.abs(box.center[0] - x) < 0.01 && Math.abs(box.center[2] - z) < 0.01)!;
    expect(at(2, 0).ends).toEqual([true, false]);
    expect(at(6, 0).ends).toEqual([false, true]);
    // Perpendicular walls meet at a corner: both keep their end faces.
    expect(at(8, 2).ends).toEqual([true, true]);
    // A glass partition has one header over its whole length.
    const headers = boxes.filter((box) => box.material === 'wall' && box.center[2] === 5);
    expect(headers).toHaveLength(1);
    expect(headers[0]!.size[0]).toBeCloseTo(3);
  });
});
