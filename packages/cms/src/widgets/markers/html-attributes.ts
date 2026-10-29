/**
 * @file The ONE render-time HTML-attribute allowlist for every free-text `htmlAttributes` field this
 * codebase re-parses at render time: media assets, media post-nodes, and (from this task on) widget
 * post-nodes (2026-09-23 embed-attributes-everywhere plan, decision §2). It replaces two prior,
 * narrower boundaries in the same render path:
 *
 * - `@jini-ai/cms/media`'s `parseMediaHtmlAttributes` (the Jini-side twin of
 *   the media admin `parseMediaHtmlAttributes` adapter, which this file's
 *   tokenizer and name pattern are ported from) — rejected `style`/`id`/`class` outright and failed
 *   the WHOLE string closed on the first bad token.
 * - `render.ts`'s own `restrictToDataAriaAttributes` — an extra widget-only restriction down to
 *   `data-*`/`aria-*`, now folded into this one list instead of being a second filter layered on top.
 *
 * Two behavior changes from that prior boundary, both owner-directed:
 * 1. **The allowlist widens** to include `class`, `id`, `style`, `title`, `role`, `tabindex`, `lang`,
 *    `dir`, `hidden`, `translate` and `draggable` — global HTML attributes an author styling or
 *    animating a widget/media embed needs — on top of the open-ended `data-*`/`aria-*` families and
 *    today's `<img>`/`<video>`-only extras (`loading`, `decoding`, `playsinline`, `muted`, `loop`,
 *    `autoplay`, `poster`). One shared list for every element shape, not a list per tag: the owner
 *    rejected per-element name filtering (an extra `loading` on a `<div>` wrapper is harmless).
 * 2. **One bad token drops only that token**, not the whole string. Once a name/value pair has been
 *    tokenized, it is self-contained — dropping it cannot change how its neighbors are read — so
 *    `data-x="1" onclick="…" style="color:red"` keeps `data-x` and `style`, drops only `onclick`. The
 *    exception is `malformed`: the tokenizer itself lost sync (e.g. a stray quote), so token
 *    boundaries downstream of that point cannot be trusted (value text could re-parse as a name) —
 *    that failure mode still discards everything and fails the WHOLE string closed, same as before.
 *
 * The media admin adapter delegates to this browser-safe parser for UX hints, retaining its
 * own error messages. Hints never gate `save()` (incident `a7cce060`): a bad attribute must not
 * prevent saving unrelated metadata. The server independently enforces write/render policy;
 * the narrower CMS media write validator remains a separate boundary.
 */

/** Why one parsed attribute token was rejected. `unsafe-url` replaces the old `javascript-url` name
 *  (it now also covers `vbscript:`/`data:` schemes, not just `javascript:`) — the admin's own i18n
 *  message key for it is unchanged. `unsafe-style` is new: a `style` value carrying a known CSS
 *  injection/escape vector. `malformed` is the one reason that still discards the WHOLE parsed
 *  result, not just its own token — see this file's header for why. */
export type EmbedHtmlAttributeRejectionReason = "disallowed-name" | "event-handler" | "unsafe-url" | "unsafe-style" | "malformed";

export interface EmbedHtmlAttributeError {
  reason: EmbedHtmlAttributeRejectionReason;
  /** The exact attribute name (or, for `malformed`, the unparsable fragment) a caller's error
   *  message must name — never a generic "invalid input". */
  attribute: string;
}

export interface ParsedEmbedHtmlAttributes {
  /** Lowercased attribute name -> value, for every token that WAS accepted. Never all-or-nothing
   *  except on `malformed` (see this file's header): a rejected token is simply absent here while
   *  every other accepted token in the same string still lands. A boolean attribute (`muted`,
   *  written with no `="..."`) maps to `""`. */
  attributes: Record<string, string>;
  /** Every rejection found, in the order encountered — zero or more. Unlike `attributes`, this is
   *  never reset to empty except that a `malformed` entry is always the last one recorded (parsing
   *  stops there). */
  errors: EmbedHtmlAttributeError[];
  /** The FIRST rejection in `errors`, or `null` when every token was accepted — kept as its own field
   *  for the existing admin-hint callers that only ever showed one reason at a time. */
  error: EmbedHtmlAttributeError | null;
}

