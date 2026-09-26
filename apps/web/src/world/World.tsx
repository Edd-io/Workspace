import { Sky } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useMemo } from 'react';
import { desksOfRoom, useOffice } from '../state/officeStore';
import { CameraRig } from './CameraRig';
import type { PropPlacement } from './decor';
import { DeskStation } from './DeskStation';
import { MasterScreens } from './MasterScreens';
import { Soundscape } from './Soundscape';
import { TimelineTV } from './TimelineTV';
import { PropInstances } from './props/PropInstances';
import { RoomView } from './RoomView';
import { Structure } from './structure/Structure';
import { useOfficeLayout, useOfficeProps } from './useOfficeLayout';
import { WalkControls } from './WalkControls';
import { Whiteboard } from './Whiteboard';

/** Props hanging above the cut walls of the overview would float in the air: hide them there. */
const HIDDEN_IN_CUTAWAY = new Set<PropPlacement['model']>([
  'ceiling_light',
  'wall_clock',
  'poster_a',
  'poster_b',
  'poster_c',
  'wall_shelf',
  'door',
]);

export function World() {
  const layout = useOfficeLayout();
  const props = useOfficeProps();
  const desks = useOffice((state) => state.desks);
  const boards = useOffice((state) => state.boards);
  const viewMode = useOffice((state) => state.viewMode);
  const focusDesk = useOffice((state) => state.focusDesk);
  const walking = viewMode === 'walk';
  const visibleProps = useMemo(
    () => (walking ? props : props.filter((prop) => !HIDDEN_IN_CUTAWAY.has(prop.model))),
    [props, walking],
  );
  const { bounds } = layout;
  const centerX = (bounds.x0 + bounds.x1) / 2;
  const sunTarget: [number, number, number] = [centerX, 0, 0];

  return (
    <Canvas
      className="world"
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 50, near: 0.05, far: 600, position: [10, 20, 20] }}
      onPointerMissed={() => {
        if (!walking) focusDesk(null);
      }}
    >
      <Sky distance={450} sunPosition={[60, 45, 80]} turbidity={6} rayleigh={1.2} mieCoefficient={0.004} />
      <fog attach="fog" args={['#cfd8e0', 60, 260]} />
      {/* Indoors (walk mode) the ceiling blocks the sun: ambient light stands in for the ceiling lights. */}
      <hemisphereLight args={['#f6f1e8', '#8a8478', walking ? 1.5 : 0.95]} />
      <ambientLight intensity={walking ? 0.55 : 0.15} />
      <directionalLight
        position={[centerX + 18, 30, 22]}
        target-position={sunTarget}
        intensity={2.2}
        color="#fff4e2"
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-(bounds.x1 - bounds.x0) / 2 - 10}
        shadow-camera-right={(bounds.x1 - bounds.x0) / 2 + 10}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-far={120}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />

      <Suspense fallback={null}>
        <Structure layout={layout} cutaway={!walking} />
        <PropInstances placements={visibleProps} />
      </Suspense>

      {layout.rooms.map((room) => (
        <RoomView key={`${room.kind}-${room.side}-${room.x0}`} layout={room} />
      ))}
      {layout.projectRooms.map((room) => (
        <Whiteboard
          key={room.room.id}
          roomId={room.room.id}
          roomName={room.room.name}
          board={boards[room.room.id]}
          desks={desksOfRoom(desks, room.room.id)}
          position={[room.whiteboard.x, 0, room.whiteboard.z]}
          rotation={room.whiteboard.rotation}
        />
      ))}
      {layout.desks.map((desk) => (
        <DeskStation key={desk.desk.id} layout={desk} showLabel={!walking} />
      ))}
      <MasterScreens layout={layout} />
      {layout.rooms
        .filter((room) => room.kind === 'master')
        .map((room) => (
          <TimelineTV key="timeline-tv" room={room} />
        ))}

      {walking ? <WalkControls layout={layout} props={props} /> : <CameraRig layout={layout} />}
      <Soundscape layout={layout} />
    </Canvas>
  );
}
