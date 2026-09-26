import * as THREE from 'three';

/** Sound preferences (per viewer), stored in localStorage when available. */
const KEY = 'workspace.sound';
const VOLUME_KEY = 'workspace.soundVolumes';

/** Background sounds (room tone, outdoors, keyboards) and the visitor's own footsteps. */
export const SOUND_CATEGORIES = ['ambience', 'steps'] as const;
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];
const DEFAULT_VOLUMES: Record<SoundCategory, number> = { ambience: 0.6, steps: 0.6 };

const listeners = new Set<(enabled: boolean) => void>();
const volumeListeners = new Set<(volumes: Record<SoundCategory, number>) => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

function readVolumes(): Record<SoundCategory, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? '{}') as Partial<
      Record<SoundCategory, unknown>
    >;
    const volumes = { ...DEFAULT_VOLUMES };
    for (const category of SOUND_CATEGORIES) {
      const value = saved[category];
      if (typeof value === 'number' && value >= 0 && value <= 1) volumes[category] = value;
    }
    return volumes;
  } catch {
    return { ...DEFAULT_VOLUMES };
  }
}

let enabled = read();
let volumes = readVolumes();

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    // Private mode: keep the setting for this page only.
  }
  for (const listener of listeners) listener(next);
}

export function onSoundEnabledChange(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Volume of a category, 0–1. */
export function soundVolume(category: SoundCategory): number {
  return volumes[category];
}

export function setSoundVolume(category: SoundCategory, value: number): void {
  volumes = { ...volumes, [category]: Math.min(1, Math.max(0, value)) };
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes));
  } catch {
    // Private mode: keep the setting for this page only.
  }
  for (const listener of volumeListeners) listener(volumes);
}

export function onSoundVolumeChange(listener: (volumes: Record<SoundCategory, number>) => void): () => void {
  volumeListeners.add(listener);
  return () => volumeListeners.delete(listener);
}

/** The shared WebAudio context (three.js audio and the UI chime use the same one). */
export function sharedAudioContext(): AudioContext {
  // three's typings declare their own AudioContext shape; at runtime it is the browser's.
  return THREE.AudioContext.getContext() as unknown as AudioContext;
}
