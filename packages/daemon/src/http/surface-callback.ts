import { SURFACE_TYPED_ANSWER_PARAM, type SurfaceExchangeStore } from '@jini-ai/core';
import { jsonResponse, type SseSchedulerPort } from '@jini-ai/core/contracts/server';
import { restoreSurface } from './surface-restoration.js';

/** Fixed, secret-free recovery copy shared by callback HTTP hops. */
export const SURFACE_TYPED_ANSWER_REFUSAL = 'This card cannot accept a typed answer. Open its form and submit it there. Details: MCP_UI_TYPED_ANSWER_REFUSED.';

/** Apply host membership and exchange-only policy; composer answers require explicit opt-in.
 * Pure, constant time/space; never authorizes fresh execution for exchange-only tools.
 * @complexity O(1).
 * @overallScore 100
 */
export function isSurfaceCallbackPermitted({ answersAnExchange, admitted, exchangeOnly }: {
  answersAnExchange: boolean; admitted: boolean; exchangeOnly: boolean;
}, { typedAnswer = false, acceptsTypedAnswer = false }: {
  typedAnswer?: boolean; acceptsTypedAnswer?: boolean;
} = {}): boolean {
  if (typedAnswer && !acceptsTypedAnswer) return false;
  return admitted && (answersAnExchange || !exchangeOnly);
}

export interface SurfaceCallbackInput {
  store: SurfaceExchangeStore;
  exchangeId: string;
  principalId: string;
  toolId: string;
  params: Record<string, unknown>;
  /** Keepalive timers for a restored card's stream (the host's `DaemonRouteHost.scheduler`). */
  scheduler: SseSchedulerPort;
  /** Aborts when the caller goes away; the store's restore is cancelled with it. */
  signal: AbortSignal;
  /** Host tool membership and typed-answer policy; identity has already been authenticated. */
  admit: (input: { toolId: string; answersAnExchange: boolean; typedAnswer: boolean }) => boolean;
}

/** Recognize composer text without coercing non-answer fields.
 * @complexity O(n) in the answer length, O(n) temporary trim space. @overallScore 100 */
function isTypedAnswer(params: Record<string, unknown>): boolean {
  const raw = params[SURFACE_TYPED_ANSWER_PARAM];
  return typeof raw === 'string' && raw.trim().length > 0;
}

/** A callback no open exchange took: a late answer may still be restored; otherwise the dialog is simply no longer waiting. */
async function answerUndelivered({ reason, restoring, params, restoreOnMiss }: {
  readonly reason: string; readonly restoring: Parameters<typeof restoreSurface>[0]; readonly params: Record<string, unknown>; readonly restoreOnMiss: boolean;
}): Promise<Response> {
  if (reason === 'unknown-or-closed' && restoreOnMiss) {
    const restored = await restoreSurface(restoring, { params });
    if (restored.handled) return restored.response;
  }
  // 409, not 404: from the browser's side both reasons mean "this dialog is no longer the
  // one waiting on you" — a second click, a reload of stale scrollback, or an expired form.
  // The distinction between them is not the human's to act on, and reporting it would only
  // describe server state they cannot change.
  return jsonResponse({ status: 409, body: { error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason } });
}

/** Terminal exchange delivery only: there is deliberately no arbitrary tool executor here.
 * Preserve restoration streaming, rejection bodies, and the answer-free 202 acknowledgment.
 * The proxy must keep its local-miss forwarding path instead of using this terminal adapter.
 * @complexity O(1) plus the store/restoration cost; retains no answer beyond this request.
 * @overallScore 100
 */
export async function deliverSurfaceCallback({ store, admit, scheduler, signal, ...input }: SurfaceCallbackInput,
  options: { restoreOnly?: boolean; restoreOnMiss?: boolean } = {},
): Promise<Response> {
  const typedAnswer = isTypedAnswer(input.params);
  if (!admit({ toolId: input.toolId, answersAnExchange: true, typedAnswer })) {
    return jsonResponse({ status: 403, body: { error: typedAnswer ? SURFACE_TYPED_ANSWER_REFUSAL : `'${input.toolId}' is not an MCP-UI-redeemable tool`, code: 'TOOL_NOT_ALLOWLISTED' } });
  }
  const restoring = { store, scheduler, signal, exchangeId: input.exchangeId, principalId: input.principalId, toolId: input.toolId };
  if (options.restoreOnly) {
    const restored = await restoreSurface(restoring);
    return restored.handled ? restored.response : jsonResponse({ status: 409, body: { code: 'SURFACE_NOT_PENDING' } });
  }
  const delivered = store.deliver(input, { toolId: input.toolId });
  if (!delivered.ok) return answerUndelivered({ reason: delivered.reason, restoring, params: input.params, restoreOnMiss: options.restoreOnMiss === true });
  // Deliberately not the tool's result. The agent's own call is what returns that, to the
  // model, where it belongs — echoing it here would make this response a second copy of an
  // answer the human already gave, and hand the iframe output it has no use for.
  return jsonResponse({ status: 202, body: { delivered: true } });
}
