import { Billboard, Text } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { DESK_STATE_COLORS, type DeskState } from '@workspace/shared';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { deskTopic } from '../lib/desk';
import { useOffice } from '../state/officeStore';
import { appearanceFromSeed } from './appearance';
import { FONT_TEXT_BOLD } from './fonts';
import type { DeskLayout } from './layout';
import { usePreviewTexture } from './usePreviewTexture';

const DESK_TOP_Y = 0.74;
const WOOD = '#b08968';
const METAL = '#3a3f47';

/** How the status lamp animates for each state. */
function lampIntensity(state: DeskState, time: number): number {
  switch (state) {
    case 'working':
      return 1.6 + Math.sin(time * 4) * 0.8;
    case 'question':
      return Math.sin(time * 6) > 0 ? 3 : 0.3;
    case 'starting':
      return Math.sin(time * 2) > 0 ? 1.5 : 0.4;
    case 'offline':
      return 0;
    default:
      return 1.5;
  }
}

export function DeskStation({ layout }: { layout: DeskLayout }) {
  const { t } = useTranslation();
  const { desk } = layout;
  const openTerminal = useOffice((state) => state.openTerminal);
  const [hovered, setHovered] = useState(false);
  const lampMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const appearance = useMemo(() => appearanceFromSeed(desk.appearanceSeed), [desk.appearanceSeed]);
  const stateColor = DESK_STATE_COLORS[desk.state];
  const live = desk.state !== 'offline';

  const screenMessage = useMemo(
    () => ({ title: desk.name, subtitle: t(`states.${desk.state}`), color: stateColor }),
    [desk.name, desk.state, stateColor, t],
  );
  const screen = usePreviewTexture(desk.id, live, screenMessage);

  useFrame(({ clock }) => {
    const material = lampMaterial.current;
    if (!material) return;
    material.emissiveIntensity = lampIntensity(desk.state, clock.elapsedTime);
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    openTerminal(desk.id);
  };
  const onOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setHovered(true);
    document.body.style.cursor = 'pointer';
  };
  const onOut = () => {
    setHovered(false);
    document.body.style.cursor = '';
  };

  return (
    <group position={[layout.x, 0, layout.z]} rotation={[0, layout.rotation, 0]}>
      <group onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
        {/* Desk */}
        <mesh position={[0, DESK_TOP_Y, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.05, 0.75]} />
          <meshStandardMaterial color={hovered ? '#c9a27e' : WOOD} roughness={0.7} />
        </mesh>
        {[-0.7, 0.7].map((x) => (
          <mesh key={x} position={[x, DESK_TOP_Y / 2, 0]} castShadow>
            <boxGeometry args={[0.05, DESK_TOP_Y, 0.7]} />
            <meshStandardMaterial color={METAL} roughness={0.5} metalness={0.4} />
          </mesh>
        ))}

        {/* Monitor */}
        <group position={[0, 0, -0.22]}>
          <mesh position={[0, DESK_TOP_Y + 0.12, -0.02]} castShadow>
            <boxGeometry args={[0.06, 0.24, 0.06]} />
            <meshStandardMaterial color={METAL} />
          </mesh>
          <mesh position={[0, DESK_TOP_Y + 0.02, -0.02]}>
            <boxGeometry args={[0.28, 0.02, 0.18]} />
            <meshStandardMaterial color={METAL} />
          </mesh>
          <mesh position={[0, 1.08, -0.03]} castShadow>
            <boxGeometry args={[0.78, 0.5, 0.035]} />
            <meshStandardMaterial color="#1b1f24" roughness={0.4} />
          </mesh>
          <mesh position={[0, 1.08, -0.011]}>
            <planeGeometry args={[0.74, 0.4625]} />
            <meshBasicMaterial map={screen} toneMapped={false} />
          </mesh>
        </group>

        {/* Keyboard */}
        <mesh position={[0, DESK_TOP_Y + 0.035, 0.12]} castShadow>
          <boxGeometry args={[0.45, 0.02, 0.15]} />
          <meshStandardMaterial color="#2b3038" />
        </mesh>

        {/* Status lamp */}
        <group position={[0.6, DESK_TOP_Y, -0.2]}>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.035, 0.05, 0.12, 16]} />
            <meshStandardMaterial color={METAL} />
          </mesh>
          <mesh position={[0, 0.16, 0]}>
            <sphereGeometry args={[0.06, 20, 16]} />
            <meshStandardMaterial
              ref={lampMaterial}
              color={stateColor}
              emissive={stateColor}
              emissiveIntensity={1.5}
              toneMapped={false}
            />
          </mesh>
        </group>

        {/* Chair + placeholder character (replaced by the Blender character in Phase 5) */}
        <group position={[0, 0, 0.75]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[0.5, 0.06, 0.5]} />
            <meshStandardMaterial color="#30343b" />
          </mesh>
          <mesh position={[0, 0.8, 0.23]} castShadow>
            <boxGeometry args={[0.48, 0.6, 0.05]} />
            <meshStandardMaterial color="#30343b" />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.44, 8]} />
            <meshStandardMaterial color={METAL} />
          </mesh>
          {live && (
            <group>
              <mesh position={[0, 0.82, 0.02]} castShadow>
                <capsuleGeometry args={[0.2, 0.36, 6, 12]} />
                <meshStandardMaterial color={appearance.shirt} roughness={0.8} />
              </mesh>
              <mesh position={[0, 1.33, -0.02]} castShadow>
                <sphereGeometry args={[0.15, 20, 16]} />
                <meshStandardMaterial color={appearance.skin} roughness={0.7} />
              </mesh>
              <mesh position={[0, 1.4, 0.02]} castShadow>
                <sphereGeometry args={[0.155, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color={appearance.hair} roughness={0.9} />
              </mesh>
            </group>
          )}
        </group>
      </group>

      {/* Name tag */}
      <Billboard position={[0, 1.85, 0.3]}>
        <Text
          font={FONT_TEXT_BOLD}
          fontSize={0.16}
          color="#f0f3f6"
          outlineWidth={0.012}
          outlineColor="#0d1117"
          anchorY="bottom"
        >
          {desk.name}
        </Text>
        {deskTopic(desk) && (
          <Text
            font={FONT_TEXT_BOLD}
            fontSize={0.09}
            color="#aab4c0"
            outlineWidth={0.008}
            outlineColor="#0d1117"
            anchorY="top"
            position={[0, -0.02, 0]}
            maxWidth={2}
            textAlign="center"
          >
            {deskTopic(desk)}
          </Text>
        )}
      </Billboard>
    </group>
  );
}
