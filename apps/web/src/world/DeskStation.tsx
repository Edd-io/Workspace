import { Billboard, Text } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { DESK_STATE_COLORS, type DeskState } from '@workspace/shared';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { deskTopic } from '../lib/desk';
import { useOffice } from '../state/officeStore';
import { appearanceFromSeed } from './appearance';
import { CHAIR, SCREEN_CENTER, STATUS_LAMP } from './decor';
import { FONT_TEXT_BOLD } from './fonts';
import type { DeskLayout } from './layout';
import { usePreviewTexture } from './usePreviewTexture';

const SCREEN_WIDTH = 0.6;
const SCREEN_HEIGHT = 0.341;

/** How the status lamp animates for each state. */
function lampIntensity(state: DeskState, time: number): number {
  switch (state) {
    case 'working':
      return 1.8 + Math.sin(time * 4) * 0.9;
    case 'question':
      return Math.sin(time * 6) > 0 ? 3.2 : 0.3;
    case 'starting':
      return Math.sin(time * 2) > 0 ? 1.5 : 0.4;
    case 'offline':
      return 0.05;
    default:
      return 1.6;
  }
}

/**
 * The living part of a workstation (the furniture itself is instanced): live screen, status lamp,
 * character, name tag and the invisible hitbox that makes the desk clickable.
 */
export function DeskStation({ layout, showLabel }: { layout: DeskLayout; showLabel: boolean }) {
  const { t } = useTranslation();
  // The layout is only rebuilt on structural changes: read the live desk from the store.
  const desk = useOffice((state) => state.desks[layout.desk.id]) ?? layout.desk;
  const openTerminal = useOffice((state) => state.openTerminal);
  const [hovered, setHovered] = useState(false);
  const lampMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const appearance = useMemo(() => appearanceFromSeed(desk.appearanceSeed), [desk.appearanceSeed]);
  const stateColor = DESK_STATE_COLORS[desk.state];
  const live = desk.state !== 'offline';
  const topic = deskTopic(desk);

  const screenMessage = useMemo(
    () => ({ title: desk.name, subtitle: t(`states.${desk.state}`), color: stateColor }),
    [desk.name, desk.state, stateColor, t],
  );
  const screen = usePreviewTexture(desk.id, live, screenMessage);

  useFrame(({ clock }) => {
    const material = lampMaterial.current;
    if (material) material.emissiveIntensity = lampIntensity(desk.state, clock.elapsedTime);
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    openTerminal(desk.id);
  };

  return (
    <group position={[layout.x, 0, layout.z]} rotation={[0, layout.rotation, 0]}>
      {/* Hitbox around desk and chair (never drawn, only raycast). */}
      <mesh
        position={[0, 0.7, 0.3]}
        onClick={onClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = '';
        }}
        userData={{ deskId: desk.id }}
      >
        <boxGeometry args={[1.7, 1.4, 1.9]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>

      <mesh position={SCREEN_CENTER}>
        <planeGeometry args={[SCREEN_WIDTH, SCREEN_HEIGHT]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>

      <group position={STATUS_LAMP}>
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.045, 0.1, 16]} />
          <meshStandardMaterial color="#2b3038" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.14, 0]}>
          <sphereGeometry args={[0.055, 20, 16]} />
          <meshStandardMaterial
            ref={lampMaterial}
            color={stateColor}
            emissive={stateColor}
            emissiveIntensity={1.5}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Placeholder character (replaced by the Blender character in Phase 5). */}
      {live && (
        <group position={[CHAIR[0], 0, CHAIR[2] + 0.03]}>
          <mesh position={[0, 0.8, 0]} castShadow>
            <capsuleGeometry args={[0.19, 0.34, 6, 12]} />
            <meshStandardMaterial color={appearance.shirt} roughness={0.8} />
          </mesh>
          <mesh position={[0, 1.3, -0.04]} castShadow>
            <sphereGeometry args={[0.14, 20, 16]} />
            <meshStandardMaterial color={appearance.skin} roughness={0.7} />
          </mesh>
          <mesh position={[0, 1.37, 0]} castShadow>
            <sphereGeometry args={[0.145, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={appearance.hair} roughness={0.9} />
          </mesh>
        </group>
      )}

      {(showLabel || hovered) && (
        <Billboard position={[0, 1.9, 0.35]}>
          <Text
            font={FONT_TEXT_BOLD}
            fontSize={0.15}
            color="#f0f3f6"
            outlineWidth={0.012}
            outlineColor="#0d1117"
            anchorY="bottom"
          >
            {desk.name}
          </Text>
          {topic && (
            <Text
              font={FONT_TEXT_BOLD}
              fontSize={0.085}
              color="#c8d0da"
              outlineWidth={0.008}
              outlineColor="#0d1117"
              anchorY="top"
              position={[0, -0.02, 0]}
              maxWidth={2}
              textAlign="center"
            >
              {topic}
            </Text>
          )}
        </Billboard>
      )}
    </group>
  );
}