/**
 * Exact-match attribute names accepted beyond the open-ended `data-`/`aria-` prefix families (see
 * {@link isAllowedEmbedHtmlAttributeName}). Two groups, kept in one flat list because the owner
 * rejected per-element filtering (§2): global attributes any element can carry (styling/animation/
 * a11y), and the pre-existing `<img>`/`<video>`-only extras that are harmless, if meaningless, on
 * any other element.
 */
export const EMBED_HTML_ATTRIBUTE_ALLOWED_NAMES = [
  // Global attributes.
  "class",
  "id",
  "style",
  "title",
  "role",
  "tabindex",
  "lang",
  "dir",
  "hidden",
  "translate",
  "draggable",
  // Pre-existing <img>/<video> extras, kept everywhere (one list, not one per element).
  "loading",
  "decoding",
  "playsinline",
  "muted",
  "loop",
  "autoplay",
  "poster",
] as const;

/**
 * The shape EVERY accepted attribute name must have, checked before allowlist membership
 * (2026-09-07 stored-XSS fix; the narrower `@jini-ai/cms/media` write validator also enforces
 * this name shape).
 *
 * The `data-`/`aria-` families below are open-ended by design — no fixed suffix list — so the
 * prefix check alone accepted whatever characters {@link HTML_ATTRIBUTE_TOKEN}'s name class
 * (`[^\s="']+`, which excludes only whitespace, `=` and quotes) let through. `<`, `>` and `/` are
 * all legal in that class, and the server renderer templating a name into ` name="value"` escapes
 * only the VALUE — so a stored `data-x><svg/onload=alert(1)` closed the `<img>` and opened a live
 * `<svg onload>` on the public page. Constraining the NAME to the characters a real HTML attribute
 * name can contain is what makes "the value is escaped" sufficient.
 */
const EMBED_HTML_ATTRIBUTE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Whether `name` is on the allowlist — a well-formed name ({@link EMBED_HTML_ATTRIBUTE_NAME_PATTERN})
 *  that is either an exact match against {@link EMBED_HTML_ATTRIBUTE_ALLOWED_NAMES} or carries a
 *  `data-`/`aria-` prefix. Case-insensitive, since HTML attribute names are themselves
 *  case-insensitive.
 *
 * @complexity O(n) in the name's length (one anchored regex test), then O(1).
 */
export function isAllowedEmbedHtmlAttributeName({ name }: { name: string }, _optional: Record<string, never> = {}): boolean {
  const lower = name.toLowerCase();
  if (!EMBED_HTML_ATTRIBUTE_NAME_PATTERN.test(lower)) return false;
  if (lower.startsWith("data-") || lower.startsWith("aria-")) return true;
  return (EMBED_HTML_ATTRIBUTE_ALLOWED_NAMES as readonly string[]).includes(lower);
}

/** The highest ASCII code point {@link isUnsafeUrlValue} strips: every C0 control character plus
 *  the ordinary space, i.e. code points `0`-`32` inclusive. Named rather than written as an inline
 *  regex control-character range so the linter never has to reason about a literal control
 *  character inside a pattern. */
const ASCII_WHITESPACE_OR_CONTROL_MAX_CODE_POINT = 0x20;

/**
 * Whether `value`'s scheme, once every ASCII whitespace/control character (code points `0`-`32`) is
 * stripped and the result lowercased, starts with `javascript:`, `vbscript:` or `data:` — the three
 * schemes a browser will still execute or navigate to even when the URL carries interior whitespace
 * a naive end-trim (the old `.trim()`-only check) would miss, e.g. `java\tscript:x`: browsers strip
 * tabs and newlines from inside a URL before parsing its scheme, so this check must too. The
 * admin media hint delegates here so this scheme policy cannot drift. Filtering code points
 * avoids writing literal control characters in a regex pattern.
 *
 * @complexity O(n) in the value's length (one filter pass, one prefix test).
 */
