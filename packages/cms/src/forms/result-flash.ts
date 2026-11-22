import { isNonArrayRecord } from "@jini-ai/core/records";
import type { FormSubmissionRedirectResult } from "./types.js";

// Post/Redirect/Get means the fresh GET that follows a failed submission cannot see the prior POST
// body — every field a visitor already typed is gone, not just the invalid one. The values cannot
// travel in the redirect's query string: names, email addresses, and message bodies would leak into
// browser history, server logs, and `Referer` headers sent to third parties. Instead they travel in
// a short-lived, `HttpOnly`, read-once cookie: `forms-submit.ts` sets it only on a validation failure
// reached via a real browser POST; `pages.ts` reads it on the very next GET, merges it into the
// decoded query-string result via `mergeFormFlashIntoResult`, and clears it in the SAME response —
// a later plain reload must not resurrect stale input.
// ---------------------------------------------------------------------------


/** The decoded flash cookie payload: which form (`slug`) it belongs to, and the field values to
 *  re-populate. `slug` guards against a stale cookie from a DIFFERENT form on the same page (or a
 *  form the visitor abandoned) being misapplied to this one — `mergeFormFlashIntoResult` only
 *  attaches `values` when both slugs match. Values are pre-filtered by the caller
 *  (`forms-submit.ts`'s `buildFormFlashValues`) to an ALLOWLIST of repopulatable field types, so a
 *  password-type field (or any future sensitive type this codebase has not added yet) is excluded at
 *  the source and never reaches this payload at all. */
export interface FormFlashPayload {
  slug: string;
  values: Readonly<Record<string, string>>;
}

// A submitted field can be up to 5000 chars (`forms-submit.ts`'s own `MAX_BODY_STRING_LENGTH`) —
// far more than a cookie can hold. Each value is truncated to a short preview length before ever
// being measured against the total budget below; a visitor who typed a genuinely long message sees
// a truncated draft to extend, which is strictly better than the pre-fix behavior of losing it
// outright, without this feature needing a server-side value store (rejected: adds a persistence +
// expiry surface for what stays, even truncated, a low-value edge case).
const FORM_FLASH_MAX_FIELD_VALUE_LENGTH = 300;
// Conservative budget for the cookie's VALUE alone, leaving headroom under browsers' ~4096-byte
// total `Set-Cookie` line (name, `=`, and the `HttpOnly; Path=/; Max-Age=...; SameSite=Lax[; Secure]`
// attribute tail all count against that same budget too).
const FORM_FLASH_MAX_COOKIE_BYTES = 3000;
const FORM_FLASH_MAX_FIELDS = 20; // mirrors forms' own `MAX_FIELDS` (forms.ts) — belt-and-suspenders on decode.
const FORM_FLASH_MAX_FIELD_ID_LENGTH = 100;
const FORM_FLASH_MAX_SLUG_LENGTH = 200;

/**
 * Serializes `payload` for the flash cookie, bounding it to fit. Each value is truncated to
 * {@link FORM_FLASH_MAX_FIELD_VALUE_LENGTH} first; if the result STILL exceeds
 * {@link FORM_FLASH_MAX_COOKIE_BYTES} (a form with many long fields), fields are dropped from the
 * END — i.e. the form's LATER-declared fields are dropped first, keeping earlier ones (typically
 * short identity fields like name/email declared before a long free-text message) — until it fits,
 * or the cookie is skipped entirely (`undefined`) if even zero fields fit under the byte budget
 * alongside the bare `slug`. Skipping rather than emitting a truncated/malformed cookie is a
 * deliberate choice: a missing flash degrades to the pre-fix (values not repopulated) behavior for
 * that one oversized submission, never a broken `Set-Cookie` header.
 * @complexity O(n^2) worst case in `payload.values`' entry count `n` (re-stringifies up to `n+1`
 * times) — `n` is bounded by {@link FORM_FLASH_MAX_FIELDS}-scale form definitions in practice, so
 * this is a handful of cheap `JSON.stringify` calls, never a real cost concern.
 */
