/**
 * @file Cookie Consent translations, keyed by the exact English copy (see `consent-i18n.ts`). One
 * block per locale covers both this page's copy and the Jini field sections' labels, which take the
 * same block as their `dictionary` prop. Engine terms (Global Privacy Control, opt-in/opt-out, CSS,
 * URL, px) stay in English where the locale commonly uses them.
 */

import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";

import { createDictionaryTranslator } from '@jini-ai/core/text';
import { CONSENT_LOCALES_A } from "./consent-dictionary.locales-a.js";
import { CONSENT_LOCALES_B } from "./consent-dictionary.locales-b.js";
import { CONSENT_LOCALES_C } from "./consent-dictionary.locales-c.js";
import { CONSENT_LOCALES_D } from "./consent-dictionary.locales-d.js";
import { CONSENT_LOCALES_E } from "./consent-dictionary.locales-e.js";

/** Locale keys are disjoint across the five modules, so the spread keeps the original order. */
export const CONSENT_DICT: Record<string, Record<string, string>> = { ...CONSENT_LOCALES_A, ...CONSENT_LOCALES_B, ...CONSENT_LOCALES_C, ...CONSENT_LOCALES_D, ...CONSENT_LOCALES_E };

/** Owner-bound translator; exposes its dictionary for locale-block consumers and translation audits. */
export const translate = createDictionaryTranslator({ featureDictionary: CONSENT_DICT }, { commonDictionary: ADMIN_COMMON_I18N });
