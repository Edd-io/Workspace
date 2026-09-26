import { useEffect, useMemo, useState } from 'react';
import { useOffice } from '../state/officeStore';
import { daylight, sunPosition, type Daylight } from './daylight';
import { CORRIDOR_HALF_WIDTH, type OfficeLayout } from './layout';
import { playerPose } from './playerPose';

/** Lighting of the current minute of the viewer's day (or of the hour forced in development). */
export function useDaylight(indoors: boolean): Daylight {
  const override = useOffice((state) => state.clockOverride);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return useMemo(() => {
    const date = new Date(now);
    if (override !== null) date.setHours(Math.floor(override), Math.round((override % 1) * 60), 0, 0);
    return daylight(sunPosition(date), indoors);
  }, [now, override, indoors]);
}

/** Whether a walking viewer is inside the building (its lights then light the scene). */
export function useViewerIndoors(layout: OfficeLayout, walking: boolean): boolean {
  const [indoors, setIndoors] = useState(true);
  useEffect(() => {
    if (!walking) return;
    const rects = [
      ...layout.rooms,
      { x0: layout.corridor.x0, x1: layout.corridor.x1, z0: -CORRIDOR_HALF_WIDTH, z1: CORRIDOR_HALF_WIDTH },
    ];
    const check = () => {
      const { x, z } = playerPose;
      setIndoors(
        rects.some(
          (rect) => x > rect.x0 - 0.1 && x < rect.x1 + 0.1 && z > rect.z0 - 0.1 && z < rect.z1 + 0.1,
        ),
      );
    };
    check();
    const timer = window.setInterval(check, 400);
    return () => window.clearInterval(timer);
  }, [layout, walking]);
  return walking && indoors;
}
