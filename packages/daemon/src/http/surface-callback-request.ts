import { SURFACE_EXCHANGE_ID_PARAM, SURFACE_TYPED_ANSWER_PARAM } from '@jini-ai/core';
import { jsonResponse } from '@jini-ai/core/contracts/server';
import type { IdGenerator } from '@jini-ai/core/primitives';
import { isNonArrayRecord } from '@jini-ai/core/records';
import type { ToolExecutionResult, ToolExecutor } from '../tool-executor-types.js';

/**
 * @file The Express-free decision half of a surface callback endpoint (the MCP-UI "tool-calls"
 * callback a rendered surface's answer re-enters through). A host keeps the HTTP shell — principal
 * header, response writing, streaming — and calls these for validation, allowlist refusal and
 * result shaping, so every hop that accepts a callback refuses and answers with the same bytes.
 *
 * A callback is one of three shapes: (1) an exchange delivery — it names an open exchange, nothing
 * is executed; (3) a typed answer naming no exchange — the host resolves the target from its store;
 * (2) a legacy two-call redemption — a second, ordinary tool call. The discriminator is the
 * exchange id's presence rather than the tool's identity, so a tool can move from one shape to the
 * other without the route learning its name.
 */

/** Fixed, secret-free recovery copy shared by callback HTTP hops. */
export const SURFACE_TYPED_ANSWER_REFUSAL = 'This card cannot accept a typed answer. Open its form and submit it there. Details: MCP_UI_TYPED_ANSWER_REFUSED.';

/**
 * True when this callback is a human's TYPED answer — prose from the chat composer rather than a
 * click on the rendered surface. Presence of a non-blank `SURFACE_TYPED_ANSWER_PARAM` is the
 * whole discriminator: no form produces that param, and nothing else in the request distinguishes a
 * typed answer from a Shape-2 redemption. Non-answer fields are never coerced.
 *
 * @complexity O(n) in the answer length, O(n) temporary trim space.
 */
export function isTypedSurfaceAnswer({ params }: { params: Record<string, unknown> }, _optional: Record<string, never> = {}): boolean {
  const raw = params[SURFACE_TYPED_ANSWER_PARAM];
  return typeof raw === 'string' && raw.trim().length > 0;
}

/** The open exchange this callback answers, if it names one (Shape 1). */
export function surfaceCallbackExchangeId(
  { bodyExchangeId, params }: { bodyExchangeId: unknown; params: Record<string, unknown> }, _optional: Record<string, never> = {},
): string | undefined {
  // Read from a top-level `exchangeId` first, falling back to the callback param. The param is
  // MCP-UI's carrier specifically — an mcp-ui surface can only answer by issuing a tool call, so
  // its correlation has to ride inside that call's params. A channel that can name the exchange
  // directly uses the top-level field and never touches the tool-call shape at all, which is what
  // keeps the route from being MCP-only.
  const rawExchangeId = typeof bodyExchangeId === 'string' ? bodyExchangeId : params[SURFACE_EXCHANGE_ID_PARAM];
  return typeof rawExchangeId === 'string' && rawExchangeId.length > 0 ? rawExchangeId : undefined;
}

/** The 403 body for a callback the host's allowlist refused; a typed answer gets recovery copy. */
export function surfaceCallbackRefusalBody(
  { toolId, typedAnswer }: { toolId: string; typedAnswer: boolean }, _optional: Record<string, never> = {},
) {
  return { error: typedAnswer ? SURFACE_TYPED_ANSWER_REFUSAL : `'${toolId}' is not an MCP-UI-redeemable tool`, code: 'TOOL_NOT_ALLOWLISTED' } as const;
}

/**
 * The 409 body for a callback no open exchange took. 409, not 404: from the browser's side
 * "nothing is outstanding", "it already expired" and "you have two open and named neither" are one
 * situation — "this dialog is no longer the one waiting on you" — the human cannot act on
 * differently, and reporting the distinction would only describe server state they cannot change.
 */
