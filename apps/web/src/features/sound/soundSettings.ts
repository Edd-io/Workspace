import * as THREE from 'three';

/** Sound preference (per viewer), stored in localStorage when available. */
const KEY = 'workspace.sound';
const listeners = new Set<(enabled: boolean) => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

let enabled = read();

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

/** The shared WebAudio context (three.js audio and the UI chime use the same one). */
export function sharedAudioContext(): AudioContext {
  // three's typings declare their own AudioContext shape; at runtime it is the browser's.
  return THREE.AudioContext.getContext() as unknown as AudioContext;
}
