/** Pictures the human puts in the office's frames. */

/** Frames are identified by the web client's layout (e.g. `master-3`). */
export const FRAME_ID_PATTERN = /^[a-z0-9-]{1,40}$/;

export const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PictureType = (typeof PICTURE_TYPES)[number];

/** Pictures are downscaled by the browser before upload; this only bounds what the server accepts. */
export const MAX_PICTURE_BYTES = 6 * 1024 * 1024;

export interface FramePicture {
  frameId: string;
  /** Changes whenever the picture does (cache-friendly). */
  url: string;
}
