import { describe, expect, it } from 'vitest';
import { localTime } from '../src/office/summarizer.ts';

describe('localTime', () => {
  it('formats a date, a time and the offset for the briefing prompt', () => {
    expect(localTime(Date.UTC(2026, 8, 26, 15, 26))).toMatch(/^2026-09-2\d \d{2}:\d{2} \S+/);
  });
});
