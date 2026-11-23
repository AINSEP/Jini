/**
 * @file The optimistic-concurrency boundary for `updatePost` (2026-09-06) — shared by every arm
 * that lets an outside caller send a version basis.
 *
 * `be45461e` put the guard in `updatePost` itself; `9c7d16bf` wired the admin HTTP route, and this
 * module exists because a SECOND arm (`features/post/tool-registrations.ts`'s `content_post_update`,
 * the assistant's route into the same domain function) then needed the identical validation and the
 * identical conflict vocabulary. Both arms import from here rather than keeping a copy: a second
 * inline copy is exactly how one arm gets fixed and its sibling silently keeps the bug, which is
 * the defect this whole change is closing in the first place.
 *
 * Deliberately NOT inside `post.ts`: `updatePost` receives an already-typed `number | undefined`
 * and has no business knowing what an untrusted wire value looks like. This is the boundary that
 * turns `unknown` into that, and the boundary is what both callers share.
 */
import { ToolInputError } from "@jini-ai/core";
import { parseExpectedVersion as parseCoreExpectedVersion } from "@jini-ai/core/optimistic-concurrency";

import { PostValidationError, type PostVersionConflictError } from "./post.js";

/** The exact text a malformed basis is rejected with, on every arm. */
export const EXPECTED_VERSION_REJECTION = "'expectedVersion' must be a non-negative integer when present";

/**
 * The machine-readable discriminator for a version conflict — the same string `entries/` and
 * `content-types/` already use for the identical condition.
 *
 * One definition rather than a literal per arm: the whole point of the code is that a client can
 * branch on it, and a client cannot branch on a string two arms spell independently.
 */
export const VERSION_CONFLICT_CODE = "VERSION_CONFLICT";

/**
 * The optimistic-concurrency basis off an untyped input — `undefined` (key absent) when the caller
 * is not opting in, otherwise the exact `number` `updatePost` will compare.
 *
 * The rule itself is `@jini-ai/core`'s one parser (a SAFE non-negative integer; 2026-11-18, owner
 * decision KT-DT6 — before it this file kept a second copy that also accepted an integer above
 * 2^53 - 1, which then failed as a version conflict instead of as invalid input). This function is
 * only the host error adapter: core's `ToolInputError` becomes the `PostValidationError` both arms
 * already branch on.
 *
 * Throws rather than returning `undefined` for anything else, and that is the whole point of this
 * function existing: `expectedVersion` is OPTIONAL in `UpdatePostInput`, so a value a caller failed
 * to recognize would coerce to "no basis sent" and be written through as an unguarded,
 * last-write-wins save — silently re-opening the exact clobber the guard exists to close. A caller
 * that sends `"3"`, `3.5`, `-1`, `null` or `true` has a bug; it must hear about it, not have its
 * edit land on top of somebody else's.
 *
 * `PostValidationError` (not a bespoke type) so it reaches each arm's EXISTING malformed-input
 * branch — a 400 on the HTTP route, a `ToolInputError`-decorated shape rejection on the agent tool
 * — and so it stays the same error class every other malformed field already throws. Deliberately
 * NOT a `PostConflictError`: resending the identical request cannot fix a stale basis, but it CAN
 * fix a mistyped one. Only core's `ToolInputError` is translated (kept as the `cause`); any other
 * failure of the parser propagates unchanged.
 *
 * @param optional.parse the parser to adapt (default core's); injected so the rethrow path is tested.
 * @complexity O(1).
 */
export function parseExpectedVersion(
  { raw }: { raw: unknown },
  { parse = parseCoreExpectedVersion }: { parse?: typeof parseCoreExpectedVersion } = {}
): number | undefined {
  try {
    return parse({ value: raw });
  } catch (error) {
    if (error instanceof ToolInputError) throw new PostValidationError(EXPECTED_VERSION_REJECTION, { cause: error });
    throw error;
  }
}

/**
 * The 409 body a version conflict answers with on an HTTP arm.
 *
 * Both versions travel as structured fields, not only inside the prose, so a client can say "yours
 * was N, theirs is M" without parsing the message — the reason `PostVersionConflictError` carries
 * them as fields at all.
 *
 * @complexity O(1).
 */
export function versionConflictEnvelope(err: PostVersionConflictError, _optional: Record<string, never> = {}): {
  error: string;
  code: typeof VERSION_CONFLICT_CODE;
  details: { expectedVersion: number; currentVersion: number };
} {
  return {
    error: err.message,
    code: VERSION_CONFLICT_CODE,
    details: { expectedVersion: err.expectedVersion, currentVersion: err.currentVersion },
  };
}
