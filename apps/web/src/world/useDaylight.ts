import { useEffect, useMemo, useState } from 'react';
import { useOffice } from '../state/officeStore';
import { daylight, sunPosition, type Daylight } from './daylight';

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
