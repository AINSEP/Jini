/**
 * Barrel for this package's shipped dictionaries -- currently the
 * settings-dialog feature set's English source of truth and its Spanish
 * translation.
 *
 * This is a SEPARATE i18n system from any Jini-consuming host's own
 * dictionaries (e.g. Tovu's `apps/admin/src/lib/i18n-common.ts` +
 * `apps/admin/src/lib/dictionary-translator.ts` + one `*-i18n.ts` file per
 * admin feature) -- deliberately so, since this package is meant to be
 * reusable across hosts and a host's own product copy has no reason to ship
 * inside it (see that repo's i18n-common.ts for the fuller reasoning). They
 * share the same underlying shape/convention (`Record<locale, Record<key,
 * string>>`, translated-value-else-raw-key fallback) by design, so adding a
 * language to one is a close parallel to adding it to the other, but they are
 * two separate dictionaries that must each be extended on their own --
 * finishing one does not finish the other. As of this note, a host's own
 * dictionaries may cover more locales than this package's `en`/`es` here;
 * check both before assuming "translations are done" for any given locale.
 * A host wires these straight into `I18nProvider`:
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
