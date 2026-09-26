import { create } from 'zustand';

/** What pressing E would use: shown under the crosshair. */
export type WalkAim = 'desk' | 'board' | 'screen' | 'frame' | 'picture' | 'seat' | null;

/** Walk mode state the HUD shows (the 3D controls own the rest). */
export const useWalk = create<{ aim: WalkAim; seated: boolean }>(() => ({ aim: null, seated: false }));
