import type { LocaleDictionary } from "@jini-ai/core/text";

/**
 * @file Composes a host's own common-dictionary entries over a neutral base dictionary, per locale.
 * The base (e.g. `ADMIN_COMMON_I18N`) carries every product-neutral shared word; a host adds only
 * the entries that name its product, so those cannot ship inside the reusable base. The result is
 * what each feature dictionary falls back to on a miss (`commonDictionary` of every
 * `create<X>Dictionary` factory).
 *
 * The host's rows decide which locales exist and in what order (language pickers and parity tests
 * read the keys), and a host entry wins a key collision. A host locale the base does not carry
 * throws at module load, so a half-added language fails loudly instead of silently showing English.
 */
export function createCommonDictionary(
  { baseDictionary, hostEntries }: { baseDictionary: LocaleDictionary; hostEntries: Readonly<Record<string, Readonly<Record<string, string>>>> },
  _optional: Record<string, never> = {},
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(hostEntries).map(([locale, entries]) => {
      const baseEntries = baseDictionary[locale];
      if (baseEntries === undefined) throw new Error(`common dictionary ${locale} is missing from the base dictionary`);
      return [locale, { ...baseEntries, ...entries }];
    }),
  );
}
