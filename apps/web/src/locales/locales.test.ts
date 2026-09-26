import { describe, expect, it } from 'vitest';
import en from './en/common.json';
import fr from './fr/common.json';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe('locales', () => {
  it('defines exactly the same keys in every language', () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });

  it('has no empty translation', () => {
    for (const locale of [en, fr]) {
      for (const key of keys(locale)) {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], locale);
        expect(value, key).not.toBe('');
      }
    }
  });
});