export function encodeFormFlashCookieValue({ payload }: { payload: FormFlashPayload }, _optional = {}): string | undefined {
  const truncatedEntries = Object.entries(payload.values).map(
    ([field, value]) => [field, value.slice(0, FORM_FLASH_MAX_FIELD_VALUE_LENGTH)] as const
  );
  for (let keep = truncatedEntries.length; keep >= 0; keep--) {
    const json = JSON.stringify({ slug: payload.slug, values: Object.fromEntries(truncatedEntries.slice(0, keep)) });
    if (Buffer.byteLength(json, "utf8") <= FORM_FLASH_MAX_COOKIE_BYTES) {
      return keep > 0 ? json : undefined;
    }
  }
  return undefined;
}

/** Shape guard for {@link decodeFormFlashCookieValue}'s parsed JSON — split out purely to keep that
 *  function's own cyclomatic complexity low (this repo's documented ≤9 ceiling); no behavior change
 *  from inlining it. */
function isFlashPayloadShape(parsed: unknown): parsed is { slug: string; values: Record<string, unknown> } {
  const candidate = { value: parsed };
  if (!isNonArrayRecord(candidate)) return false;
  if (typeof candidate.value.slug !== "string" || !candidate.value.slug) return false;
  return isNonArrayRecord({ value: candidate.value.values });
}

/** The per-field half of {@link decodeFormFlashCookieValue} — split out for the same complexity
 *  reason as {@link isFlashPayloadShape}. Caps both the number of entries considered and each
 *  field id's/value's own length, the same untrusted-input discipline
 *  {@link readFieldErrorsFromQuery} already applies to the query-string side of this feature.
 * @complexity O(n) in `rawValues`' entry count, capped at {@link FORM_FLASH_MAX_FIELDS}. */
function decodeFlashValues(rawValues: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [field, value] of Object.entries(rawValues).slice(0, FORM_FLASH_MAX_FIELDS)) {
    if (typeof value === "string" && field) {
      values[field.slice(0, FORM_FLASH_MAX_FIELD_ID_LENGTH)] = value.slice(0, FORM_FLASH_MAX_FIELD_VALUE_LENGTH);
    }
  }
  return values;
}

/** Decodes a flash cookie's raw (already `decodeURIComponent`-d) value. Every value is untrusted —
 *  a visitor can hand-craft a cookie the same way `decodeFormSubmissionResultFromQuery` already
 *  treats a hand-crafted query string — so any malformation (not JSON, wrong shape, oversized)
 *  degrades to `undefined` rather than throwing.
 * @complexity O(1) plus {@link decodeFlashValues}' own bounded cost. */
export function decodeFormFlashCookieValue({ raw }: { raw: string | undefined }, _optional = {}): FormFlashPayload | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isFlashPayloadShape(parsed)) return undefined;
  return { slug: parsed.slug.slice(0, FORM_FLASH_MAX_SLUG_LENGTH), values: decodeFlashValues(parsed.values) };
}

/** Attaches a decoded flash's `values` onto a decoded query-string `result`, read-once (the caller,
 *  `pages.ts`, clears the cookie regardless of whether this merge actually applied). Only ever
 *  applies to a `"validation"` result for the SAME slug the flash names — a flash for a different
 *  form, a stale/expired one that decoded to `undefined`, or one arriving alongside a `"success"`/
 *  `"rate-limited"`/`"error"` result (a shape it was never set for) all pass `result` through
 *  unchanged. @complexity O(1). */
export function mergeFormFlashIntoResult(
  { result, flash }: { result: FormSubmissionRedirectResult | undefined; flash: FormFlashPayload | undefined }, _optional = {}
): FormSubmissionRedirectResult | undefined {
  // Timing retries use the same read-once text recovery; successful/rate/internal outcomes do not.
  if (!result || !flash || flash.slug !== result.slug) return result;
  if (result.kind !== "validation" && result.kind !== "too-fast") return result;
  return { ...result, values: flash.values };
}
