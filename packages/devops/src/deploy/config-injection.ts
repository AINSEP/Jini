/**
 * @file The guard a deploy-config generator runs on a value it is about to interpolate, unescaped, into a
 * generated TOML or YAML file. Security-relevant: one unchecked value can inject a whole new key into a file a
 * hosting platform will then act on.
 */

/** QUOTED-sink hazard characters (hazard 1 in {@link assertNoConfigInjection}'s own doc). A bare array and
 *  `.some()` keep this predicate free of branches of its own: the complexity ceiling applies per FUNCTION, and a
 *  3-character alternation hand-written as `||` chains was most of the guard's earlier complexity. */
const QUOTE_OR_NEWLINE_CHARS = ['"', '\n', '\r'] as const;

/** UNQUOTED-YAML-plain-scalar indicator and structural characters (hazard 2 in the guard's own doc). */
const YAML_SIGNIFICANT_CHARS = [':', '#', '{', '[', '&', '*'] as const;

function containsAnyOf(required: { value: string; chars: readonly string[] }, _optional = {}): boolean {
  return required.chars.some((char) => required.value.includes(char));
}

function hasLeadingHyphenOrSurroundingWhitespace(required: { value: string }, _optional = {}): boolean {
  return required.value.startsWith('-') || required.value !== required.value.trim();
}

/**
 * Guards a value about to be interpolated, unescaped, into a generated TOML/YAML config file (a deploy-config
 * generator that builds its file from a hand-written template string). A generator that builds its file through
 * `JSON.stringify` is safe by construction and does not need it. Two distinct sink shapes call this, so it covers
 * two distinct hazards:
 *
 * 1. QUOTED sinks (a TOML `key = "${...}"`, or a YAML value after the generator's own allow-list already passed
 *    it). A value containing a double-quote can close the quoted string early; one also containing a newline can
 *    then inject an entirely new top-level key on the next line (the reproduction and its regression test live
 *    with the TOML-emitting generator).
 * 2. UNQUOTED YAML plain-scalar sinks (a `name: ${...}` line: YAML, unlike the TOML sinks above, is rendered with
 *    no surrounding quotes at all). Here a quote or newline is not the only hazard: `:`, `#`, `{`, `[`, `&`, `*`, a
 *    leading `-`, or leading/trailing whitespace are each YAML indicator or structural characters that change what
 *    an unquoted plain scalar means (`:` or `#` can end the scalar and start a new key or a comment mid-line;
 *    `{`/`[` open a flow collection; `&`/`*` are anchor and alias indicators; a leading `-` reads as a
 *    block-sequence entry). A guard that let these through was the original bug.
 *
 * Rejecting outright is the reliable fix for both. A per-host region allow-list is each generator's own choice, and
 * one host's catalog had no authoritative source to enumerate against (its generator says why). The same reasoning
 * extends to app and volume names: quoting the two unquoted YAML sinks at render time was considered instead of
 * widening this check, but every generator's exact-string golden test already pins the CURRENT unquoted rendering
 * for a safe name, so unconditionally quoting would change output for every already-safe name, not just unsafe
 * ones, which is a real caller-visible behaviour change. Widening the reject-list here never changes what an
 * already-accepted value renders as; it only ever accepts fewer values, exactly the tradeoff already made for the
 * quote and newline above.
 *
 * The error is the host's own class, built by `fail`, so a bad value surfaces through the host's validation path.
 * @throws whatever `fail` returns, with a message naming `fieldLabel` and the JSON-quoted value.
 * @complexity O(n) in the value's length.
 */
export function assertNoConfigInjection(
  required: { fieldLabel: string; value: string; fail: (required: { message: string }) => Error },
  _optional = {},
): void {
  const { fieldLabel, value, fail } = required;
  if (containsAnyOf({ value, chars: QUOTE_OR_NEWLINE_CHARS })) {
    throw fail({ message: `${fieldLabel} (${JSON.stringify(value)}) contains a quote or newline character, which would corrupt the generated config file` });
  }
  if (containsAnyOf({ value, chars: YAML_SIGNIFICANT_CHARS })) {
    throw fail({ message: `${fieldLabel} (${JSON.stringify(value)}) contains a YAML-significant character (one of : # { [ & *), which would corrupt an unquoted YAML scalar in the generated config file` });
  }
  if (hasLeadingHyphenOrSurroundingWhitespace({ value })) {
    throw fail({ message: `${fieldLabel} (${JSON.stringify(value)}) starts with "-" or has leading/trailing whitespace, which would corrupt an unquoted YAML scalar in the generated config file` });
  }
}
