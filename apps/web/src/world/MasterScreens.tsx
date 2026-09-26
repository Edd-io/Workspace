import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { DESK_STATE_COLORS, type Desk, type OfficeSummary } from '@workspace/shared';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { drawOfficeMap, mapTransform, useMapLabels } from '../features/hud/Minimap';
import { drawUsageBadge } from '../features/usage/usage';
import { stripMarkdown } from '../lib/markdown';
import { formatRelative } from '../lib/time';
import { attentionDesks, useOffice, type Panel } from '../state/officeStore';
import { DESK_TOP, MASTER_MONITORS, masterDeskPose } from './decor';
import { deskToWorld, type OfficeLayout, type RoomRect } from './layout';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from './previewCanvas';

const SCREEN: [number, number, number] = [0, 0.338, 0.0215];
const BACKGROUND = '#0f141b';
const TEXT = '#e6edf3';
const MUTED = '#8b949e';
const FONT = 'Inter, sans-serif';

type ScreenKind = 'map' | 'summary' | 'inbox';

function useCanvasTexture(): THREE.CanvasTexture {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.anisotropy = 4;
    return result;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function wrapLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (context.measureText(candidate).width > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

function header(context: CanvasRenderingContext2D, title: string, subtitle: string): void {
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  context.fillStyle = TEXT;
  context.font = `600 30px ${FONT}`;
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillText(title, 28, 22);
  context.fillStyle = MUTED;
  context.font = `400 18px ${FONT}`;
  context.fillText(subtitle, 28, 60);
}

function drawSummary(
  canvas: HTMLCanvasElement,
  summary: OfficeSummary | null,
  labels: Record<string, string>,
) {
  const context = canvas.getContext('2d')!;
  const subtitle =
    summary?.status === 'generating'
      ? labels.generating!
      : summary?.generatedAt
        ? labels.generatedAt!
        : labels.none!;
  header(context, labels.title!, subtitle);
  if (!summary?.text) return;
  context.fillStyle = TEXT;
  context.font = `400 19px ${FONT}`;
  const lines = wrapLines(context, stripMarkdown(summary.text), PREVIEW_WIDTH - 56);
  const maxLines = Math.floor((PREVIEW_HEIGHT - 110) / 25);
  lines.slice(0, maxLines).forEach((line, index) => context.fillText(line, 28, 100 + index * 25));
  if (lines.length > maxLines) {
    context.fillStyle = MUTED;
    context.fillText('…', 28, 100 + maxLines * 25 - 8);
  }
}

function drawInbox(
  canvas: HTMLCanvasElement,
  desks: Desk[],
  labels: Record<string, string>,
  kinds: Record<string, string>,
) {
  const context = canvas.getContext('2d')!;
  header(context, labels.title!, desks.length === 0 ? labels.empty! : labels.count!);
  let y = 104;
  for (const desk of desks) {
    if (y > PREVIEW_HEIGHT - 60) break;
    context.fillStyle = DESK_STATE_COLORS[desk.state];
    context.beginPath();
    context.arc(40, y + 12, 9, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = TEXT;
    context.font = `600 22px ${FONT}`;
    context.fillText(desk.name, 60, y);
    if (desk.attention) {
      context.fillStyle = MUTED;
      context.font = `400 18px ${FONT}`;
      const kind = kinds[desk.attention.kind] ?? '';
      const text = wrapLines(context, `${kind} — ${desk.attention.text}`, PREVIEW_WIDTH - 90).slice(0, 2);
      text.forEach((line, index) => context.fillText(line, 60, y + 30 + index * 22));
      y += 30 + text.length * 22 + 16;
    } else {
      y += 46;
    }
  }
}

interface ScreenProps {
  kind: ScreenKind;
  position: [number, number, number];
  rotation: number;
  texture: THREE.Texture;
}

function Screen({ kind, position, rotation, texture }: ScreenProps) {
  const setPanel = useOffice((state) => state.setPanel);
  const panel: Panel = { kind };
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    setPanel(panel);
  };
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh
        position={SCREEN}
        onClick={onClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
        userData={{ panel: kind }}
      >
        <planeGeometry args={[0.6, 0.341]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** The three monitors of the owner's desk: live map, Haiku summary and inbox. */
export function MasterScreens({ layout }: { layout: OfficeLayout }) {
  const { t, i18n } = useTranslation();
  const master = layout.rooms.find((room) => room.kind === 'master') as RoomRect | undefined;
  const summary = useOffice((state) => state.summary);
  const desks = useOffice((state) => state.desks);
  const waiting = useMemo(() => attentionDesks(desks), [desks]);
  const mapTexture = useCanvasTexture();
  const summaryTexture = useCanvasTexture();
  const inboxTexture = useCanvasTexture();
  const mapLabels = useMapLabels();
  const transform = useMemo(() => mapTransform(layout, PREVIEW_WIDTH, PREVIEW_HEIGHT), [layout]);
  const lastMapDraw = useRef(0);

  // Live map, redrawn a few times per second.
  useFrame(({ clock }) => {
    if (clock.elapsedTime - lastMapDraw.current < 0.25) return;
    lastMapDraw.current = clock.elapsedTime;
    const context = (mapTexture.image as HTMLCanvasElement).getContext('2d')!;
    drawOfficeMap(context, layout, transform, clock.elapsedTime, mapLabels, { background: '#20252c' });
    drawUsageBadge(
      context,
      useOffice.getState().usage,
      { title: t('usage.screen'), fiveHour: t('usage.fiveHourShort'), sevenDay: t('usage.sevenDayShort') },
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
    );
    mapTexture.needsUpdate = true;
  });

  useEffect(() => {
    const generatedAt = summary?.generatedAt
      ? formatRelative(summary.generatedAt, Date.now(), i18n.resolvedLanguage ?? 'en')
      : '';
    drawSummary(summaryTexture.image as HTMLCanvasElement, summary, {
      title: t('summary.title'),
      generating: t('summary.generating'),
      generatedAt: t('summary.screenGenerated', { ago: generatedAt }),
      none: t('summary.none'),
    });
    summaryTexture.needsUpdate = true;
  }, [summary, summaryTexture, t, i18n.resolvedLanguage]);

  useEffect(() => {
    drawInbox(
      inboxTexture.image as HTMLCanvasElement,
      waiting,
      {
        title: t('inbox.title'),
        empty: t('inbox.empty'),
        count: t('inbox.count', { count: waiting.length }),
      },
      Object.fromEntries(
        ['question', 'permission', 'plan', 'message', 'error', 'limit', 'trust'].map((kind) => [
          kind,
          t(`attention.${kind}`),
        ]),
      ),
    );
    inboxTexture.needsUpdate = true;
  }, [waiting, inboxTexture, t]);

  if (!master) return null;
  const pose = masterDeskPose(master);
  const textures: Record<ScreenKind, THREE.Texture> = {
    map: mapTexture,
    summary: summaryTexture,
    inbox: inboxTexture,
  };
  const kinds: ScreenKind[] = ['map', 'summary', 'inbox'];
  return (
    <group>
      {MASTER_MONITORS.map((monitor, index) => {
        const local: [number, number, number] = [monitor.x, DESK_TOP, -0.2 + Math.abs(monitor.angle) * 0.35];
        const kind = kinds[index]!;
        return (
          <Screen
            key={kind}
            kind={kind}
            position={deskToWorld(pose, local)}
            rotation={pose.rotation + monitor.angle}
            texture={textures[kind]}
          />
        );
      })}
    </group>
  );
}
