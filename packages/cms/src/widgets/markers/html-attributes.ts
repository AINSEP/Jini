/**
 * @file The ONE render-time HTML-attribute allowlist for every free-text `htmlAttributes` field this
 * codebase re-parses at render time: media assets, media post-nodes, and (from this task on) widget
 * post-nodes (2026-09-23 embed-attributes-everywhere plan, decision §2). It replaces two prior,
 * narrower boundaries in the same render path:
 *
 * - `@jini-ai/cms/media`'s `parseMediaHtmlAttributes` (the Jini-side twin of
 *   `apps/admin/src/features/media/rules.ts`'s `parseMediaHtmlAttributes`, which this file's
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
 * The admin (`apps/admin/src/features/media/rules.ts`) keeps its OWN hand-copied allowlist, unchanged
 * by this task — it is a UX hint only (never gates `save()`, incident `a7cce060`), and the
 * browser/Node split between admin and this server-side file is the existing precedent (see that
 * file's own header). Widening ITS list, and Jini's write-path copy, is tracked separately (plan
 * slice J) — until then, an admin Media-library save with `style` still gets Jini's own 400.
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
 * The shape EVERY accepted attribute name must have, checked before allowlist membership (ported
 * unchanged from the 2026-09-07 stored-XSS fix in `apps/admin/src/features/media/rules.ts`). The
 * `data-`/`aria-` families are open-ended by design — no fixed suffix list — so the prefix check
 * alone would accept whatever characters {@link HTML_ATTRIBUTE_TOKEN}'s name class (`[^\s="']+`,
 * which excludes only whitespace, `=` and quotes) lets through; `<`, `>` and `/` are all legal in
 * that class, and the renderer templates a name into ` name="value"` escaping only the VALUE — so a
 * stored `data-x><svg/onload=alert(1)` would close the tag and open a live `<svg onload>`.
 * Constraining the NAME to characters a real HTML attribute name can contain is what makes escaping
 * only the value sufficient.
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
 * tabs and newlines from inside a URL before parsing its scheme, so the check must too. Filters by
 * code point rather than a regex character class so no literal control character ever has to appear
 * in a pattern.
 *
 * @complexity O(n) in the value's length (one filter pass, one prefix test).
 */
function isUnsafeUrlValue(value: string): boolean {
  let stripped = "";
  for (const char of value) {
    if ((char.codePointAt(0) ?? 0) > ASCII_WHITESPACE_OR_CONTROL_MAX_CODE_POINT) stripped += char;
  }
  stripped = stripped.toLowerCase();
  return stripped.startsWith("javascript:") || stripped.startsWith("vbscript:") || stripped.startsWith("data:");
}

/**
 * Whether a `style` value carries a known CSS injection or CSS-escape-bypass vector:
 * `expression(...)` (legacy IE script-in-CSS), a `javascript:`/`vbscript:` value inside a CSS
 * `url(...)`, `-moz-binding`/`behavior:` (XBL/HTC script bindings), `@import` (pulls in a second,
 * unvetted stylesheet), or ANY backslash — a CSS escape sequence (`\65` is `e`) can respell any of
 * the above past a plain substring check, so a backslash anywhere in the value is rejected outright
 * rather than trying to first decode every possible CSS escape. Plain `url(...)` values (background
 * images) are otherwise allowed — authors here are the owner/admins, not anonymous input.
 *
 * @complexity O(n) in the value's length (one regex test).
 */
const UNSAFE_STYLE_PATTERN = /expression\(|javascript:|vbscript:|-moz-binding|behavior:|@import|\\/i;
function isUnsafeStyleValue(value: string): boolean {
  return UNSAFE_STYLE_PATTERN.test(value);
}

/**
 * Classifies one already-tokenized `name`/`value` pair into a rejection reason, or `null` when it is
 * accepted. Split out of {@link parseEmbedHtmlAttributes} into its own function, and into three
 * single-purpose checks ({@link isAllowedEmbedHtmlAttributeName}, {@link isUnsafeUrlValue},
 * {@link isUnsafeStyleValue}), so each rejection reason is its own directly testable branch and this
 * function's own complexity stays low.
 *
 * Order matters: `on*` is checked FIRST (so an `onerror` always reports as `event-handler`, the more
 * actionable reason, never the generic `disallowed-name`), then the URL-scheme check runs against
 * EVERY value regardless of name (matching the pre-existing `javascript:` check this is ported from
 * — the only allowlisted attribute with a URL-shaped value is `poster`, but checking unconditionally
 * costs nothing and adds no gap), then allowlist membership, then — only for an already-allowed
 * `style` — the CSS-specific unsafe-value check.
 *
 * @complexity O(1) — four fixed checks against one already-extracted token; each check's own O(n) in
 * the token's length is linear, not nested.
 */
function classifyEmbedHtmlAttributeToken(name: string, value: string): EmbedHtmlAttributeError | null {
  if (name.startsWith("on")) return { reason: "event-handler", attribute: name };
  if (isUnsafeUrlValue(value)) return { reason: "unsafe-url", attribute: name };
  if (!isAllowedEmbedHtmlAttributeName({ name: name })) return { reason: "disallowed-name", attribute: name };
  if (name === "style" && isUnsafeStyleValue(value)) return { reason: "unsafe-style", attribute: name };
  return null;
}

/** Matches one `name`, or one `name="value"`/`name='value'`/`name=value` pair — the same loose shape
 *  real HTML attribute syntax allows, ported unchanged from the admin's tokenizer. */
const HTML_ATTRIBUTE_TOKEN = /([^\s="']+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;

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
 * @complexity Time O(n) in `text`'s length (one regex pass over it), space O(k) for k accepted
 *   attributes plus O(e) for e rejected tokens.
 */
export function parseEmbedHtmlAttributes({ text }: { text: string }, _optional: Record<string, never> = {}): ParsedEmbedHtmlAttributes {
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
    if (skipped.trim() !== "") {
      const malformed: EmbedHtmlAttributeError = { reason: "malformed", attribute: skipped.trim() };
      errors.push(malformed);
      return { attributes: {}, errors, error: malformed };
    }
    consumed = match.index + match[0].length;

    const name = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    const rejection = classifyEmbedHtmlAttributeToken(name, value);
    if (rejection) {
      errors.push(rejection);
      continue;
    }
    attributes[name] = value;
  }

  const trailing = trimmed.slice(consumed);
  if (trailing.trim() !== "") {
    const malformed: EmbedHtmlAttributeError = { reason: "malformed", attribute: trailing.trim() };
    errors.push(malformed);
    return { attributes: {}, errors, error: malformed };
  }
  return { attributes, errors, error: errors[0] ?? null };
}
