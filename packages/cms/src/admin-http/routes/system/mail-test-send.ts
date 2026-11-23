import { ToolInputError } from "@jini-ai/core";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError, rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { authorizeMail, mailActorId, type MailRoutePrincipal } from "./mail-shared.js";

/**
 * @file `POST /api/admin/v1/workspaces/:workspaceId/system/mail-test-send` — the Email page's
 * **Send test email** button. A thin adapter over the same operation the assistant's `mail_send_test`
 * tool runs: same recipient rules, limiter, delivery policy and truthful outcome. The person's click
 * is the confirmation here; the assistant's tool stays approval-gated by its card.
 *
 * Body: `{ to?: string, requestId?: string }`. `to` defaults to the operator's account address;
 * `requestId` (8-64 of `[A-Za-z0-9_-]`, one per click) is the idempotency key, so a retried
 * request replays the ledger's answer instead of sending twice.
 *
 * 200 `{ sent, result }` for every send outcome (accepted | captured | redirected | failed),
 * 429 for the local duplicate/rate guard, 400 for bad input, 403 without `admin.forms.manage`.
 */

/** What the route reads of a send's truthful outcome; the whole object is answered unchanged. */
export interface MailTestSendOutcome { outcome: string; errorCode?: string }

/** The deps this route reads. The host owns recipient rules, the limiter and the delivery policy. */
export interface MailTestSendRouteDeps {
  /** Validates a chosen recipient: `undefined` when none was chosen, the address when valid, a `ToolInputError` when not. */
  readTestRecipient: (required: { value: unknown }) => string | undefined;
  /** A fresh idempotency key for a click that sent none. */
  newRequestId: () => string;
  /** Plans, then runs one test send for the principal; `ref` is the ledger's idempotency reference. */
  sendTestMail: (required: { principalId: string; to?: string; ref: string }) => Promise<MailTestSendOutcome>;
}

/** The raw body fields, validated later because the recipient rules are injected. */
export interface MailTestSendInput { to: unknown; requestId: unknown }

/** The 200/429 body: whether the message left, and the send's own outcome. */
export interface MailTestSendEnvelope { sent: boolean; result: MailTestSendOutcome }

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** The mailer's local duplicate/rate guards: nothing was attempted, so the client may retry later (429). */
const LOCAL_REFUSALS: ReadonlySet<string> = new Set(["MAIL_TEST_DUPLICATE", "MAIL_TEST_RATE_LIMITED"]);

/** The request body as an object; none at all is an empty one. Anything else is a caller error. @complexity O(1). */
function readBody({ body }: { body: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  if (typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  return rejectRoute({ status: 400, error: "the request body must be a JSON object. Nothing was sent.", code: "INVALID_INPUT" });
}

/** The click's idempotency key: the sent one when well-formed, a fresh one when absent. @throws ToolInputError when malformed. @complexity O(1). */
function readRequestId({ value, newRequestId }: { value: unknown; newRequestId: () => string }, _optional: Record<string, never> = {}): string {
  if (value === undefined) return newRequestId();
  if (typeof value === "string" && REQUEST_ID.test(value)) return value;
  throw new ToolInputError({ message: "requestId must be 8-64 letters, digits, '-' or '_'. Nothing was sent." });
}

/** Runs `run`, answering a caller error (`ToolInputError`, from here or deeper) as 400 INVALID_INPUT; anything else is rethrown. @complexity O(1) plus `run`. */
async function refuseBadInput<T>({ run }: { run: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ToolInputError) rejectRoute({ status: 400, error: error.message, code: "INVALID_INPUT" });
    throw error;
  }
}

/**
 * POST one test email, gated by `admin.forms.manage`. The body is checked before authorizing, as a
 * malformed request is a 400 for everyone. The spec has one success status, so the local
 * duplicate/rate refusal leaves as a 429 refusal carrying the same `{ sent, result }` body.
 * @complexity One authorization and one injected send.
 */
export const mailTestSendRoute = defineJsonRoute<MailTestSendInput, MailTestSendEnvelope, MailTestSendRouteDeps, MailRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/system/mail-test-send",
  parse: (raw) => {
    const body = readBody({ body: raw.body });
    return ok({ value: { to: body.to, requestId: body.requestId } });
  },
  handle: async ({ input, deps, context, authorize }) => {
    const result = await refuseBadInput({ run: async () => {
      const to = deps.readTestRecipient({ value: input.to });
      const requestId = readRequestId({ value: input.requestId, newRequestId: deps.newRequestId });
      await authorizeMail({ authorize, permission: "admin.forms.manage", entityType: "mail" });
      const principalId = mailActorId({ context });
      return deps.sendTestMail({ principalId, ...(to === undefined ? {} : { to }), ref: `admin:${principalId}:${requestId}` });
    } });
    const body = { sent: result.outcome === "accepted" || result.outcome === "redirected", result };
    const refusedLocally = result.outcome === "failed" && result.errorCode !== undefined && LOCAL_REFUSALS.has(result.errorCode);
    if (refusedLocally) throw new RouteRefusalError({ status: 429, body });
    return ok({ value: body });
  },
});
