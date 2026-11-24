import { defineJsonRoute, ok, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { memberClientAddress, memberRequestLimitReply, memberStringBody, refuseMemberAuthError, type MemberAuthRefusalFor, type MemberRequestLimiter } from "./shared.js";

/**
 * @file `POST /api/members/v1/workspaces/:workspaceId/password/set` — member self-service; shares /me's
 * session check and charges both strict counters before the host's password hashing.
 */

/** The deps this route reads; the session check, the write and the error copy are the host's. */
export interface MemberSetPasswordRouteDeps {
  workspaceId: string;
  /** The shared per-IP password limiter, keyed by the client address. */
  ipLimiter: MemberRequestLimiter;
  /** The per-member password-set limiter, keyed by the session's member id. */
  perMemberLimiter: MemberRequestLimiter;
  /** The host's member-session cookie value from the `Cookie` header (`undefined` when absent). */
  readSessionToken: (required: { cookieHeader: string | undefined }) => string | undefined;
  /** The member id of the live session the token names; throws the host's credential failure when none. */
  requireSessionMemberId: (required: { sessionToken: string | undefined }) => Promise<string>;
  /** Set the password (the service owns the write lifecycle); its result is the 200 body. */
  setPassword: (required: { workspaceId: string; sessionToken: string | undefined; password: string; currentPassword: string | undefined }) => Promise<unknown>;
  refusalFor: MemberAuthRefusalFor;
}

/** The validated body. */
interface SetPasswordInput { password: string; currentPassword: string | undefined; cookieHeader: string | undefined; clientAddress: string }

/** Public member set-password.
 * @complexity O(n + s) in password size n and affected sessions s; service owns the write lifecycle.
 */
export const memberSetPasswordRoute: JsonRouteSpec<SetPasswordInput, unknown, MemberSetPasswordRouteDeps> & { readonly readHeaders: readonly string[]; readonly requestFacts: true } = {
  ...defineJsonRoute<SetPasswordInput, unknown, MemberSetPasswordRouteDeps>({
    method: "post",
    path: "/api/members/v1/workspaces/:workspaceId/password/set",
    parse: (raw) => {
      const body = memberStringBody({ body: raw.body, fields: ["password"], optionalFields: ["currentPassword"] });
      if (!body) rejectRoute({ status: 400, error: "expected password and optional currentPassword strings" });
      return ok({ value: { password: body.password, currentPassword: body.currentPassword, cookieHeader: raw.headers?.cookie, clientAddress: memberClientAddress({ raw }) } });
    },
    handle: async ({ input, deps }) => {
      try {
        const sessionToken = deps.readSessionToken({ cookieHeader: input.cookieHeader });
        const memberId = await deps.requireSessionMemberId({ sessionToken });
        const limited = await memberRequestLimitReply({ clientAddress: input.clientAddress, ipLimiter: deps.ipLimiter, identity: { key: memberId, limiter: deps.perMemberLimiter } });
        if (limited) return ok({ value: limited });
        return ok({ value: await deps.setPassword({ workspaceId: deps.workspaceId, sessionToken, password: input.password, currentPassword: input.currentPassword }) });
      } catch (error) {
        return refuseMemberAuthError({ error, refusalFor: deps.refusalFor });
      }
    },
  }),
  readHeaders: ["cookie"],
  requestFacts: true,
};
