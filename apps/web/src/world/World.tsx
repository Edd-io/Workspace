import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import { sortedRooms, useOffice } from '../state/officeStore';
import { CameraRig } from './CameraRig';
import { DeskStation } from './DeskStation';
import { computeLayout, CORRIDOR_HALF_WIDTH } from './layout';
import { RoomView } from './RoomView';

export function World() {
  const rooms = useOffice((state) => state.rooms);
  const desks = useOffice((state) => state.desks);
  const focusDesk = useOffice((state) => state.focusDesk);
  const layout = useMemo(() => computeLayout(sortedRooms(rooms), Object.values(desks)), [rooms, desks]);
  const corridorLength = layout.corridor.maxX - layout.corridor.minX;
  const corridorCenter = (layout.corridor.maxX + layout.corridor.minX) / 2;

  return (
    <Canvas
      className="world"
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 45, near: 0.05, far: 300, position: [10, 14, 14] }}
      onPointerMissed={() => focusDesk(null)}
    >
      <color attach="background" args={['#1a1d22']} />
      <fog attach="fog" args={['#1a1d22', 40, 120]} />
      <hemisphereLight args={['#f5efe6', '#3a3530', 0.9]} />
      <directionalLight
        position={[corridorCenter + 10, 25, 12]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-bias={-0.0004}
      />

      {/* Ground and corridor */}
      <mesh position={[corridorCenter, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[corridorLength + 60, 80]} />
        <meshStandardMaterial color="#2a2e34" roughness={1} />
      </mesh>
      <mesh position={[corridorCenter, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[corridorLength, CORRIDOR_HALF_WIDTH * 2]} />
        <meshStandardMaterial color="#b9b2a7" roughness={0.8} />
      </mesh>

      {layout.rooms.map((room) => (
        <RoomView key={room.room.id} layout={room} />
      ))}
      {layout.desks.map((desk) => (
        <DeskStation key={desk.desk.id} layout={desk} />
      ))}

      <CameraRig layout={layout} />
    </Canvas>
  );
}
