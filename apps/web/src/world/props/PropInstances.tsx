import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PropPlacement } from '../decor';
import { usePropLibrary, type PropModel, type PropName } from './propLibrary';

const WHITE = new THREE.Color('#ffffff');

/**
 * Renders every placement of every prop, one instanced mesh per prop model. Outdoor placements take
 * `outdoorTint` as instance color (darker at night); indoor ones keep their colors.
 */
export function PropInstances({
  placements,
  outdoorTint = '#ffffff',
}: {
  placements: PropPlacement[];
  outdoorTint?: string;
}) {
  const library = usePropLibrary();
  const byModel = useMemo(() => {
    const groups = new Map<PropName, PropPlacement[]>();
    for (const placement of placements) {
      const list = groups.get(placement.model) ?? [];
      list.push(placement);
      groups.set(placement.model, list);
    }
    return groups;
  }, [placements]);

  return (
    <>
      {[...byModel].map(([name, list]) => {
        const model = library.get(name);
        return model ? (
          <PropModelInstances
            key={name}
            name={name}
            model={model}
            placements={list}
            outdoorTint={outdoorTint}
          />
        ) : null;
      })}
    </>
  );
}

const dummy = new THREE.Object3D();

function PropModelInstances({
  name,
  model,
  placements,
  outdoorTint,
}: {
  name: PropName;
  model: PropModel;
  placements: PropPlacement[];
  outdoorTint: string;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  // Capacity grows by powers of two, so adding a desk rarely recreates the instanced mesh.
  const capacity = 2 ** Math.ceil(Math.log2(Math.max(8, placements.length)));

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    placements.forEach((placement, index) => {
      dummy.position.set(placement.x, placement.y, placement.z);
      dummy.rotation.set(placement.tilt ?? 0, placement.rotation, 0);
      dummy.scale.setScalar(placement.scale ?? 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(index, dummy.matrix);
    });
    instanced.count = placements.length;
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [placements, capacity]);

  // Only models placed outdoors get instance colors (the attribute changes the shader variant).
  const outdoor = placements.some((placement) => placement.outdoor);
  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced || !outdoor) return;
    const tint = new THREE.Color(outdoorTint);
    placements.forEach((placement, index) => instanced.setColorAt(index, placement.outdoor ? tint : WHITE));
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  }, [placements, capacity, outdoor, outdoorTint]);

  return (
    <instancedMesh
      key={capacity}
      ref={mesh}
      name={name}
      args={[model.geometry, model.material, capacity]}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}
