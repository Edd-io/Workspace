import { useSyncExternalStore } from 'react';

/**
 * Graphics quality (per viewer), stored in localStorage when available. The office is mostly still,
 * so most of the GPU time goes to redrawing identical frames: each level caps the resolution, the
 * frame rate and how often the sun shadows are recomputed.
 */
export type GraphicsQuality = 'eco' | 'normal' | 'max';

export const GRAPHICS_QUALITIES: GraphicsQuality[] = ['eco', 'normal', 'max'];

export interface GraphicsProfile {
  /** Upper bound of the device pixel ratio used for rendering. */
  maxDpr: number;
  /** Frames per second while the camera moves, the pointer is over the office, or walking. */
  activeFps: number;
  /** Frames per second when nothing is being done in the office (characters still animate). */
  idleFps: number;
  /** Frames per second while a terminal is open or the window is not focused. */
  backgroundFps: number;
  shadowMapSize: number;
  /** How many times per second the sun shadows are recomputed (Infinity: every frame). */
  shadowUpdatesPerSecond: number;
}

export const GRAPHICS_PROFILES: Record<GraphicsQuality, GraphicsProfile> = {
  eco: {
    maxDpr: 1,
    activeFps: 30,
    idleFps: 15,
    backgroundFps: 6,
    shadowMapSize: 1024,
    shadowUpdatesPerSecond: 0.5,
  },
  normal: {
    maxDpr: 1.5,
    activeFps: 60,
    idleFps: 30,
    backgroundFps: 10,
    shadowMapSize: 2048,
    shadowUpdatesPerSecond: 4,
  },
  max: {
    maxDpr: 2,
    activeFps: Infinity,
    idleFps: 60,
    backgroundFps: 30,
    shadowMapSize: 4096,
    shadowUpdatesPerSecond: Infinity,
  },
};

const KEY = 'workspace.graphics';
const listeners = new Set<() => void>();

function read(): GraphicsQuality {
  try {
    const stored = localStorage.getItem(KEY);
    return GRAPHICS_QUALITIES.includes(stored as GraphicsQuality) ? (stored as GraphicsQuality) : 'normal';
  } catch {
    return 'normal';
  }
}

let quality = read();

export function graphicsQuality(): GraphicsQuality {
  return quality;
}

export function setGraphicsQuality(next: GraphicsQuality): void {
  quality = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private mode: keep the setting for this page only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGraphicsQuality(): GraphicsQuality {
  return useSyncExternalStore(subscribe, graphicsQuality);
}
