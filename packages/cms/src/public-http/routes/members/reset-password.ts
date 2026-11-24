import { defineJsonRoute, ok, type JsonRouteSpec, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { memberClientAddress, memberRequestLimitReply, memberStringBody, refuseMemberAuthError, type MemberAuthRefusalFor, type MemberRequestLimiter } from "./shared.js";

/**
 * @file `POST /api/members/v1/workspaces/:workspaceId/reset-password` — consume a link-only reset;
 * policy belongs to the host's members service and a reset never creates a session.
 */

/** The deps this route reads; the reset service and its error copy are the host's. */
export interface MemberResetPasswordRouteDeps {
  workspaceId: string;
  /** The shared completion-attempt limiter, keyed by the client address. */
  attemptLimiter: MemberRequestLimiter;
  /** Consume the reset token and set the password; its result is the 200 body. */
  resetPassword: (required: { workspaceId: string; token: string; password: string }) => Promise<unknown>;
  refusalFor: MemberAuthRefusalFor;
}

/** The validated body. */
interface ResetPasswordInput { token: string; password: string; clientAddress: string }

/** Public member password reset. O(1) plus the service. */
export const memberResetPasswordRoute: JsonRouteSpec<ResetPasswordInput, unknown, MemberResetPasswordRouteDeps> & { readonly requestFacts: true } = {
  ...defineJsonRoute<ResetPasswordInput, unknown, MemberResetPasswordRouteDeps>({
    method: "post",
    path: "/api/members/v1/workspaces/:workspaceId/reset-password",
    parse: (raw) => {
      const body = memberStringBody({ body: raw.body, fields: ["token", "password"] });
      if (!body?.token) rejectRoute({ status: 400, error: "expected nonempty token and password strings" });
      return ok({ value: { token: body.token, password: body.password, clientAddress: memberClientAddress({ raw }) } });
    },
    handle: async ({ input, deps }) => {
      try {
        const limited: RouteReply | undefined = await memberRequestLimitReply({ clientAddress: input.clientAddress, ipLimiter: deps.attemptLimiter });
        if (limited) return ok({ value: limited });
        return ok({ value: await deps.resetPassword({ workspaceId: deps.workspaceId, token: input.token, password: input.password }) });
      } catch (error) {
        return refuseMemberAuthError({ error, refusalFor: deps.refusalFor });
      }
    },
  }),
  requestFacts: true,
};
