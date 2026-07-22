import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import vi from './locales/vi.json'

/** Supported UI languages. Vietnamese is the product default. */
export const SUPPORTED_LANGUAGES = ['vi', 'en'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'vi'
export const LANGUAGE_STORAGE_KEY = 'vg-lang'

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

/** Read the persisted UI language, defaulting to Vietnamese on first visit.
 * Guarded for non-browser (test) environments where localStorage may throw. */
export function initialLanguage(): Language {
  try {
    const saved = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY)
    if (isLanguage(saved)) return saved
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return DEFAULT_LANGUAGE
}

// English is the fallback dictionary; a missing Vietnamese key surfaces the
// English string rather than the raw key. Vietnamese is the active default.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    vi: { translation: vi },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false }, // React already escapes.
})

/** Switch the active UI language and persist the choice. */
export function setLanguage(lng: Language): void {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, lng)
  } catch {
    // Persistence is best-effort; the in-memory switch still applies.
  }
  void i18n.changeLanguage(lng)
}

export default i18n
