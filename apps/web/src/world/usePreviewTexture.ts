import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { subscribePreview } from '../state/previews';
import { drawFrame, drawMessage, PREVIEW_HEIGHT, PREVIEW_WIDTH } from './previewCanvas';

export interface ScreenMessage {
  title: string;
  subtitle: string;
  color: string;
}

/**
 * Canvas texture showing a desk's terminal. While `live` is true it follows the server preview
 * frames; otherwise it shows `message` (offline screen).
 */
export function usePreviewTexture(
  deskId: string,
  live: boolean,
  message: ScreenMessage,
): THREE.CanvasTexture {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.anisotropy = 4;
    return result;
  }, []);

  useEffect(() => () => texture.dispose(), [texture]);

  // Live frames: subscribe once per desk, independently of state changes.
  useEffect(() => {
    if (!live) return;
    const canvas = texture.image as HTMLCanvasElement;
    return subscribePreview(deskId, (frame) => {
      drawFrame(canvas, frame);
      texture.needsUpdate = true;
    });
  }, [deskId, live, texture]);

  // Offline screen.
  useEffect(() => {
    if (live) return;
    drawMessage(texture.image as HTMLCanvasElement, message.title, message.subtitle, message.color);
    texture.needsUpdate = true;
  }, [live, message.title, message.subtitle, message.color, texture]);

  return texture;
}
