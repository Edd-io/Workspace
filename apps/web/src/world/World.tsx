import { Sky, Stars } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { desksOfRoom, useOffice } from '../state/officeStore';
import { CameraRig } from './CameraRig';
import { CharacterLife } from './CharacterLife';
import { masterGallery, type PropPlacement } from './decor';
import type { Daylight } from './daylight';
import { FrameScheduler } from './FrameScheduler';
import { GRAPHICS_PROFILES, useGraphicsQuality } from './graphicsSettings';
import type { OfficeLayout } from './layout';
import { DeskStation } from './DeskStation';
import { MasterScreens } from './MasterScreens';
import { OutdoorScene } from './OutdoorScene';
import { Soundscape } from './Soundscape';
import { TimelineTV } from './TimelineTV';
import { PictureFrames } from './PictureFrames';
import { PropInstances } from './props/PropInstances';
import { RoomView } from './RoomView';
import { Structure } from './structure/Structure';
import { useOfficeLayout, useOfficeProps } from './useOfficeLayout';
import { AmbientLights, useDaylight } from './useDaylight';
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
  'tv_screen',
]);

/** Handle for automated browser checks during development (frame and draw-call counts). */
function DevHandles() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    (window as unknown as { __three?: unknown }).__three = { gl, scene, camera };
  }, [gl, scene, camera]);
  return null;
}

/** Sun (or moon) light; its shadow map is rebuilt when the graphics quality changes its size. */
function Sun({ layout, size, sky }: { layout: OfficeLayout; size: number; sky: Daylight['light'] }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const { bounds } = layout;
  const centerX = (bounds.x0 + bounds.x1) / 2;
  const [dx, dy, dz] = sky.direction;
  useEffect(() => {
    const shadow = light.current?.shadow;
    if (!shadow || shadow.mapSize.x === size) return;
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
  }, [size]);
  return (
    <directionalLight
      ref={light}
      position={[centerX + dx * 60, dy * 60, dz * 60]}
      target-position={[centerX, 0, 0]}
      intensity={sky.intensity}
      color={sky.color}
      castShadow
      shadow-mapSize={[size, size]}
      shadow-camera-left={-(bounds.x1 - bounds.x0) / 2 - 10}
      shadow-camera-right={(bounds.x1 - bounds.x0) / 2 + 10}
      shadow-camera-top={30}
      shadow-camera-bottom={-30}
      shadow-camera-far={120}
      shadow-bias={-0.0003}
      shadow-normalBias={0.02}
    />
  );
}

/**
 * Depth precision depends on the near plane: the overview camera stays meters away from everything,
 * so a larger near plane there keeps close surfaces (screens on monitors, boards on frames) from
 * z-fighting at a distance.
 */
function CameraClipping({ walking }: { walking: boolean }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.near = walking ? 0.05 : 0.2;
    camera.far = 400;
    camera.updateProjectionMatrix();
  }, [camera, walking]);
  return null;
}

export function World() {
  const layout = useOfficeLayout();
  const props = useOfficeProps();
  const desks = useOffice((state) => state.desks);
  const boards = useOffice((state) => state.boards);
  const viewMode = useOffice((state) => state.viewMode);
  const focusDesk = useOffice((state) => state.focusDesk);
  const walking = viewMode === 'walk';
  // Handle for automated browser checks during development.
  if (import.meta.env.DEV) (window as unknown as { __layout?: unknown }).__layout = layout;
  const visibleProps = useMemo(
    () => (walking ? props : props.filter((prop) => !HIDDEN_IN_CUTAWAY.has(prop.model))),
    [props, walking],
  );
  const frameSlots = useMemo(
    () => layout.rooms.filter((room) => room.kind === 'master').flatMap((room) => masterGallery(room)),
    [layout],
  );
  const profile = GRAPHICS_PROFILES[useGraphicsQuality()];
  const daylight = useDaylight();
  // Sky, sun, fog and outdoor tint do not depend on where the viewer stands: the outdoor values.
  const light = daylight.outdoor;
  const [sunX, sunY, sunZ] = light.skySun;

  return (
    <Canvas
      className="world"
      shadows="percentage"
      // Frames are scheduled by FrameScheduler, not on every display refresh.
      frameloop="never"
      dpr={[1, profile.maxDpr]}
      camera={{ fov: 50, near: 0.2, far: 400, position: [10, 20, 20] }}
      onPointerMissed={() => {
        if (!walking) focusDesk(null);
      }}
    >
      <Sky
        distance={450}
        sunPosition={[sunX * 100, sunY * 100, sunZ * 100]}
        turbidity={6}
        rayleigh={1.2}
        mieCoefficient={0.004}
      />
      {light.night > 0.4 && <Stars radius={180} depth={40} count={2500} factor={5} saturation={0} fade />}
      <fog attach="fog" args={[light.fog, 60, 260]} />
      {/* Indoors (walk mode) the ceiling blocks the sun: ambient light stands in for the ceiling lights. */}
      <AmbientLights layout={layout} walking={walking} light={daylight} />
      <Sun layout={layout} size={profile.shadowMapSize} sky={light.light} />

      <Suspense fallback={null}>
        <Structure layout={layout} cutaway={!walking} />
        <OutdoorScene layout={layout} light={light} />
        <PropInstances placements={visibleProps} outdoorTint={light.outdoorTint} />
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
      {/* The wall TV and the frames hang above the cut walls of the overview: only shown indoors. */}
      {walking &&
        layout.rooms
          .filter((room) => room.kind === 'master')
          .map((room) => <TimelineTV key="timeline-tv" room={room} />)}
      {walking && <PictureFrames slots={frameSlots} />}

      <FrameScheduler walking={walking} />
      {import.meta.env.DEV && <DevHandles />}
      <CameraClipping walking={walking} />
      {walking ? <WalkControls layout={layout} props={props} /> : <CameraRig layout={layout} />}
      <Soundscape layout={layout} night={light.night} />
      <CharacterLife layout={layout} props={props} />
    </Canvas>
  );
}
