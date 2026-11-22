import { isNonArrayRecord } from "@jini-ai/core/records";
import type { FormSubmissionRedirectResult } from "./types.js";

/** Query param names shared by {@link encodeFormSubmissionResultQuery} (write side, forms-submit.ts
 *  builds a redirect Location with) and {@link decodeFormSubmissionResultFromQuery} (read side,
 *  pages.ts reads `req.query` with) — the host supplies the same map to both halves
 *  of the round trip so they cannot drift apart. */
export interface FormResultQueryKeys {
  slug: string;
  status: string;
  errors: string;
  retryAfter: string;
}

// A hand-crafted query string is untrusted input regardless of whether it came from our own redirect
// or a visitor typing it directly — these bound how much of it `decodeFormSubmissionResultFromQuery`
// will ever process, so neither side of the round trip can be turned into an unbounded-work vector.
const FORM_RESULT_MAX_FIELD_ERRORS = 20;
const FORM_RESULT_MAX_FIELD_STRING_LEN = 200;

/** Builds the query params `forms-submit.ts` appends to its Post/Redirect/Get `Location` header. A
 *  plain `URLSearchParams`, not a full URL — resolving and validating the redirect's BASE (same-
 *  origin check against `Referer`) is an HTTP/security concern that belongs to the route layer, not
 *  this rendering-layer function. Never encodes `result.values` — see {@link FormSubmissionRedirectResult}'s
 *  own doc for why submitted field text never travels in the query string. */
export function encodeFormSubmissionResultQuery(
  { result, keys }: { result: FormSubmissionRedirectResult; keys: FormResultQueryKeys }, _optional = {}
): URLSearchParams {
  const params = new URLSearchParams();
  params.set(keys.slug, result.slug);
  params.set(keys.status, result.kind === "rate-limited" ? "rate_limited" : result.kind);
  if (result.kind === "validation") {
    params.set(keys.errors, JSON.stringify(result.fieldErrors.slice(0, FORM_RESULT_MAX_FIELD_ERRORS)));
  }
  if (result.kind === "rate-limited") {
    params.set(keys.retryAfter, String(Math.max(0, Math.trunc(result.retryAfterSeconds))));
  }
  return params;
}

/** Strips every {@link keys} key from `params` in place. `forms-submit.ts` calls
 *  this on the redirect base's existing query before re-appending a fresh result, so resubmitting the
 *  same form twice on the same page never accumulates stale `form_*` params from the earlier visit. */
export function clearFormSubmissionResultQueryParams(
  { params, keys }: { params: URLSearchParams; keys: FormResultQueryKeys }, _optional = {}
): void {
  for (const key of Object.values(keys)) params.delete(key);
}

function queryStringValue({ value }: { value: unknown }, _optional = {}): string {
  return typeof value === "string" ? value : "";
}

/** The `form_errors` half of {@link decodeFormSubmissionResultFromQuery} — split out because it is
 *  the one field shaped as nested, attacker-editable JSON rather than a flat scalar, so it carries
 *  its own parse/shape/length guards. Any malformation (not JSON, not an array, oversized, wrong
 *  element shape) degrades to an empty list rather than throwing — a visitor can reach this by
 *  hitting a page directly with a hand-crafted query string, not only via our own redirect.
 * @complexity O(n) in the decoded array's length, itself capped at {@link FORM_RESULT_MAX_FIELD_ERRORS}
 * before this function ever sees it. */
/** Shape-narrows ONE decoded `form_errors` array entry to a `{field, reason}` pair, or `null` when it
 *  isn't one — split out of {@link readFieldErrorsFromQuery}'s own loop body (complexity-debt sweep,
 *  2026-09-03; that function was at cyclomatic 10 / cognitive 12 against this repo's 9 ceilings) so
 *  the per-entry decode decision is its own unit instead of four of the loop's own branches. Same
 *  untrusted-input discipline as before: a non-object entry, or one with no non-empty `field`, is
 *  simply skipped by the caller — never a thrown error. Neither `field` nor `reason` is escaped here;
 *  both remain raw decoded strings until they reach an actual HTML sink ({@link showFieldErrors}),
 *  same "escape at the sink, not at the boundary" rule every other query/cookie decoder in this file
 *  follows.
 * @complexity O(1). */
function parseFieldErrorEntry({ entry }: { entry: unknown }, _optional = {}): { field: string; reason: string } | null {
  const candidate = { value: entry };
  if (!isNonArrayRecord(candidate)) return null;
  const field = queryStringValue({ value: candidate.value.field });
  if (!field) return null;
  const reason = queryStringValue({ value: candidate.value.reason });
  return { field: field.slice(0, FORM_RESULT_MAX_FIELD_STRING_LEN), reason: reason.slice(0, FORM_RESULT_MAX_FIELD_STRING_LEN) };
}

function readFieldErrorsFromQuery({ raw }: { raw: unknown }, _optional = {}): Array<{ field: string; reason: string }> {
  const rawString = queryStringValue({ value: raw });
  if (!rawString || rawString.length > FORM_RESULT_MAX_FIELD_STRING_LEN * FORM_RESULT_MAX_FIELD_ERRORS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawString);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const errors: Array<{ field: string; reason: string }> = [];
  for (const entry of parsed.slice(0, FORM_RESULT_MAX_FIELD_ERRORS)) {
    const parsedEntry = parseFieldErrorEntry({ entry });
    if (parsedEntry) errors.push(parsedEntry);
  }
  return errors;
}

/** A `retry-after` query value as whole positive seconds; anything else reads as 0. */
function positiveSeconds({ raw }: { raw: unknown }, _optional: Record<string, never> = {}): number {
  const seconds = Number.parseInt(queryStringValue({ value: raw }), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/** Reads a {@link FormSubmissionRedirectResult} back off `query` (an Express `req.query`, or any
 *  plain string-keyed record — kept framework-agnostic per this module's own doc). Every value is
 *  untrusted, the same way `readFieldErrorsFromQuery` already treats `form_errors`: an unrecognized/
 *  malformed `form_status`, or a `form`/`form_status` that isn't a non-empty string, decodes to
 *  `undefined` ("no result to show") rather than throwing. Never produces a `values` field — see
 *  {@link mergeFormFlashIntoResult} for the separate channel that attaches one.
 * @complexity O(1), except `form_status=invalid` which delegates to
 * {@link readFieldErrorsFromQuery}'s own bounded cost. */
export function decodeFormSubmissionResultFromQuery(
  { query, keys }: { query: Record<string, unknown>; keys: FormResultQueryKeys }, _optional = {}
): FormSubmissionRedirectResult | undefined {
  const slug = queryStringValue({ value: query[keys.slug] });
  const status = queryStringValue({ value: query[keys.status] });
  if (!slug || !status) return undefined;
  if (status === "success") return { kind: "success", slug };
  if (status === "error") return { kind: "error", slug };
  if (status === "too-fast") return { kind: "too-fast", slug };
  if (status === "rate_limited") return { kind: "rate-limited", slug, retryAfterSeconds: positiveSeconds({ raw: query[keys.retryAfter] }) };
  if (status === "validation") return { kind: "validation", slug, fieldErrors: readFieldErrorsFromQuery({ raw: query[keys.errors] }) };
  return undefined;
}

