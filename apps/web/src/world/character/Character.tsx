import { useAnimations, useGLTF } from '@react-three/drei';
import type { DeskState } from '@workspace/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HAIR_STYLES, seededRandom, type Appearance } from '../appearance';
import type { TripClip } from '../trips';

export const CHARACTER_URL = '/models/character.glb';

type Clip = 'Typing' | 'Idle' | 'LeanBack' | 'RaiseHand' | 'Drink' | 'HeadInHands' | 'Sleep' | TripClip;

/** Clips during which the character holds its coffee cup. */
const CUP_CLIPS = new Set<Clip>(['Drink', 'StandDrink']);

/** Idle desks alternate between these, so a quiet office still looks alive. */
const IDLE_ROTATION: Clip[] = ['Idle', 'LeanBack', 'Idle', 'Drink'];
const IDLE_SWITCH_SECONDS = [14, 26] as const;
const FADE_SECONDS = 0.45;

function clipFor(state: DeskState, idleIndex: number): Clip {
  switch (state) {
    case 'working':
    case 'compacting':
      return 'Typing';
    case 'question':
      return 'RaiseHand';
    case 'error':
      return 'HeadInHands';
    case 'limited':
      // Waiting for the usage window: coffee break.
      return 'Drink';
    default:
      return IDLE_ROTATION[idleIndex % IDLE_ROTATION.length]!;
  }
}

const COLOR_KEYS = ['skin', 'hair', 'shirt', 'pants', 'shoes'] as const;

interface Props {
  appearance: Appearance;
  state: DeskState;
  seed: number;
  /** Away from the desk (see trips.ts): the clip of the trip replaces the seated ones. */
  tripClip?: TripClip | null;
  timeScale?: number;
}

/** A seated office character (Blender rig) animated from its desk state. */
export function Character({ appearance, state, seed, tripClip = null, timeScale = 1 }: Props) {
  const gltf = useGLTF(CHARACTER_URL);
  const group = useRef<THREE.Group>(null);

  // Own copy of the skinned hierarchy and of the materials we recolor.
  const model = useMemo(() => {
    const scene = clone(gltf.scene);
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    scene.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const swap = (material: THREE.Material) => {
        const existing = materials.get(material.name);
        if (existing) return existing;
        const copy = (material as THREE.MeshStandardMaterial).clone();
        materials.set(material.name, copy);
        return copy;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    return { scene, materials };
  }, [gltf.scene]);

  useEffect(() => {
    for (const key of COLOR_KEYS) model.materials.get(key)?.color.set(appearance[key]);
    model.scene.traverse((object) => {
      if (HAIR_STYLES.includes(object.name as (typeof HAIR_STYLES)[number])) {
        object.visible = object.name === appearance.hairStyle;
      }
      if (object.name === 'glasses') object.visible = appearance.glasses;
    });
  }, [model, appearance]);

  useEffect(
    () => () => {
      for (const material of model.materials.values()) material.dispose();
    },
    [model],
  );

  const { actions } = useAnimations(gltf.animations, group);

  // Idle variations change every 14-26 s, at a pace specific to each character.
  const [idleIndex, setIdleIndex] = useState(() => Math.floor(seededRandom(seed)() * IDLE_ROTATION.length));
  useEffect(() => {
    if (state !== 'idle' && state !== 'starting') return;
    const random = seededRandom(seed + idleIndex);
    const delay =
      (IDLE_SWITCH_SECONDS[0] + random() * (IDLE_SWITCH_SECONDS[1] - IDLE_SWITCH_SECONDS[0])) * 1000;
    const timer = window.setTimeout(() => setIdleIndex((index) => index + 1), delay);
    return () => window.clearTimeout(timer);
  }, [state, idleIndex, seed]);

  const clip: Clip = tripClip ?? clipFor(state, idleIndex);
  const previous = useRef<THREE.AnimationAction | null>(null);
  useEffect(() => {
    const action = actions[clip];
    if (!action) return;
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    // Desynchronize characters playing the same clip.
    action.time = seededRandom(seed)() * action.getClip().duration;
    action.fadeIn(FADE_SECONDS).play();
    if (previous.current && previous.current !== action) previous.current.fadeOut(FADE_SECONDS);
    previous.current = action;
  }, [actions, clip, seed]);

  useEffect(() => {
    actions[clip]?.setEffectiveTimeScale(timeScale);
  }, [actions, clip, timeScale]);

  useEffect(() => {
    model.scene.traverse((object) => {
      if (object.name === 'cup') object.visible = CUP_CLIPS.has(clip);
    });
  }, [model, clip]);

  return (
    <group ref={group}>
      <primitive object={model.scene} />
    </group>
  );
}

useGLTF.preload(CHARACTER_URL);
