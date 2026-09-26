import {
  PREVIEW_FLAG_BOLD,
  PREVIEW_FLAG_DIM,
  PREVIEW_FLAG_INVERSE,
  PREVIEW_FLAG_ITALIC,
} from '@workspace/shared';
import type { PreviewFrameMessage } from '../state/previews';

export const PREVIEW_WIDTH = 768;
export const PREVIEW_HEIGHT = 480;
const BACKGROUND = '#0d1117';
const FOREGROUND = '#d0d7de';
const FONT_FAMILY = '"JetBrains Mono", ui-monospace, monospace';

/** Draws a terminal preview frame into a canvas used as a monitor texture. */
export function drawFrame(canvas: HTMLCanvasElement, frame: PreviewFrameMessage): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, width, height);

  const cellWidth = width / frame.cols;
  const cellHeight = height / frame.rows;
  const fontSize = Math.min(cellHeight * 0.92, cellWidth / 0.6);
  context.textBaseline = 'middle';

  frame.lines.forEach((runs, row) => {
    let column = 0;
    const y = row * cellHeight;
    for (const [text, fg, bg, flags] of runs) {
      const length = [...text].length;
      const inverse = (flags & PREVIEW_FLAG_INVERSE) !== 0;
      const background = inverse ? (fg ?? FOREGROUND) : bg;
      const foreground = inverse ? (bg ?? BACKGROUND) : (fg ?? FOREGROUND);
      if (background) {
        context.fillStyle = background;
        context.fillRect(column * cellWidth, y, length * cellWidth + 0.5, cellHeight + 0.5);
      }
      if (text.trim() !== '') {
        const weight = flags & PREVIEW_FLAG_BOLD ? '700' : '400';
        const style = flags & PREVIEW_FLAG_ITALIC ? 'italic ' : '';
        context.font = `${style}${weight} ${fontSize}px ${FONT_FAMILY}`;
        context.globalAlpha = flags & PREVIEW_FLAG_DIM ? 0.6 : 1;
        context.fillStyle = foreground;
        // Draw per character to keep the monospace grid aligned whatever the font metrics.
        let index = 0;
        for (const char of text) {
          if (char !== ' ') context.fillText(char, (column + index) * cellWidth, y + cellHeight / 2);
          index++;
        }
        context.globalAlpha = 1;
      }
      column += length;
    }
  });
}

/** Screen shown before the first frame arrives or when the desk is offline. */
export function drawMessage(canvas: HTMLCanvasElement, title: string, subtitle: string, color: string): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, width, height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = color;
  context.font = `700 44px ${FONT_FAMILY}`;
  context.fillText(title, width / 2, height / 2 - 24);
  context.fillStyle = '#8b949e';
  context.font = `400 26px ${FONT_FAMILY}`;
  context.fillText(subtitle, width / 2, height / 2 + 30);
  context.textAlign = 'start';
}
