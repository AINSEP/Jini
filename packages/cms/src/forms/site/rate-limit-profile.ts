import type { RateLimitProfile } from "@jini-ai/core/contracts/site/http-kit-rate-limit";

/**
 * @file `FORMS_SUBMIT` rate-limit profile (SPEC-010 REQ-09, C-010/C-011).
 *
 * Purpose:
 * Wraps the EXISTING `core/rate-limit/rate-limit.ts` `createRateLimiter`/`resolveClientIp`
 * (Article I reuse, ADR-PIPE-010 Pattern Evaluation) — does not reimplement the fixed-window
 * algorithm. This file only pins the profile constant for the package-owned `(sourceIp, formId)` key.
 */

// INV-09 key isolation rationale: Jini/packages/cms/forms/src/rate-limit-key.ts.
/** api.spec.md §3 `FORMS_SUBMIT` — 5 requests / 60s / 0 burst, keyed by `(ip, formId)`. */
export const FORMS_SUBMIT_PROFILE: RateLimitProfile = {
  windowSeconds: 60,
  max: 5,
  burst: 0,
};
