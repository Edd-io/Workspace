import * as THREE from 'three';
import { seededRandom } from './appearance';

/** Procedural canvas textures for floors, so the office needs no downloaded image. */

function canvasTexture(
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
  repeat: number,
) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function shade(hex: string, amount: number): string {
  const color = new THREE.Color(hex);
  color.offsetHSL(0, 0, amount);
  return `#${color.getHexString()}`;
}

/** Wood planks, one texture tile ≈ 2 m. */
export function woodTexture(base: string): THREE.CanvasTexture {
  return canvasTexture(
    512,
    (context, size) => {
      const random = seededRandom(42);
      const plank = size / 8;
      for (let row = 0; row < 8; row++) {
        let x = -random() * size;
        while (x < size) {
          const length = size * (0.35 + random() * 0.4);
          context.fillStyle = shade(base, (random() - 0.5) * 0.08);
          context.fillRect(x, row * plank, length, plank);
          context.strokeStyle = shade(base, -0.12);
          context.lineWidth = 1.5;
          context.strokeRect(x, row * plank, length, plank);
          for (let grain = 0; grain < 5; grain++) {
            context.strokeStyle = `rgba(0, 0, 0, ${0.03 + random() * 0.04})`;
            context.beginPath();
            const y = row * plank + random() * plank;
            context.moveTo(x, y);
            context.bezierCurveTo(x + length / 3, y + 3, x + (2 * length) / 3, y - 3, x + length, y);
            context.stroke();
          }
          x += length;
        }
      }
    },
    1,
  );
}

/** Low-pile office carpet: fine noise plus faint carpet-tile seams. */
export function carpetTexture(base: string): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (context, size) => {
      const random = seededRandom(7);
      context.fillStyle = base;
      context.fillRect(0, 0, size, size);
      const image = context.getImageData(0, 0, size, size);
      for (let i = 0; i < image.data.length; i += 4) {
        const noise = (random() - 0.5) * 22;
        image.data[i] = Math.max(0, Math.min(255, image.data[i]! + noise));
        image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1]! + noise));
        image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2]! + noise));
      }
      context.putImageData(image, 0, 0);
      context.strokeStyle = 'rgba(0, 0, 0, 0.08)';
      context.lineWidth = 2;
      context.strokeRect(0, 0, size, size);
    },
    1,
  );
}

/** Large light floor tiles for the corridor. */
export function tileTexture(base: string): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (context, size) => {
      const random = seededRandom(3);
      const tile = size / 2;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          context.fillStyle = shade(base, (random() - 0.5) * 0.04);
          context.fillRect(i * tile, j * tile, tile, tile);
        }
      }
      context.strokeStyle = shade(base, -0.15);
      context.lineWidth = 2;
      for (let k = 0; k <= 2; k++) {
        context.beginPath();
        context.moveTo(k * tile, 0);
        context.lineTo(k * tile, size);
        context.moveTo(0, k * tile);
        context.lineTo(size, k * tile);
        context.stroke();
      }
    },
    1,
  );
}

/** Blends a room accent color into a neutral carpet color. */
export function carpetColor(accent: string): string {
  const color = new THREE.Color('#7d7a75').lerp(new THREE.Color(accent), 0.28);
  return `#${color.getHexString()}`;
}
