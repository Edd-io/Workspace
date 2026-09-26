import { advance, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { useOffice } from '../state/officeStore';
import { GRAPHICS_PROFILES, useGraphicsQuality } from './graphicsSettings';

/** How long the office stays "active" (full frame rate) after the camera or the pointer moved. */
const ACTIVE_MS = 1200;
/** Frames may come this early: 60 fps on a 120 Hz display is one frame out of two. */
const FRAME_SLACK_MS = 2;

/**
 * Drives the render loop of a `frameloop="never"` canvas: full rate while something happens, a
 * lower rate when the office is only watched, and a trickle while a terminal is open or the window
 * is in the background. Also decides when the sun shadows are recomputed.
 */
export function FrameScheduler({ walking }: { walking: boolean }) {
  const quality = useGraphicsQuality();
  const profile = GRAPHICS_PROFILES[quality];
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const everyFrame = profile.shadowUpdatesPerSecond === Infinity;
    gl.shadowMap.autoUpdate = everyFrame;
    gl.shadowMap.needsUpdate = true;

    let lastActivity = performance.now();
    const onInput = () => {
      lastActivity = performance.now();
    };
    const canvas = gl.domElement;
    const events = ['pointermove', 'pointerdown', 'wheel'] as const;
    for (const type of events) canvas.addEventListener(type, onInput, { passive: true });

    const lastCamera = new THREE.Matrix4();
    let lastFrame = -Infinity;
    let lastShadow = -Infinity;
    let request = 0;
    const tick = (now: number) => {
      request = requestAnimationFrame(tick);
      if (!lastCamera.equals(camera.matrixWorld)) {
        lastCamera.copy(camera.matrixWorld);
        lastActivity = now;
      }
      const active = walking || now - lastActivity < ACTIVE_MS;
      const background = useOffice.getState().terminalDeskId !== null || !document.hasFocus();
      const fps = active ? profile.activeFps : background ? profile.backgroundFps : profile.idleFps;
      if (now - lastFrame < 1000 / fps - FRAME_SLACK_MS) return;
      lastFrame = now;
      if (!everyFrame && now - lastShadow >= 1000 / profile.shadowUpdatesPerSecond) {
        lastShadow = now;
        gl.shadowMap.needsUpdate = true;
      }
      // R3F expects seconds in frameloop="never" mode.
      advance(now / 1000);
    };
    request = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(request);
      for (const type of events) canvas.removeEventListener(type, onInput);
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, camera, walking, profile]);

  return null;
}
