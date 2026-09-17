/**
 * @file Server-side allowlist for `MediaRecord.htmlAttributes` (2026-09-07) — the enforcement half
 * of a validator that ALSO has a browser-side copy in the consuming product's admin
 * (`apps/admin/src/features/media/rules.ts`, `parseMediaHtmlAttributes` and friends).
 *
 * Deliberately duplicated, not shared via one imported module, for the same reason this codebase
 * already hand-copies `DEFAULT_ALLOWED_MIME_TYPES` into that admin's `FILE_HANDLER_ALLOWED_MIME_TYPES`/
 * `IMPORTABLE_CONTENT_TYPES`: `@jini-ai/cms/media`'s barrel (`index.ts`) re-exports files that
 * import real Node built-ins (`node:crypto` in `media-service.ts`, `node:fs` in
 * `blob-store.fs.ts`, native `sharp` bindings in `image-transformer.sharp.ts`) — importing this
 * subpath from a browser-bundled Vite app (that product's `apps/admin`) risks pulling those into the admin
 * SPA's bundle even if only this one pure function is actually used, and this admin's own copy
 * already exists, tested, with no such risk. This file is the copy every Node-side consumer
 * (`media-service.ts`'s own `updateMediaMetadata`, and that product's `apps/website` render path, both pure
 * backend code) can safely import from `@jini-ai/cms/media` instead of re-deriving the rules a
 * third time.
 *
 * THE RULES THEMSELVES ARE NOT REDESIGNED HERE — this is a verbatim port of the admin copy's logic
 * (allowlist membership, `on*`/`javascript:` precedence, the tokenizer, the four rejection reasons).
 * Extend `MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES` in BOTH copies together if a new attribute is ever
 * needed — that is the one piece of drift risk this duplication accepts, the same risk every other
 * hand-copied list in this codebase already accepts.
 *
 * This is a SECURITY boundary, not a syntax convenience: media metadata is authored in the consuming product's admin
 * but rendered on the public site, so a free-text HTML-attribute passthrough is a stored-XSS vector
 * (`onerror`, `onclick`, `style`, `href="javascript:"`, any `on*` handler) the moment it reaches a
 * public page. A client-side-only check is not a control, since the API accepts whatever a caller
 * sends — this file is what makes the write path (`updateMediaMetadata`) and the render path (a
 * host's own tag-building code) actually enforce it, not just the admin form.
 */

/**
 * Exact-match attribute names the allowlist accepts beyond the open-ended `data-`/`aria-` prefix
 * families (checked separately in {@link isAllowedMediaHtmlAttributeName}). Picked for the owner's
 * stated near-term uses (animations, custom WebMCP hooks) plus the standard `<img>`/`<video>`
 * attributes those uses actually need; extend this list, not the parser, when a new one is needed —
 * and keep it in sync with the identical constant in that admin's copy (see this file's header).
 */
