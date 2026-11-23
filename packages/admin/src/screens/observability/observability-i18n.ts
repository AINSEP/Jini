import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";

import { createDictionaryTranslator } from '@jini-ai/core/text';
import { OBSERVABILITY_LOCALES_A } from "./observability-i18n.locales-a.js";
import { OBSERVABILITY_LOCALES_B } from "./observability-i18n.locales-b.js";
import { OBSERVABILITY_LOCALES_C } from "./observability-i18n.locales-c.js";
/**
 * @file Translations for the Observability page (`/admin/observability`). Same shape as
 * `security/security-i18n.ts`: a flat `DICT[locale][englishKey] = translation` map, `t =
 * createDictionaryTranslator(DICT)`.
 *
 */

const OBSERVABILITY_DICT: Record<string, Record<string, string>> = {
  ...OBSERVABILITY_LOCALES_A, ...OBSERVABILITY_LOCALES_B, ...OBSERVABILITY_LOCALES_C,
};

export const t = createDictionaryTranslator({ featureDictionary: OBSERVABILITY_DICT }, { commonDictionary: ADMIN_COMMON_I18N });
