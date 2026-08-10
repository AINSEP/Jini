/**
 * @file Settings-dialog chrome dictionary — the 24 generic tab labels/subtitles for the Settings
 * screen (Instructions, Notifications, Privacy, MCP server, Memory, Skills, Version, etc.).
 *
 * Relocated here from Jini's `@jini-ai/ui` (2026-08-08): these keys aren't UI-rendering logic,
 * they're settings-domain presentation copy, and this package's `settings` module is the actual
 * domain owner shared across every host (Tovu, Zana, ...). `@jini-ai/ui` keeps the *component*
 * that renders a settings dialog; a host supplies the copy, and this is the shared copy any
 * OD-parity host can reuse instead of re-authoring its own. See project memory "Settings-dialog
 * i18n relocation" for the full decision record and the sibling move of the 8 Tovu-specific
 * capability-fact keys (those stayed host-side — see Tovu's own `settings-capabilities-i18n.ts`).
 *
 * No `en` dictionary: this package's convention (matching `@jini-ai/ui`) is "the English string
 * IS the key" — `translateSettingsDialog` falls back to the raw key for English and any
 * unrecognized locale.
 */

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

export {
  SETTINGS_DIALOG_ES,
  SETTINGS_DIALOG_ID,
  SETTINGS_DIALOG_DE,
  SETTINGS_DIALOG_ZH_CN,
  SETTINGS_DIALOG_ZH_TW,
  SETTINGS_DIALOG_PT_BR,
  SETTINGS_DIALOG_RU,
  SETTINGS_DIALOG_FA,
  SETTINGS_DIALOG_AR,
  SETTINGS_DIALOG_JA,
  SETTINGS_DIALOG_KO,
  SETTINGS_DIALOG_PL,
  SETTINGS_DIALOG_HU,
  SETTINGS_DIALOG_FR,
  SETTINGS_DIALOG_UK,
  SETTINGS_DIALOG_TR,
  SETTINGS_DIALOG_TH,
  SETTINGS_DIALOG_IT,
  SETTINGS_DIALOG_HI,
  SETTINGS_DIALOG_UR,
  SETTINGS_DIALOG_BN,
};

/** Every non-English locale this dictionary covers, keyed the same way `@jini-ai/ui`'s
 *  `SETTINGS_DIALOG_DICTIONARIES` is. */
export const SETTINGS_DIALOG_DICTIONARIES: Readonly<Record<string, Record<string, string>>> = {
  es: SETTINGS_DIALOG_ES,
  id: SETTINGS_DIALOG_ID,
  de: SETTINGS_DIALOG_DE,
  "zh-CN": SETTINGS_DIALOG_ZH_CN,
  "zh-TW": SETTINGS_DIALOG_ZH_TW,
  "pt-BR": SETTINGS_DIALOG_PT_BR,
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

/** `dict[locale]?.[key] ?? key` — no separate English dict to fall back to, since the key
 *  itself already is the English text. */
export function translateSettingsDialog(locale: string, key: string): string {
  return SETTINGS_DIALOG_DICTIONARIES[locale]?.[key] ?? key;
}
