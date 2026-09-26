import { describe, expect, it } from 'vitest';
import { masterGallery, officeProps } from './decor';
import { computeLayout, WALL_HEIGHT } from './layout';
import { pictureSize } from './frameGeometry';

describe('masterGallery', () => {
  const layout = computeLayout([], []);
  const master = layout.rooms.find((room) => room.kind === 'master')!;
  const slots = masterGallery(master);
  const corridorWall = layout.walls.find(
    (wall) => wall.a[1] === master.z1 && wall.b[1] === master.z1 && wall.a[0] === master.x0,
  )!;

  it('hangs every frame on the corridor wall, inside the room, facing it', () => {
    for (const slot of slots) {
      expect(slot.position[2]).toBeLessThan(master.z1);
      expect(slot.position[2]).toBeGreaterThan(master.z1 - 0.1);
      // The picture faces into the room (−Z for the north side).
      expect(Math.cos(slot.rotation)).toBeCloseTo(-1);
      expect(slot.position[1] + slot.height / 2).toBeLessThan(WALL_HEIGHT - 0.5);
      const [width, height] = pictureSize(slot);
      expect(width).toBeGreaterThan(0.2);
      expect(height).toBeGreaterThan(0.2);
    }
  });

  it('keeps frames apart, clear of the door, the coat rack and the corner', () => {
    const boxes = slots.map((slot) => ({
      x0: slot.position[0] - slot.width / 2,
      x1: slot.position[0] + slot.width / 2,
      y0: slot.position[1] - slot.height / 2,
      y1: slot.position[1] + slot.height / 2,
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!];
        const overlap = a.x0 < b.x1 + 0.05 && b.x0 < a.x1 + 0.05 && a.y0 < b.y1 + 0.05 && b.y0 < a.y1 + 0.05;
        expect(overlap, `${slots[i]!.id} / ${slots[j]!.id}`).toBe(false);
      }
    }
    const door = corridorWall.doors[0]!;
    const doorEnd = corridorWall.a[0] + door.offset + door.width;
    const coatRack = officeProps(layout).find((prop) => prop.model === 'coat_rack')!;
    const left = Math.min(...boxes.map((box) => box.x0));
    expect(left).toBeGreaterThan(Math.max(doorEnd, coatRack.x + 0.4));
    expect(Math.max(...boxes.map((box) => box.x1))).toBeLessThan(master.x1 - 0.3);
  });
});
