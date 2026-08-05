/**
 * @module markup-attributes
 *
 * Shared quoted-attribute parser for this package's inline protocol tags —
 * `<artifact …>` (`./parser.ts`, `./strip.ts`) and `<question-form …>` /
 * `<ask-question …>` (`../question-form/scan.ts`). All three interpret
 * model-produced markup with the exact same tolerant grammar; centralizing
 * it means a future correction to escaping, accepted attribute names, or
 * malformed-quote handling can't drift between streaming, post-stream, and
 * question-form parsing.
 *
 * Internal only — deliberately not part of this package's public surface;
 * see `./index.ts`'s barrel comment.
 */

/**
 * Parse `name="value"` / `name='value'` pairs out of a tag's raw attribute
 * string (the content between the tag name and the closing `>`).
 */
export function parseQuotedAttrs(raw: string): Record<string, string> {
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null = re.exec(raw);
  while (m !== null) {
    // The pattern's quote alternation means exactly one of group 2 (double-
    // quoted) / group 3 (single-quoted) participates in any successful match
    // — never both, never neither — so `m[2] ?? m[3]` is always defined; the
    // cast just satisfies `noUncheckedIndexedAccess`.
    out[m[1] as string] = (m[2] ?? m[3]) as string;
    m = re.exec(raw);
  }
  return out;
}
