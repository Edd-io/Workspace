import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { useTimeline } from '../features/timeline/TimelinePanel';
import { drawTimeline, timelineRows, type TimelineStyle } from '../features/timeline/timelineCanvas';
import { sortedRooms, useOffice } from '../state/officeStore';
import { masterTvPose } from './decor';
import type { RoomRect } from './layout';

const WIDTH = 1280;
const HEIGHT = 720;
const TV_STYLE: TimelineStyle = {
  background: '#0f141b',
  text: '#e6edf3',
  muted: '#8b949e',
  grid: 'rgba(255,255,255,0.1)',
  font: 'Inter, sans-serif',
  rowHeight: 40,
  labelWidth: 230,
  padding: 28,
};

/** Wall TV of the master office showing today's timeline; opens the timeline panel. */
export function TimelineTV({ room }: { room: RoomRect }) {
  const { t, i18n } = useTranslation();
  const timeline = useTimeline(4, 60_000);
  const rooms = useOffice((state) => state.rooms);
  const desks = useOffice((state) => state.desks);
  const setPanel = useOffice((state) => state.setPanel);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.anisotropy = 8;
    return result;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  useEffect(() => {
    const context = (texture.image as HTMLCanvasElement).getContext('2d')!;
    if (!timeline) return;
    const rows = timelineRows(sortedRooms(rooms), desks, timeline, {
      ...TV_STYLE,
      padding: TV_STYLE.padding + 34,
    });
    drawTimeline(context, timeline, rows, WIDTH, HEIGHT, TV_STYLE, i18n.resolvedLanguage ?? 'en');
    context.fillStyle = TV_STYLE.text;
    context.font = `600 30px ${TV_STYLE.font}`;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText(t('timeline.title'), TV_STYLE.padding, HEIGHT - 50);
    texture.needsUpdate = true;
  }, [timeline, rooms, desks, texture, t, i18n.resolvedLanguage]);

  const pose = masterTvPose(room);
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    setPanel({ kind: 'timeline' });
  };
  return (
    <group position={pose.position} rotation={[0, pose.rotation, 0]}>
      <mesh
        position={[0, 0.42, 0.028]}
        onClick={onClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
        userData={{ panel: 'timeline' }}
      >
        <planeGeometry args={[1.39, 0.78]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}