export function surfaceNotPendingBody({ reason }: { reason: string }, _optional: Record<string, never> = {}) {
  return { error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason } as const;
}

export interface SurfaceCallbackRequest {
  readonly toolName: string;
  readonly params: Record<string, unknown>;
  /** Present only when this callback names an open exchange (Shape 1). */
  readonly exchangeId: string | undefined;
}

/** A plain status + JSON body; the host writes it with its own server framework. */
export interface SurfaceCallbackReply {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Thrown from a surface route's authenticate/handle step to answer with exactly one
 * {@link SurfaceCallbackReply}. Surface endpoints keep their own flat `{ error, code }` bodies
 * (their callers already match on those bytes), so a refusal is carried out of the JSON route by
 * this error and written back verbatim by {@link surfaceReplyOnError} rather than being re-shaped
 * into the generic `{ error: { code, message } }` envelope.
 */
export class SurfaceReplyRefusal extends Error {
  readonly reply: SurfaceCallbackReply;

  constructor({ reply }: { readonly reply: SurfaceCallbackReply }, _optional: Record<string, never> = {}) {
    super(`surface reply refusal (${reply.status})`);
    this.name = 'SurfaceReplyRefusal';
    this.reply = reply;
  }
}

/** The 401 every surface endpoint answers when the caller named no principal. */
export function unauthenticatedReply({ principalHeader }: { readonly principalHeader: string }, _optional: Record<string, never> = {}): SurfaceCallbackReply {
  return { status: 401, body: { error: `${principalHeader} is required`, code: 'UNAUTHENTICATED' } };
}

/** The principal id the caller's header names, or `undefined` when it is absent or empty. */
export function readSurfacePrincipalId(
  { headers, principalHeader }: { readonly headers: { get(name: string): string | null }; readonly principalHeader: string },
  _optional: Record<string, never> = {},
): string | undefined {
  const value = headers.get(principalHeader);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A {@link SurfaceCallbackReply} as the web `Response` a route returns. */
export function surfaceReplyResponse({ reply }: { readonly reply: SurfaceCallbackReply }, _optional: Record<string, never> = {}): Response {
  return jsonResponse({ status: reply.status, body: reply.body });
}

/**
 * The `ports.onError` of a surface JSON route: a {@link SurfaceReplyRefusal} is answered as the
 * reply it carries; anything else is rethrown so the host's dispatcher answers and redacts it like
 * any other route that throws.
 */
export function surfaceReplyOnError({ error }: { readonly error: unknown }, _optional: Record<string, never> = {}): Response {
  if (error instanceof SurfaceReplyRefusal) return surfaceReplyResponse({ reply: error.reply });
  throw error;
}

/**
 * Validates and shapes a callback body, or returns the 400/403 reply for the first invalid field.
 * `admit` is the host's allowlist (tool membership and typed-answer policy).
 *
 * The allowlist is the security-critical check the callback route exists to enforce. A host checks
 * it here even when a proxy in front already did, because the route — not the proxy — is the one
 * call site that can actually reach `toolExecutor.execute`. A proxy-only check would be a
 * suggestion, not a boundary. The answer shape is decided BEFORE the check, so a host whose
 * allowlist admits some ids only as an answer to an open card can never run one as Shape 2.
 *
 * @complexity O(1) plus the host's `admit` cost.
 */
export function parseSurfaceCallbackRequest(
  { body: rawBody, admit }: {
    body: unknown;
    admit: (required: { toolName: string; answersAnExchange: boolean; typedAnswer: boolean }) => boolean;
  },
  _optional: Record<string, never> = {},
): { ok: true; request: SurfaceCallbackRequest } | { ok: false; reply: SurfaceCallbackReply } {
  const body = (rawBody ?? {}) as { toolName?: unknown; params?: unknown; exchangeId?: unknown };
  const toolName = body.toolName;
  if (typeof toolName !== 'string' || toolName.length === 0) {
    return { ok: false, reply: { status: 400, body: { error: "'toolName' must be a non-empty string", code: 'VALIDATION_ERROR' } } };
  }
  const candidate = { value: body.params };
  const params = isNonArrayRecord(candidate) ? candidate.value : {};
  const exchangeId = surfaceCallbackExchangeId({ bodyExchangeId: body.exchangeId, params });
  const typedAnswer = isTypedSurfaceAnswer({ params });
  if (!admit({ toolName, answersAnExchange: exchangeId !== undefined || typedAnswer, typedAnswer })) {
    return { ok: false, reply: { status: 403, body: surfaceCallbackRefusalBody({ toolId: toolName, typedAnswer }) } };
  }
  return { ok: true, request: { toolName, params, exchangeId } };
}

/**
 * Maps one `ToolExecutionResult` of a Shape-2 redemption onto a status + body.
 *
 * `'completed'` is the only outcome a correctly-behaving caller normally sees: a host's domain
 * tools typically gate inside their own handler (throwing rather than returning a denial), and
 * catalog entries rarely set `requiresConfirmation`. So `'denied'`/`'confirmation-denied'` are
 * handled for completeness and to keep this switch exhaustive against `ToolExecutionStatus`, not
 * because a live path must reach them. `'cancelled'` is similarly unreachable from a redemption —
 * nothing there holds the `executionId` an external `toolExecutor.cancel()` would need. `'failed'`
 * is a tool's own thrown rejection (e.g. a stale/reused confirmation token).
 *
 * @complexity O(1).
 */
export function surfaceRedemptionReply(
  { toolName, principalId, result }: { toolName: string; principalId: string; result: ToolExecutionResult }, _optional: Record<string, never> = {},
): SurfaceCallbackReply {
  switch (result.status) {
    case 'completed': return { status: 200, body: result.output ?? {} };
    case 'denied': return { status: 403, body: { error: `principal '${principalId}' is not authorized to call '${toolName}'`, code: 'FORBIDDEN' } };
    case 'confirmation-denied':
      return { status: 409, body: { error: `'${toolName}' declined to run without a further confirmation this endpoint cannot supply`, code: 'CONFLICT' } };
    case 'timed-out': return { status: 504, body: { error: `'${toolName}' timed out`, code: 'GATEWAY_TIMEOUT' } };
    case 'cancelled': return { status: 500, body: { error: `'${toolName}' was cancelled before it completed`, code: 'INTERNAL_ERROR' } };
    case 'failed': return { status: 400, body: { error: result.error ?? `'${toolName}' failed`, code: 'TOOL_CALL_FAILED' } };
  }
}

/**
 * Shape 2: legacy two-call redemption — executes the tool through the same `ToolExecutor.execute`
 * a model-issued call uses (which is what makes it "reuse the handler" rather than reimplement its
 * logic), and shapes the outcome. Deliberately NOT run-scoped: the run that raised the dialog may
 * have finished by the time a human clicks, so a fresh, single-use synthetic `RunRef` (`{id}` is the
 * kernel's whole structural contract for one) satisfies `execute` without asserting a real run exists.
 *
 * @complexity O(1) plus the invoked tool handler's own cost.
 */
export async function executeSurfaceRedemption(
  { toolExecutor, idGenerator, toolName, params, principalId }: {
    toolExecutor: Pick<ToolExecutor, 'execute'>; idGenerator: IdGenerator; toolName: string; params: Record<string, unknown>; principalId: string;
  },
  _optional: Record<string, never> = {},
): Promise<SurfaceCallbackReply> {
  const run = { id: `mcp-ui-redemption:${idGenerator.newId()}` };
  let result: ToolExecutionResult;
  try {
    result = await toolExecutor.execute({ principal: { id: principalId }, run, toolId: toolName, input: params });
  } catch (error) {
    // `ToolExecutor.execute` throws only for an unregistered `toolId`; a host allowlist that only
    // admits registered ids makes this unreachable in practice. Reported rather than left to crash
    // the process, in case that guarantee is ever violated by a future refactor.
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { error: message, code: 'INTERNAL_ERROR' } };
  }
  return surfaceRedemptionReply({ toolName, principalId, result });
}
