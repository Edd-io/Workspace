import { describe, expect, it } from 'vitest';
import { stripMarkdown } from './markdown';

describe('stripMarkdown', () => {
  it('removes headings, bold and bullets but keeps file names intact', () => {
    expect(stripMarkdown('# Title\n- **Ken**: tests go in __tests__\n- *done*')).toBe(
      'Title\n• Ken: tests go in __tests__\n• done',
    );
  });
});
