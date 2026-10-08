export type { Locale, TranslationDict, TranslationVars } from './types.js';
export {
  detectInitialLocale,
  resolveSystemLocale,
  defaultDetectSystemLocale,
} from './locale.js';
export type {
  LocalePersistencePort,
  SystemLocaleDetector,
  DetectInitialLocaleOptions,
} from './locale.js';
export { I18nProvider, useI18n, useT } from './context.js';
export type { I18nProviderProps, I18nContextValue } from './context.js';
export {
  SETTINGS_DIALOG_EN,
  SETTINGS_DIALOG_ES,
  SETTINGS_DIALOG_DICTIONARIES,
} from './dictionaries/index.js';
export type { SettingsDialogDict } from './dictionaries/index.js';
export { createDictionaryTranslator } from './dictionary-translator.js';
export type { Translate, DictionaryTranslator, LocaleDictionary } from './dictionary-translator.js';
export { interpolate, splitOnPlaceholders, pickPlural, localeEntry } from './template-i18n.js';
