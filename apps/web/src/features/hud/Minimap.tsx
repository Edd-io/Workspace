import { ATTENTION_STATES, DESK_STATE_COLORS } from '@workspace/shared';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOffice } from '../../state/officeStore';
import type { OfficeLayout } from '../../world/layout';
import { playerPose } from '../../world/playerPose';
import { useOfficeLayout } from '../../world/useOfficeLayout';

const PADDING = 10;

export interface MapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** Fits the office plan in `width` (and `maxHeight` when given). */
export function mapTransform(layout: OfficeLayout, width: number, maxHeight?: number): MapTransform {
  const { bounds } = layout;
  const spanX = bounds.x1 - bounds.x0;
  const spanZ = bounds.z1 - bounds.z0;
  let scale = (width - PADDING * 2) / spanX;
  if (maxHeight !== undefined) scale = Math.min(scale, (maxHeight - PADDING * 2) / spanZ);
  const height = maxHeight ?? Math.round(spanZ * scale + PADDING * 2);
  return {
    scale,
    offsetX: (width - spanX * scale) / 2 - bounds.x0 * scale,
    offsetY: (height - spanZ * scale) / 2 - bounds.z0 * scale,
    width,
    height,
  };
}

export interface MapLabels {
  master: string;
  lounge: string;
}

/** Draws the office plan with live desk states and the viewer's position. */
export function drawOfficeMap(
  context: CanvasRenderingContext2D,
  layout: OfficeLayout,
  transform: MapTransform,
  time: number,
  labels: MapLabels,
  options: { background?: string; showViewer?: boolean } = {},
): void {
  const { scale, offsetX, offsetY } = transform;
  const px = (x: number) => offsetX + x * scale;
  const py = (z: number) => offsetY + z * scale;
  const { desks } = useOffice.getState();
  context.clearRect(0, 0, transform.width, transform.height);
  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, transform.width, transform.height);
  }

  context.fillStyle = '#c9c3b8';
  context.fillRect(
    px(layout.corridor.x0),
    py(-1.6),
    (layout.corridor.x1 - layout.corridor.x0) * scale,
    3.2 * scale,
  );
  const fontSize = Math.max(9, Math.min(16, scale * 1.2));
  for (const room of layout.rooms) {
    const fill =
      room.kind === 'project'
        ? room.room.accentColor
        : room.kind === 'master'
          ? '#9c7552'
          : room.kind === 'lounge'
            ? '#b88f66'
            : '#6f6c66';
    context.globalAlpha = room.kind === 'placeholder' ? 0.35 : 0.55;
    context.fillStyle = fill;
    context.fillRect(px(room.x0), py(room.z0), (room.x1 - room.x0) * scale, (room.z1 - room.z0) * scale);
    context.globalAlpha = 1;
    const name =
      room.kind === 'project'
        ? room.room.name
        : room.kind === 'master'
          ? labels.master
          : room.kind === 'lounge'
            ? labels.lounge
            : '+';
    context.fillStyle = 'rgba(15, 18, 22, 0.85)';
    context.font = `600 ${fontSize}px Inter, sans-serif`;
    context.textAlign = 'center';
    const labelY = room.side === 'north' ? py(room.z0) + fontSize + 3 : py(room.z1) - 5;
    context.fillText(name, px((room.x0 + room.x1) / 2), labelY, (room.x1 - room.x0) * scale - 6);
  }

  context.strokeStyle = '#2b2f36';
  context.lineWidth = Math.max(1.5, scale * 0.08);
  for (const wall of layout.walls) {
    context.beginPath();
    context.moveTo(px(wall.a[0]), py(wall.a[1]));
    context.lineTo(px(wall.b[0]), py(wall.b[1]));
    context.stroke();
  }

  for (const entry of layout.desks) {
    const desk = desks[entry.desk.id] ?? entry.desk;
    const blinkOff = ATTENTION_STATES.has(desk.state) && Math.sin(time * 6) < 0;
    context.beginPath();
    context.arc(px(entry.x), py(entry.z), Math.max(3.5, scale * 0.45), 0, Math.PI * 2);
    context.fillStyle = blinkOff ? '#ffffff' : DESK_STATE_COLORS[desk.state];
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(0,0,0,0.5)';
    context.stroke();
  }

  if (options.showViewer !== false) {
    const x = px(playerPose.x);
    const y = py(playerPose.z);
    const heading = -playerPose.yaw - Math.PI / 2;
    const size = Math.max(6, scale * 0.6);
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#111';
    context.beginPath();
    context.moveTo(x + Math.cos(heading) * size * 1.3, y + Math.sin(heading) * size * 1.3);
    context.lineTo(x + Math.cos(heading + 2.5) * size, y + Math.sin(heading + 2.5) * size);
    context.lineTo(x + Math.cos(heading - 2.5) * size, y + Math.sin(heading - 2.5) * size);
    context.closePath();
    context.fill();
    context.stroke();
  }
}

/** Handles a click on the map: desk → open or approach it, elsewhere → go there. */
export function navigateFromMap(layout: OfficeLayout, x: number, z: number, openDesks: boolean): void {
  const state = useOffice.getState();
  const hit = layout.desks.find((entry) => Math.hypot(entry.x - x, entry.z - z) < 0.9);
  if (hit && openDesks) {
    state.openTerminal(hit.desk.id);
    return;
  }
  if (hit) {
    if (state.viewMode === 'walk') {
      // Stand in the aisle just behind the chair, looking at the screen.
      const behind = 1.6;
      state.goTo(
        hit.x + Math.sin(hit.rotation) * behind,
        hit.z + Math.cos(hit.rotation) * behind,
        hit.rotation,
      );
    } else {
      state.focusDesk(hit.desk.id);
    }
    return;
  }
  state.goTo(x, z);
}

export function useMapLabels(): MapLabels {
  const { t } = useTranslation();
  return { master: t('world.masterRoom'), lounge: t('world.lounge') };
}

interface OfficeMapProps {
  width: number;
  /** Clicking a desk opens its terminal (instead of approaching it). */
  openDesks?: boolean;
  onNavigate?: () => void;
}

export function OfficeMap({ width, openDesks = false, onNavigate }: OfficeMapProps) {
  const { t } = useTranslation();
  const layout = useOfficeLayout();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transform = mapTransform(layout, width);
  const labels = useMapLabels();
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = transform.width * ratio;
    canvas.height = transform.height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    let frame = 0;
    const loop = (time: number) => {
      drawOfficeMap(context, layout, transform, time / 1000, labelsRef.current);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [layout, transform.width, transform.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - transform.offsetX) / transform.scale;
    const z = (event.clientY - rect.top - transform.offsetY) / transform.scale;
    navigateFromMap(layout, x, z, openDesks);
    onNavigate?.();
  };

  return (
    <canvas
      ref={canvasRef}
      className="office-map"
      style={{ width: transform.width, height: transform.height }}
      onClick={onClick}
      aria-label={t('hud.minimap')}
      role="img"
    />
  );
}

export function Minimap() {
  return (
    <div className="minimap panel">
      <OfficeMap width={260} />
    </div>
  );
}
