import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  loadSoundLibrary,
  type AmbienceName,
  type LoopSound,
  type SoundLibrary,
  type Surface,
} from '../features/sound/library';
import {
  onSoundEnabledChange,
  onSoundVolumeChange,
  sharedAudioContext,
  soundEnabled,
  soundVolume,
} from '../features/sound/soundSettings';
import { useOffice } from '../state/officeStore';
import { deskToWorld, type OfficeLayout } from './layout';
import { playerPose } from './playerPose';
import { indoorness, surfaceFinder } from './surfaces';

const MAX_TYPISTS = 6;
const HEARING_RANGE = 18;
const TICK = 0.25;
/** Levels of each layer at full category volume (the files are already leveled). */
const GAIN = { indoor: 0.7, outdoor: 1, typing: 0.5, steps: 0.25 };
/** Outdoors can still be heard faintly through the windows. */
const OUTDOOR_THROUGH_WALLS = 0.12;
/** Someone types for a while, then stops to read or think. */
const TYPING_BURST: [number, number] = [2.5, 9];
const TYPING_PAUSE: [number, number] = [1.2, 6];

/** Footsteps are triggered by the walk controller. */
export const footsteps = { step: (): void => undefined };

const between = ([min, max]: [number, number]) => min + Math.random() * (max - min);

/**
 * Sets a sound's level right away. (three's `setVolume` glides there from the current level over
 * ~30 ms: long enough for the attack of a footstep to play at full volume.)
 */
function setLevel(audio: THREE.Audio<AudioNode>, value: number): void {
  const gain = audio.gain.gain;
  gain.cancelScheduledValues(audio.context.currentTime);
  gain.setValueAtTime(value, audio.context.currentTime);
}

function loopingAudio(listener: THREE.AudioListener, sound: LoopSound): THREE.Audio {
  const audio = new THREE.Audio(listener);
  audio.setBuffer(sound.buffer);
  audio.setLoop(true);
  audio.setLoopStart(sound.loopStart);
  audio.setLoopEnd(sound.loopEnd);
  audio.offset = sound.loopStart + Math.random() * (sound.loopEnd - sound.loopStart);
  setLevel(audio, 0);
  return audio;
}

interface Typist {
  sound: THREE.PositionalAudio;
  /** Opens and closes the sound between bursts of typing. */
  gate: GainNode;
  typing: boolean;
  until: number;
}

/**
 * The office as you hear it: recorded room tone indoors, birds by day and insects by night
 * outdoors (blended as you walk out), keyboards at the desks that are actually working
 * (positional, nearest ones, typing in bursts), and footsteps matching the floor.
 */
