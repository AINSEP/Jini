import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { memberClientAddress, memberRequestLimitReply, type MemberRequestLimiter, type PublicMemberRawRoute } from "./shared.js";

/**
 * @file `POST /api/members/v1/workspaces/:workspaceId/identities/:providerId/unlink` — the PUBLIC
 * self-service unlink of one federated sign-in identity from the signed-in member.
 *
 * The host owns the unlink lifecycle (its locks, the fresh-session window, the alternative-sign-in
 * requirement, the session revoke/reissue), the member session cookie and its reader, the same-origin and
 * body-size gates (run at the mount, ahead of this spec), and the refusal copy.
 */

/** What the host's unlink answers: the reissued raw session token (only ever sent in the cookie) and its expiry. */
export interface MemberUnlinkIdentityResult {
  readonly rawSessionToken: string;
  readonly session: { readonly expiresAt: string };
}

/** The host's FAIL-CLOSED answer for ANY error (its own login codes, or a fixed invalid outcome for anything
 *  else): federated-login failures may carry upstream credentials, so nothing passes through to a 500. */
export type MemberLoginRefusalFor = (required: { readonly error: unknown }) => { readonly status: number; readonly body: unknown };

/** The deps this route reads. */
export interface MemberUnlinkIdentityRouteDeps {
  /** The strict shared per-IP counter. */
  ipLimiter: MemberRequestLimiter;
  /** The strict shared per-member counter, keyed by the presenting member's id. */
  perMemberLimiter: MemberRequestLimiter;
  /** The presenting member's id from the request's `Cookie` header, or `null` without a live session. May throw
   *  the host's own refusal (a disabled member). */
  currentMemberId: (required: { cookieHeader: string | undefined }) => Promise<string | null>;
  /** Unlink `providerId` from the presenting member and reissue its session; throws the host's refusal for an
   *  identity this member does not hold, a stale session, or no alternative sign-in. */
  unlinkIdentity: (required: { cookieHeader: string | undefined; providerId: string | undefined; userAgent: string | undefined; ip: string }) => Promise<MemberUnlinkIdentityResult>;
  /** The `Set-Cookie` value that sets the host's member session cookie for this token until `expiresAtIso`. */
  sessionCookie: (required: { rawToken: string; expiresAtIso: string }) => string;
  refusalFor: MemberLoginRefusalFor;
}

/** A request this route refuses itself (a non-empty body, no live member session): the host's mapping answers
 *  it with its fixed invalid outcome, exactly as for any unrecognized error. */
class MemberUnlinkRequestInvalid extends Error {}

/** Only an empty JSON object is accepted: the provider comes from the path, never from claims in the body. O(k) keys. */
function isEmptyObject({ body }: { body: unknown }, _optional: Record<string, never> = {}): boolean {
  return Boolean(body) && typeof body === "object" && !Array.isArray(body) && Object.keys(body as object).length === 0;
}

/** A JSON answer as Express's `res.json` wrote it: the same content type and serialized bytes. O(n) body. */
function jsonResponse({ status, body, headers = {} }: { status: number; body: unknown; headers?: Readonly<Record<string, string>> }, _optional: Record<string, never> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
}

/** The unlink steps in the hand-written order: body, live session, strict IP/member counters, unlink, cookie.
 * @complexity O(1) plus the host's unlink.
 */
async function unlinkSteps({ raw, deps, clientAddress }: { raw: Parameters<PublicMemberRawRoute<MemberUnlinkIdentityRouteDeps>["handle"]>[0]["raw"]; deps: MemberUnlinkIdentityRouteDeps; clientAddress: string }, _optional: Record<string, never> = {}): Promise<Response> {
  if (!isEmptyObject({ body: raw.body })) throw new MemberUnlinkRequestInvalid();
  const cookieHeader = raw.headers?.cookie;
  const memberId = await deps.currentMemberId({ cookieHeader });
  if (!memberId) throw new MemberUnlinkRequestInvalid();
  const limited = await memberRequestLimitReply({ clientAddress, ipLimiter: deps.ipLimiter, identity: { key: memberId, limiter: deps.perMemberLimiter } });
  if (limited) return jsonResponse({ status: limited.status, body: limited.body, headers: limited.headers ?? {} });
  const result = await deps.unlinkIdentity({ cookieHeader, providerId: raw.params.providerId, userAgent: raw.facts?.userAgent, ip: clientAddress });
  const cookie = deps.sessionCookie({ rawToken: result.rawSessionToken, expiresAtIso: result.session.expiresAt });
  return jsonResponse({ status: 200, body: { ok: true }, headers: { "set-cookie": cookie } });
}

/** Fresh member self-service only, same-origin JSON and the existing strict IP/member counters. A raw answer,
 *  so the reissued session cookie is APPENDED after any `Set-Cookie` an earlier handler wrote.
 * @complexity O(s) affected sessions; the host's transactional helper owns all persistence.
 */
export const memberUnlinkIdentityRoute: PublicMemberRawRoute<MemberUnlinkIdentityRouteDeps> & { readonly readHeaders: readonly string[]; readonly requestFacts: true } = {
  method: "post",
  path: "/api/members/v1/workspaces/:workspaceId/identities/:providerId/unlink",
  readHeaders: ["cookie"],
  requestFacts: true,
  handle: async ({ raw, deps }) => {
    const clientAddress = memberClientAddress({ raw });
    try {
      return await unlinkSteps({ raw, deps, clientAddress });
    } catch (error) {
      const refusal = deps.refusalFor({ error });
      throw new RouteRefusalError({ status: refusal.status, body: refusal.body });
    }
  },
};
