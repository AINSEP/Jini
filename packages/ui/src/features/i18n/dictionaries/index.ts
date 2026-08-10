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
import { SETTINGS_DIALOG_ID } from './settings-dialog.id.js';
import { SETTINGS_DIALOG_DE } from './settings-dialog.de.js';
import { SETTINGS_DIALOG_ZH_CN } from './settings-dialog.zh-CN.js';
import { SETTINGS_DIALOG_ZH_TW } from './settings-dialog.zh-TW.js';
import { SETTINGS_DIALOG_PT_BR } from './settings-dialog.pt-BR.js';
import { SETTINGS_DIALOG_RU } from './settings-dialog.ru.js';
import { SETTINGS_DIALOG_FA } from './settings-dialog.fa.js';
import { SETTINGS_DIALOG_AR } from './settings-dialog.ar.js';
import { SETTINGS_DIALOG_JA } from './settings-dialog.ja.js';
import { SETTINGS_DIALOG_KO } from './settings-dialog.ko.js';
import { SETTINGS_DIALOG_PL } from './settings-dialog.pl.js';
import { SETTINGS_DIALOG_HU } from './settings-dialog.hu.js';
import { SETTINGS_DIALOG_FR } from './settings-dialog.fr.js';
import { SETTINGS_DIALOG_UK } from './settings-dialog.uk.js';
import { SETTINGS_DIALOG_TR } from './settings-dialog.tr.js';
import { SETTINGS_DIALOG_TH } from './settings-dialog.th.js';
import { SETTINGS_DIALOG_IT } from './settings-dialog.it.js';
import { SETTINGS_DIALOG_HI } from './settings-dialog.hi.js';
import { SETTINGS_DIALOG_UR } from './settings-dialog.ur.js';
import { SETTINGS_DIALOG_BN } from './settings-dialog.bn.js';
import type { SettingsDialogDict } from './types.js';

export { SETTINGS_DIALOG_EN } from './settings-dialog.en.js';
export { SETTINGS_DIALOG_ES } from './settings-dialog.es.js';
export { SETTINGS_DIALOG_ID } from './settings-dialog.id.js';
export { SETTINGS_DIALOG_DE } from './settings-dialog.de.js';
export { SETTINGS_DIALOG_ZH_CN } from './settings-dialog.zh-CN.js';
export { SETTINGS_DIALOG_ZH_TW } from './settings-dialog.zh-TW.js';
export { SETTINGS_DIALOG_PT_BR } from './settings-dialog.pt-BR.js';
export { SETTINGS_DIALOG_RU } from './settings-dialog.ru.js';
export { SETTINGS_DIALOG_FA } from './settings-dialog.fa.js';
export { SETTINGS_DIALOG_AR } from './settings-dialog.ar.js';
export { SETTINGS_DIALOG_JA } from './settings-dialog.ja.js';
export { SETTINGS_DIALOG_KO } from './settings-dialog.ko.js';
export { SETTINGS_DIALOG_PL } from './settings-dialog.pl.js';
export { SETTINGS_DIALOG_HU } from './settings-dialog.hu.js';
export { SETTINGS_DIALOG_FR } from './settings-dialog.fr.js';
export { SETTINGS_DIALOG_UK } from './settings-dialog.uk.js';
export { SETTINGS_DIALOG_TR } from './settings-dialog.tr.js';
export { SETTINGS_DIALOG_TH } from './settings-dialog.th.js';
export { SETTINGS_DIALOG_IT } from './settings-dialog.it.js';
export { SETTINGS_DIALOG_HI } from './settings-dialog.hi.js';
export { SETTINGS_DIALOG_UR } from './settings-dialog.ur.js';
export { SETTINGS_DIALOG_BN } from './settings-dialog.bn.js';
export type { SettingsDialogDict } from './types.js';

/** Every locale this package ships a settings-dialog translation for. */
export const SETTINGS_DIALOG_DICTIONARIES: Partial<Record<Locale, SettingsDialogDict>> = {
  en: SETTINGS_DIALOG_EN,
  es: SETTINGS_DIALOG_ES,
  id: SETTINGS_DIALOG_ID,
  de: SETTINGS_DIALOG_DE,
  'zh-CN': SETTINGS_DIALOG_ZH_CN,
  'zh-TW': SETTINGS_DIALOG_ZH_TW,
  'pt-BR': SETTINGS_DIALOG_PT_BR,
  ru: SETTINGS_DIALOG_RU,
  fa: SETTINGS_DIALOG_FA,
  ar: SETTINGS_DIALOG_AR,
  ja: SETTINGS_DIALOG_JA,
  ko: SETTINGS_DIALOG_KO,
  pl: SETTINGS_DIALOG_PL,
  hu: SETTINGS_DIALOG_HU,
  fr: SETTINGS_DIALOG_FR,
  uk: SETTINGS_DIALOG_UK,
  tr: SETTINGS_DIALOG_TR,
  th: SETTINGS_DIALOG_TH,
  it: SETTINGS_DIALOG_IT,
  hi: SETTINGS_DIALOG_HI,
  ur: SETTINGS_DIALOG_UR,
  bn: SETTINGS_DIALOG_BN,
};
