import xtermHeadless from '@xterm/headless';
import xtermSerialize from '@xterm/addon-serialize';
import {
  PREVIEW_FLAG_BOLD,
  PREVIEW_FLAG_DIM,
  PREVIEW_FLAG_INVERSE,
  PREVIEW_FLAG_ITALIC,
  PREVIEW_FLAG_UNDERLINE,
  type PreviewFrame,
  type PreviewRun,
} from '@workspace/shared';
import { paletteColor, rgbColor } from './palette.ts';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = xtermSerialize;

type HeadlessTerminal = InstanceType<typeof Terminal>;
type BufferCell = NonNullable<
  ReturnType<NonNullable<ReturnType<HeadlessTerminal['buffer']['active']['getLine']>>['getCell']>
>;

export interface TerminalFrame {
  cols: number;
  rows: number;
  cursor: [number, number];
  lines: PreviewFrame;
}

function cellColor(cell: BufferCell, which: 'fg' | 'bg'): string | null {
  if (which === 'fg') {
    if (cell.isFgDefault()) return null;
    if (cell.isFgRGB()) return rgbColor(cell.getFgColor());
    return paletteColor(cell.getFgColor());
  }
  if (cell.isBgDefault()) return null;
  if (cell.isBgRGB()) return rgbColor(cell.getBgColor());
  return paletteColor(cell.getBgColor());
}

function cellFlags(cell: BufferCell): number {
  let flags = 0;
  if (cell.isBold()) flags |= PREVIEW_FLAG_BOLD;
  if (cell.isDim()) flags |= PREVIEW_FLAG_DIM;
  if (cell.isItalic()) flags |= PREVIEW_FLAG_ITALIC;
  if (cell.isUnderline()) flags |= PREVIEW_FLAG_UNDERLINE;
  if (cell.isInverse()) flags |= PREVIEW_FLAG_INVERSE;
  return flags;
}

/**
 * Server-side copy of a desk's terminal. Lets any client get the current screen instantly
 * (serialized snapshot) and produces lightweight frames for the 3D monitor previews.
 */
export class TerminalMirror {
  private readonly terminal: HeadlessTerminal;
  private readonly serializer: InstanceType<typeof SerializeAddon>;
  /** Incremented on every write; lets the preview loop skip unchanged screens. */
  revision = 0;

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({ cols, rows, scrollback: 2000, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
  }

  get cols(): number {
    return this.terminal.cols;
  }

  get rows(): number {
    return this.terminal.rows;
  }

  write(data: string): void {
    this.terminal.write(data);
    this.revision++;
  }

  resize(cols: number, rows: number): void {
    if (cols === this.terminal.cols && rows === this.terminal.rows) return;
    this.terminal.resize(cols, rows);
    this.revision++;
  }

  /** Waits for pending writes to be parsed (xterm parses asynchronously). */
  flush(): Promise<void> {
    return new Promise((resolve) => this.terminal.write('', resolve));
  }

  snapshot(): string {
    return this.serializer.serialize({ scrollback: 500 });
  }

  /** Plain text of the visible screen (used for heuristics such as prompts detection). */
  screenText(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < this.terminal.rows; y++) {
      lines.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  }

  frame(): TerminalFrame {
    const buffer = this.terminal.buffer.active;
    const lines: PreviewFrame = [];
    let cell = buffer.getNullCell();
    for (let y = 0; y < this.terminal.rows; y++) {
      const line = buffer.getLine(buffer.viewportY + y);
      const runs: PreviewRun[] = [];
      if (line) {
        let current: PreviewRun | null = null;
        for (let x = 0; x < this.terminal.cols; x++) {
          const next = line.getCell(x, cell);
          if (!next) break;
          cell = next;
          if (cell.getWidth() === 0) continue;
          const chars = cell.getChars() || ' ';
          const fg = cellColor(cell, 'fg');
          const bg = cellColor(cell, 'bg');
          const flags = cellFlags(cell);
          if (current && current[1] === fg && current[2] === bg && current[3] === flags) {
            current[0] += chars;
          } else {
            current = [chars, fg, bg, flags];
            runs.push(current);
          }
        }
        // Trim trailing blank run with default colors to keep frames small.
        const last = runs.at(-1);
        if (last && last[2] === null && last[3] === 0) {
          last[0] = last[0].trimEnd();
          if (last[0] === '') runs.pop();
        }
      }
      lines.push(runs);
    }
    return {
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      cursor: [buffer.cursorX, buffer.cursorY],
      lines,
    };
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
