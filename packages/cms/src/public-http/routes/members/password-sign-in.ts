import { defineJsonRoute, ok, routeReply, type JsonRouteSpec, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { memberClientAddress, memberRequestLimitReply, memberStringBody, refuseMemberAuthError, type MemberAuthRefusalFor, type MemberRequestLimiter } from "./shared.js";

/**
 * @file `POST /api/members/v1/workspaces/:workspaceId/password/sign-in` — verify unchanged password bytes
 * behind separate strict IP and normalized-email counters, then answer the public member with the host's
 * session cookie. The JSON 200 carries the cookie as a reply header, so the host's JSON mount writes it
 * exactly as a hand-written `res.cookie(...)` + `res.json(...)` did.
 */

/** What the host's password sign-in service answers: the raw session token (only ever sent in the
 *  cookie), the session's expiry, and the member row the host projects to its public DTO. */
export interface MemberPasswordSignInResult {
  readonly rawSessionToken: string;
  readonly session: { readonly expiresAt: string };
  readonly member: unknown;
}

/** The deps this route reads. Cookie name and attributes, analytics, the member DTO and error copy are the host's. */
export interface MemberPasswordSignInRouteDeps {
  workspaceId: string;
  /** The strict shared per-IP counter, checked first. */
  ipLimiter: MemberRequestLimiter;
  /** The strict shared per-normalized-email counter. */
  emailLimiter: MemberRequestLimiter;
  /** Host analytics: the request passed every gate and counter, before the service runs. */
  signInRequested: () => void;
  signInWithPassword: (required: { workspaceId: string; email: string; password: string; userAgent: string | undefined; ip: string }) => Promise<MemberPasswordSignInResult>;
  /** The `Set-Cookie` value that sets the host's member session cookie for this token until `expiresAtIso`. */
  sessionCookie: (required: { rawToken: string; expiresAtIso: string }) => string;
  /** Host analytics: one session outcome after its authoritative owner committed. */
  signedIn: (required: { result: MemberPasswordSignInResult }) => void;
  /** The host's public member DTO of `result.member`. */
  toPublicMember: (required: { member: unknown }) => unknown;
  refusalFor: MemberAuthRefusalFor;
}

/** The validated body plus the host-resolved client facts. */
interface PasswordSignInInput { email: string; password: string; clientAddress: string; userAgent: string | undefined }

/** Public member password sign-in. O(1) plus the limiters and the service. */
export const memberPasswordSignInRoute: JsonRouteSpec<PasswordSignInInput, RouteReply, MemberPasswordSignInRouteDeps> & { readonly requestFacts: true } = {
  ...defineJsonRoute<PasswordSignInInput, RouteReply, MemberPasswordSignInRouteDeps>({
    method: "post",
    path: "/api/members/v1/workspaces/:workspaceId/password/sign-in",
    parse: (raw) => {
      const body = memberStringBody({ body: raw.body, fields: ["email", "password"] });
      if (!body) rejectRoute({ status: 400, error: "expected email and password strings" });
      return ok({ value: { email: body.email, password: body.password, clientAddress: memberClientAddress({ raw }), userAgent: raw.facts?.userAgent } });
    },
    handle: async ({ input, deps }) => {
      try {
        const limited = await memberRequestLimitReply({ clientAddress: input.clientAddress, ipLimiter: deps.ipLimiter,
          email: input.email, emailLimiter: deps.emailLimiter });
        if (limited) return ok({ value: limited });
        deps.signInRequested();
        const result = await deps.signInWithPassword({ workspaceId: deps.workspaceId, email: input.email, password: input.password,
          userAgent: input.userAgent, ip: input.clientAddress });
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
