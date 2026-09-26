import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useOffice } from '../state/officeStore';
import { daylight, sunPosition, type Daylight } from './daylight';
import { CORRIDOR_HALF_WIDTH, type OfficeLayout } from './layout';
import { playerPose } from './playerPose';

/**
 * Lighting of the current minute of the viewer's day (or of the hour forced in development), for
 * outdoors and for indoors (the office lights on).
 */
export function useDaylight(): { outdoor: Daylight; indoor: Daylight } {
  const override = useOffice((state) => state.clockOverride);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return useMemo(() => {
    const date = new Date(now);
    if (override !== null) date.setHours(Math.floor(override), Math.round((override % 1) * 60), 0, 0);
    const sun = sunPosition(date);
    return { outdoor: daylight(sun, false), indoor: daylight(sun, true) };
  }, [now, override]);
}

/** Distance over which the lighting fades from indoors to outdoors when walking out (m). */
const FADE_DISTANCE = 4;

/**
 * Sky and fill lights. When walking, the office lights fade out progressively with the distance to
 * the building (and in time), instead of switching when crossing the door.
 */
export function AmbientLights({
  layout,
  walking,
  light,
}: {
  layout: OfficeLayout;
  walking: boolean;
  light: { outdoor: Daylight; indoor: Daylight };
}) {
  const hemisphere = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const blend = useRef(walking ? 1 : 0);
  const colors = useMemo(
    () => ({
      outdoorSky: new THREE.Color(light.outdoor.hemisphere.sky),
      outdoorGround: new THREE.Color(light.outdoor.hemisphere.ground),
      indoorSky: new THREE.Color(light.indoor.hemisphere.sky),
      indoorGround: new THREE.Color(light.indoor.hemisphere.ground),
    }),
    [light],
  );
  const rects = useMemo(
    () => [
      ...layout.rooms,
      { x0: layout.corridor.x0, x1: layout.corridor.x1, z0: -CORRIDOR_HALF_WIDTH, z1: CORRIDOR_HALF_WIDTH },
    ],
    [layout],
  );

  useFrame((_, delta) => {
    let target = 0;
    if (walking) {
      const { x, z } = playerPose;
      let distance = Infinity;
      for (const rect of rects) {
        const dx = Math.max(rect.x0 - x, 0, x - rect.x1);
        const dz = Math.max(rect.z0 - z, 0, z - rect.z1);
        distance = Math.min(distance, Math.hypot(dx, dz));
      }
      target = 1 - THREE.MathUtils.smoothstep(distance, 0, FADE_DISTANCE);
    }
    blend.current += (target - blend.current) * Math.min(1, delta * 2.5);
    const t = blend.current;
    if (hemisphere.current) {
      hemisphere.current.color.lerpColors(colors.outdoorSky, colors.indoorSky, t);
      hemisphere.current.groundColor.lerpColors(colors.outdoorGround, colors.indoorGround, t);
      hemisphere.current.intensity = THREE.MathUtils.lerp(
        light.outdoor.hemisphere.intensity,
        light.indoor.hemisphere.intensity,
        t,
      );
    }
    if (ambient.current) {
      ambient.current.intensity = THREE.MathUtils.lerp(light.outdoor.ambient, light.indoor.ambient, t);
    }
  });

  return (
    <>
      <hemisphereLight ref={hemisphere} />
      <ambientLight ref={ambient} />
    </>
  );
}
