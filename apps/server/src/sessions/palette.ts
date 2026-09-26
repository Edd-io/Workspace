/** xterm's default 16-color palette followed by the 6×6×6 cube and the grayscale ramp. */
const BASE_16 = [
  '#2e3436',
  '#cd3131',
  '#0dbc79',
  '#e5e510',
  '#2472c8',
  '#bc3fbc',
  '#11a8cd',
  '#e5e5e5',
  '#666666',
  '#f14c4c',
  '#23d18b',
  '#f5f543',
  '#3b8eea',
  '#d670d6',
  '#29b8db',
  '#ffffff',
];

function hex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

const PALETTE_256: string[] = (() => {
  const colors = [...BASE_16];
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        colors.push(`#${hex(steps[r]!)}${hex(steps[g]!)}${hex(steps[b]!)}`);
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const level = 8 + i * 10;
    colors.push(`#${hex(level)}${hex(level)}${hex(level)}`);
  }
  return colors;
})();

export function paletteColor(index: number): string {
  return PALETTE_256[index] ?? '#ffffff';
}

export function rgbColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}
