/** A dictionary indexed by caller-defined locale and English source key. */
export type LocaleDictionary = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Locale-bound translation injected into a widget or panel hook. */
export type Translate = (key: string) => string;
// Name the bound and unbound forms separately so injected widget translators need no locale
// argument at every call site, and their contract is discoverable beyond the conventional name t.
export type DictionaryTranslator = (required: { locale: string; key: string }) => string;

function lookup(dictionary: LocaleDictionary, locale: string, key: string): string | undefined {
  if (!Object.hasOwn(dictionary, locale)) return undefined;
  const block = dictionary[locale];
  return block && Object.hasOwn(block, key) ? block[key] : undefined;
}

// Centralize fallback once: small feature dictionaries inherit shared Save/Cancel/Delete copy,
// and misses remain readable English source keys rather than raw dictionary-miss placeholders.
/** Feature copy wins over the host's common copy, then falls back to the source key.
 * No locale context or product dictionary is installed by this helper. */
export function createDictionaryTranslator({ featureDictionary }: { featureDictionary: LocaleDictionary }, { commonDictionary = {} }: { commonDictionary?: LocaleDictionary | undefined } = {}
): DictionaryTranslator {
  return ({ locale, key }) => lookup(featureDictionary, locale, key) ?? lookup(commonDictionary, locale, key) ?? key;
}
