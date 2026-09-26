import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { subscribePreview } from '../state/previews';
import { drawFrame, drawMessage, PREVIEW_HEIGHT, PREVIEW_WIDTH } from './previewCanvas';

const SNAPSHOT_MS = 20_000;

export interface ScreenMessage {
  title: string;
  subtitle: string;
  color: string;
}

/**
 * Canvas texture showing a desk's terminal. While `live` is true it shows the server preview
 * frames (streamed only while `stream` is true, the last frame stays otherwise); when not live it
 * shows `message` (offline screen).
 */
export function usePreviewTexture(
  deskId: string,
  live: boolean,
  message: ScreenMessage,
  stream = true,
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

  // Live frames: subscribe once per desk, independently of state changes. Far desks only take a
  // snapshot now and then instead of streaming.
  useEffect(() => {
    if (!live) return;
    const canvas = texture.image as HTMLCanvasElement;
    const draw = (frame: Parameters<typeof drawFrame>[1]) => {
      drawFrame(canvas, frame);
      texture.needsUpdate = true;
    };
    if (stream) return subscribePreview(deskId, draw);
    let close: (() => void) | null = null;
    const snapshot = () => {
      close?.();
      close = subscribePreview(deskId, (frame) => {
        draw(frame);
        // First frame received: stop listening until the next snapshot.
        queueMicrotask(() => {
          close?.();
          close = null;
        });
      });
    };
    snapshot();
    const timer = window.setInterval(snapshot, SNAPSHOT_MS);
    return () => {
      window.clearInterval(timer);
      close?.();
    };
  }, [deskId, live, stream, texture]);

  // Offline screen.
  useEffect(() => {
    if (live) return;
    drawMessage(texture.image as HTMLCanvasElement, message.title, message.subtitle, message.color);
    texture.needsUpdate = true;
  }, [live, message.title, message.subtitle, message.color, texture]);

  return texture;
}
