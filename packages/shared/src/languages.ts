// No zod here: the web client imports this module on its own (`@workspace/shared/languages`) to keep
// the schemas out of its first bundle.

/** Languages of the web client: one folder each under `apps/web/src/locales/`. */
export const LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'zh'] as const;
export type Language = (typeof LANGUAGES)[number];

/** BCP 47 tag of the variant each locale file is written in (for display names and prompts). */
export const LANGUAGE_TAGS: Record<Language, string> = {
  de: 'de',
  en: 'en',
  es: 'es',
  fr: 'fr',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  pt: 'pt-BR',
  ru: 'ru',
  zh: 'zh-Hans',
};

export function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}
