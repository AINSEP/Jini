import { createDictionaryTranslator, interpolate, type DictionaryTranslator, type LocaleDictionary } from '@jini-ai/core/text';
import { PLUGINS_LOCALES_A } from "./plugins-i18n.locales-a.js";
import { PLUGINS_LOCALES_B } from "./plugins-i18n.locales-b.js";
import { PLUGINS_LOCALES_C } from "./plugins-i18n.locales-c.js";
import { PLUGINS_LOCALES_D } from "./plugins-i18n.locales-d.js";
import { PLUGINS_LOCALES_E } from "./plugins-i18n.locales-e.js";
import { PLUGINS_LOCALES_F } from "./plugins-i18n.locales-f.js";
import { PLUGINS_LOCALES_G } from "./plugins-i18n.locales-g.js";
import { PLUGINS_LOCALES_H } from "./plugins-i18n.locales-h.js";
import { PLUGINS_LOCALES_I } from "./plugins-i18n.locales-i.js";
import { PLUGINS_LOCALES_J } from "./plugins-i18n.locales-j.js";
import { PLUGINS_LOCALES_K } from "./plugins-i18n.locales-k.js";
/**
 * @file Translations for the `plugins` feature's own screens (`Plugins.tsx` and
 * `AgentPlugins.tsx`) — this feature's own dictionary, not the shared admin-nav one,
 * so parallel translation passes over other admin sections can't collide on the same file. Same
 * two-step fallback every other `t()` in this app uses: translated value, else the English source
 * string itself.
 *
 * About a third of the copy names the product ("Not for this {product} version"). The product name
 * is the host's (K3), so the data below keeps a `{product}` slot where the brand used to be and
 * {@link createPluginsDictionary} fills it, in the English source keys AND the translations, once
 * per host. A host named "Acme" therefore looks copy up with `"Not for this Acme version"`, the
 * same sentence its screens render. Every other `{name}`-style slot is left for the caller.
 */

/** All 21 locales, in the original order; locale keys are disjoint, so the spread order is the old literal order. */
export const PLUGINS_DICT_TEMPLATE: Record<string, Record<string, string>> = {
  ...PLUGINS_LOCALES_A, ...PLUGINS_LOCALES_B, ...PLUGINS_LOCALES_C, ...PLUGINS_LOCALES_D,
  ...PLUGINS_LOCALES_E, ...PLUGINS_LOCALES_F, ...PLUGINS_LOCALES_G, ...PLUGINS_LOCALES_H,
  ...PLUGINS_LOCALES_I, ...PLUGINS_LOCALES_J, ...PLUGINS_LOCALES_K,
};

/** Fills the `{product}` slot of every key and value, leaving the other `{slots}` untouched. */
function fillProduct({ productName }: { productName: string }): LocaleDictionary {
  const vars = { product: productName };
  const fill = (template: string): string => interpolate({ template, vars });
  return Object.fromEntries(Object.entries(PLUGINS_DICT_TEMPLATE).map(([locale, entries]) => [
    locale,
    Object.fromEntries(Object.entries(entries).map(([key, value]) => [fill(key), fill(value)])),
  ]));
}

/**
 * `dictionary[locale]?.[key] ?? commonDictionary[locale]?.[key] ?? key`, with `productName`
 * standing where the plugins copy names the product. The host supplies both: its common fallback
 * dictionary and the name its screens show.
 * @example const translatePlugins = createPluginsDictionary({ commonDictionary: HOST_COMMON_I18N, productName: "Acme" });
 */
export function createPluginsDictionary(
  { commonDictionary, productName }: { commonDictionary: LocaleDictionary; productName: string },
  _optional = {},
): DictionaryTranslator {
  return createDictionaryTranslator({ featureDictionary: fillProduct({ productName }) }, { commonDictionary });
}
