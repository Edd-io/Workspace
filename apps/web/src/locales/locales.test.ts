import { describe, expect, it } from 'vitest';
import { LANGUAGE_TAGS, LANGUAGES } from '@workspace/shared/languages';

type Dictionary = Record<string, unknown>;

const files = import.meta.glob<Dictionary>('./*/common.json', { eager: true, import: 'default' });
const locales = Object.fromEntries(
  Object.entries(files).map(([path, dictionary]) => [path.split('/')[1], dictionary]),
);
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Every leaf of the dictionary, as a dotted key and its text. */
function entries(value: unknown, prefix = ''): [string, unknown][] {
  if (typeof value !== 'object' || value === null) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) => entries(child, prefix ? `${prefix}.${key}` : key));
}

function variables(text: unknown): string[] {
  return [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!).sort();
}

/** Plural forms a language needs for whole counts, and the ones it can use at all. */
function pluralForms(language: string): { needed: Set<string>; allowed: Set<string> } {
  const rules = new Intl.PluralRules(LANGUAGE_TAGS[language as keyof typeof LANGUAGE_TAGS]);
  const needed = new Set(['other']);
  for (let count = 0; count <= 1000; count++) needed.add(rules.select(count));
  return { needed, allowed: new Set(rules.resolvedOptions().pluralCategories) };
}

const english = new Map(entries(locales.en));
const englishBases = new Set([...english.keys()].map((key) => key.replace(PLURAL_SUFFIX, '')));
const englishPlurals = new Set(
  [...english.keys()].filter((key) => PLURAL_SUFFIX.test(key)).map((key) => key.replace(PLURAL_SUFFIX, '')),
);

describe('locales', () => {
  it('has a folder for every supported language, and no other', () => {
    expect(Object.keys(locales).sort()).toEqual([...LANGUAGES].sort());
  });
});

describe.each(LANGUAGES.filter((language) => language !== 'en'))('%s locale', (language) => {
  const locale = new Map(entries(locales[language]));
  const { needed, allowed } = pluralForms(language);

  it('translates exactly the English keys', () => {
    const bases = new Set([...locale.keys()].map((key) => key.replace(PLURAL_SUFFIX, '')));
    expect([...bases].sort()).toEqual([...englishBases].sort());
  });

  it('has the plural forms of the language, and only those', () => {
    for (const base of englishPlurals) {
      const forms = [...locale.keys()]
        .filter((key) => key.replace(PLURAL_SUFFIX, '') === base && PLURAL_SUFFIX.test(key))
        .map((key) => PLURAL_SUFFIX.exec(key)![1]!);
      for (const form of needed) expect(forms, `${base}_${form}`).toContain(form);
      for (const form of forms) expect(allowed.has(form), `${base}_${form}`).toBe(true);
    }
  });

  it('keeps the interpolated variables', () => {
    for (const [key, text] of locale) {
      const base = key.replace(PLURAL_SUFFIX, '');
      const source = english.get(key) ?? english.get(`${base}_other`);
      expect(variables(text), key).toEqual(variables(source));
    }
  });
});

describe.each(LANGUAGES)('%s texts', (language) => {
  it('has no empty translation', () => {
    for (const [key, text] of entries(locales[language])) {
      expect(typeof text, key).toBe('string');
      expect(text, key).not.toBe('');
    }
  });
});
