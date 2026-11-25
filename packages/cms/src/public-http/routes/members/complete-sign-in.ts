import type { RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { memberClientAddress, memberRequestLimitReply, memberStringBody, refuseMemberAuthError, type MemberAuthRefusalFor, type MemberRequestLimiter, type PublicMemberRawRoute } from "./shared.js";

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

/** A JSON answer as Express's `res.json` wrote it: the same content type and serialized bytes. O(n) body. */
function jsonResponse({ status, body, headers = {} }: { status: number; body: unknown; headers?: Readonly<Record<string, string>> }, _optional: Record<string, never> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
}

/** Complete a purpose-bound link/code challenge and set only the member session cookie. A raw answer, so the
 *  cookie is APPENDED after any `Set-Cookie` an earlier handler wrote, never replacing it. O(1) I/O. */
export const memberCompleteSignInRoute: PublicMemberRawRoute<MemberCompleteSignInRouteDeps> & { readonly requestFacts: true } = {
  method: "post",
  path: "/api/members/v1/workspaces/:workspaceId/sign-in/complete",
  requestFacts: true,
  handle: async ({ raw, deps }) => {
    const credential = memberCompletionCredential({ body: raw.body });
    if (!credential) rejectRoute({ status: 400, error: "expected token or challengeId and six-digit code strings" });
    const clientAddress = memberClientAddress({ raw });
    try {
      const limited: RouteReply | undefined = await memberRequestLimitReply({ clientAddress, ipLimiter: deps.attemptLimiter });
      if (limited) return jsonResponse({ status: limited.status, body: limited.body, headers: limited.headers ?? {} });
      const result = await deps.completeSignIn({ workspaceId: deps.workspaceId, ...credential, userAgent: raw.facts?.userAgent, ip: clientAddress });
      const cookie = deps.sessionCookie({ rawToken: result.rawSessionToken, expiresAtIso: result.session.expiresAt });
      deps.signedIn({ result });
      return jsonResponse({ status: 200, body: { member: deps.toPublicMember({ member: result.member }) }, headers: { "set-cookie": cookie } });
    } catch (error) {
      return refuseMemberAuthError({ error, refusalFor: deps.refusalFor });
    }
  },
};
