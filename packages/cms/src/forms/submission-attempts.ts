/**
 * @file `submission-attempts.ts` — remembers, in this process only and for a short window, which
 * public form submissions were just accepted, so a double-clicked Send stores ONE row.
 *
 * Why an attempt token, not the body (2026-10-05, replacing the 2026-10-04 derived-id dedupe): an
 * IP + body key cannot tell a double click from two people behind one office NAT giving the same
 * answer, and deriving the permanent submission id from it left an unsalted IP hash in every row
 * after the 90-day IP sweep. The page now carries a fresh `_attempt` token per response
 * (`injectFormAttemptTokens`, `http/site/form-render.ts`), so a double click repeats one token while
 * two visitors, or the same visitor after a reload, send different ones. Ids are random again.
 *
 * What still shares a token: a static export (the server cannot vary a file per visitor, so it
 * ships none) and a page a shared HTTP cache served to several visitors. Those, and API callers that
 * send no token, fall back to the old IP + body comparison for the same window. Only identical
 * answers from one IP within the window collapse, as before.
 *
 * Why process memory, not a table: the claim must be atomic, short-lived and never persisted (it is
 * an IP-derived hash). One Node process makes check-then-claim atomic with no await between them;
 * a restart or a second machine only forgets recent claims, which stores a duplicate rather than
 * dropping a submission. Same one-process-lifetime shape as the forms rate limiter.
 */
import type { SubmitFormInput } from "./index.js";

/** The hidden field carrying a form's per-response attempt token. Never stored, never validated. */
export const FORM_ATTEMPT_FIELD = "_attempt";

/** How long after a submission is accepted an identical attempt is answered without a second row. */
export const DUPLICATE_SUBMISSION_WINDOW_MS = 60_000;

/** Upper bound on remembered attempts; past it the oldest is forgotten (a duplicate, never a drop). */
const MAX_REMEMBERED_ATTEMPTS = 10_000;

type Attempt =
  | { kind: "pending"; accepted: Promise<boolean> }
  | { kind: "accepted"; atMs: number };

/** Returned by {@link SubmissionAttempts.once} when `submit` was skipped as a duplicate. */
export const DUPLICATE_ATTEMPT = Symbol("duplicate form submission attempt");

export interface SubmissionAttempts {
  /** Hash one attempt with the host-supplied hash, without retaining the source IP or body. */
  key(required: { input: SubmitFormInput; attemptToken: unknown }, optional?: Record<string, never>): string;
  /**
   * Runs `submit` unless the same attempt was accepted within the window. A copy that arrives while
   * the first is still being stored waits for it: answered as a duplicate when the first is
   * accepted, run itself when the first failed (so a failed first copy never swallows its retry).
   * `submit`'s rejection propagates and frees the claim.
   * @complexity O(1) amortized: expired claims are pruned from the oldest end.
   */
  once<T>(
    required: { key: string; nowMs: () => number; submit: () => Promise<T> },
    optional?: Record<string, never>,
  ): Promise<T | typeof DUPLICATE_ATTEMPT>;
}

/**
 * The key one attempt is remembered under: a SHA-256 of workspace, slug, source IP, attempt token
 * (null when the request carried none) and the body. Body keys are sorted so their order cannot
 * change the key. Held only in memory, only for the window.
 * @complexity O(b log b) for b body keys.
 */
export function submissionAttemptKey(
  { input, attemptToken, hash }: { input: SubmitFormInput; attemptToken: unknown; hash: (input: string) => string },
  _optional: Record<string, never> = {},
): string {
  // Object keys are unique, so the comparator never sees a tie.
  const body = Object.entries(input.body).sort(([a], [b]) => (a < b ? -1 : 1));
  return hash(JSON.stringify([input.workspaceId, input.slug, input.sourceIp, attemptToken ?? null, body]));
}

/**
 * Builds one in-memory attempt store. Entries sit in claim/acceptance order (an accepted entry is
 * re-inserted at the end), so expired ones are always at the front.
 * @returns The store; see {@link SubmissionAttempts.once}.
 */
export function createSubmissionAttempts(
  { hash }: { hash: (input: string) => string },
  { windowMs = DUPLICATE_SUBMISSION_WINDOW_MS, maxEntries = MAX_REMEMBERED_ATTEMPTS }: { windowMs?: number; maxEntries?: number } = {},
): SubmissionAttempts {
  const attempts = new Map<string, Attempt>();

  const prune = (nowMs: number): void => {
    for (const [key, attempt] of attempts) {
      if (attempt.kind === "pending" || nowMs - attempt.atMs < windowMs) break;
      attempts.delete(key);
    }
    while (attempts.size >= maxEntries) attempts.delete(attempts.keys().next().value!);
  };

  return {
    key: (required, optional = {}) => submissionAttemptKey({ ...required, hash }, optional),
    async once({ key, nowMs, submit }, _optional = {}) {
      for (;;) {
        const seen = attempts.get(key);
        if (seen?.kind === "accepted" && nowMs() - seen.atMs < windowMs) return DUPLICATE_ATTEMPT;
        if (seen?.kind !== "pending") break;
        if (await seen.accepted) return DUPLICATE_ATTEMPT;
      }
      // No await between the check above and this claim: one process cannot interleave them.
      prune(nowMs());
      let settle!: (accepted: boolean) => void;
      const mine: Attempt = { kind: "pending", accepted: new Promise<boolean>((resolve) => { settle = resolve; }) };
      attempts.set(key, mine);
      try {
        const result = await submit();
        if (attempts.get(key) === mine) attempts.delete(key);
        attempts.set(key, { kind: "accepted", atMs: nowMs() });
        settle(true);
        return result;
      } catch (error) {
        if (attempts.get(key) === mine) attempts.delete(key);
        settle(false);
        throw error;
      }
    },
  };
}
