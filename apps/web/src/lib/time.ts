import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** "5 min ago" / "il y a 5 min", refreshed every 30 s. */
export function useRelativeTime(timestamp: number | null): string {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (timestamp === null) return '';
  return formatRelative(timestamp, now, i18n.resolvedLanguage ?? 'en');
}

export function formatRelative(timestamp: number, now: number, language: string): string {
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  const seconds = Math.round((timestamp - now) / 1000);
  if (Math.abs(seconds) < 60) return format.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}
