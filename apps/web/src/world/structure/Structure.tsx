import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CORRIDOR_HALF_WIDTH, WALL_HEIGHT, type OfficeLayout, type RoomLayout } from '../layout';
import { carpetColor, carpetTexture, tileTexture, woodTexture } from '../textures';
import { buildWallBoxes, type WallBox, type WallMaterial } from './buildWalls';

/** Floors sit at y = 0; the slab under them and the ceiling are unions of the room rectangles. */
function useSlabGeometry(layout: OfficeLayout, y: number, thickness: number, margin: number) {
  const geometry = useMemo(() => {
    const rects = [
      ...layout.rooms.map((room) => ({ x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1 })),
      { x0: layout.corridor.x0, x1: layout.corridor.x1, z0: -CORRIDOR_HALF_WIDTH, z1: CORRIDOR_HALF_WIDTH },
    ];
    const parts = rects.map((rect) => {
      const box = new THREE.BoxGeometry(
        rect.x1 - rect.x0 + margin * 2,
        thickness,
        rect.z1 - rect.z0 + margin * 2,
      );
      box.translate((rect.x0 + rect.x1) / 2, y + thickness / 2, (rect.z0 + rect.z1) / 2);
      return box;
    });
    const merged = mergeGeometries(parts)!;
    parts.forEach((part) => part.dispose());
    return merged;
  }, [layout.rooms, layout.corridor, y, thickness, margin]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

const WALL_MATERIALS: Record<WallMaterial, THREE.Material> = {
  wall: new THREE.MeshStandardMaterial({ color: '#ecebe7', roughness: 0.92 }),
  frame: new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.45, metalness: 0.5 }),
  glass: new THREE.MeshStandardMaterial({
    color: '#cfe6f2',
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  }),
  trim: new THREE.MeshStandardMaterial({ color: '#8c8780', roughness: 0.7 }),
};

/**
 * The end faces of the wall boxes that remain (free wall ends, corners) are drawn apart, slightly
 * pushed back in depth, so they never win against the face of a wall they touch edge-on.
 */
const WALL_END_MATERIALS = Object.fromEntries(
  Object.entries(WALL_MATERIALS).map(([name, material]) => {
    const ends = material.clone();
    ends.polygonOffset = true;
    ends.polygonOffsetFactor = 1;
    ends.polygonOffsetUnits = 1;
    return [name, ends];
  }),
) as Record<WallMaterial, THREE.Material>;

/** Builds the faces of a wall box: its long sides, or its end faces that `box.ends` keeps. */
function boxFaces(box: WallBox, geometry: THREE.BoxGeometry, ends: boolean): THREE.BufferGeometry | null {
  // BoxGeometry groups: 0 is the +X face (the box's end along the wall), 1 the −X face (its start).
  const keep = (group: number) => (group === 0 ? box.ends[1] : group === 1 ? box.ends[0] : false);
  const source = geometry.getIndex()!.array;
  const indices: number[] = [];
  for (const group of geometry.groups) {
    const index = group.materialIndex ?? 0;
    if (ends ? !keep(index) : index <= 1) continue;
    for (let i = group.start; i < group.start + group.count; i++) indices.push(source[i]!);
  }
  if (indices.length === 0) return null;
  const faces = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) faces.setAttribute(name, geometry.getAttribute(name));
  faces.setIndex(indices);
  return faces;
}

interface WallMesh {
  key: string;
  material: WallMaterial;
  ends: boolean;
  geometry: THREE.BufferGeometry;
}

function useWallGeometries(layout: OfficeLayout, cut: number): WallMesh[] {
  const meshes = useMemo(() => {
    const byKey = new Map<string, { material: WallMaterial; ends: boolean; parts: THREE.BufferGeometry[] }>();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const box of buildWallBoxes(layout.walls, cut)) {
      const geometry = new THREE.BoxGeometry(...box.size);
      quaternion.setFromAxisAngle(up, box.rotation);
      matrix.compose(new THREE.Vector3(...box.center), quaternion, new THREE.Vector3(1, 1, 1));
      geometry.applyMatrix4(matrix);
      for (const ends of [false, true]) {
        const faces = boxFaces(box, geometry, ends);
        if (!faces) continue;
        const key = `${box.material}${ends ? '-ends' : ''}`;
        const entry = byKey.get(key) ?? { material: box.material, ends, parts: [] };
        entry.parts.push(faces);
        byKey.set(key, entry);
      }
      geometry.dispose();
    }
    return [...byKey].map(([key, { material, ends, parts }]): WallMesh => {
      const geometry = mergeGeometries(parts)!;
      parts.forEach((part) => part.dispose());
      return { key, material, ends, geometry };
    });
  }, [layout.walls, cut]);
  useEffect(() => () => meshes.forEach((mesh) => mesh.geometry.dispose()), [meshes]);
  return meshes;
}