export const MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES = [
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
 * (2026-09-07 stored-XSS fix; keep identical in the admin copy).
 *
 * The `data-`/`aria-` families below are open-ended by design — no fixed suffix list — so the
 * prefix check alone accepted whatever characters {@link HTML_ATTRIBUTE_TOKEN}'s name class
 * (`[^\s="']+`, which excludes only whitespace, `=` and quotes) let through. `<`, `>` and `/` are
 * all legal in that class, and a renderer templating a name into ` name="value"` escapes only the
 * VALUE — so a stored `data-x><svg/onload=alert(1)` closed the `<img>` and opened a live
 * `<svg onload>` on the public page. Constraining the NAME to the characters a real HTML attribute
 * name can contain is what makes "the value is escaped" sufficient: no accepted name can carry a
 * character that terminates a tag or starts an attribute.
 *
 * Deliberately narrower than the HTML spec's own name production (which permits far more): this
 * field exists for `data-*`/`aria-*` hooks and a short list of standard `<img>`/`<video>`
 * attributes, every one of which fits `[a-z][a-z0-9-]*`. Widening this is a deliberate decision,
 * not something a new allowlist entry should need.
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
export function isAllowedMediaHtmlAttributeName(name: string): boolean {
  const lower = name.toLowerCase();
  if (!MEDIA_HTML_ATTRIBUTE_NAME_PATTERN.test(lower)) return false;
  if (lower.startsWith("data-") || lower.startsWith("aria-")) return true;
  return (MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES as readonly string[]).includes(lower);
}

/** Why one parsed attribute token was rejected — see {@link parseMediaHtmlAttributes}'s own doc for
 *  why `event-handler`/`javascript-url` are checked, and reported, ahead of plain allowlist
 *  membership. */
export type MediaHtmlAttributeRejectionReason = "disallowed-name" | "event-handler" | "javascript-url" | "malformed";

export interface MediaHtmlAttributeError {
  reason: MediaHtmlAttributeRejectionReason;
  /** The exact attribute name (or, for `malformed`, the unparsable fragment) — never a generic
   *  "invalid input" (owner requirement: a visible, specific error naming the rejected attribute). */
  attribute: string;
}

export interface ParsedMediaHtmlAttributes {
  /** Lowercased attribute name -> value. A boolean attribute (`muted`, written with no
   *  `="..."`) maps to `""` — recording only that it was present; how a valueless attribute gets
   *  emitted onto the real tag is the renderer's decision, not this parser's. */
  attributes: Record<string, string>;
  /** `null` when every token in the input is allowed and safe; otherwise the FIRST rejection found
   *  scanning left to right — one specific, visible reason at a time, not a batch of every problem
   *  in the string. */
  error: MediaHtmlAttributeError | null;
}

/** Matches one `name`, or one `name="value"`/`name='value'`/`name=value` pair — the same loose
 *  shape real HTML attribute syntax allows, since that is the syntax an operator typing this field
 *  would naturally reach for. */
const HTML_ATTRIBUTE_TOKEN = /([^\s="']+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;

/** Classifies one already-tokenized `name`/`value` pair. Split out of {@link parseMediaHtmlAttributes}
 *  so each rejection reason is its own directly testable branch.
 *
 * Order matters: `on*`/`javascript:` are checked BEFORE allowlist membership, so a rejected
 * `onerror="..."` always reports as `event-handler` (the more specific, more actionable reason)
 * rather than the generic `disallowed-name`.
 *
 * @complexity O(1) — three fixed checks against one already-extracted token.
 */
function classifyMediaHtmlAttributeToken(name: string, value: string): MediaHtmlAttributeError | null {
  if (name.startsWith("on")) return { reason: "event-handler", attribute: name };
  if (value.trim().toLowerCase().startsWith("javascript:")) return { reason: "javascript-url", attribute: name };
  if (!isAllowedMediaHtmlAttributeName(name)) return { reason: "disallowed-name", attribute: name };
  return null;
}

/**
 * Parses the `htmlAttributes` field's free text (`name="value" name2="value2"`, or a bare boolean
 * `name`) into a validated attribute map, rejecting anything not on the allowlist. Nothing here
 * tries to sanitize or escape an otherwise-disallowed name into something safe — it is rejected
 * outright, and the caller must show the reason (not silently drop it) so an operator can tell a
 * typo from a hard "no".
 *
 * @complexity Time O(n) in `text`'s length (one regex pass over it), space O(k) for k parsed
 *   attributes.
 */
export function parseMediaHtmlAttributes(text: string): ParsedMediaHtmlAttributes {
  const trimmed = text.trim();
  if (trimmed === "") return { attributes: {}, error: null };

  const attributes: Record<string, string> = {};
  HTML_ATTRIBUTE_TOKEN.lastIndex = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_ATTRIBUTE_TOKEN.exec(trimmed)) !== null) {
    // Non-whitespace text between the previous match and this one is a fragment the token pattern
    // could not parse as a name (e.g. a stray quote) — reported once, at the first gap, rather
    // than silently skipped.
    const skipped = trimmed.slice(consumed, match.index);
    if (skipped.trim() !== "") return { attributes: {}, error: { reason: "malformed", attribute: skipped.trim() } };
    consumed = match.index + match[0].length;

    const name = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    const rejection = classifyMediaHtmlAttributeToken(name, value);
    if (rejection) return { attributes: {}, error: rejection };
    attributes[name] = value;
  }

  const trailing = trimmed.slice(consumed);
  if (trailing.trim() !== "") return { attributes: {}, error: { reason: "malformed", attribute: trailing.trim() } };
  return { attributes, error: null };
}

/** Formats a {@link MediaHtmlAttributeError} into a plain-English message naming the rejected
 *  attribute (owner requirement) — the server-side, non-localized counterpart to the admin's own
 *  `describeMediaHtmlAttributeError` (which additionally runs the message through `MEDIA_DICT` for
 *  the operator's locale). Domain errors elsewhere in this file (`MediaValidationError`'s other
 *  messages) are likewise always plain English, so this matches that existing convention rather
 *  than inventing a localized-error contract this service has never had.
 *
 * @complexity O(1).
 */
export function describeMediaHtmlAttributeError(error: MediaHtmlAttributeError): string {
  if (error.reason === "event-handler") return `event handler attributes like '${error.attribute}' are not allowed`;
  if (error.reason === "javascript-url") return `'${error.attribute}' cannot use a javascript: value`;
  if (error.reason === "malformed") return `could not parse HTML attributes near '${error.attribute}'`;
  return `'${error.attribute}' is not an allowed HTML attribute`;
}
