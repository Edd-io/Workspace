import { ATTENTION_STATES, DESK_STATE_COLORS } from '@workspace/shared';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOffice } from '../../state/officeStore';
import type { OfficeLayout } from '../../world/layout';
import { playerPose } from '../../world/playerPose';
import { useOfficeLayout } from '../../world/useOfficeLayout';

const WIDTH = 260;
const PADDING = 10;

interface MapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  height: number;
}

function transformFor(layout: OfficeLayout): MapTransform {
  const { bounds } = layout;
  const scale = (WIDTH - PADDING * 2) / (bounds.x1 - bounds.x0);
  const height = Math.round((bounds.z1 - bounds.z0) * scale + PADDING * 2);
  return { scale, offsetX: PADDING - bounds.x0 * scale, offsetY: PADDING - bounds.z0 * scale, height };
}

/**
 * 2D plan of the office with live desk states. Clicking a desk opens it; clicking elsewhere moves
 * the view there. The same drawing is reused on the master room's map screen.
 */
export function drawOfficeMap(
  context: CanvasRenderingContext2D,
  layout: OfficeLayout,
  transform: MapTransform,
  time: number,
  labels: { master: string; lounge: string },
): void {
  const { scale, offsetX, offsetY } = transform;
  const px = (x: number) => offsetX + x * scale;
  const py = (z: number) => offsetY + z * scale;
  const { desks } = useOffice.getState();
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);

  context.fillStyle = '#c9c3b8';
  context.fillRect(
    px(layout.corridor.x0),
    py(-1.6),
    (layout.corridor.x1 - layout.corridor.x0) * scale,
    3.2 * scale,
  );
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
    context.fillStyle = 'rgba(15, 18, 22, 0.8)';
    context.font = `600 ${Math.max(9, Math.min(12, scale * 1.4))}px Inter, sans-serif`;
    context.textAlign = 'center';
    context.fillText(
      name,
      px((room.x0 + room.x1) / 2),
      py(room.side === 'north' ? room.z0 : room.z1) + (room.side === 'north' ? 12 : -5),
      (room.x1 - room.x0) * scale - 6,
    );
  }

  context.strokeStyle = '#2b2f36';
  context.lineWidth = 1.5;
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

  // Viewer: position and heading.
  const x = px(playerPose.x);
  const y = py(playerPose.z);
  const heading = -playerPose.yaw - Math.PI / 2;
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#111';
  context.beginPath();
  context.moveTo(x + Math.cos(heading) * 8, y + Math.sin(heading) * 8);
  context.lineTo(x + Math.cos(heading + 2.5) * 6, y + Math.sin(heading + 2.5) * 6);
  context.lineTo(x + Math.cos(heading - 2.5) * 6, y + Math.sin(heading - 2.5) * 6);
  context.closePath();
  context.fill();
  context.stroke();
}

export function Minimap() {
  const { t } = useTranslation();
  const layout = useOfficeLayout();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transform = transformFor(layout);
  const labels = { master: t('world.masterRoom'), lounge: t('world.lounge') };
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = WIDTH * ratio;
    canvas.height = transform.height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    let frame = 0;
    const loop = (time: number) => {
      drawOfficeMap(context, layout, transform, time / 1000, labelsRef.current);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [layout, transform.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const x = (mx - transform.offsetX) / transform.scale;
    const z = (my - transform.offsetY) / transform.scale;
    const state = useOffice.getState();
    const hit = layout.desks.find((entry) => Math.hypot(entry.x - x, entry.z - z) < 0.9);
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
  };

  return (
    <div className="minimap panel">
      <canvas
        ref={canvasRef}
        className="minimap__canvas"
        style={{ width: WIDTH, height: transform.height }}
        onClick={onClick}
        aria-label={t('hud.minimap')}
        role="img"
      />
    </div>
  );
}
