import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useOffice } from '../state/officeStore';
import { buildColliders, resolveCollisions, type Segment } from './collision';
import { computeOutdoor } from './outdoor';
import type { PropPlacement } from './decor';
import type { OfficeLayout, Vec2 } from './layout';
import { playerPose } from './playerPose';
import { aimedSeat, seatsOf, type Seat } from './seats';
import { footsteps } from './Soundscape';
import { useWalk, type WalkAim } from './walkState';

const EYE_HEIGHT = 1.62;
const WALK_SPEED = 2.4;
const RUN_SPEED = 4.6;
const RADIUS = 0.28;
const LOOK_SENSITIVITY = 0.0022;
const INTERACT_DISTANCE = 3.2;
/** Sitting down or standing up takes that long (seconds). */
const SIT_DURATION = 0.45;
const SEATED_PITCH = -0.12;
/** How often the target under the crosshair is looked up for the hint (seconds). */
const AIM_INTERVAL = 0.15;

type Interactive =
  | { kind: 'desk'; deskId: string }
  | { kind: 'board'; roomId: string }
  | { kind: 'screen'; panel: 'map' | 'summary' | 'inbox' | 'timeline' }
  | { kind: 'seat'; seat: Seat };

interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Shortest turn from one angle to another. */
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

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
 * E (or click) to use the desk, whiteboard or screen in front of you, or to sit on a free seat.
 */
