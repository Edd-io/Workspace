import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CORRIDOR_HALF_WIDTH, WALL_HEIGHT, type OfficeLayout, type RoomLayout } from '../layout';
import { carpetColor, carpetTexture, tileTexture, woodTexture } from '../textures';
import { buildWallBoxes, type WallMaterial } from './buildWalls';

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

function useWallGeometries(layout: OfficeLayout, cut: number): [WallMaterial, THREE.BufferGeometry][] {
  const geometries = useMemo(() => {
    const byMaterial = new Map<WallMaterial, THREE.BufferGeometry[]>();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const box of buildWallBoxes(layout.walls, cut)) {
      const geometry = new THREE.BoxGeometry(...box.size);
      quaternion.setFromAxisAngle(up, box.rotation);
      matrix.compose(new THREE.Vector3(...box.center), quaternion, new THREE.Vector3(1, 1, 1));
      geometry.applyMatrix4(matrix);
      const list = byMaterial.get(box.material) ?? [];
      list.push(geometry);
      byMaterial.set(box.material, list);
    }
    return [...byMaterial].map(([material, list]): [WallMaterial, THREE.BufferGeometry] => {
      const merged = mergeGeometries(list)!;
      list.forEach((geometry) => geometry.dispose());
      return [material, merged];
    });
  }, [layout.walls, cut]);
  useEffect(() => () => geometries.forEach(([, geometry]) => geometry.dispose()), [geometries]);
  return geometries;
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
      position={[(room.x0 + room.x1) / 2, 0.002, (room.z0 + room.z1) / 2]}
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
      position={[(layout.corridor.x0 + layout.corridor.x1) / 2, 0.003, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      material={material}
    >
      <planeGeometry args={[length, CORRIDOR_HALF_WIDTH * 2]} />
    </mesh>
  );
}

/** Walls, floors, ceiling and the ground around the building. */
export function Structure({ layout, cutaway }: { layout: OfficeLayout; cutaway: boolean }) {
  const walls = useWallGeometries(layout, cutaway ? 1.15 : WALL_HEIGHT);
  const { bounds } = layout;
  const width = bounds.x1 - bounds.x0;
  const depth = bounds.z1 - bounds.z0;
  const centerX = (bounds.x0 + bounds.x1) / 2;
  const centerZ = (bounds.z0 + bounds.z1) / 2;

  return (
    <group>
      {walls.map(([material, geometry]) => (
        <mesh
          key={material}
          geometry={geometry}
          material={WALL_MATERIALS[material]}
          castShadow={material !== 'glass'}
          receiveShadow
        />
      ))}
      {layout.rooms.map((room) => (
        <RoomFloor key={`${room.kind}-${room.x0}-${room.side}`} room={room} />
      ))}
      <CorridorFloor layout={layout} />

      {/* Building slab, ground and the path to the entrance. */}
      <mesh position={[centerX, -0.06, centerZ]} receiveShadow>
        <boxGeometry args={[width + 0.4, 0.12, depth + 0.4]} />
        <meshStandardMaterial color="#8d877d" roughness={0.9} />
      </mesh>
      <mesh position={[centerX, -0.13, centerZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width + 160, depth + 160]} />
        <meshStandardMaterial color="#7e9a62" roughness={1} />
      </mesh>
      <mesh position={[bounds.x0 - 6, -0.11, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 3]} />
        <meshStandardMaterial color="#b8b2a6" roughness={0.9} />
      </mesh>

      {!cutaway && (
        // A thin slab (not a plane) so it casts shadows: sunlight only comes in through windows.
        <mesh position={[centerX, WALL_HEIGHT + 0.05, centerZ]} castShadow receiveShadow>
          <boxGeometry args={[width + 0.4, 0.1, depth + 0.4]} />
          <meshStandardMaterial color="#f1f0ec" emissive="#6d6b66" roughness={0.95} />
        </mesh>
      )}
    </group>
  );
}
