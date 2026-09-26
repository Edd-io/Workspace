import type { Timeline } from '@workspace/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/http';
import { sortedRooms, useOffice } from '../../state/officeStore';
import { Dialog } from '../hud/Dialog';
import {
  drawTimeline,
  hitTimeline,
  PANEL_STYLE,
  timelineHeight,
  timelineRows,
  type TimelineGeometry,
} from './timelineCanvas';

const RANGES = [1, 6, 12, 24] as const;
const WIDTH = 900;
const REFRESH_MS = 20_000;

export function useTimeline(hours: number, refreshMs = REFRESH_MS): Timeline | null {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<Timeline>('GET', `/api/timeline?hours=${hours}`)
        .then((next) => !cancelled && setTimeline(next))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hours, refreshMs]);
  return timeline;
}

/** The day of the office: every desk's states over time. */
export function TimelinePanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [hours, setHours] = useState<(typeof RANGES)[number]>(6);
  const timeline = useTimeline(hours);
  const rooms = useOffice((state) => state.rooms);
  const desks = useOffice((state) => state.desks);
  const openTerminal = useOffice((state) => state.openTerminal);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometry = useRef<TimelineGeometry | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const rows = timeline ? timelineRows(sortedRooms(rooms), desks, timeline, PANEL_STYLE) : [];
  const height = timelineHeight(rows, PANEL_STYLE);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !timeline) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = WIDTH * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d')!;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    geometry.current = drawTimeline(
      context,
      timeline,
      rows,
      WIDTH,
      height,
      PANEL_STYLE,
      i18n.resolvedLanguage ?? 'en',
    );
  }); // Redraw on every render: cheap, and keeps up with desk renames and states.

  const locate = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y, hit: geometry.current ? hitTimeline(geometry.current, x, y) : null };
  };

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y, hit } = locate(event);
    if (!hit || !timeline) {
      setHover(null);
      return;
    }
    const segment = timeline.desks
      .find((entry) => entry.deskId === hit.deskId)
      ?.segments.find((entry) => hit.ts >= entry.from && hit.ts <= entry.to);
    if (!segment) {
      setHover(null);
      return;
    }
    const format = new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: '2-digit', minute: '2-digit' });
    const minutes = Math.max(1, Math.round((segment.to - segment.from) / 60000));
    setHover({
      x,
      y,
      text: t('timeline.tooltip', {
        desk: desks[hit.deskId]?.name ?? '',
        state: t(`states.${segment.state}`),
        from: format.format(segment.from),
        to: format.format(segment.to),
        minutes,
      }),
    });
  };

  return (
    <Dialog title={t('timeline.title')} onClose={onClose} wide>
      <div className="timeline">
        <div className="timeline__toolbar">
          <div className="segmented" role="group" aria-label={t('timeline.range')}>
            {RANGES.map((range) => (
              <button
                key={range}
                className={`segmented__item${hours === range ? ' segmented__item--active' : ''}`}
                onClick={() => setHours(range)}
              >
                {t('timeline.hours', { count: range })}
              </button>
            ))}
          </div>
          <span className="muted">{t('timeline.hint')}</span>
        </div>
        <div className="timeline__canvas">
          {!timeline && <p className="muted">{t('app.loading')}</p>}
          {timeline && rows.length === 0 && <p className="muted">{t('timeline.empty')}</p>}
          <canvas
            ref={canvasRef}
            style={{ width: WIDTH, height, display: rows.length ? 'block' : 'none' }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            onClick={(event) => {
              const { hit } = locate(event);
              if (hit) openTerminal(hit.deskId);
            }}
          />
          {hover && (
            <div className="timeline__tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
              {hover.text}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
