import type { ThreeEvent } from '@react-three/fiber';
import type { Desk, RoomBoard } from '@workspace/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { useOffice } from '../state/officeStore';
import { drawWhiteboard, WHITEBOARD_HEIGHT, WHITEBOARD_WIDTH } from './whiteboardCanvas';

const BOARD_WIDTH = 1.8;
const BOARD_HEIGHT = (BOARD_WIDTH * WHITEBOARD_HEIGHT) / WHITEBOARD_WIDTH;
const BOARD_BOTTOM = 0.8;
const FRAME = '#c9ced6';

interface Props {
  roomId: string;
  roomName: string;
  board: RoomBoard | undefined;
  desks: Desk[];
  position: [number, number, number];
  rotation: number;
}

/** Mobile whiteboard showing the room board; clicking it opens the board panel. */
export function Whiteboard({ roomId, roomName, board, desks, position, rotation }: Props) {
  const { t, i18n } = useTranslation();
  const setPanel = useOffice((state) => state.setPanel);
  const [hovered, setHovered] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = WHITEBOARD_WIDTH;
    canvas.height = WHITEBOARD_HEIGHT;
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.anisotropy = 8;
    return result;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([document.fonts.load('700 34px Caveat'), document.fonts.load('500 27px Caveat')]).then(
      () => {
        if (!cancelled) setFontsReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    drawWhiteboard(texture.image as HTMLCanvasElement, board, desks, {
      title: t('whiteboard.title', { room: roomName }),
      whoDoesWhat: t('whiteboard.whoDoesWhat'),
      notes: t('whiteboard.notes'),
      messages: t('whiteboard.messages'),
      nobody: t('whiteboard.nobody'),
      noNotes: t('whiteboard.noNotes'),
      human: t('whiteboard.human'),
      room: t('whiteboard.room'),
    });
    texture.needsUpdate = true;
  }, [board, desks, roomName, fontsReady, texture, t, i18n.resolvedLanguage]);

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    setPanel({ kind: 'board', roomId });
  };

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <group
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
      >
        <mesh position={[0, BOARD_BOTTOM + BOARD_HEIGHT / 2, 0]} castShadow>
          <boxGeometry args={[BOARD_WIDTH + 0.06, BOARD_HEIGHT + 0.06, 0.04]} />
          <meshStandardMaterial color={hovered ? '#e3e7ec' : FRAME} metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[0, BOARD_BOTTOM + BOARD_HEIGHT / 2, 0.021]} userData={{ boardRoomId: roomId }}>
          <planeGeometry args={[BOARD_WIDTH, BOARD_HEIGHT]} />
          <meshStandardMaterial map={texture} roughness={0.35} />
        </mesh>
        {/* Marker tray */}
        <mesh position={[0, BOARD_BOTTOM - 0.02, 0.06]}>
          <boxGeometry args={[BOARD_WIDTH * 0.6, 0.02, 0.08]} />
          <meshStandardMaterial color={FRAME} />
        </mesh>
        {['#1f4e9c', '#c0392b', '#1e7a46'].map((color, index) => (
          <mesh
            key={color}
            position={[-0.2 + index * 0.12, BOARD_BOTTOM + 0.005, 0.07]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.012, 0.012, 0.11, 8]} />
            <meshStandardMaterial color={color} />
          </mesh>
        ))}
      </group>
      {/* Legs on wheels */}
      {[-BOARD_WIDTH / 2 + 0.05, BOARD_WIDTH / 2 - 0.05].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, (BOARD_BOTTOM + BOARD_HEIGHT) / 2, -0.03]} castShadow>
            <cylinderGeometry args={[0.018, 0.018, BOARD_BOTTOM + BOARD_HEIGHT, 8]} />
            <meshStandardMaterial color="#9aa1ab" metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.04, -0.03]} castShadow>
            <boxGeometry args={[0.06, 0.03, 0.5]} />
            <meshStandardMaterial color="#9aa1ab" metalness={0.5} roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
