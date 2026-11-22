/**
 * @module redact
 *
 * Lexical secret / PII scrubber for telemetry payloads. Originally a verbatim port of
 * OD's daemon redactor — no product-identity strings or hardcoded env vars in the original,
 * so no genericization was needed. The shared kernel now also covers the CLI/provider rule
 * union and accepts explicit host secrets; the original categories and rationale stay here.
 *
 * Runs before any prompt or assistant text is sent to an external
 * observability sink. The default policy is intentionally conservative:
 * each one matches a well-defined token shape with extremely low
 * false-positive rate (API keys have a fixed prefix, JWTs have the
 * "header.payload.signature" triple, credit-card matches go through a Luhn
 * check). What this file does NOT do — and any caller-facing copy must
 * reflect that — is detect names, addresses, business secrets, or anything
 * that requires understanding the meaning of the surrounding text. That's
 * an ML / LLM problem this module doesn't take on. Callers can explicitly opt
 * into `policy: 'aggressive'` to also mask bare 20+ character opaque runs;
 * that CLI-style heuristic trades identifier/path readability for broader masking
 * and must never be used by diagnostics or secret-scan guards.
 *
 * Output format: every match is replaced by `[REDACTED:<kind>]` so a
 * reviewer reading a trace can see exactly which category fired without
 * recovering the original value.
 *
 * References:
 * - Langfuse client-side masking guidance:
 *   https://langfuse.com/docs/observability/features/masking
 * - GitHub token format:
 *   https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github
 * - AWS access key shape: 'AKIA' + 16 uppercase alphanumerics.
 * - Luhn algorithm (credit cards): https://en.wikipedia.org/wiki/Luhn_algorithm
 */

import type { SecretRedactionOptions } from './redaction-patterns.js';
import { collectSpans } from './redaction-collectors.js';
import { mergeSpans } from './redaction-spans.js';

/**
 * Returns `input` with every recognised secret / PII pattern replaced by a
 * `[REDACTED:<kind>]` marker. Under the default policies, idempotent — re-running on already redacted
 * text only matches new tokens. Exact occurrences wholly within credential labels or generated markers preserve that syntax;
 * crossing occurrences still mask their complete range; all value rules still see the original context. Defaults to conservative; `{ policy: 'aggressive' }`
 * additionally masks bare 20+ character opaque runs. Exact secrets and extra patterns
 * are honored under either heuristic policy.
 * Exact-only replaces only supplied secrets in one pass,
 * preserves unmatched characters, and inserts the optional literal marker without reprocessing it.
 *
 * Empty / non-string input passes through unchanged so the caller can use
 * this as a no-op on optional fields.
 */
export function redactSecrets({ input }: { input: string }, options: SecretRedactionOptions = {}): string {
  return redactSecretsWithCounts({ input }, options).redacted;
}

/**
 * Same as {@link redactSecrets} but also returns per-category counts so the
 * caller can attach an audit summary to the trace metadata ('we stripped 2
 * keys + 1 email before send').
 *
 * Every rule matches the ORIGINAL input and contributes value spans; overlapping or adjacent
 * spans merge, and one left-to-right pass writes one marker per merged span. Sequential
 * substitution passes leaked in every order tried: each pass saw text an earlier pass had
 * changed. Exact secrets run first split labels (`a` inside `password=hunter2` left `hunter2`) and
 * lost context (`note password=` left `hunter2`); run last, a lexical rule that stopped partway
 * (the label rule at whitespace, vendor/query rules at `.`, `;`, `&`, `!` or quotes) left the rest
 * of a known secret visible; protecting spans exempted secrets overlapping a marker; and
 * overlapping secrets left a tail behind. Opt-in aggressive opaque
 * rules are collected before PII rules so a numeric token keeps the opaque category when tied.
 * @complexity O(n·(r + e) + s + k) for n input chars, r rules, e exact-secret needles, s needle
 * chars and k spans.
 */
export function redactSecretsWithCounts({ input }: { input: string }, options: SecretRedactionOptions = {}): {
  redacted: string;
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  if (!input) return { redacted: input, counts };
  const spans = mergeSpans(collectSpans({ text: input }, options), { keepAdjacent: options.policy === 'exact-only' });
  let redacted = '';
  let cursor = 0;
  for (const { start, end, category, suffix } of spans) {
    counts[category] = (counts[category] ?? 0) + 1;
    redacted += input.slice(cursor, start) + (options.policy === 'exact-only' ? options.marker ?? '[REDACTED:exact_secret]' : `[REDACTED:${category}]`) + (suffix ?? '');
    cursor = end;
  }
  return { redacted: redacted + input.slice(cursor), counts };
}
