import { CameraControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useOffice } from '../state/officeStore';
import { deskCameraPose, type OfficeLayout } from './layout';
import { playerPose } from './playerPose';

const target = new THREE.Vector3();

/**
 * Overview ("dollhouse") camera: orbit, pan and zoom; flies to a desk's monitor when a desk gets
 * focus, to a floor point on minimap clicks, and back to the whole office otherwise.
 */
export function CameraRig({ layout }: { layout: OfficeLayout }) {
  const controls = useRef<CameraControls>(null);
  const focusedDeskId = useOffice((state) => state.focusedDeskId);
  const sidebarCollapsed = useOffice((state) => state.sidebarCollapsed);
  const viewTarget = useOffice((state) => state.viewTarget);
  const initialized = useRef(false);
  const { bounds } = layout;

  useEffect(() => {
    const camera = controls.current;
    if (!camera) return;
    const desk = focusedDeskId ? layout.desks.find((entry) => entry.desk.id === focusedDeskId) : undefined;
    if (desk) {
      const { position, target: lookAt } = deskCameraPose(desk);
      void camera.setLookAt(...position, ...lookAt, true);
    } else {
      const centerX = (bounds.x0 + bounds.x1) / 2;
      const span = Math.max(bounds.x1 - bounds.x0, (bounds.z1 - bounds.z0) * 1.6);
      const height = Math.max(14, span * 0.62);
      void camera.setLookAt(centerX, height, height * 0.75, centerX, 0, 0, initialized.current);
    }
    initialized.current = true;
    // Re-frame only when the focus or the building size changes, not on every desk update.
  }, [focusedDeskId, bounds.x0, bounds.x1, bounds.z0, bounds.z1]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const camera = controls.current;
    if (!camera || !viewTarget) return;
    void camera.setLookAt(viewTarget.x, 9, viewTarget.z + 7, viewTarget.x, 0, viewTarget.z, true);
  }, [viewTarget]);

  // Keep the office centered in the part of the screen the sidebar does not cover.
  useEffect(() => {
    const camera = controls.current;
    if (!camera) return;
    const shift = sidebarCollapsed || focusedDeskId ? 0 : -(bounds.x1 - bounds.x0) * 0.09;
    void camera.setFocalOffset(shift, 0, 0, true);
  }, [sidebarCollapsed, focusedDeskId, bounds.x0, bounds.x1]);

  useFrame(() => {
    const camera = controls.current;
    if (!camera) return;
    camera.getTarget(target);
    playerPose.x = target.x;
    playerPose.z = target.z;
    playerPose.yaw = camera.azimuthAngle;
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={0.8}
      maxDistance={120}
      maxPolarAngle={Math.PI / 2.1}
      smoothTime={0.6}
    />
  );
}
