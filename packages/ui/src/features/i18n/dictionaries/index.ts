/**
 * Barrel for this package's shipped dictionaries -- currently the
 * settings-dialog feature set's English source of truth and its Spanish
 * translation. A host wires these straight into `I18nProvider`:
 *
 * ```tsx
 * <I18nProvider
 *   dictionaries={{ en: SETTINGS_DIALOG_EN, es: SETTINGS_DIALOG_ES }}
 *   fallbackLocale="en"
 * >
 * ```
 *
 * `SETTINGS_DIALOG_DICTIONARIES` bundles both under the `Locale` keys
 * `I18nProvider.dictionaries` expects, for a host that wants the whole set
 * in one prop rather than assembling the record itself. Adding a further
 * locale later (per-locale dictionary file, one more property here) does not
 * require touching `I18nProvider`, `context.tsx`, or any mounted component --
 * see each dictionary file's own doc comment for the parity contract new
 * locales must satisfy.
 */
import type { Locale } from '../types.js';
import { SETTINGS_DIALOG_EN } from './settings-dialog.en.js';
import { SETTINGS_DIALOG_ES } from './settings-dialog.es.js';
import type { SettingsDialogDict } from './types.js';

export { SETTINGS_DIALOG_EN } from './settings-dialog.en.js';
export { SETTINGS_DIALOG_ES } from './settings-dialog.es.js';
export type { SettingsDialogDict } from './types.js';

/** Every locale this package ships a settings-dialog translation for. */
export const SETTINGS_DIALOG_DICTIONARIES: Partial<Record<Locale, SettingsDialogDict>> = {
  en: SETTINGS_DIALOG_EN,
  es: SETTINGS_DIALOG_ES,
};
