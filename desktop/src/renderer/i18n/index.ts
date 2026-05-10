import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ru from './locales/ru.json';

export const SUPPORTED_LOCALES = ['ru', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'ru';

const STORAGE_KEY = 'freeclaude-locale';

const detector = new LanguageDetector(undefined, {
  order: ['localStorage', 'navigator'],
  lookupLocalStorage: STORAGE_KEY,
  caches: ['localStorage']
});

i18n
  .use(detector)
  .use(initReactI18next)
  .init({
    fallbackLng: DEFAULT_LOCALE,
    defaultNS: 'translation',
    ns: ['translation'],
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    nonExplicitSupportedLngs: true,
    resources: {
      en: { translation: en },
      ru: { translation: ru }
    },
    interpolation: { escapeValue: false },
    returnEmptyString: false
  });

// Reflect the active language on <html lang="..."> for a11y + spell checkers.
const syncDocumentLang = (lng: string): void => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
};
syncDocumentLang(i18n.resolvedLanguage || DEFAULT_LOCALE);
i18n.on('languageChanged', syncDocumentLang);

export function changeLocale(locale: SupportedLocale): Promise<unknown> {
  return i18n.changeLanguage(locale);
}

export function getActiveLocale(): SupportedLocale {
  const resolved = (i18n.resolvedLanguage || DEFAULT_LOCALE) as string;
  if ((SUPPORTED_LOCALES as readonly string[]).includes(resolved)) {
    return resolved as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}

export default i18n;
