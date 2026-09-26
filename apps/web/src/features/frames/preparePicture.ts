/** Longest side of a picture once hung: plenty for a frame, light on the GPU and the disk. */
const MAX_SIDE = 1280;
/** Transparent areas take the color of the frame's mat. */
const BACKGROUND = '#f2efe8';
const QUALITY = 0.9;

/** Decodes an image file, downscales it and re-encodes it as JPEG (also strips its metadata). */
export async function preparePicture(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d')!;
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Cannot encode the picture.'))),
      'image/jpeg',
      QUALITY,
    ),
  );
}
