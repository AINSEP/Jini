import type { LocaleDictionary } from "@jini-ai/core/text";

/**
 * @file Binds the host's product names into a neutral locale dictionary. A reusable admin
 * dictionary cannot spell a host's product name, so it writes `{productName}` where the name
 * goes, in keys and values alike (the English key is the lookup string, so a name inside a key
 * has to be bound too). The host passes the real names once and gets back the exact dictionary
 * its own call sites look up, e.g. `t({ locale, key: "Acme has no skills backend yet." })`.
 * Only `{name}` tokens the caller names are replaced; any other `{token}` is left for the
 * interpolation the dictionary's own consumers do.
 */
export function bindDictionaryNames(
  { dictionary, names }: { dictionary: LocaleDictionary; names: Readonly<Record<string, string>> },
  _optional = {},
): Record<string, Record<string, string>> {
  const bind = (text: string): string =>
    Object.entries(names).reduce((bound, [name, value]) => bound.split(`{${name}}`).join(value), text);
  return Object.fromEntries(
    Object.entries(dictionary).map(([locale, block]) => [
      locale,
      Object.fromEntries(Object.entries(block).map(([key, value]) => [bind(key), bind(value)])),
    ]),
  );
}