export function WalkControls({ layout, props }: { layout: OfficeLayout; props: PropPlacement[] }) {
  const { camera, gl, scene } = useThree();
  const colliders = useMemo(() => {
    // The neighboring buildings are solid too, for a walk outside.
    const buildings = computeOutdoor(layout).neighbors.flatMap(({ x, z, width, depth }): Segment[] => {
      const corners: Vec2[] = [
        [x - width / 2, z - depth / 2],
        [x + width / 2, z - depth / 2],
        [x + width / 2, z + depth / 2],
        [x - width / 2, z + depth / 2],
      ];
      return corners.map((a, index) => ({ a, b: corners[(index + 1) % 4]! }));
    });
    return buildColliders(layout, props, buildings);
  }, [layout, props]);
  const keys = useRef(new Set<string>());
  const yaw = useRef(-Math.PI / 2);
  const pitch = useRef(0);
  const position = useRef<Vec2>([...layout.entrance]);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const viewTarget = useOffice((state) => state.viewTarget);
  const stride = useRef(0);
  const seats = useMemo(() => seatsOf(props), [props]);
  /** The seat in use, and where the visitor stood before sitting down (free of colliders). */
  const seated = useRef<{ seat: Seat; standing: Vec2 } | null>(null);
  const transition = useRef<{ from: Pose; to: Pose; progress: number } | null>(null);
  const aimClock = useRef(0);

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
    seated.current = null;
    transition.current = null;
    useWalk.setState({ seated: false });
    position.current = [viewTarget.x, viewTarget.z];
    if (viewTarget.yaw !== undefined) {
      yaw.current = viewTarget.yaw;
      pitch.current = -0.15;
    }
  }, [viewTarget]);

  /** What the crosshair points at: a desk, board or screen (raycast), or a seat. */
  const target = (): Interactive | null => {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = INTERACT_DISTANCE;
    const interactive: THREE.Object3D[] = [];
    scene.traverse((object) => {
      const data = object.userData as { deskId?: string; boardRoomId?: string; panel?: string };
      if (data.deskId || data.boardRoomId || data.panel) interactive.push(object);
    });
    let found: (Interactive & { distance: number }) | null = null;
    const hit = raycaster.intersectObjects(interactive, false)[0];
    if (hit) {
      const data = hit.object.userData as {
        deskId?: string;
        boardRoomId?: string;
        panel?: 'map' | 'summary' | 'inbox' | 'timeline';
      };
      if (data.deskId) found = { kind: 'desk', deskId: data.deskId, distance: hit.distance };
      else if (data.boardRoomId) found = { kind: 'board', roomId: data.boardRoomId, distance: hit.distance };
      else if (data.panel) found = { kind: 'screen', panel: data.panel, distance: hit.distance };
    }
    if (!seated.current) {
      const { origin, direction } = raycaster.ray;
      const aimed = aimedSeat(
        seats,
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
        INTERACT_DISTANCE,
      );
      if (aimed && (!found || aimed.distance < found.distance)) return { kind: 'seat', seat: aimed.seat };
    }
    return found;
  };

  const currentPose = (): Pose => ({
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
    yaw: yaw.current,
    pitch: pitch.current,
  });

  const sitDown = (seat: Seat) => {
    seated.current = { seat, standing: [...position.current] };
    transition.current = {
      from: currentPose(),
      to: {
        x: seat.eye[0],
        y: seat.eye[1],
        z: seat.eye[2],
        yaw: seat.yaw ?? yaw.current,
        pitch: SEATED_PITCH,
      },
      progress: 0,
    };
    position.current = [seat.eye[0], seat.eye[2]];
    useWalk.setState({ seated: true });
  };

  const standUp = () => {
    const standing = seated.current?.standing;
    if (!standing) return;
    seated.current = null;
    transition.current = {
      from: currentPose(),
      to: { x: standing[0], y: EYE_HEIGHT, z: standing[1], yaw: yaw.current, pitch: 0 },
      progress: 0,
    };
    position.current = [...standing];
    useWalk.setState({ seated: false });
  };

  useEffect(() => {
    const canvas = gl.domElement;
    const interact = () => {
      const found = target();
      if (found?.kind === 'seat') return sitDown(found.seat);
      if (!found) {
        // Nothing to use in front of you: E gets you up again.
        if (seated.current) standUp();
        return;
      }
      document.exitPointerLock();
      if (found.kind === 'desk') useOffice.getState().openTerminal(found.deskId);
      else if (found.kind === 'board') useOffice.getState().setPanel({ kind: 'board', roomId: found.roomId });
      else useOffice.getState().setPanel({ kind: found.panel });
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
  }); // Re-bound on every render: the handlers read the latest seats.

  useEffect(() => () => useWalk.setState({ aim: null, seated: false }), []);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05);
    const pressed = keys.current;
    const has = (set: Set<string>) => [...set].some((code) => pressed.has(code));
    const forward = (has(FORWARD) ? 1 : 0) - (has(BACKWARD) ? 1 : 0);
    const strafe = (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0);
    const blocked = useOffice.getState().terminalDeskId !== null || useOffice.getState().panel !== null;

    const moving = transition.current;
    if (moving) {
      moving.progress = Math.min(1, moving.progress + step / SIT_DURATION);
      const k = moving.progress * moving.progress * (3 - 2 * moving.progress);
      const { from, to } = moving;
      camera.position.set(
        from.x + (to.x - from.x) * k,
        from.y + (to.y - from.y) * k,
        from.z + (to.z - from.z) * k,
      );
      yaw.current = from.yaw + angleDelta(from.yaw, to.yaw) * k;
      pitch.current = from.pitch + (to.pitch - from.pitch) * k;
      if (moving.progress >= 1) transition.current = null;
    } else if (seated.current) {
      // Walking keys get you up.
      if ((forward || strafe) && !blocked) standUp();
      const [x, y, z] = seated.current?.seat.eye ?? [position.current[0], EYE_HEIGHT, position.current[1]];
      camera.position.set(x, y, z);
    } else {
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
    }
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    playerPose.x = position.current[0];
    playerPose.z = position.current[1];
    playerPose.yaw = yaw.current;

    // What E would do, for the hint under the crosshair.
    aimClock.current += delta;
    if (aimClock.current >= AIM_INTERVAL) {
      aimClock.current = 0;
      const locked = document.pointerLockElement === gl.domElement;
      const aim: WalkAim = locked && !blocked && !transition.current ? (target()?.kind ?? null) : null;
      if (useWalk.getState().aim !== aim) useWalk.setState({ aim });
    }
  });

  return null;
}
