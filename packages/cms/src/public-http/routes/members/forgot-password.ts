import { defineJsonRoute, ok, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { memberClientAddress, memberRequestLimitReply, memberStringBody, refuseMemberAuthError, type MemberAuthRefusalFor, type MemberRequestLimiter } from "./shared.js";

/**
 * @file `POST /api/members/v1/workspaces/:workspaceId/forgot-password` — link-only reset requests share
 * the magic-link counters and the host's detached delivery owner; the answer is a generic acceptance, so
 * neither membership nor per-address delivery can be enumerated.
 */

/** The deps this route reads; the challenge service, its mailer and the error copy are the host's. */
export interface MemberForgotPasswordRouteDeps {
  workspaceId: string;
  /** The shared magic-link per-email limiter. */
  emailLimiter: MemberRequestLimiter;
  /** The shared magic-link per-IP limiter, keyed by the client address. */
  ipLimiter: MemberRequestLimiter;
  /** Prepare the password-reset challenge; `deliver` sends it. */
  prepareReset: (required: { workspaceId: string; email: string }) => Promise<{ deliver: () => Promise<unknown> }>;
  /** Run `deliver` after the acceptance is answered and report its failure privately (the host's scheduler). */
  deliverInBackground: (required: { deliver: () => Promise<unknown> }) => void;
  refusalFor: MemberAuthRefusalFor;
}

/** The validated body and the client address the IP counter is keyed by. */
interface ForgotPasswordInput { email: string; clientAddress: string }

/** Public member forgot-password. O(1) setup I/O. */
export const memberForgotPasswordRoute: JsonRouteSpec<ForgotPasswordInput, unknown, MemberForgotPasswordRouteDeps> & { readonly requestFacts: true } = {
  ...defineJsonRoute<ForgotPasswordInput, unknown, MemberForgotPasswordRouteDeps>({
    method: "post",
    path: "/api/members/v1/workspaces/:workspaceId/forgot-password",
    parse: (raw) => {
      const body = memberStringBody({ body: raw.body, fields: ["email"] });
      if (!body) rejectRoute({ status: 400, error: "expected email string" });
      return ok({ value: { email: body.email, clientAddress: memberClientAddress({ raw }) } });
    },
    handle: async ({ input, deps }) => {
      try {
        const limited = await memberRequestLimitReply({ clientAddress: input.clientAddress, ipLimiter: deps.ipLimiter, email: input.email, emailLimiter: deps.emailLimiter });
        if (limited) return ok({ value: limited });
        const prepared = await deps.prepareReset({ workspaceId: deps.workspaceId, email: input.email });
        deps.deliverInBackground({ deliver: () => prepared.deliver() });
        return ok({ value: { accepted: true } });
      } catch (error) {
        return refuseMemberAuthError({ error, refusalFor: deps.refusalFor });
      }
    },
  }),
  requestFacts: true,
};
