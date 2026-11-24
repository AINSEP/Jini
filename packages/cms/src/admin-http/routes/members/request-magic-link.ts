import { defineJsonRoute, ok, routeReply, type RateLimiter, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { authorizeMemberManage, rejectMemberError, type MemberErrorClassifier, type MemberErrorStatuses, type MemberRoutePrincipal } from "./shared.js";

/** What the members library answers an operator-triggered sign-in link with, passed through as the 200 body. */
export interface MemberSignInLinkResult { delivered: boolean; challengeId: string }

/**
 * Sends one passwordless sign-in link. Injected because the challenge service and its mailer are the host's
 * members library: it throws the library's sign-in-unavailable / validation errors and the mailer's
 * sender-not-configured error, which the host's classifier names for this route.
 */
export type MemberRequestSignInLinkFn = (required: { workspaceId: string; email: string; redirectPath: string | undefined }) => Promise<MemberSignInLinkResult>;

/** The deps this route reads. */
export interface MemberRequestMagicLinkRouteDeps {
  workspaceId: string;
  /** The shared per-email sign-in limiter (the same instance the public sign-in route consults). */
  magicLinkPerEmailLimiter: Pick<RateLimiter, "check">;
  requestSignInLink: MemberRequestSignInLinkFn;
  classifyMemberError: MemberErrorClassifier;
  /** The host's product copy for a site whose mailer has no sender identity, answered verbatim with the 503. */
  senderNotConfiguredMessage: string;
}

/**
 * The raw, uncoerced request body. Coercion runs in `handle` only after `authorizeMemberManage`, because the
 * legacy handler authorized first: a denied caller whose field coercion would throw still gets the 403.
 */
interface MagicLinkInput { body: Record<string, unknown> }

/** The two body fields, string-coerced as the hand-written route read them (call only after authorization). */
function coerceMagicLinkBody({ body }: MagicLinkInput, _optional: Record<string, never> = {}): { rawEmail: string; redirectPath: string | undefined } {
  return { rawEmail: String(body.email ?? ""), redirectPath: body.redirectPath ? String(body.redirectPath) : undefined };
}

/** The library failures this route answers itself; a not-found or conflict was never mapped here (a redacted 500). */
const MAGIC_LINK_ERRORS: MemberErrorStatuses = { validation: 400 };

/** The 503 code both setup failures share, so the admin screen can say mail is not set up. */
const SIGN_IN_UNAVAILABLE = "MEMBER_SIGN_IN_UNAVAILABLE";

/**
 * Checks the per-email budget — ADR-PIPE-013 Decision §2-3 / INV-NEW-03: the caller invokes it only AFTER
 * `authorize()` succeeded (an unauthorized caller must never reach, and therefore never consume, this
 * check). Answers the 429 reply on a denial, `undefined` when the request may proceed.
 * @complexity O(1) plus the injected limiter.
 */
async function rateLimitReply(
  { deps, rawEmail }: { deps: Pick<MemberRequestMagicLinkRouteDeps, "magicLinkPerEmailLimiter">; rawEmail: string },
  _optional: Record<string, never> = {},
): Promise<RouteReply | undefined> {
  const emailKey = rawEmail.trim().toLowerCase();
  // Empty emails are validation errors, never missing-key limiter buckets.
  if (!emailKey) rejectRoute({ status: 400, error: `'${rawEmail}' is not a valid email address` });
  const limit = await deps.magicLinkPerEmailLimiter.check({ key: emailKey });
  if (limit.allowed) return undefined;
  return routeReply({
    status: 429,
    body: { error: "too many sign-in requests for this email", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: limit.retryAfterSeconds } },
    headers: { "Retry-After": String(limit.retryAfterSeconds) },
  });
}

/** Answers a send failure: both setup failures are a coded 503, a validation error a code-less 400, anything else rethrown. */
function rejectMagicLinkError({ err, deps }: { err: unknown; deps: MemberRequestMagicLinkRouteDeps }, _optional: Record<string, never> = {}): never {
  const kind = deps.classifyMemberError({ err });
  if (kind === "sender-not-configured") rejectRoute({ status: 503, error: deps.senderNotConfiguredMessage, code: SIGN_IN_UNAVAILABLE });
  if (kind === "sign-in-unavailable") rejectRoute({ status: 503, error: err instanceof Error ? err.message : String(err), code: SIGN_IN_UNAVAILABLE });
  return rejectMemberError({ err, classify: deps.classifyMemberError, statuses: MAGIC_LINK_ERRORS });
}

/**
 * POST request a passwordless sign-in link for a member email (operator-
 * triggered resend, e.g. from an admin member-detail screen's "resend
 * sign-in link" action).
 *
 * Returns actual mailer acceptance to the authorized operator, including false for skipped or
 * failed sends. Site-wide setup failures return 503. Public callers use the separate generic
 * accepted response so neither membership nor per-address delivery failures can be enumerated.
 * A malformed email reaches the 400 branch below.
 *
 * ADR-PIPE-013 §1 (FEAT-013 Phase 1): previously ran behind session auth only
 * — no per-action `authorize()` call, unlike `disable.ts`. Closes that live
 * authorization gap by requiring `member.manage`, copying `disable.ts`'s
 * exact call shape. INV-NEW-03 (Phase 2, T022, now enforced below):
 * the shared `MAGIC_LINK_PER_EMAIL` rate-limit check must land strictly
 * *after* this `authorize()` call, never before, so an unauthorized caller
 * cannot consume rate-limit budget for a target email as a side channel.
 */
export const memberRequestMagicLinkRoute = defineJsonRoute<MagicLinkInput, MemberSignInLinkResult | RouteReply, MemberRequestMagicLinkRouteDeps, MemberRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/members/request-magic-link",
  parse: (raw) => ok({ value: { body: (raw.body ?? {}) as Record<string, unknown> } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMemberManage({ authorize });
    const { rawEmail, redirectPath } = coerceMagicLinkBody(input);
    try {
      const limited = await rateLimitReply({ deps, rawEmail });
      if (limited) return ok({ value: limited });
      return ok({ value: await deps.requestSignInLink({ workspaceId: deps.workspaceId, email: rawEmail, redirectPath }) });
    } catch (err) {
      return rejectMagicLinkError({ err, deps });
    }
  },
});
