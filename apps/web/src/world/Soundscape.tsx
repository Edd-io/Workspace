import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { onSoundEnabledChange, sharedAudioContext, soundEnabled } from '../features/sound/soundSettings';
import { footstepBuffer, roomToneBuffer, typingBuffer } from '../features/sound/synth';
import { useOffice } from '../state/officeStore';
import { deskToWorld, type OfficeLayout } from './layout';
import { playerPose } from './playerPose';

const MAX_TYPISTS = 8;
const HEARING_RANGE = 22;
const TYPING_BUFFERS = 4;
const MASTER_VOLUME = 0.9;

/** Footsteps are triggered by the walk controller. */
export const footsteps = { step: (): void => undefined };

/**
 * The office as you hear it: room tone everywhere, keyboards typing at the desks that are
 * actually working (positional, nearest ones only), footsteps when walking.
 */
export function Soundscape({ layout }: { layout: OfficeLayout }) {
  const { camera, scene } = useThree();
  const viewMode = useOffice((state) => state.viewMode);
  const context = sharedAudioContext();

  const listener = useMemo(() => new THREE.AudioListener(), []);
  const ears = useMemo(() => new THREE.Object3D(), []);
  const buffers = useMemo(
    () => ({
      typing: Array.from({ length: TYPING_BUFFERS }, (_, index) => typingBuffer(context, 12, index + 1)),
      tone: roomToneBuffer(context),
      steps: [footstepBuffer(context, 1), footstepBuffer(context, 2), footstepBuffer(context, 3)],
    }),
    [context],
  );
  const typists = useRef(new Map<string, THREE.PositionalAudio>());
  const stepIndex = useRef(0);

  useEffect(() => {
    ears.add(listener);
    scene.add(ears);
    listener.setMasterVolume(MASTER_VOLUME);
    // Muted: suspend the whole audio graph rather than playing it at volume 0 (it costs CPU).
    if (!soundEnabled()) void context.suspend();
    const off = onSoundEnabledChange((enabled) => {
      if (enabled) void context.resume().then(startTone);
      else void context.suspend();
    });

    const tone = new THREE.Audio(listener);
    tone.setBuffer(buffers.tone);
    tone.setLoop(true);
    tone.setVolume(0.05);
    const startTone = () => {
      if (context.state === 'running' && !tone.isPlaying) tone.play();
    };
    startTone();
    const unlock = () => {
      if (soundEnabled()) void context.resume().then(startTone);
    };
    window.addEventListener('pointerdown', unlock);

    // A few reusable footstep voices (creating one per step would leak audio nodes).
    const stepVoices = buffers.steps.map((buffer) => {
      const voice = new THREE.Audio(listener);
      voice.setBuffer(buffer);
      voice.setVolume(0.35);
      return voice;
    });
    footsteps.step = () => {
      if (context.state !== 'running') return;
      const voice = stepVoices[stepIndex.current++ % stepVoices.length]!;
      if (voice.isPlaying) voice.stop();
      voice.play();
    };

    const currentTypists = typists.current;
    return () => {
      off();
      window.removeEventListener('pointerdown', unlock);
      footsteps.step = () => undefined;
      if (tone.isPlaying) tone.stop();
      for (const sound of currentTypists.values()) {
        if (sound.isPlaying) sound.stop();
        sound.removeFromParent();
      }
      currentTypists.clear();
      scene.remove(ears);
      ears.remove(listener);
    };
  }, [buffers, context, ears, listener, scene]);

  const lastUpdate = useRef(0);
  useFrame(({ clock }) => {
    // Listen from the camera when walking, from the point looked at in the overview.
    if (viewMode === 'walk') {
      ears.position.copy(camera.position);
    } else {
      ears.position.set(playerPose.x, 5, playerPose.z);
    }
    ears.quaternion.copy(camera.quaternion);
    ears.updateMatrixWorld();

    if (clock.elapsedTime - lastUpdate.current < 0.5 || context.state !== 'running') return;
    lastUpdate.current = clock.elapsedTime;
    const { desks } = useOffice.getState();
    const candidates = layout.desks
      .filter((entry) => desks[entry.desk.id]?.state === 'working')
      .map((entry) => ({ entry, distance: Math.hypot(entry.x - ears.position.x, entry.z - ears.position.z) }))
      .filter(({ distance }) => distance < HEARING_RANGE)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_TYPISTS);
    const wanted = new Set(candidates.map(({ entry }) => entry.desk.id));

    for (const [deskId, sound] of typists.current) {
      if (wanted.has(deskId)) continue;
      if (sound.isPlaying) sound.stop();
      sound.removeFromParent();
      typists.current.delete(deskId);
    }
    for (const { entry } of candidates) {
      if (typists.current.has(entry.desk.id)) continue;
      const sound = new THREE.PositionalAudio(listener);
      // Plain stereo panning: the default HRTF spatialization is much heavier on the CPU.
      sound.panner.panningModel = 'equalpower';
      const buffer = buffers.typing[entry.desk.appearanceSeed % TYPING_BUFFERS]!;
      sound.setBuffer(buffer);
      sound.setLoop(true);
      sound.setRefDistance(1.2);
      sound.setRolloffFactor(1.4);
      sound.setMaxDistance(HEARING_RANGE);
      sound.setVolume(0.8);
      sound.position.set(...deskToWorld(entry, [0, 0.8, 0.1]));
      scene.add(sound);
      sound.offset = ((entry.desk.appearanceSeed % 1000) / 1000) * buffer.duration;
      sound.play();
      typists.current.set(entry.desk.id, sound);
    }
  });

  return null;
}
