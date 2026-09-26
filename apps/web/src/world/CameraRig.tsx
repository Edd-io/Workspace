import { CameraControls } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import { useOffice } from '../state/officeStore';
import { deskCameraPose, type OfficeLayout } from './layout';

/**
 * Overview camera (orbit, pan, zoom) that flies to a desk's monitor when a desk gets focus and back
 * to the overview when focus is cleared.
 */
export function CameraRig({ layout }: { layout: OfficeLayout }) {
  const controls = useRef<CameraControls>(null);
  const focusedDeskId = useOffice((state) => state.focusedDeskId);
  const initialized = useRef(false);

  const centerX = (layout.corridor.minX + layout.corridor.maxX) / 2;

  useEffect(() => {
    const camera = controls.current;
    if (!camera) return;
    const desk = focusedDeskId ? layout.desks.find((entry) => entry.desk.id === focusedDeskId) : undefined;
    if (desk) {
      const { position, target } = deskCameraPose(desk);
      void camera.setLookAt(...position, ...target, true);
    } else {
      const span = layout.corridor.maxX - layout.corridor.minX;
      const height = Math.max(12, span * 0.55);
      void camera.setLookAt(centerX, height, height * 0.9, centerX, 0, 0, initialized.current);
    }
    initialized.current = true;
    // The overview only depends on the office size, not on every desk update.
  }, [focusedDeskId, layout.corridor.minX, layout.corridor.maxX]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={0.8}
      maxDistance={80}
      maxPolarAngle={Math.PI / 2.1}
      smoothTime={0.6}
    />
  );
}