export function Soundscape({ layout, night }: { layout: OfficeLayout; night: number }) {
  const { camera, scene } = useThree();
  const viewMode = useOffice((state) => state.viewMode);
  const context = sharedAudioContext();
  const [library, setLibrary] = useState<SoundLibrary | null>(null);

  const listener = useMemo(() => new THREE.AudioListener(), []);
  const ears = useMemo(() => new THREE.Object3D(), []);
  const surfaceAt = useMemo(() => surfaceFinder(layout), [layout]);
  const ambience = useRef<Record<AmbienceName, THREE.Audio> | null>(null);
  const typists = useRef(new Map<string, Typist>());
  const volumes = useRef({ ambience: soundVolume('ambience'), steps: soundVolume('steps') });
  const nightRef = useRef(night);
  nightRef.current = night;
  // Handle for automated checks during development (measuring what actually plays).
  if (import.meta.env.DEV)
    (window as unknown as { __soundscape?: unknown }).__soundscape = { listener, context };

  // The sounds are only downloaded once sound is on and the browser lets the page play it.
  useEffect(() => {
    ears.add(listener);
    scene.add(ears);
    const fetchSounds = () => {
      if (context.state === 'running') void loadSoundLibrary(context).then(setLibrary, () => undefined);
    };
    // Muted: suspend the whole audio graph rather than playing it at volume 0 (it costs CPU).
    if (!soundEnabled()) void context.suspend();
    else fetchSounds();
    const offEnabled = onSoundEnabledChange((enabled) => {
      if (enabled) void context.resume().then(fetchSounds);
      else void context.suspend();
    });
    const offVolume = onSoundVolumeChange((next) => {
      volumes.current = { ...next };
    });
    const unlock = () => {
      if (soundEnabled()) void context.resume().then(fetchSounds);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      offEnabled();
      offVolume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      scene.remove(ears);
      ears.remove(listener);
    };
  }, [context, ears, listener, scene]);

  useEffect(() => {
    if (!library) return;
    const layers = {
      'ambience-indoor': loopingAudio(listener, library.ambience['ambience-indoor']),
      'ambience-day': loopingAudio(listener, library.ambience['ambience-day']),
      'ambience-night': loopingAudio(listener, library.ambience['ambience-night']),
    };
    for (const layer of Object.values(layers)) layer.play();
    ambience.current = layers;

    // A few reusable footstep voices (creating one per step would leak audio nodes).
    const voices = Array.from({ length: 4 }, () => new THREE.Audio(listener));
    let voiceIndex = 0;
    const lastVariant: Partial<Record<Surface, number>> = {};
    footsteps.step = () => {
      if (context.state !== 'running' || volumes.current.steps === 0) return;
      const surface = surfaceAt(ears.position.x, ears.position.z);
      const variants = library.steps[surface];
      // Never the same recording twice in a row.
      let variant = Math.floor(Math.random() * variants.length);
      if (variant === lastVariant[surface]) variant = (variant + 1) % variants.length;
      lastVariant[surface] = variant;
      const voice = voices[voiceIndex++ % voices.length]!;
      if (voice.isPlaying) voice.stop();
      voice.setBuffer(variants[variant]!.buffer);
      voice.offset = variants[variant]!.offset;
      voice.setPlaybackRate(0.93 + Math.random() * 0.14);
      setLevel(voice, GAIN.steps * volumes.current.steps * (0.75 + Math.random() * 0.25));
      voice.play();
    };

    const currentTypists = typists.current;
    return () => {
      footsteps.step = () => undefined;
      for (const layer of Object.values(layers)) if (layer.isPlaying) layer.stop();
      for (const voice of voices) if (voice.isPlaying) voice.stop();
      ambience.current = null;
      for (const { sound } of currentTypists.values()) {
        if (sound.isPlaying) sound.stop();
        sound.removeFromParent();
      }
      currentTypists.clear();
    };
  }, [context, ears, library, listener, surfaceAt]);

  const lastTick = useRef(-Infinity);
  useFrame(({ clock }) => {
    // Listen from the camera when walking, from the point looked at in the overview.
    const walking = viewMode === 'walk';
    if (walking) ears.position.copy(camera.position);
    else ears.position.set(playerPose.x, 5, playerPose.z);
    ears.quaternion.copy(camera.quaternion);
    ears.updateMatrixWorld();

    if (!library || clock.elapsedTime - lastTick.current < TICK || context.state !== 'running') return;
    lastTick.current = clock.elapsedTime;
    const now = context.currentTime;
    const volume = volumes.current.ambience;

    // Ambience layers, cross-faded as the visitor walks in or out and as night falls.
    const layers = ambience.current;
    if (layers) {
      const inside = walking ? indoorness(layout, ears.position.x, ears.position.z) : 0.8;
      const outdoors = volume * GAIN.outdoor * (1 - inside + inside * OUTDOOR_THROUGH_WALLS);
      const fade = (audio: THREE.Audio, target: number) => audio.gain.gain.setTargetAtTime(target, now, 0.4);
      fade(layers['ambience-indoor'], volume * GAIN.indoor * inside);
      fade(layers['ambience-day'], outdoors * (1 - nightRef.current));
      fade(layers['ambience-night'], outdoors * nightRef.current);
    }

    // Keyboards of the nearest working desks.
    const { desks } = useOffice.getState();
    const candidates = layout.desks
      .filter((entry) => desks[entry.desk.id]?.state === 'working')
      .map((entry) => ({ entry, distance: Math.hypot(entry.x - ears.position.x, entry.z - ears.position.z) }))
      .filter(({ distance }) => distance < HEARING_RANGE)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_TYPISTS);
    const wanted = new Set(candidates.map(({ entry }) => entry.desk.id));
    for (const [deskId, typist] of typists.current) {
      if (wanted.has(deskId)) continue;
      if (typist.sound.isPlaying) typist.sound.stop();
      typist.sound.removeFromParent();
      typists.current.delete(deskId);
    }
    for (const { entry } of candidates) {
      if (typists.current.has(entry.desk.id)) continue;
      const recording = library.typing[entry.desk.appearanceSeed % library.typing.length]!;
      const sound = new THREE.PositionalAudio(listener);
      // Plain stereo panning: the default HRTF spatialization is much heavier on the CPU.
      sound.panner.panningModel = 'equalpower';
      sound.setBuffer(recording.buffer);
      sound.setLoop(true);
      sound.setLoopStart(recording.loopStart);
      sound.setLoopEnd(recording.loopEnd);
      sound.offset = recording.loopStart + Math.random() * (recording.loopEnd - recording.loopStart);
      sound.setRefDistance(1.5);
      sound.setRolloffFactor(1.6);
      sound.setMaxDistance(HEARING_RANGE);
      setLevel(sound, GAIN.typing * volumes.current.ambience);
      const gate = context.createGain();
      gate.gain.value = 0;
      sound.setFilter(gate);
      sound.position.set(...deskToWorld(entry, [0, 0.8, 0.1]));
      scene.add(sound);
      sound.play();
      typists.current.set(entry.desk.id, { sound, gate, typing: false, until: now + Math.random() * 2 });
    }
    for (const typist of typists.current.values()) {
      typist.sound.setVolume(GAIN.typing * volume);
      if (now < typist.until) continue;
      typist.typing = !typist.typing;
      typist.until = now + between(typist.typing ? TYPING_BURST : TYPING_PAUSE);
      typist.gate.gain.setTargetAtTime(typist.typing ? 1 : 0, now, 0.12);
    }
  });

  return null;
}
