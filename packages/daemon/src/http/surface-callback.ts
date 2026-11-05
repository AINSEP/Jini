import type { Response } from 'express';
import { SURFACE_TYPED_ANSWER_PARAM, type SurfaceExchangeStore } from '@jini-ai/core';
import { tryRestoreSurface } from './surface-restoration.js';

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
  res: Response;
  store: SurfaceExchangeStore;
  exchangeId: string;
  principalId: string;
  toolId: string;
  params: Record<string, unknown>;
  /** Host tool membership and typed-answer policy; identity has already been authenticated. */
  admit: (input: { toolId: string; answersAnExchange: boolean; typedAnswer: boolean }) => boolean;
}

function isTypedAnswer(params: Record<string, unknown>): boolean {
  const raw = params[SURFACE_TYPED_ANSWER_PARAM];
  return typeof raw === 'string' && raw.trim().length > 0;
}

/** Terminal exchange delivery only: there is deliberately no arbitrary tool executor here.
 * Preserve restoration streaming, rejection bodies, and the answer-free 202 acknowledgment.
 * The proxy must keep its local-miss forwarding path instead of using this terminal adapter.
 * @complexity O(1) plus the store/restoration cost; retains no answer beyond this request.
 * @overallScore 100
 */
export async function deliverSurfaceCallback({ res, store, admit, ...input }: SurfaceCallbackInput,
  options: { restoreOnly?: boolean; restoreOnMiss?: boolean } = {},
): Promise<void> {
  const typedAnswer = isTypedAnswer(input.params);
  if (!admit({ toolId: input.toolId, answersAnExchange: true, typedAnswer })) {
    res.status(403).json({ error: typedAnswer ? SURFACE_TYPED_ANSWER_REFUSAL : `'${input.toolId}' is not an MCP-UI-redeemable tool`, code: 'TOOL_NOT_ALLOWLISTED' });
    return;
  }
  if (options.restoreOnly) {
    if (await tryRestoreSurface({ res, store, ...input })) return;
    res.status(409).json({ code: 'SURFACE_NOT_PENDING' });
    return;
  }
  const delivered = store.deliver(input, { toolId: input.toolId });
  if (!delivered.ok) {
    if (delivered.reason === 'unknown-or-closed' && options.restoreOnMiss && await tryRestoreSurface(
      { res, store, ...input }, { params: input.params },
    )) return;
    // 409, not 404: from the browser's side both reasons mean "this dialog is no longer the
    // one waiting on you" — a second click, a reload of stale scrollback, or an expired form.
    // The distinction between them is not the human's to act on, and reporting it would only
    // describe server state they cannot change.
    res.status(409).json({ error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: delivered.reason });
    return;
  }
  // Deliberately not the tool's result. The agent's own call is what returns that, to the
  // model, where it belongs — echoing it here would make this response a second copy of an
  // answer the human already gave, and hand the iframe output it has no use for.
  res.status(202).json({ delivered: true });
}
