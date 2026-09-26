import { describe, expect, it } from 'vitest';
import { computeLayout } from './layout';
import { computeOutdoor } from './outdoor';
import { indoorness, surfaceFinder } from './surfaces';

describe('surfaces', () => {
  const layout = computeLayout([], []);
  const outdoor = computeOutdoor(layout);
  const surfaceAt = surfaceFinder(layout);
  const center = (rect: { x0: number; x1: number; z0: number; z1: number }): [number, number] => [
    (rect.x0 + rect.x1) / 2,
    (rect.z0 + rect.z1) / 2,
  ];

  it('knows what the visitor walks on', () => {
    expect(surfaceAt(...layout.entrance)).toBe('wood');
    expect(surfaceAt(...center(outdoor.surfaces.find((surface) => surface.kind === 'deck')!))).toBe('wood');
    expect(surfaceAt(...center(outdoor.surfaces.find((surface) => surface.kind === 'paving')!))).toBe(
      'concrete',
    );
    expect(surfaceAt(...center(outdoor.roads[0]!))).toBe('concrete');
    expect(surfaceAt(layout.bounds.x1 + 200, 200)).toBe('grass');
  });

  it('fades from indoors to outdoors across the walls', () => {
    const { x0, z0, z1 } = layout.bounds;
    const middle = (z0 + z1) / 2;
    expect(indoorness(layout, x0 + 3, middle)).toBe(1);
    expect(indoorness(layout, x0 - 3, middle)).toBe(0);
    const wall = indoorness(layout, x0, middle);
    expect(wall).toBeGreaterThan(0.2);
    expect(wall).toBeLessThan(0.8);
  });
});
