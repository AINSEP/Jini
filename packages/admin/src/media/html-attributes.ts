/** Browser-only live metadata hint, separate from server validation across the browser/Node
 * boundary. The server must enforce the same policy on writes and rendering independently.
 * Hints never gate Save: an invalid attribute once silently blocked saving unrelated title/alt/
 * caption/credit/class changes. Rejections must instead reach the authoritative atomic write.
 * One flat allowlist includes global and image/video extras: per-element name filtering is
 * unnecessary because an unused loading attribute on a wrapper is harmless. Extend the list,
 * not the tokenizer, when adding an allowed name. data-/aria- families remain open-ended. */
export const MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES = [
  // Global attributes (2026-09-23).
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
 * (2026-09-07 stored-XSS fix; keep identical in `@jini-ai/cms/media`'s `html-attributes.ts` — see
 * that file's copy of this comment for the full incident).
 *
 * The `data-`/`aria-` families below are open-ended by design — no fixed suffix list — so the
 * prefix check alone accepted whatever characters {@link HTML_ATTRIBUTE_TOKEN}'s name class
 * (`[^\s="']+`, which excludes only whitespace, `=` and quotes) let through. `<`, `>` and `/` are
 * all legal in that class, and the server renderer templating a name into ` name="value"` escapes
 * only the VALUE — so a stored `data-x><svg/onload=alert(1)` closed the `<img>` and opened a live
 * `<svg onload>` on the public page. Constraining the NAME to the characters a real HTML attribute
 * name can contain is what makes "the value is escaped" sufficient.
 */
const MEDIA_HTML_ATTRIBUTE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Whether `name` is on the allowlist — a well-formed attribute name
 *  ({@link MEDIA_HTML_ATTRIBUTE_NAME_PATTERN}) that is either an exact match against
 *  {@link MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES} or carries a `data-`/`aria-` prefix (both open-ended
 *  families with no fixed suffix list). Case-insensitive: HTML attribute names are themselves
 *  case-insensitive, and an operator typing `DATA-FOO` should not slip past a lowercase-only check.
 *
 * @complexity O(n) in the name's length (one anchored regex test), then O(1) — one prefix check,
 * one fixed-length array lookup.
 */
export function isAllowedMediaHtmlAttributeName({ name }: { name: string }, _optional: Record<string, never> = {}): boolean {
  const lower = name.toLowerCase();
  if (!MEDIA_HTML_ATTRIBUTE_NAME_PATTERN.test(lower)) return false;
  if (lower.startsWith("data-") || lower.startsWith("aria-")) return true;
  return (MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES as readonly string[]).includes(lower);
}

/** Why one parsed attribute token was rejected — see {@link parseMediaHtmlAttributes}'s own doc for
 *  why `event-handler`/`unsafe-url` are checked, and reported, ahead of plain allowlist membership.
 *  `unsafe-url` replaces the old `javascript-url` name (2026-09-23: it now also covers
 *  `vbscript:`/`data:` schemes, not just `javascript:`) — the i18n message key for it is unchanged.
 *  `unsafe-style` is new: a `style` value carrying a known CSS injection/escape vector. */
export type MediaHtmlAttributeRejectionReason = "disallowed-name" | "event-handler" | "unsafe-url" | "unsafe-style" | "malformed";

export interface MediaHtmlAttributeError {
  reason: MediaHtmlAttributeRejectionReason;
  /** The exact attribute name (or, for `malformed`, the unparsable fragment) the caller's error
   *  message must name — never a generic "invalid input" (owner requirement: a visible, specific
   *  error naming the rejected attribute). */
  attribute: string;
}

export interface ParsedMediaHtmlAttributes {
  /** Lowercased attribute name -> value, for every token that WAS accepted. Never all-or-nothing
   *  except on `malformed` (see {@link parseMediaHtmlAttributes}'s own header): a rejected token
   *  (2026-09-23) is simply absent here while every other accepted token in the same string still
   *  lands. A boolean attribute (`muted`, written with no `="..."`) maps to `""`. */
  attributes: Record<string, string>;
  /** Every rejection found, in the order encountered — zero or more (2026-09-23). Unlike
   *  `attributes`, this is never reset to empty except that a `malformed` entry is always the last
   *  one recorded (parsing stops there). */
  errors: MediaHtmlAttributeError[];
  /** The FIRST rejection in {@link errors}, or `null` when every token was accepted — kept as its
   *  own field for the existing single-reason hint consumers (`MediaEditDialog.hooks.tsx`,
   *  `use-edit-media-panel.hooks.ts`) that only ever show one reason at a time. */
  error: MediaHtmlAttributeError | null;
}

/** Matches one `name`, or one `name="value"`/`name='value'`/`name=value` pair — the same loose
 *  shape real HTML attribute syntax allows, since that is the syntax an operator typing this field
 *  would naturally reach for. */
const HTML_ATTRIBUTE_TOKEN = /([^\s="']+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;

/** The highest ASCII code point {@link isUnsafeMediaUrlValue} strips: every C0 control character
 *  plus the ordinary space, i.e. code points `0`-`32` inclusive. Named rather than written as an
 *  inline regex control-character range so the linter never has to reason about a literal control
 *  character inside a pattern. Ported from the shared server parser, `html-attributes.ts`. */
const ASCII_WHITESPACE_OR_CONTROL_MAX_CODE_POINT = 0x20;

/**
 * Whether `value`'s scheme, once every ASCII whitespace/control character (code points `0`-`32`) is
 * stripped and the result lowercased, starts with `javascript:`, `vbscript:` or `data:` — the three
 * schemes a browser will still execute or navigate to even when the URL carries interior whitespace
 * a naive end-trim (the old `.trim()`-only check) would miss, e.g. `java\tscript:x`: browsers strip
 * tabs and newlines from inside a URL before parsing its scheme, so this check must too. Ported
 * 2026-09-23 from the shared server parser's `isUnsafeUrlValue` (`html-attributes.ts`).
 *
 * @complexity O(n) in the value's length (one filter pass, one prefix test).
 */
function isUnsafeMediaUrlValue(value: string): boolean {
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
 * the above past a plain substring check, so a backslash anywhere in the value is rejected outright.
 * Plain `url(...)` values (background images) are otherwise allowed. Ported 2026-09-23 from the
 * shared server parser's `isUnsafeStyleValue` (`html-attributes.ts`).
 *
 * @complexity O(n) in the value's length (one regex test).
 */
const UNSAFE_MEDIA_STYLE_PATTERN = /expression\(|javascript:|vbscript:|-moz-binding|behavior:|@import|\\/i;
function isUnsafeMediaStyleValue(value: string): boolean {
  return UNSAFE_MEDIA_STYLE_PATTERN.test(value);
}

/** Classifies one already-tokenized `name`/`value` pair. Split out of {@link parseMediaHtmlAttributes}
 *  so each rejection reason is its own directly testable branch, and so the loop below reads as
 *  "tokenize, then classify" rather than one function doing both.
 *
 * Order matters (ported 2026-09-23 from the shared server parser's `classifyEmbedHtmlAttributeToken`):
 * `on*` is checked FIRST (so an `onerror` always reports as `event-handler`, the more actionable
 * reason, never the generic `disallowed-name`), then the URL-scheme check runs against EVERY value
 * regardless of name (matching the pre-existing `javascript:` check this is ported from), then
 * allowlist membership, then — only for an already-allowed `style` — the CSS-specific unsafe-value
 * check.
 *
 * @complexity O(1) — four fixed checks against one already-extracted token; each check's own O(n) in
 * the token's length is linear, not nested.
 */
function classifyMediaHtmlAttributeToken(name: string, value: string): MediaHtmlAttributeError | null {
  if (name.startsWith("on")) return { reason: "event-handler", attribute: name };
  if (isUnsafeMediaUrlValue(value)) return { reason: "unsafe-url", attribute: name };
  if (!isAllowedMediaHtmlAttributeName({ name })) return { reason: "disallowed-name", attribute: name };
  if (name === "style" && isUnsafeMediaStyleValue(value)) return { reason: "unsafe-style", attribute: name };
  return null;
}

/**
 * Parses the `HTML attributes` field's free text (`name="value" name2="value2"`, or a bare
 * boolean `name`) into a validated attribute map, per-token (ported 2026-09-23 from the shared
 * server parser, `html-attributes.ts`'s `parseEmbedHtmlAttributes`): an accepted token lands in
 * `attributes`, a rejected one lands in `errors` and is simply omitted — this string never fails
 * closed as a whole EXCEPT when the tokenizer itself loses sync (a stray quote or other unparseable
 * fragment), in which case `attributes` is `{}` and the sole entry in `errors` has
 * `reason: "malformed"` (token boundaries downstream of a sync loss cannot be trusted — value text
 * could re-parse as a name — so that one case still discards everything).
 *
 * This is a SECURITY boundary, not a syntax convenience: media metadata is authored in this admin
 * but rendered on the public site, so a free-text HTML-attribute passthrough is a stored-XSS vector
 * (`onerror`, `onclick`, `href="javascript:"`, any `on*` handler, an unsafe `style` value) the
 * moment it reaches a public page. The allowlist in {@link isAllowedMediaHtmlAttributeName} is
 * therefore the ONLY path to acceptance — nothing here tries to sanitize or escape an otherwise-
 * disallowed name or value into something safe; it is rejected outright, and the caller must show
 * the reason (not silently drop it) so an operator can tell a typo from a hard "no". NOTE: this
 * validator runs in the admin only — see this repo's media-admin-ui report for where the write and
 * render paths that would actually persist and emit this attribute still need the SAME allowlist
 * enforced server-side (a client-only check is not a control, since the API accepts whatever a
 * caller sends).
 *
 * @complexity Time O(n) in `text`'s length (one regex pass over it), space O(k) for k accepted
 *   attributes plus O(e) for e rejected tokens.
 */
export function parseMediaHtmlAttributes({ text }: { text: string }, _optional: Record<string, never> = {}): ParsedMediaHtmlAttributes {
  const trimmed = text.trim();
  if (trimmed === "") return { attributes: {}, errors: [], error: null };

  const attributes: Record<string, string> = {};
  const errors: MediaHtmlAttributeError[] = [];
  HTML_ATTRIBUTE_TOKEN.lastIndex = 0;
  let consumed = 0;
  // A `for` loop (rather than `while ((match = …exec(trimmed)) !== null)`) keeps every assignment
  // to `match` in statement position, never inside the loop's own test expression.
  for (let match = HTML_ATTRIBUTE_TOKEN.exec(trimmed); match !== null; match = HTML_ATTRIBUTE_TOKEN.exec(trimmed)) {
    // Non-whitespace text between the previous match and this one is a fragment the token pattern
    // could not parse as a name (e.g. a stray quote) — the tokenizer has lost sync, so everything
    // parsed so far is discarded rather than trusted.
    const skipped = trimmed.slice(consumed, match.index);
    if (skipped.trim() !== "") {
      const malformed: MediaHtmlAttributeError = { reason: "malformed", attribute: skipped.trim() };
      errors.push(malformed);
      return { attributes: {}, errors, error: malformed };
    }
    consumed = match.index + match[0].length;

    const name = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    const rejection = classifyMediaHtmlAttributeToken(name, value);
    if (rejection) {
      errors.push(rejection);
      continue;
    }
    attributes[name] = value;
  }

  const trailing = trimmed.slice(consumed);
  if (trailing.trim() !== "") {
    const malformed: MediaHtmlAttributeError = { reason: "malformed", attribute: trailing.trim() };
    errors.push(malformed);
    return { attributes: {}, errors, error: malformed };
  }
  return { attributes, errors, error: errors[0] ?? null };
}


/** The hint names the rejected token so operators can distinguish a typo from a hard no.
 * This is client feedback only; the server must independently enforce write/render policy. */
export function describeMediaHtmlAttributeError({ error }: { error: MediaHtmlAttributeError }, _optional: Record<string, never> = {}): string {
  const name = error.attribute;
  switch (error.reason) {
    case 'event-handler': return `Event handler attributes like '${name}' are not allowed.`;
    case 'unsafe-url': return `'${name}' cannot use a javascript: value.`;
    case 'unsafe-style': return `'${name}' cannot use an unsafe style value.`;
    case 'malformed': return `Could not parse HTML attributes near '${name}'.`;
    default: return `'${name}' is not an allowed HTML attribute.`;
  }
}
