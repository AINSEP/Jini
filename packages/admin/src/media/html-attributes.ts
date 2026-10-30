/** Browser-only live metadata hint, separate from server validation across the browser/Node
 * boundary. The server must enforce the same policy on writes and rendering independently.
 * Hints never gate Save: an invalid attribute once silently blocked saving unrelated title/alt/
 * caption/credit/class changes. Rejections must instead reach the authoritative atomic write.
 * One flat allowlist includes global and image/video extras: per-element name filtering is
 * unnecessary because an unused loading attribute on a wrapper is harmless. Extend the list,
 * not the tokenizer, when adding an allowed name. data-/aria- families remain open-ended. */
import {
  EMBED_HTML_ATTRIBUTE_ALLOWED_NAMES,
  isAllowedEmbedHtmlAttributeName,
  parseEmbedHtmlAttributes,
} from "@jini-ai/cms/widgets/markers";

export const MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES = EMBED_HTML_ATTRIBUTE_ALLOWED_NAMES;

/** Whether `name` is on the allowlist — a well-formed attribute name
 *  (`/^[a-z][a-z0-9-]*$/`) that is either an exact match against
 *  {@link MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES} or carries a `data-`/`aria-` prefix (both open-ended
 *  families with no fixed suffix list). Case-insensitive: HTML attribute names are themselves
 *  case-insensitive, and an operator typing `DATA-FOO` should not slip past a lowercase-only check.
 *
 * @complexity O(n) in the name's length (one anchored regex test), then O(1) — one prefix check,
 * one fixed-length array lookup.
 */
export function isAllowedMediaHtmlAttributeName({ name }: { name: string }, _optional: Record<string, never> = {}): boolean {
  return isAllowedEmbedHtmlAttributeName({ name });
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
  // Media hints always use inline-attribute policy; stylesheet escape allowances do not apply.
  return parseEmbedHtmlAttributes({ text });
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
