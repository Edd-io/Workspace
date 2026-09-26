import { Text } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import type { Daylight } from './daylight';
import { FONT_TEXT_BOLD } from './fonts';
import { lampUniforms, setLampPools, withLampLight } from './lampLight';
import type { OfficeLayout } from './layout';
import { Neighborhood } from './Neighborhood';
import { computeOutdoor, GROUND_Y, type Road, type Surface, type SurfaceKind } from './outdoor';
import { LAMP_MATERIALS } from './props/propLibrary';
import { asphaltTexture, grassTexture, pavingTexture, roadTexture, woodTexture } from './textures';

/** Texture tile size (m) of each surface kind. */
const TILE: Record<SurfaceKind, number> = { paving: 2, apron: 2, path: 2, lot: 4, deck: 2, paint: 1 };
const GROUND_SIZE = 700;

/** Flat boxes from the ground up to each surface's top, with world-space texture coordinates. */
function surfaceGeometry(surfaces: Surface[], tile: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const quad = (
    corners: [number, number, number][],
    normal: [number, number, number],
    uv: [number, number][],
  ) => {
    const base = positions.length / 3;
    corners.forEach((corner, index) => {
      positions.push(...corner);
      normals.push(...normal);
      uvs.push(...uv[index]!);
    });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const { x0, x1, z0, z1, top } of surfaces) {
    const y0 = GROUND_Y;
    const h = (top - y0) / tile;
    quad(
      [
        [x0, top, z1],
        [x1, top, z1],
        [x1, top, z0],
        [x0, top, z0],
      ],
      [0, 1, 0],
      [
        [x0 / tile, z1 / tile],
        [x1 / tile, z1 / tile],
        [x1 / tile, z0 / tile],
        [x0 / tile, z0 / tile],
      ],
    );
    // Curbs.
    const along = (a: number, b: number): [number, number][] => [
      [a / tile, 0],
      [b / tile, 0],
      [b / tile, h],
      [a / tile, h],
    ];
    quad(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, top, z1],
        [x0, top, z1],
      ],
      [0, 0, 1],
      along(x0, x1),
    );
    quad(
      [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, top, z0],
        [x1, top, z0],
      ],
      [0, 0, -1],
      along(x1, x0),
    );
    quad(
      [
        [x1, y0, z1],
        [x1, y0, z0],
        [x1, top, z0],
        [x1, top, z1],
      ],
      [1, 0, 0],
      along(z1, z0),
    );
    quad(
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, top, z1],
        [x0, top, z0],
      ],
      [-1, 0, 0],
      along(z0, z1),
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Road planes: U across the road (0 → 1), V along it (one texture tile per 7 m). */
function roadGeometry(roads: Road[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const y = GROUND_Y + 0.006;
  for (const road of roads) {
    const base = positions.length / 3;
    const { x0, x1, z0, z1 } = road;
    positions.push(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0);
    if (road.axis === 'z') uvs.push(0, z1 / 7, 1, z1 / 7, 1, z0 / 7, 0, z0 / 7);
    else uvs.push(1, x0 / 7, 1, x1 / 7, 0, x1 / 7, 0, x0 / 7);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

interface Tinted {
  material: THREE.MeshStandardMaterial;
  base: THREE.Color;
}

function tinted(material: THREE.MeshStandardMaterial): Tinted {
  return { material: withLampLight(material), base: material.color.clone() };
}

/** Everything around the building (see outdoor.ts), lit by the time of day and, at night, the lamps. */
export function OutdoorScene({ layout, light }: { layout: OfficeLayout; light: Daylight }) {
  const { t } = useTranslation();
  const outdoor = useMemo(() => computeOutdoor(layout), [layout]);
  const { bounds } = layout;
  const centerX = (bounds.x0 + bounds.x1) / 2;
  const centerZ = (bounds.z0 + bounds.z1) / 2;

  const materials = useMemo(() => {
    const grass = grassTexture();
    grass.repeat.set(GROUND_SIZE / 8, GROUND_SIZE / 8);
    const paving = pavingTexture();
    const kinds: Record<SurfaceKind | 'road' | 'grass', Tinted> = {
      grass: tinted(new THREE.MeshStandardMaterial({ map: grass, roughness: 1 })),
      paving: tinted(new THREE.MeshStandardMaterial({ map: paving, color: '#d3cdc1', roughness: 0.95 })),
      apron: tinted(new THREE.MeshStandardMaterial({ map: paving, color: '#b9b3a7', roughness: 0.95 })),
      path: tinted(new THREE.MeshStandardMaterial({ map: paving, color: '#d8c7a2', roughness: 1 })),
      lot: tinted(new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95 })),
      deck: tinted(new THREE.MeshStandardMaterial({ map: woodTexture('#8f6b4a'), roughness: 0.8 })),
      paint: tinted(new THREE.MeshStandardMaterial({ color: '#efeee8', roughness: 0.8 })),
      road: tinted(new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.95 })),
    };
    return kinds;
  }, []);
  useEffect(
    () => () => {
      const textures = new Set<THREE.Texture>();
      for (const { material } of Object.values(materials)) {
        if (material.map) textures.add(material.map);
        material.dispose();
      }
      textures.forEach((texture) => texture.dispose());
    },
    [materials],
  );

  const geometries = useMemo(() => {
    const byKind = new Map<SurfaceKind, Surface[]>();
    for (const surface of outdoor.surfaces) {
      const list = byKind.get(surface.kind) ?? [];
      list.push(surface);
      byKind.set(surface.kind, list);
    }
    return {
      surfaces: [...byKind].map(([kind, list]) => ({ kind, geometry: surfaceGeometry(list, TILE[kind]) })),
      roads: roadGeometry(outdoor.roads),
    };
  }, [outdoor]);
  useEffect(
    () => () => {
      geometries.surfaces.forEach(({ geometry }) => geometry.dispose());
      geometries.roads.dispose();
    },
    [geometries],
  );

  useEffect(() => setLampPools(outdoor.pools), [outdoor]);

  // Darker outdoors at night; lamps (street lamps, bollards, the canopy strip) glow.
  useEffect(() => {
    const tint = new THREE.Color(light.outdoorTint);
    for (const { material, base } of Object.values(materials)) material.color.copy(base).multiply(tint);
    lampUniforms.lampStrength.value = light.night * 1.5;
    for (const material of LAMP_MATERIALS) material.emissiveIntensity = 0.05 + 2.6 * light.night;
  }, [light, materials]);

  const { sign } = outdoor;
  return (
    <group>
      <mesh
        position={[centerX, GROUND_Y, centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={materials.grass.material}
        receiveShadow
      >
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
      </mesh>
      {geometries.surfaces.map(({ kind, geometry }) => (
        <mesh key={kind} geometry={geometry} material={materials[kind].material} receiveShadow />
      ))}
      <mesh geometry={geometries.roads} material={materials.road.material} receiveShadow />
      <group position={[sign.x, sign.y, sign.z]} rotation={[0, sign.rotation, 0]}>
        <Text
          font={FONT_TEXT_BOLD}
          position={[0, 0.72, 0.205]}
          fontSize={0.36}
          color="#f4efe6"
          anchorX="center"
          anchorY="middle"
          maxWidth={2.1}
        >
          {t('app.name')}
        </Text>
      </group>
      <Neighborhood neighbors={outdoor.neighbors} night={light.night} tint={light.outdoorTint} />
    </group>
  );
}
