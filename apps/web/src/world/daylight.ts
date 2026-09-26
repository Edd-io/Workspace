import * as THREE from 'three';

/**
 * Day/night cycle following the viewer's local time. The sun course is a simple astronomical model
 * at a fixed latitude (the office has no geolocation): good enough for mornings, golden hours and
 * nights at the right times.
 *
 * Scene axes: north is −Z, east is +X, up is +Y.
 */

const LATITUDE_DEG = 46;
const DEG = Math.PI / 180;

export interface SunPosition {
  /** Degrees above the horizon (negative at night). */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000);
}

/** Summer time shift of the viewer's time zone at `date`, in hours. */
function daylightSavingShift(date: Date): number {
  const january = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const july = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return (Math.max(january, july) - date.getTimezoneOffset()) / 60;
}

export function sunPosition(date: Date, latitude = LATITUDE_DEG): SunPosition {
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear(date) + 10));
  // Solar noon at 12:00 standard time: the office does not know its longitude.
  const solarHour = date.getHours() + date.getMinutes() / 60 - daylightSavingShift(date);
  const hourAngle = 15 * (solarHour - 12);
  const phi = latitude * DEG;
  const delta = declination * DEG;
  const h = hourAngle * DEG;
  const elevation = Math.asin(
    Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(h),
  );
  const azimuth =
    Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi)) + Math.PI;
  return { elevation: elevation / DEG, azimuth: (((azimuth / DEG) % 360) + 360) % 360 };
}

/** Unit vector from the ground toward a point of the sky. */
export function skyDirection(elevation: number, azimuth: number): [number, number, number] {
  const e = elevation * DEG;
  const a = azimuth * DEG;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const mix = (a: string, b: string, t: number) =>
  `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

export interface Daylight {
  /** 0 in full daylight, 1 in the middle of the night. */
  night: number;
  /** Direction of the sky dome's sun (below the horizon at night: the sky turns dark). */
  skySun: [number, number, number];
  /** The shadow-casting light: the sun by day, the moon by night. */
  light: { direction: [number, number, number]; color: string; intensity: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  ambient: number;
  fog: string;
  /** Multiplies the colors of the outdoor surfaces: white by day, dark blue at night. */
  outdoorTint: string;
}

/** Moonlight comes from a fixed point of the southern sky. */
const MOON_DIRECTION = skyDirection(38, 200);

export function daylight(sun: SunPosition, indoors: boolean): Daylight {
  const { elevation, azimuth } = sun;
  const day = smoothstep(-7, 6, elevation);
  const night = 1 - day;
  const sunIntensity = 2.2 * smoothstep(-1, 12, elevation);
  const moonIntensity = 0.45 * (1 - smoothstep(-9, -2, elevation));
  // A sun grazing the horizon would stretch shadows across the whole map: keep it a bit higher.
  const sunDirection = skyDirection(Math.max(elevation, 9), azimuth);
  const light =
    sunIntensity >= moonIntensity
      ? {
          direction: sunDirection,
          color: mix('#ff9d5c', '#fff4e2', smoothstep(3, 25, elevation)),
          intensity: sunIntensity,
        }
      : { direction: MOON_DIRECTION, color: '#9db2ff', intensity: moonIntensity };
  return {
    night,
    skySun: skyDirection(elevation, azimuth),
    light,
    // Indoors the office lights are always on; from above, the night keeps the lit offices readable.
    hemisphere: indoors
      ? { sky: '#f6f1e8', ground: '#8a8478', intensity: 1.5 }
      : {
          sky: mix('#f6f1e8', '#ffe2b8', night),
          ground: mix('#8a8478', '#2c2a2e', night),
          intensity: 0.95 - 0.3 * night,
        },
    ambient: indoors ? 0.55 : 0.15 + 0.05 * night,
    fog: mix(mix('#cfd8e0', '#e8b890', smoothstep(12, 0, elevation) * day), '#0b1020', night),
    // Moonlit rather than black: everything outside (ground, trees, cars, neighbors) gets the same
    // tint, so nothing stands out of the night.
    // (The tint multiplies linear colors: #a3acbd keeps about a third of the daylight brightness.)
    outdoorTint: mix('#ffffff', '#a3acbd', night),
  };
}
