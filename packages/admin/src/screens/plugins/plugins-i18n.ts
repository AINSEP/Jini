import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary } from "@jini-ai/core/text";

import { bindDictionaryNames } from "../../core/bind-dictionary-names.js";
import { PLUGINS_DICT_PART_1 } from "./i18n/plugins-dict-1.js";
import { PLUGINS_DICT_PART_2 } from "./i18n/plugins-dict-2.js";
import { PLUGINS_DICT_PART_3 } from "./i18n/plugins-dict-3.js";
import { PLUGINS_DICT_PART_4 } from "./i18n/plugins-dict-4.js";
import { PLUGINS_DICT_PART_5 } from "./i18n/plugins-dict-5.js";
import { PLUGINS_DICT_PART_6 } from "./i18n/plugins-dict-6.js";
import { PLUGINS_DICT_PART_7 } from "./i18n/plugins-dict-7.js";
import { PLUGINS_DICT_PART_8 } from "./i18n/plugins-dict-8.js";
import { PLUGINS_DICT_PART_9 } from "./i18n/plugins-dict-9.js";
import { PLUGINS_DICT_PART_10 } from "./i18n/plugins-dict-10.js";
import { PLUGINS_DICT_PART_11 } from "./i18n/plugins-dict-11.js";
import { PLUGINS_DICT_PART_12 } from "./i18n/plugins-dict-12.js";
import { PLUGINS_DICT_PART_13 } from "./i18n/plugins-dict-13.js";
import { PLUGINS_DICT_PART_14 } from "./i18n/plugins-dict-14.js";
import { PLUGINS_DICT_PART_15 } from "./i18n/plugins-dict-15.js";
import { PLUGINS_DICT_PART_16 } from "./i18n/plugins-dict-16.js";
import { PLUGINS_DICT_PART_17 } from "./i18n/plugins-dict-17.js";
import { PLUGINS_DICT_PART_18 } from "./i18n/plugins-dict-18.js";
import { PLUGINS_DICT_PART_19 } from "./i18n/plugins-dict-19.js";
import { PLUGINS_DICT_PART_20 } from "./i18n/plugins-dict-20.js";
import { PLUGINS_DICT_PART_21 } from "./i18n/plugins-dict-21.js";

/**
 * @file Spanish translation for the `plugins` feature's own screens (`Plugins.tsx` and
 * `AgentPlugins.tsx`) — this feature's own dictionary, not the shared `lib/admin-nav-i18n.ts` one,
 * so parallel translation passes over other admin sections can't collide on the same file. Same
 * two-step fallback every other `t()` in this app uses: translated value, else the English source
 * string itself.
 */

const PLUGINS_DICT: Record<string, Record<string, string>> = { ...PLUGINS_DICT_PART_1, ...PLUGINS_DICT_PART_2, ...PLUGINS_DICT_PART_3, ...PLUGINS_DICT_PART_4, ...PLUGINS_DICT_PART_5, ...PLUGINS_DICT_PART_6, ...PLUGINS_DICT_PART_7, ...PLUGINS_DICT_PART_8, ...PLUGINS_DICT_PART_9, ...PLUGINS_DICT_PART_10, ...PLUGINS_DICT_PART_11, ...PLUGINS_DICT_PART_12, ...PLUGINS_DICT_PART_13, ...PLUGINS_DICT_PART_14, ...PLUGINS_DICT_PART_15, ...PLUGINS_DICT_PART_16, ...PLUGINS_DICT_PART_17, ...PLUGINS_DICT_PART_18, ...PLUGINS_DICT_PART_19, ...PLUGINS_DICT_PART_20, ...PLUGINS_DICT_PART_21 };


/** The host binds its commonDictionary and product name once. `t` is `PLUGINS_DICT[locale]?.[key] ?? commonDictionary[locale]?.[key] ?? key`
 *  via `createDictionaryTranslator`, so a shared word this dict doesn't carry for a locale still renders translated.
 *  The host's `.hooks.ts` files (no JSX) import the bound `t` directly instead of duplicating the lookup. */
export function createPluginsDictionary(
  { commonDictionary, productName }: { commonDictionary: LocaleDictionary; productName: string },
  _optional = {},
): { t: DictionaryTranslator } {
  const featureDictionary = bindDictionaryNames({ dictionary: PLUGINS_DICT, names: { productName } });
  return { t: createDictionaryTranslator({ featureDictionary }, { commonDictionary }) };
}