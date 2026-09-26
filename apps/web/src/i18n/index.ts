import i18n, { type BackendModule, type ResourceKey } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { isLanguage, LANGUAGE_TAGS, LANGUAGES, type Language } from '@workspace/shared/languages';
import en from '../locales/en/common.json';

export const SUPPORTED_LANGUAGES = LANGUAGES;
export type { Language };

// English is bundled (it is the fallback); the other languages are fetched when chosen.
const loaders = import.meta.glob<ResourceKey>(['../locales/*/common.json', '!../locales/en/*'], {
  import: 'default',
});

const lazyLocales: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const load = loaders[`../locales/${language}/${namespace}.json`];
    if (!load) return callback(new Error(`No ${language} locale`), false);
    load().then(
      (resources) => callback(null, resources),
      (error: Error) => callback(error, false),
    );
  },
};

/** Resolves once the viewer's language is loaded, so the first render is already translated. */
export const i18nReady = i18n
  .use(lazyLocales)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { common: en } },
    partialBundledLanguages: true,
    ns: ['common'],
    defaultNS: 'common',
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'workspace.lang',
    },
  });

function applyDocumentLanguage(): void {
  document.documentElement.lang = LANGUAGE_TAGS[currentLanguage()];
}
i18n.on('languageChanged', applyDocumentLanguage);
void i18nReady.then(applyDocumentLanguage);

export function currentLanguage(): Language {
  const lng = i18n.resolvedLanguage;
  return isLanguage(lng) ? lng : 'en';
}

/** A language's own name, written in that language ("Deutsch", "日本語"). */
export function languageName(language: Language): string {
  const tag = LANGUAGE_TAGS[language];
  const name = new Intl.DisplayNames(tag, { type: 'language' }).of(tag) ?? language;
  return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
}

export default i18n;