function isUnsafeUrlValue(value: string): boolean {
  let stripped = "";
  for (const char of value) {
    // A `for...of` step always yields one whole code point, so `codePointAt(0)` is never undefined.
    if (char.codePointAt(0)! > ASCII_WHITESPACE_OR_CONTROL_MAX_CODE_POINT) stripped += char;
  }
  stripped = stripped.toLowerCase();
  return stripped.startsWith("javascript:") || stripped.startsWith("vbscript:") || stripped.startsWith("data:");
}

/**
 * Whether a `style` value carries a known CSS injection or CSS-escape-bypass vector:
 * `expression(...)` (legacy IE script-in-CSS), a `javascript:`/`vbscript:` value inside a CSS
 * `url(...)`, `-moz-binding`/`behavior:` (XBL/HTC script bindings), `@import` (pulls in a second,
 * unvetted stylesheet), or ANY backslash in an inline attribute — a CSS escape sequence (`\65`
 * is `e`) can respell any of the above past a plain substring check, so a backslash anywhere in
 * an inline value is rejected outright rather than decoding every possible CSS escape.
 * Plain `url(...)` values (background images) are otherwise allowed — authors here are the
 * owner/admins, not anonymous input.
 * Stylesheets additionally allow non-ASCII scalar hex escapes (e.g. `\2713` for a checkmark).
 * They cannot respell the ASCII injection vocabulary. Only the validation projection changes;
 * the accepted value remains byte-for-byte authored CSS. ASCII/invalid/other escapes still fail.
 *
 * @complexity O(n) time/space in the value's length; escape matches consume at most six digits.
 */
