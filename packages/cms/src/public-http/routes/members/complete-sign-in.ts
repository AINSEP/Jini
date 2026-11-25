import { defineJsonRoute, ok, routeReply, type JsonRouteSpec, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { memberClientAddress, memberRequestLimitReply, memberStringBody, refuseMemberAuthError, type MemberAuthRefusalFor, type MemberRequestLimiter } from "./shared.js";

/**
 * @file `POST /api/members/v1/workspaces/:workspaceId/sign-in/complete` — the PUBLIC
 * complete-sign-in route (ADR-PIPE-013 Decision §2-3, C-013).
 *
 * Deliberately unauthenticated (no `requireAdminSession`, no `authorize()`) and gated by the
 * lighter `MAGIC_LINK_COMPLETE_ATTEMPT` per-IP profile. That limit is defense-in-depth: the
 * 256-bit raw link token makes brute force infeasible, and a six-digit code is bounded by the
 * per-challenge attempt reservation in `consumeMemberChallenge`, not by this IP counter.
 *
 * INV-NEW-01 (cookie isolation): sets ONLY the host's member session cookie (`sessionCookie`), never
 * reads or writes the admin session cookie — a request carrying only an admin cookie (no token)
 * is still rejected by this route; the admin cookie has zero effect here.
 */

/** One credential form: a link token, or a challenge id plus its emailed code. */
export type MemberCompletionCredential = { token: string } | { challengeId: string; code: string };

/** What the host's completion service answers: the raw session token (only ever sent in the cookie),
 *  the session's expiry, and the member row the host projects to its public DTO. */
export interface MemberCompleteSignInResult {
  readonly rawSessionToken: string;
  readonly session: { readonly expiresAt: string };
  readonly member: unknown;
}

/** The deps this route reads. Cookie name and attributes, analytics, the member DTO and error copy are the host's. */
export interface MemberCompleteSignInRouteDeps {
  workspaceId: string;
  /** The shared per-IP completion attempt counter. */
  attemptLimiter: MemberRequestLimiter;
  completeSignIn: (required: { workspaceId: string; userAgent: string | undefined; ip: string } & MemberCompletionCredential) => Promise<MemberCompleteSignInResult>;
  /** The `Set-Cookie` value that sets the host's member session cookie for this token until `expiresAtIso`. */
  sessionCookie: (required: { rawToken: string; expiresAtIso: string }) => string;
  /** Host analytics: one session outcome after its authoritative owner committed. */
  signedIn: (required: { result: MemberCompleteSignInResult }) => void;
  /** The host's public member DTO of `result.member`. */
  toPublicMember: (required: { member: unknown }) => unknown;
  refusalFor: MemberAuthRefusalFor;
}

/** Exactly one credential form, with no missing/empty handle passed to the repository: a non-empty token,
 *  or a non-empty challenge id with a code of exactly six ASCII digits (anchored at both ends).
 * @returns The credential, or `null` when the body is neither form.
 * @complexity O(k) fields.
 */
export function memberCompletionCredential({ body }: { body: unknown }, _optional: Record<string, never> = {}): MemberCompletionCredential | null {
  const token = memberStringBody({ body, fields: ["token"] });
  if (token?.token) return { token: token.token };
  const { challengeId, code } = memberStringBody({ body, fields: ["challengeId", "code"] }) ?? {};
  if (challengeId && code !== undefined && /^\d{6}$/.test(code)) return { challengeId, code };
  return null;
}

/** The validated credential plus the host-resolved client facts. */
interface CompleteSignInInput { credential: MemberCompletionCredential; clientAddress: string; userAgent: string | undefined }

/** Complete a purpose-bound link/code challenge and set only the member session cookie. O(1) I/O. */
export const memberCompleteSignInRoute: JsonRouteSpec<CompleteSignInInput, RouteReply, MemberCompleteSignInRouteDeps> & { readonly requestFacts: true } = {
  ...defineJsonRoute<CompleteSignInInput, RouteReply, MemberCompleteSignInRouteDeps>({
    method: "post",
    path: "/api/members/v1/workspaces/:workspaceId/sign-in/complete",
    parse: (raw) => {
      const credential = memberCompletionCredential({ body: raw.body });
      if (!credential) rejectRoute({ status: 400, error: "expected token or challengeId and six-digit code strings" });
      return ok({ value: { credential, clientAddress: memberClientAddress({ raw }), userAgent: raw.facts?.userAgent } });
    },
    handle: async ({ input, deps }) => {
      try {
        const limited = await memberRequestLimitReply({ clientAddress: input.clientAddress, ipLimiter: deps.attemptLimiter });
        if (limited) return ok({ value: limited });
        const result = await deps.completeSignIn({ workspaceId: deps.workspaceId, ...input.credential, userAgent: input.userAgent, ip: input.clientAddress });
        const cookie = deps.sessionCookie({ rawToken: result.rawSessionToken, expiresAtIso: result.session.expiresAt });
        deps.signedIn({ result });
        return ok({ value: routeReply({ status: 200, body: { member: deps.toPublicMember({ member: result.member }) }, headers: { "Set-Cookie": cookie } }) });
      } catch (error) {
        return refuseMemberAuthError({ error, refusalFor: deps.refusalFor });
      }
    },
  }),
  requestFacts: true,
};
