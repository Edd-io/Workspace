import { Text } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOffice } from '../state/officeStore';
import { FONT_TEXT_BOLD } from './fonts';
import type { RoomLayout } from './layout';

const WALL_HEIGHT = 1.2;
const WALL_THICKNESS = 0.12;
const DOOR_WIDTH = 1.4;
const WALL_COLOR = '#d9d4cc';

function Wall({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={WALL_COLOR} roughness={0.9} />
    </mesh>
  );
}

export function RoomView({ layout }: { layout: RoomLayout }) {
  const { t } = useTranslation();
  const setPanel = useOffice((state) => state.setPanel);
  const [hoverSlot, setHoverSlot] = useState(false);
  const { room, x, z, width, depth, towardCorridor, nextSlot } = layout;
  const frontZ = z + (depth / 2) * towardCorridor;
  const backZ = z - (depth / 2) * towardCorridor;
  const sideLength = (width - DOOR_WIDTH) / 2;

  const addDesk = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    setPanel({ kind: 'createDesk', roomId: room.id });
  };

  return (
    <group>
      {/* Floor with the room's accent color as a border */}
      <mesh position={[x, 0.005, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={room.accentColor} roughness={0.95} />
      </mesh>
      <mesh position={[x, 0.01, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width - 0.3, depth - 0.3]} />
        <meshStandardMaterial color="#8f877c" roughness={0.95} />
      </mesh>

      {/* Walls: back, sides, and the corridor side with a door */}
      <Wall position={[x, WALL_HEIGHT / 2, backZ]} size={[width, WALL_HEIGHT, WALL_THICKNESS]} />
      <Wall position={[x - width / 2, WALL_HEIGHT / 2, z]} size={[WALL_THICKNESS, WALL_HEIGHT, depth]} />
      <Wall position={[x + width / 2, WALL_HEIGHT / 2, z]} size={[WALL_THICKNESS, WALL_HEIGHT, depth]} />
      <Wall
        position={[x - width / 2 + sideLength / 2, WALL_HEIGHT / 2, frontZ]}
        size={[sideLength, WALL_HEIGHT, WALL_THICKNESS]}
      />
      <Wall
        position={[x + width / 2 - sideLength / 2, WALL_HEIGHT / 2, frontZ]}
        size={[sideLength, WALL_HEIGHT, WALL_THICKNESS]}
      />

      {/* Room name painted on the corridor floor, in front of the door */}
      <Text
        font={FONT_TEXT_BOLD}
        position={[x, 0.02, frontZ + towardCorridor * 0.7]}
        rotation={[-Math.PI / 2, 0, towardCorridor === 1 ? 0 : Math.PI]}
        fontSize={0.42}
        color={room.accentColor}
        anchorX="center"
        anchorY="middle"
        maxWidth={width - 0.5}
      >
        {room.name}
      </Text>

      {/* "Add a desk" placeholder in the next free slot */}
      <group
        position={[nextSlot.x, 0, nextSlot.z]}
        rotation={[0, nextSlot.rotation, 0]}
        onClick={addDesk}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHoverSlot(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHoverSlot(false);
          document.body.style.cursor = '';
        }}
      >
        <mesh position={[0, 0.37, 0]}>
          <boxGeometry args={[1.5, 0.74, 0.75]} />
          <meshStandardMaterial
            color="#ffffff"
            transparent
            opacity={hoverSlot ? 0.35 : 0.12}
            depthWrite={false}
          />
        </mesh>
        <Text
          font={FONT_TEXT_BOLD}
          position={[0, 0.76, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.14}
          color="#ffffff"
          fillOpacity={hoverSlot ? 1 : 0.6}
          anchorX="center"
          anchorY="middle"
        >
          {t('world.addDesk')}
        </Text>
      </group>
    </group>
  );
}
