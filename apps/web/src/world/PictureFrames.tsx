import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useOffice } from '../state/officeStore';
import type { FrameSlot } from './decor';
import { DEPTH, MAT_RECESS, MOULDING, pictureSize } from './frameGeometry';

const MAT_COLOR = '#f2efe8';
/** An empty frame shows bare backing paper, a shade darker than the mat. */
const EMPTY_COLOR = '#dcd7cd';
const PICTURE_GLOW = 0.3;
const FINISHES: Record<FrameSlot['finish'], string> = { black: '#1c1c1e', oak: '#b08457' };

function slotMatrix(slot: FrameSlot): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...slot.position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotation),
    new THREE.Vector3(1, 1, 1),
  );
}

/** A box of `size` centered at `center` in the frame's local space, moved to the wall. */
function box(slot: FrameSlot, size: [number, number, number], center: [number, number, number]) {
  const geometry = new THREE.BoxGeometry(...size);
  geometry.translate(...center);
  geometry.applyMatrix4(slotMatrix(slot));
  return geometry;
}

/** Mouldings of every frame of one finish, and the mats of all frames: a few draw calls in total. */
function useFrameGeometry(slots: FrameSlot[]) {
  const geometry = useMemo(() => {
    const mouldings: Record<FrameSlot['finish'], THREE.BufferGeometry[]> = { black: [], oak: [] };
    const mats: THREE.BufferGeometry[] = [];
    for (const slot of slots) {
      const { width: w, height: h } = slot;
      const z = DEPTH / 2;
      mouldings[slot.finish].push(
        box(slot, [w, MOULDING, DEPTH], [0, h / 2 - MOULDING / 2, z]),
        box(slot, [w, MOULDING, DEPTH], [0, -h / 2 + MOULDING / 2, z]),
        box(slot, [MOULDING, h - 2 * MOULDING, DEPTH], [-w / 2 + MOULDING / 2, 0, z]),
        box(slot, [MOULDING, h - 2 * MOULDING, DEPTH], [w / 2 - MOULDING / 2, 0, z]),
      );
      const matDepth = DEPTH - MAT_RECESS;
      mats.push(box(slot, [w - 2 * MOULDING, h - 2 * MOULDING, matDepth], [0, 0, matDepth / 2]));
    }
    const merge = (parts: THREE.BufferGeometry[]) => (parts.length > 0 ? mergeGeometries(parts) : null);
    return { black: merge(mouldings.black), oak: merge(mouldings.oak), mats: merge(mats) };
  }, [slots]);
  useEffect(
    () => () => {
      geometry.black?.dispose();
      geometry.oak?.dispose();
      geometry.mats?.dispose();
    },
    [geometry],
  );
  return geometry;
}

/** Loads a picture and crops it to fill `aspect` (center crop), like `object-fit: cover`. */
function usePictureTexture(url: string | undefined, aspect: number): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(url, (result) => {
      if (cancelled) {
        result.dispose();
        return;
      }
      const image = result.image as { width: number; height: number };
      const ratio = image.width / image.height;
      if (ratio > aspect) {
        result.repeat.set(aspect / ratio, 1);
        result.offset.set((1 - aspect / ratio) / 2, 0);
      } else {
        result.repeat.set(1, ratio / aspect);
        result.offset.set(0, (1 - ratio / aspect) / 2);
      }
      result.colorSpace = THREE.SRGBColorSpace;
      result.anisotropy = 8;
      loaded = result;
      setTexture(result);
    });
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [url, aspect]);
  return texture;
}

function Picture({ slot }: { slot: FrameSlot }) {
  const url = useOffice((state) => state.pictures[slot.id]);
  const [width, height] = pictureSize(slot);
  const texture = usePictureTexture(url, width / height);
  // Just in front of the mat.
  const local = new THREE.Vector3(0, 0, DEPTH - MAT_RECESS + 0.001).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    slot.rotation,
  );
  return (
    <mesh
      position={[slot.position[0] + local.x, slot.position[1] + local.y, slot.position[2] + local.z]}
      rotation={[0, slot.rotation, 0]}
      userData={{ frameId: slot.id, frameAspect: width / height }}
    >
      <planeGeometry args={[width, height]} />
      {texture ? (
        // A little light of their own, as in a gallery: pictures stay readable in the office light.
        <meshStandardMaterial
          key="picture"
          map={texture}
          emissiveMap={texture}
          emissive="#ffffff"
          emissiveIntensity={PICTURE_GLOW}
          roughness={0.55}
        />
      ) : (
        <meshStandardMaterial key="empty" color={EMPTY_COLOR} roughness={0.95} />
      )}
    </mesh>
  );
}

/** Picture frames on the walls; E (walking) on one opens the dialog to put a picture in it. */
export function PictureFrames({ slots }: { slots: FrameSlot[] }) {
  const geometry = useFrameGeometry(slots);
  return (
    <group>
      {geometry.black && (
        <mesh geometry={geometry.black}>
          <meshStandardMaterial color={FINISHES.black} roughness={0.45} />
        </mesh>
      )}
      {geometry.oak && (
        <mesh geometry={geometry.oak}>
          <meshStandardMaterial color={FINISHES.oak} roughness={0.6} />
        </mesh>
      )}
      {geometry.mats && (
        <mesh geometry={geometry.mats}>
          <meshStandardMaterial color={MAT_COLOR} roughness={0.95} />
        </mesh>
      )}
      {slots.map((slot) => (
        <Picture key={slot.id} slot={slot} />
      ))}
    </group>
  );
}
