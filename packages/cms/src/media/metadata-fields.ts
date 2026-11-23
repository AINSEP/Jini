import { MediaValidationError } from "./types.js";

/**
 * @file Optional media metadata field parsing for an untyped request body: undefined means omitted, null means clear (string fields) or is rejected (title/slug).
 */

/** Describes a rejected field's actual runtime shape for an error message — bare `typeof` collapses
 *  an array into `"object"`, which reads as misleading in a "must be a string" message.
 *  @complexity O(1). */
function describeType({ raw }: { raw: unknown }, _optional = {}): string {
  return Array.isArray(raw) ? "array" : typeof raw;
}

/**
 * `undefined` means "field omitted, leave it alone" and stays `undefined`. `null` means "explicit
 * clear": `alt`/`caption`/`credit`/`description` have no "keep existing" fallback in `updateMediaMetadata`
 * (unlike `title` — see {@link parseOptionalTitleField}) — an empty string IS their cleared
 * representation there (`input.alt.trim()`, no `|| existing.alt`), and `uploadMedia` already
 * collapses omitted and empty to the same stored value (`input.alt?.trim() ?? ""`). So `null` maps
 * to `""` here rather than being passed through: both service functions' own input types are
 * `string | undefined` with no `null` case, and forwarding a literal `null` would call `.trim()` on
 * `null` and throw a `TypeError`, not clear the field. (`description` differs only at upload: omitted
 * stores no key rather than `""`; an explicit clear through here still stores `""`.) Anything that is neither `undefined`, `null`,
 * nor a `string` is rejected outright — silently `String()`-coercing an object or array would store
 * its stringified form (e.g. `"[object Object]"`) as visible, screen-reader-announced field text
 * instead of failing loudly.
 *
 * @complexity O(1).
 */
export function parseOptionalStringField({ raw, field }: { raw: unknown; field: string }, _optional = {}): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return "";
  if (typeof raw !== "string") {
    throw new MediaValidationError({ message: `media.${field} must be a string or null, got ${describeType({ raw })}` });
  }
  return raw;
}

/**
 * Same omitted/provided contract as {@link parseOptionalStringField}, but for `title`: unlike
 * `alt`/`caption`/`credit`, `updateMediaMetadata` gives `title` a "keep existing" fallback
 * (`input.title.trim() || existing.title`) because title is required and always displayed — there
 * is no empty-string representation of "no title" for it to fall through to. A `null` here can
 * therefore neither be silently mapped to `""` (that would round-trip back to the existing title
 * instead of clearing it) nor silently ignored (that would hide a client's explicit clear request)
 * — it is rejected with a message naming the reason. A non-string, non-null value is rejected the
 * same way as {@link parseOptionalStringField}.
 *
 * @complexity O(1).
 */
export function parseOptionalTitleField({ raw }: { raw: unknown }, _optional = {}): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) {
    throw new MediaValidationError({ message: "media.title cannot be cleared to null; title is required and cannot be empty" });
  }
  if (typeof raw !== "string") {
    throw new MediaValidationError({ message: `media.title must be a string, got ${describeType({ raw })}` });
  }
  return raw;
}

/**
 * Same omitted/provided/reject-null shape as {@link parseOptionalTitleField}, for the same reason:
 * `slug` (2026-09-07) has no empty-string "cleared" representation either — `updateMediaMetadata`'s
 * own `resolveSlugForUpdate` (`@jini-ai/cms/media`) rejects an empty or malformed slug outright
 * rather than treating it as "unset". Format/uniqueness validation itself stays entirely in that
 * service function (`MediaValidationError`/`MediaConflictError`) — this parser's only job is the
 * same undefined-vs-provided/wrong-JSON-type boundary every other field parser in this file owns.
 *
 * @complexity O(1).
 */
export function parseOptionalSlugField({ raw }: { raw: unknown }, _optional = {}): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) {
    throw new MediaValidationError({ message: "media.slug cannot be cleared to null; slug is required and cannot be empty" });
  }
  if (typeof raw !== "string") {
    throw new MediaValidationError({ message: `media.slug must be a string, got ${describeType({ raw })}` });
  }
  return raw;
}
