import { defineJsonRoute, ok, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { memberClientAddress, memberRequestLimitReply, memberStringBody, refuseMemberAuthError, type MemberAuthRefusalFor, type MemberRequestLimiter } from "./shared.js";

/**
 * @file `POST /api/members/v1/workspaces/:workspaceId/sign-in` — the PUBLIC, visitor-initiated
 * sign-in-request route (ADR-PIPE-013 Decision §2-3, C-012).
 *
 * Deliberately unauthenticated (no `requireAdminSession`, no `authorize()` — this route family
 * must never import either, see ADR-PIPE-013 Enforcement) and rate-limited on BOTH axes before any
 * token is minted:
 *  - `MAGIC_LINK_PER_EMAIL` (keyed by the normalized target email) — bounds spam to one inbox
 *    regardless of source IP.
 *  - `MAGIC_LINK_PER_IP` (keyed by the host-resolved client address) — bounds a single attacker's
 *    ability to enumerate many emails.
 * Both checks must pass (W-002/W-003) — this is the primary target of ADR-030 OQ-8's hard
 * pre-launch precondition; checking only one of the two would reopen the enumeration/abuse
 * surface. INV-06 (anti-enumeration) is preserved: the public response is
 * `{accepted:true, challengeId}` regardless of the address or mailer result; site-wide setup
 * failures are checked before member lookup; a `429` here is a volume signal (this email/IP was
 * queried too often), never an existence signal.
 *
 * Public acceptance is independent of address lookup and mail latency. Setup failures remain the host's
 * refusals (503); the challenge service, its mailer, analytics and the error copy are the host's.
 */

/** The deps this route reads. */
export interface MemberSignInRequestRouteDeps {
  workspaceId: string;
  /** The shared magic-link per-email limiter. */
  emailLimiter: MemberRequestLimiter;
  /** The shared magic-link per-IP limiter, keyed by the client address and checked first. */
  ipLimiter: MemberRequestLimiter;
  /** Prepare the sign-in challenge; `deliver` sends it. */
  prepareSignIn: (required: { workspaceId: string; email: string; redirectPath: string | undefined }) => Promise<{ challengeId: string; deliver: () => Promise<unknown> }>;
  /** Host analytics: a challenge was prepared for this request, before the acceptance. */
  signInRequested: () => void;
  /** Run `deliver` after the acceptance is answered and report its failure privately (the host's scheduler). */
  deliverInBackground: (required: { deliver: () => Promise<unknown> }) => void;
  refusalFor: MemberAuthRefusalFor;
}

/** The validated body and the client address the IP counter is keyed by. */
interface SignInRequestInput { email: string; redirectPath: string | undefined; clientAddress: string }

/** Public member sign-in request. O(1) setup I/O; address-dependent work runs detached after the response. */
export const memberSignInRequestRoute: JsonRouteSpec<SignInRequestInput, unknown, MemberSignInRequestRouteDeps> & { readonly requestFacts: true } = {
  ...defineJsonRoute<SignInRequestInput, unknown, MemberSignInRequestRouteDeps>({
    method: "post",
    path: "/api/members/v1/workspaces/:workspaceId/sign-in",
    parse: (raw) => {
      const body = memberStringBody({ body: raw.body, fields: ["email"], optionalFields: ["redirectPath"] });
      if (!body) rejectRoute({ status: 400, error: "expected email and optional redirectPath strings" });
      // Empty emails have no valid counter key; preserve the service's validation response.
      if (!body.email.trim()) rejectRoute({ status: 400, error: `'${body.email}' is not a valid email address` });
      return ok({ value: { email: body.email, redirectPath: body.redirectPath, clientAddress: memberClientAddress({ raw }) } });
    },
    handle: async ({ input, deps }) => {
      try {
        const limited = await memberRequestLimitReply({ clientAddress: input.clientAddress, ipLimiter: deps.ipLimiter, email: input.email, emailLimiter: deps.emailLimiter });
        if (limited) return ok({ value: limited });
        const prepared = await deps.prepareSignIn({ workspaceId: deps.workspaceId, email: input.email, redirectPath: input.redirectPath });
        deps.signInRequested();
        // Do not await per-address I/O or reflect its outcome in this anti-enumeration response.
        deps.deliverInBackground({ deliver: () => prepared.deliver() });
        return ok({ value: { accepted: true, challengeId: prepared.challengeId } });
      } catch (error) {
        return refuseMemberAuthError({ error, refusalFor: deps.refusalFor });
      }
    },
  }),
  requestFacts: true,
};
