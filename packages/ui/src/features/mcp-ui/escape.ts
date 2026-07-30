/**
 * @module features/mcp-ui/escape
 *
 * The two escapes every generated MCP-UI surface needs, and the reason they are a module rather
 * than a one-liner at each call site: a surface's HTML is assembled by string concatenation (there
 * is no DOM, no JSX, and no template engine on the builder side), so every caller-supplied value
 * crossing into that string is an injection site. Ported from Tovu's
 * `src/assistant/mcp-ui.ts` — the implementations were already correct there; only the location and
 * the doc are new.
 */

/**
 * Escapes a value for interpolation into generated HTML.
 *
 * Escapes all five of `& < > " '`, which makes the result safe in a text node **and** inside a
 * quoted attribute value with either quote style — the builders in `surfaces/` use it for both, so
 * a text-node-only escape (`& < >`) would be a live attribute-injection hole the first time someone
 * interpolated a label into `title="…"`.
 *
 * @param value - Untrusted text.
 * @returns The escaped text.
 * @complexity O(n) in the value's length.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serializes a value as a JS literal safe to embed in an inline `<script>`.
 *
 * `JSON.stringify` alone is not enough for three reasons a real surface hits:
 * - a literal `</script` anywhere in the value closes the script element early, so every `<` is
 *   escaped to `<` (which also defuses `<!--`, the other sequence the HTML parser treats
 *   specially inside a script element);
 * - U+2028 / U+2029 are legal in JSON but were not legal in JS string literals before ES2019, and
 *   a surface's script is parsed as a classic script by whatever engine the host embeds.
 *
 * Accepts any JSON-serializable value, not just strings, so a builder can inline a params object
 * with the same guarantees it gets for a label.
 *
 * @param value - Any JSON-serializable value. `undefined` (and anything else `JSON.stringify`
 * drops) serializes to the literal `undefined`, which is valid JS in expression position.
 * @returns A JS literal.
 * @complexity O(n) in the serialized length.
 */
export function escapeJsValue(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) return 'undefined';
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * {@link escapeJsValue} narrowed to strings.
 *
 * Kept as its own export because the overwhelmingly common call is "inline this one string", and a
 * `string`-typed signature makes a caller that accidentally passes an object a compile error rather
 * than a silently-inlined `[object Object]`-free-but-surprising literal.
 */
export function escapeJsString(value: string): string {
  return escapeJsValue(value);
}
