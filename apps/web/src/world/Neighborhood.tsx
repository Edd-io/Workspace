import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { seededRandom } from './appearance';
import { GROUND_Y, type Neighbor } from './outdoor';
import { FACADE_BAYS, FACADE_FLOORS, facadeTextures } from './textures';

/** Size of one window bay and one floor on the facades, in meters. */
const BAY = 3;
const FLOOR = 3.2;

/**
 * The neighboring buildings, merged into one mesh: facades (window texture tinted by each building's
 * color, windows lit at night through the emissive map) and flat roofs.
 */
function buildGeometry(neighbors: Neighbor[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const facadeIndices: number[] = [];
  const roofIndices: number[] = [];
  const color = new THREE.Color();

  const quad = (
    corners: [number, number, number][],
    normal: [number, number, number],
    uv: [number, number][],
    target: number[],
  ) => {
    const base = positions.length / 3;
    corners.forEach((corner, index) => {
      positions.push(...corner);
      normals.push(...normal);
      uvs.push(...uv[index]!);
      colors.push(color.r, color.g, color.b);
    });
    target.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const flat: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  /** A box without bottom, in the roof group. */
  const box = (bx0: number, bx1: number, bz0: number, bz1: number, by0: number, by1: number) => {
    quad(
      [
        [bx0, by0, bz1],
        [bx1, by0, bz1],
        [bx1, by1, bz1],
        [bx0, by1, bz1],
      ],
      [0, 0, 1],
      flat,
      roofIndices,
    );
    quad(
      [
        [bx1, by0, bz0],
        [bx0, by0, bz0],
        [bx0, by1, bz0],
        [bx1, by1, bz0],
      ],
      [0, 0, -1],
      flat,
      roofIndices,
    );
    quad(
      [
        [bx1, by0, bz1],
        [bx1, by0, bz0],
        [bx1, by1, bz0],
        [bx1, by1, bz1],
      ],
      [1, 0, 0],
      flat,
      roofIndices,
    );
    quad(
      [
        [bx0, by0, bz0],
        [bx0, by0, bz1],
        [bx0, by1, bz1],
        [bx0, by1, bz0],
      ],
      [-1, 0, 0],
      flat,
      roofIndices,
    );
    quad(
      [
        [bx0, by1, bz1],
        [bx1, by1, bz1],
        [bx1, by1, bz0],
        [bx0, by1, bz0],
      ],
      [0, 1, 0],
      flat,
      roofIndices,
    );
  };

  for (const building of neighbors) {
    color.set(building.color);
    const x0 = building.x - building.width / 2;
    const x1 = building.x + building.width / 2;
    const z0 = building.z - building.depth / 2;
    const z1 = building.z + building.depth / 2;
    const y0 = GROUND_Y;
    const y1 = GROUND_Y + building.height;
    // Each building starts at a different place of the window pattern, so they do not all match.
    const offset = (building.seed % FACADE_BAYS) / FACADE_BAYS;
    const v1 = building.height / (FLOOR * FACADE_FLOORS);
    const side = (length: number): [number, number][] => {
      const u1 = offset + length / (BAY * FACADE_BAYS);
      return [
        [offset, 0],
        [u1, 0],
        [u1, v1],
        [offset, v1],
      ];
    };
    // Counter-clockwise seen from outside.
    quad(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 0, 1],
      side(building.width),
      facadeIndices,
    );
    quad(
      [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ],
      [0, 0, -1],
      side(building.width),
      facadeIndices,
    );
    quad(
      [
        [x1, y0, z1],
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
      ],
      [1, 0, 0],
      side(building.depth),
      facadeIndices,
    );
    quad(
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
      [-1, 0, 0],
      side(building.depth),
      facadeIndices,
    );
    color.set('#8b8781');
    // Rooftop equipment: a few boxes (air handling units, stair exits).
    const random = seededRandom(building.seed);
    for (let i = 0, count = 1 + Math.floor(random() * 3); i < count; i++) {
      const w = 1.5 + random() * 3;
      const d = 1.5 + random() * 3;
      const bx = x0 + 1 + random() * Math.max(0, building.width - w - 2);
      const bz = z0 + 1 + random() * Math.max(0, building.depth - d - 2);
      box(bx, bx + w, bz, bz + d, y1, y1 + 1 + random() * 1.8);
    }
    quad(
      [
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      [0, 1, 0],
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      roofIndices,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex([...facadeIndices, ...roofIndices]);
  geometry.addGroup(0, facadeIndices.length, 0);
  geometry.addGroup(facadeIndices.length, roofIndices.length, 1);
  geometry.computeBoundingSphere();
  return geometry;
}

export function Neighborhood({
  neighbors,
  night,
  tint,
}: {
  neighbors: Neighbor[];
  night: number;
  tint: string;
}) {
  const geometry = useMemo(() => buildGeometry(neighbors), [neighbors]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const materials = useMemo(() => {
    const { map, emissive } = facadeTextures();
    map.repeat.set(1, 1);
    emissive.repeat.set(1, 1);
    const facade = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0,
      vertexColors: true,
      roughness: 0.85,
    });
    const roof = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    return [facade, roof] as const;
  }, []);
  useEffect(
    () => () => {
      for (const material of materials) {
        material.map?.dispose();
        material.emissiveMap?.dispose();
        material.dispose();
      }
    },
    [materials],
  );
  useEffect(() => {
    materials[0].emissiveIntensity = night * 1.1;
    // Facades and roofs darken with the rest of the outdoors; lit windows (emissive) do not.
    for (const material of materials) material.color.set(tint);
  }, [materials, night, tint]);
  return <mesh geometry={geometry} material={[...materials]} />;
}
