/** Environment isolation for child processes; hosts name the settings that belong to one run. */

/**
 * Copy an environment without host-selected keys. Reports names only, never values; no I/O.
 * Windows callers opt into case-insensitive matching so duplicate spellings cannot survive.
 * @returns A fresh environment and the configured names whose defined values were omitted.
 * @complexity O(e + k) time/space for e environment entries and k configured names.
 * @example omitEnvironmentKeys({ env: parent, keys: ['WORKSPACE_STORAGE'] });
 */
export function omitEnvironmentKeys(
  { env, keys }: { env: Readonly<Record<string, string | undefined>>; keys: readonly string[] },
  { caseInsensitive = false }: { caseInsensitive?: boolean } = {},
): { env: Record<string, string | undefined>; omitted: string[] } {
  const normalize = (key: string) => caseInsensitive ? key.toUpperCase() : key;
  const names = new Map(keys.map((key) => [normalize(key), key]));
  const child: Record<string, string | undefined> = {};
  const omitted = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    const name = names.get(normalize(key));
    if (name !== undefined) {
      if (value !== undefined) omitted.add(name);
    } else {
      child[key] = value;
    }
  }
  return { env: child, omitted: [...omitted] };
}
