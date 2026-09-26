import type { FrameSlot } from './decor';

/** Width of the moulding seen from the front, and how far it stands out of the wall. */
export const MOULDING = 0.035;
export const DEPTH = 0.03;
/** The mat (passe-partout) sits that far behind the moulding's front face. */
export const MAT_RECESS = 0.01;
/** Width of the mat around the picture: wider on large frames. */
export function matWidth(slot: Pick<FrameSlot, 'width' | 'height'>): number {
  return Math.min(slot.width, slot.height) >= 0.8 ? 0.08 : 0.055;
}

/** Size of the visible picture inside the mat. */
export function pictureSize(slot: Pick<FrameSlot, 'width' | 'height'>): [number, number] {
  const inset = 2 * (MOULDING + matWidth(slot));
  return [slot.width - inset, slot.height - inset];
}
