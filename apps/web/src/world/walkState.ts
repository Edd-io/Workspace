import { create } from 'zustand';

/** What pressing E would use: shown under the crosshair. */
export type WalkAim = 'desk' | 'board' | 'screen' | 'frame' | 'picture' | 'seat' | null;

/** Walk mode state the HUD shows (the 3D controls own the rest). */
export const useWalk = create<{ aim: WalkAim; seated: boolean }>(() => ({ aim: null, seated: false }));

/**
 * Where the visitor was when leaving the walk: pressing V again resumes from there, unless a
 * place was picked meanwhile (a view request newer than `targetSeq`, e.g. a minimap click).
 */
export const walkMemory: {
  pose: { x: number; z: number; yaw: number } | null;
  targetSeq: number | undefined;
} = {
  pose: null,
  targetSeq: undefined,
};