function floorMaterial(room: RoomLayout): THREE.MeshStandardMaterial {
  const width = room.x1 - room.x0;
  const depth = room.z1 - room.z0;
  let texture: THREE.Texture;
  if (room.kind === 'project') texture = carpetTexture(carpetColor(room.room.accentColor));
  else if (room.kind === 'master') texture = woodTexture('#9c7552');
  else if (room.kind === 'lounge') texture = woodTexture('#b88f66');
  else texture = carpetTexture('#8f8b84');
  const tile = room.kind === 'project' || room.kind === 'placeholder' ? 1 : 2;
  texture.repeat.set(width / tile, depth / tile);
  return new THREE.MeshStandardMaterial({ map: texture, roughness: room.kind === 'project' ? 1 : 0.6 });
}

function RoomFloor({ room }: { room: RoomLayout }) {
  const accent = room.kind === 'project' ? room.room.accentColor : '';
  const material = useMemo(
    () => floorMaterial(room),
    [room.kind, room.x0, room.x1, room.z0, room.z1, accent],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      material.map?.dispose();
      material.dispose();
    },
    [material],
  );
  return (
    <mesh
      position={[(room.x0 + room.x1) / 2, 0, (room.z0 + room.z1) / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      material={material}
    >
      <planeGeometry args={[room.x1 - room.x0, room.z1 - room.z0]} />
    </mesh>
  );
}

function CorridorFloor({ layout }: { layout: OfficeLayout }) {
  const length = layout.corridor.x1 - layout.corridor.x0;
  const material = useMemo(() => {
    const texture = tileTexture('#d6d1c8');
    texture.repeat.set(length / 1.2, (CORRIDOR_HALF_WIDTH * 2) / 1.2);
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.35 });
  }, [length]);
  useEffect(
    () => () => {
      material.map?.dispose();
      material.dispose();
    },
    [material],
  );
  return (
    <mesh
      position={[(layout.corridor.x0 + layout.corridor.x1) / 2, 0, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      material={material}
    >
      <planeGeometry args={[length, CORRIDOR_HALF_WIDTH * 2]} />
    </mesh>
  );
}

/** Walls, floors, slab and ceiling of the building. */
export function Structure({ layout, cutaway }: { layout: OfficeLayout; cutaway: boolean }) {
  const walls = useWallGeometries(layout, cutaway ? 1.15 : WALL_HEIGHT);
  // The slab top stays 3 cm under the floors, so floors never fight with it.
  const slab = useSlabGeometry(layout, -0.15, 0.12, 0.12);
  // The ceiling's underside is 3 cm below the wall tops: walls go into it, no light leaks at the joint.
  const ceiling = useSlabGeometry(layout, WALL_HEIGHT - 0.03, 0.12, 0.1);
  const { bounds } = layout;
  const width = bounds.x1 - bounds.x0;
  const depth = bounds.z1 - bounds.z0;
  const centerX = (bounds.x0 + bounds.x1) / 2;
  const centerZ = (bounds.z0 + bounds.z1) / 2;

  return (
    <group>
      {walls.map(({ key, material, ends, geometry }) => (
        <mesh
          key={key}
          geometry={geometry}
          material={(ends ? WALL_END_MATERIALS : WALL_MATERIALS)[material]}
          castShadow={material !== 'glass'}
          receiveShadow
        />
      ))}
      {layout.rooms.map((room) => (
        <RoomFloor key={`${room.kind}-${room.x0}-${room.side}`} room={room} />
      ))}
      <CorridorFloor layout={layout} />

      {/* Building slab (the ground and everything outside: Outdoor). */}
      <mesh geometry={slab} receiveShadow>
        <meshStandardMaterial color="#8d877d" roughness={0.9} />
      </mesh>

      {!cutaway && (
        <mesh geometry={ceiling} castShadow receiveShadow>
          <meshStandardMaterial color="#f1f0ec" emissive="#6d6b66" roughness={0.95} />
        </mesh>
      )}
    </group>
  );
}
