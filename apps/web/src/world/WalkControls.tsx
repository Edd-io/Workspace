import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useOffice } from '../state/officeStore';
import { buildColliders, resolveCollisions } from './collision';
import type { PropPlacement } from './decor';
import type { OfficeLayout, Vec2 } from './layout';
import { playerPose } from './playerPose';
import { footsteps } from './Soundscape';

const EYE_HEIGHT = 1.62;
const WALK_SPEED = 2.4;
const RUN_SPEED = 4.6;
const RADIUS = 0.28;
const LOOK_SENSITIVITY = 0.0022;
const INTERACT_DISTANCE = 3.2;

/** `KeyboardEvent.code` values: physical keys, so WASD maps to ZQSD on an AZERTY keyboard. */
const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACKWARD = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return (
    !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

/**
 * First-person visit: pointer lock + physical WASD keys, collisions against walls and furniture,
 * E (or click) to use the desk or whiteboard in front of you.
 */
export function WalkControls({ layout, props }: { layout: OfficeLayout; props: PropPlacement[] }) {
  const { camera, gl, scene } = useThree();
  const colliders = useMemo(() => buildColliders(layout, props), [layout, props]);
  const keys = useRef(new Set<string>());
  const yaw = useRef(-Math.PI / 2);
  const pitch = useRef(0);
  const position = useRef<Vec2>([...layout.entrance]);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const viewTarget = useOffice((state) => state.viewTarget);
  const stride = useRef(0);

  // Start where the camera is when it is inside the building, otherwise at the entrance.
  useEffect(() => {
    const { bounds } = layout;
    const inside =
      camera.position.x > bounds.x0 &&
      camera.position.x < bounds.x1 &&
      camera.position.z > bounds.z0 &&
      camera.position.z < bounds.z1 &&
      camera.position.y < 3;
    if (inside) {
      position.current = [camera.position.x, camera.position.z];
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      yaw.current = Math.atan2(-direction.x, -direction.z);
    } else {
      position.current = [...layout.entrance];
      yaw.current = -Math.PI / 2;
    }
    pitch.current = 0;
    return () => {
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewTarget) return;
    position.current = [viewTarget.x, viewTarget.z];
    if (viewTarget.yaw !== undefined) {
      yaw.current = viewTarget.yaw;
      pitch.current = -0.15;
    }
  }, [viewTarget]);

  useEffect(() => {
    const canvas = gl.domElement;
    const interact = () => {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      raycaster.far = INTERACT_DISTANCE;
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        const data = hit.object.userData as {
          deskId?: string;
          boardRoomId?: string;
          panel?: 'map' | 'summary' | 'inbox' | 'timeline';
        };
        if (data.deskId) {
          document.exitPointerLock();
          useOffice.getState().openTerminal(data.deskId);
          return;
        }
        if (data.boardRoomId) {
          document.exitPointerLock();
          useOffice.getState().setPanel({ kind: 'board', roomId: data.boardRoomId });
          return;
        }
        if (data.panel) {
          document.exitPointerLock();
          useOffice.getState().setPanel({ kind: data.panel });
          return;
        }
      }
    };
    const onClick = () => {
      const { terminalDeskId, panel } = useOffice.getState();
      if (terminalDeskId || panel) return;
      if (document.pointerLockElement === canvas) interact();
      else void canvas.requestPointerLock();
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      yaw.current -= event.movementX * LOOK_SENSITIVITY;
      pitch.current = Math.max(-1.3, Math.min(1.3, pitch.current - event.movementY * LOOK_SENSITIVITY));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      keys.current.add(event.code);
      if (event.code === 'KeyE' && document.pointerLockElement === canvas) interact();
    };
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.code);
    const onBlur = () => keys.current.clear();
    canvas.addEventListener('click', onClick);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [camera, gl, raycaster, scene]);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05);
    const pressed = keys.current;
    const has = (set: Set<string>) => [...set].some((code) => pressed.has(code));
    const forward = (has(FORWARD) ? 1 : 0) - (has(BACKWARD) ? 1 : 0);
    const strafe = (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0);
    const blocked = useOffice.getState().terminalDeskId !== null || useOffice.getState().panel !== null;
    if ((forward || strafe) && !blocked) {
      const speed = pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
      const length = Math.hypot(forward, strafe);
      const sin = Math.sin(yaw.current);
      const cos = Math.cos(yaw.current);
      // Forward is −Z rotated by yaw; right is +X rotated by yaw.
      const dx = ((-sin * forward + cos * strafe) / length) * speed * step;
      const dz = ((-cos * forward - sin * strafe) / length) * speed * step;
      const before = position.current;
      position.current = resolveCollisions(
        [position.current[0] + dx, position.current[1] + dz],
        RADIUS,
        colliders,
      );
      // One footstep every ~0.75 m actually walked.
      stride.current += Math.hypot(position.current[0] - before[0], position.current[1] - before[1]);
      if (stride.current > 0.75) {
        stride.current = 0;
        footsteps.step();
      }
    }
    camera.position.set(position.current[0], EYE_HEIGHT, position.current[1]);
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    playerPose.x = position.current[0];
    playerPose.z = position.current[1];
    playerPose.yaw = yaw.current;
  });

  return null;
}
