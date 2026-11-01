/**
 * §5.5's grammar as one regex: alnum runs separated by single `-`/`.` delimiters. This shape alone
 * guarantees start/end are alphanumeric (the regex can only start and end on `[a-z0-9]+`) AND that
 * no two delimiters are ever adjacent (a delimiter is always followed by at least one alnum char
 * before the next one can appear) — so "no leading/trailing hyphen" and "no consecutive delimiters"
 * fall out of one pattern rather than needing separate checks that could disagree.
 */
const NAME_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
export const MAX_NAME_LENGTH = 64;

/**
 * True when `value` is a valid Agent Plugin id: `plugin.json`'s `name` grammar (§5.5, see
 * `NAME_PATTERN`), 1-64 characters. The one owner of that grammar: a host checks an id taken from a
 * URL or a tool input here before it names anything on disk, instead of restating the pattern.
 * @complexity O(n) in the value's length.
 */
export function isAgentPluginName({ value }: { readonly value: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof value === "string" && value.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(value);
}