const UNSAFE_STYLE_PATTERN = /expression\(|javascript:|vbscript:|-moz-binding|behavior:|@import|\\/i;
function isUnsafeStyleValue(value: string, { styleContext }: { styleContext?: "stylesheet" } = {}): boolean {
  const inspected = styleContext === "stylesheet"
    ? value.replace(/\\([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?/gi, (escape, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint < 0xa0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return escape;
      return String.fromCodePoint(codePoint);
    })
    : value;
  return UNSAFE_STYLE_PATTERN.test(inspected);
}

/** Classifies one already-tokenized `name`/`value` pair. Split out of {@link parseEmbedHtmlAttributes}
 *  so each rejection reason is its own directly testable branch, and so the loop below reads as
 *  "tokenize, then classify" rather than one function doing both.
 *
 * Order matters:
 * `on*` is checked FIRST (so an `onerror` always reports as `event-handler`, the more actionable
 * reason, never the generic `disallowed-name`), then the URL-scheme check runs against EVERY value
 * regardless of name (matching the pre-existing `javascript:` check this is ported from), then
 * allowlist membership, then — only for an already-allowed `style` — the CSS-specific unsafe-value
 * check. `poster` is the only allowlisted URL-shaped attribute, but checking every value adds
 * no gap. Keeping these checks separate also keeps the classifier's own complexity low.
 *
 * @complexity O(1) — four fixed checks against one already-extracted token; each check's own O(n) in
 * the token's length is linear, not nested.
 */
function classifyEmbedHtmlAttributeToken(name: string, value: string, options: { styleContext?: "stylesheet" } = {}): EmbedHtmlAttributeError | null {
  if (name.startsWith("on")) return { reason: "event-handler", attribute: name };
  if (isUnsafeUrlValue(value)) return { reason: "unsafe-url", attribute: name };
  if (!isAllowedEmbedHtmlAttributeName({ name })) return { reason: "disallowed-name", attribute: name };
  if (name === "style" && isUnsafeStyleValue(value, options)) return { reason: "unsafe-style", attribute: name };
  return null;
}

/** Matches one `name`, or one `name="value"`/`name='value'`/`name=value` pair — the same loose shape
 *  real HTML attribute syntax allows, ported unchanged from the admin's tokenizer. */
const HTML_ATTRIBUTE_TOKEN = /([^\s="']+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;

/** The value of one {@link HTML_ATTRIBUTE_TOKEN} match: whichever of the double-quoted, single-quoted
 *  or bare value groups matched, or `""` for a bare boolean name (`muted`). */
function tokenValue(match: RegExpExecArray): string {
  return match[2] ?? match[3] ?? match[4] ?? "";
}

/** The fail-closed result for a fragment the tokenizer could not parse: everything parsed so far is
 *  discarded and the `malformed` entry is recorded last (see this file's header for why). */
function malformedResult({ errors, fragment }: { errors: EmbedHtmlAttributeError[]; fragment: string }): ParsedEmbedHtmlAttributes {
  const malformed: EmbedHtmlAttributeError = { reason: "malformed", attribute: fragment.trim() };
  errors.push(malformed);
  return { attributes: {}, errors, error: malformed };
}

/**
 * Parses free-text HTML attributes (`name="value" name2="value2"`, or a bare boolean `name`) into a
 * validated attribute map, per-token: an accepted token lands in `attributes`, a rejected one lands
 * in `errors` and is simply omitted — this string never fails closed as a whole EXCEPT when the
 * tokenizer itself loses sync (a stray quote or other unparseable fragment between/after matches),
 * in which case `attributes` is `{}` and the sole entry in `errors` has `reason: "malformed"` (see
 * this file's header for why that one case is different).
 *
 * This is a SECURITY boundary, not a syntax convenience: every string this parses was authored in an
 * admin/owner context but rendered on the public site, so free-text HTML-attribute pass-through is a
 * stored-XSS vector the moment it reaches a public page. {@link isAllowedEmbedHtmlAttributeName} is
 * therefore the ONLY path to acceptance for a name; nothing here tries to sanitize an otherwise-
 * disallowed name or value into something safe.
 *
 * @param options.styleContext Use `stylesheet` only for a style element's CSS text; allows
 *   non-ASCII scalar hex escapes for glyphs while preserving the inline escape restriction.
 *
 * @complexity Time O(n) in `text`'s length (one regex pass over it), space O(k) for k accepted
 *   attributes plus O(e) for e rejected tokens.
 */
export function parseEmbedHtmlAttributes({ text }: { text: string }, options: { styleContext?: "stylesheet" } = {}): ParsedEmbedHtmlAttributes {
  const trimmed = text.trim();
  if (trimmed === "") return { attributes: {}, errors: [], error: null };

  const attributes: Record<string, string> = {};
  const errors: EmbedHtmlAttributeError[] = [];
  HTML_ATTRIBUTE_TOKEN.lastIndex = 0;
  let consumed = 0;
  // A `for` loop (rather than `while ((match = …exec(trimmed)) !== null)`) keeps every assignment
  // to `match` in statement position, never inside the loop's own test expression.
  for (let match = HTML_ATTRIBUTE_TOKEN.exec(trimmed); match !== null; match = HTML_ATTRIBUTE_TOKEN.exec(trimmed)) {
    // Non-whitespace text between the previous match and this one is a fragment the token pattern
    // could not parse as a name (e.g. a stray quote) — the tokenizer has lost sync, so everything
    // parsed so far is discarded rather than trusted (see this file's header).
    const skipped = trimmed.slice(consumed, match.index);
    if (skipped.trim() !== "") return malformedResult({ errors, fragment: skipped });
    consumed = match.index + match[0].length;

    // Group 1 (the name) is the one non-optional group in HTML_ATTRIBUTE_TOKEN, so it is always set.
    const name = match[1]!.toLowerCase();
    const value = tokenValue(match);
    const rejection = classifyEmbedHtmlAttributeToken(name, value, options);
    if (rejection) errors.push(rejection);
    else attributes[name] = value;
  }

  const trailing = trimmed.slice(consumed);
  if (trailing.trim() !== "") return malformedResult({ errors, fragment: trailing });
  return { attributes, errors, error: errors[0] ?? null };
}
