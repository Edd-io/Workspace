import { describe, expect, it } from 'vitest';
import { daylight, skyDirection, sunPosition } from './daylight';

// Local times: the model follows the viewer's clock, whatever the time zone of the machine.
const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute);

describe('sunPosition', () => {
  it('follows the day: low in the east in the morning, high in the south at noon, gone at night', () => {
    // Summer time (when the machine's time zone has one) moves solar noon to 13:00.
    const summerTime = new Date(2026, 0, 1).getTimezoneOffset() !== new Date(2026, 6, 1).getTimezoneOffset();
    const noon = sunPosition(at(6, 21, summerTime ? 13 : 12));
    expect(noon.elevation).toBeGreaterThan(55);
    expect(Math.abs(noon.azimuth - 180)).toBeLessThan(20);

    const morning = sunPosition(at(6, 21, 7));
    expect(morning.elevation).toBeGreaterThan(0);
    expect(morning.azimuth).toBeGreaterThan(45);
    expect(morning.azimuth).toBeLessThan(135);

    expect(sunPosition(at(6, 21, 0, 30)).elevation).toBeLessThan(-10);
    // Winter days are short and the sun stays low.
    expect(sunPosition(at(12, 21, 18)).elevation).toBeLessThan(0);
    expect(sunPosition(at(12, 21, 12, 30)).elevation).toBeLessThan(25);
  });
});

describe('skyDirection', () => {
  it('maps azimuths onto the scene axes (north −Z, east +X)', () => {
    const [x, , z] = skyDirection(0, 90);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
    expect(skyDirection(0, 180)[2]).toBeCloseTo(1);
    expect(skyDirection(90, 0)[1]).toBeCloseTo(1);
  });
});

describe('daylight', () => {
  it('switches from sunlight to moonlight and darkens the outdoors at night', () => {
    const day = daylight({ elevation: 45, azimuth: 180 }, false);
    const night = daylight({ elevation: -30, azimuth: 0 }, false);
    expect(day.night).toBe(0);
    expect(night.night).toBe(1);
    expect(day.light.intensity).toBeGreaterThan(2);
    expect(night.light.intensity).toBeLessThan(0.6);
    expect(night.light.color).toBe('#9db2ff');
    // Indoors the office lights stay on.
    expect(daylight({ elevation: -30, azimuth: 0 }, true).hemisphere.intensity).toBe(1.5);
  });
});
