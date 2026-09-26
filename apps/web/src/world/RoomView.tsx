import { Billboard, Text } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOffice } from '../state/officeStore';
import { FONT_TEXT_BOLD } from './fonts';
import type { RoomLayout } from './layout';

function useHoverCursor() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    handlers: {
      onPointerOver: (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      },
      onPointerOut: () => {
        setHovered(false);
        document.body.style.cursor = '';
      },
    },
  };
}

/** Names painted on the corridor floor, plus the clickable "add desk" / "new room" placeholders. */
export function RoomView({ layout }: { layout: RoomLayout }) {
  const { t } = useTranslation();
  const setPanel = useOffice((state) => state.setPanel);
  const slot = useHoverCursor();
  const newRoom = useHoverCursor();
  const toward = layout.towardCorridor;
  const frontZ = toward === 1 ? layout.z1 : layout.z0;
  const cx = (layout.x0 + layout.x1) / 2;
  const cz = (layout.z0 + layout.z1) / 2;
  // Floor labels face the overview camera (south of the building) whatever the room side.
  const labelRotation: [number, number, number] = [-Math.PI / 2, 0, 0];

  const name =
    layout.kind === 'project'
      ? layout.room.name
      : layout.kind === 'master'
        ? t('world.masterRoom')
        : layout.kind === 'lounge'
          ? t('world.lounge')
          : null;
  const color = layout.kind === 'project' ? layout.room.accentColor : '#d9d3c7';

  return (
    <group>
      {name && (
        <Text
          font={FONT_TEXT_BOLD}
          position={[layout.x0 + 1.5, 0.012, frontZ + toward * 0.55]}
          rotation={labelRotation}
          fontSize={0.34}
          color={color}
          anchorX="left"
          anchorY="middle"
          maxWidth={layout.x1 - layout.x0 - 1.8}
        >
          {name}
        </Text>
      )}

      {layout.kind === 'project' && (
        <group
          position={[layout.nextSlot.x, 0, layout.nextSlot.z]}
          rotation={[0, layout.nextSlot.rotation, 0]}
          onClick={(event) => {
            event.stopPropagation();
            setPanel({ kind: 'createDesk', roomId: layout.room.id });
          }}
          {...slot.handlers}
        >
          <mesh position={[0, 0.37, 0]}>
            <boxGeometry args={[1.5, 0.74, 0.75]} />
            <meshStandardMaterial
              color="#ffffff"
              transparent
              opacity={slot.hovered ? 0.35 : 0.12}
              depthWrite={false}
            />
          </mesh>
          {/* A sign facing the camera: text lying on the desk would read mirrored from behind. */}
          <Billboard position={[0, 1.02, 0]}>
            <Text
              font={FONT_TEXT_BOLD}
              fontSize={0.14}
              color="#ffffff"
              fillOpacity={slot.hovered ? 1 : 0.75}
              outlineWidth={0.008}
              outlineColor="#1b1f24"
              outlineOpacity={0.35}
              anchorX="center"
              anchorY="middle"
            >
              {t('world.addDesk')}
            </Text>
          </Billboard>
        </group>
      )}

      {layout.kind === 'placeholder' && (
        <group
          onClick={(event) => {
            event.stopPropagation();
            setPanel({ kind: 'createRoom' });
          }}
          {...newRoom.handlers}
        >
          <mesh position={[cx, 0.01, cz]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[layout.x1 - layout.x0 - 1, layout.z1 - layout.z0 - 1]} />
            <meshStandardMaterial
              color="#ffffff"
              transparent
              opacity={newRoom.hovered ? 0.18 : 0.06}
              depthWrite={false}
            />
          </mesh>
          <Text
            font={FONT_TEXT_BOLD}
            position={[cx, 0.02, cz]}
            rotation={labelRotation}
            fontSize={0.5}
            color="#ffffff"
            fillOpacity={newRoom.hovered ? 1 : 0.65}
            anchorX="center"
            anchorY="middle"
          >
            {t('world.newRoom')}
          </Text>
        </group>
      )}
    </group>
  );
}
