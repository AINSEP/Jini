import { parseQuestion, QuestionShapeError } from './question.js';
import { ASK_CHOICE_INPUT_SCHEMA } from './schema.js';
import type {
  AskChoiceCall, AskChoiceExchange, AskChoiceExchangeStore, AskChoiceMessages,
  AskChoicePendingStore, AskChoicePolicy, AskChoicePresentation,
} from './types.js';

export type * from './types.js';
export { ASK_CHOICE_INPUT_SCHEMA } from './schema.js';
export { createAskChoiceAnswerTicketStore } from './pending.js';

/** Existing callback wire keys; the tool's identity is supplied by the host. */
export const ASK_CHOICE_ANSWER_TICKET_PARAM = '__askChoiceAnswerTicket';
const SURFACE_EXCHANGE_ID_PARAM = '__exchangeId';
const SURFACE_DISMISSED_PARAM = '__dismissed';
const SURFACE_TYPED_ANSWER_PARAM = '__typedAnswer';

function describeAnswer(params: Record<string, unknown>, messages: AskChoiceMessages): Record<string, unknown> {
  const choice = typeof params['choice'] === 'string' ? params['choice'] : undefined;
  const selections = Array.isArray(params['selections']) ? params['selections'] : undefined;
  if (choice === undefined && selections === undefined) return { submitted: false, reason: 'no-answer', note: messages.noAnswer };
  return { submitted: true, ...(choice === undefined ? {} : { choice }), ...(selections === undefined ? {} : { selections }), note: messages.submitted };
}

async function waitForAnswer({ exchange, ui, signal, messages }: {
  exchange: AskChoiceExchange; ui: unknown; signal: AbortSignal; messages: AskChoiceMessages;
}): Promise<Record<string, unknown>> {
  const close = () => exchange.close({});
  signal.addEventListener('abort', close, { once: true });
  try {
    if (signal.aborted) {
      close();
      return { submitted: false, reason: 'abandoned', note: messages.abandoned };
    }
    await exchange.send({ emission: { channel: 'mcp-ui', payload: { resource: ui } } });
    const answer = await exchange.receive({});
    if (answer.status !== 'received') return { submitted: false, reason: answer.status, note: messages[answer.status] };
    if (answer.params[SURFACE_DISMISSED_PARAM] === true) return { submitted: false, reason: 'cancelled', note: messages.cancelled };
    const typed = answer.params[SURFACE_TYPED_ANSWER_PARAM];
    if (typeof typed === 'string' && typed.trim()) return { submitted: true, freeText: typed.trim(), note: messages.typed };
    return describeAnswer(answer.params, messages);
  } finally {
    signal.removeEventListener('abort', close);
    close();
  }
}

/** Creates a choice tool without a CMS, renderer, permission system, clock, or global store.
 * The host composes this descriptor/handler into its registry and mounts callbacks against the
 * same exchange and pending stores. Policy and presentation are required, with no product defaults.
 */
export function createAskChoiceTool({ toolId, description, permission, policy, presentation, pendingQuestions, surfaceExchanges, messages }: {
  toolId: string;
  description: string;
  permission: string;
  policy: AskChoicePolicy;
  presentation: AskChoicePresentation;
  pendingQuestions: AskChoicePendingStore;
  surfaceExchanges: AskChoiceExchangeStore;
  messages: AskChoiceMessages;
}) {
  const descriptor = {
    id: toolId, name: toolId, description, sideEffects: 'none' as const,
    authorization: { permission }, inputSchema: ASK_CHOICE_INPUT_SCHEMA,
  };
  return {
    descriptor,
    async handler({ ctx }: { ctx: AskChoiceCall }): Promise<Record<string, unknown>> {
      await policy.authorize({ ctx, toolId });
      const input = typeof ctx.input === 'object' && ctx.input !== null ? ctx.input as Record<string, unknown> : {};
      const isAnswer = typeof input['title'] !== 'string' && (typeof input['choice'] === 'string' || Array.isArray(input['selections']));
      if (isAnswer) {
        const rawTicket = input[ASK_CHOICE_ANSWER_TICKET_PARAM];
        const ticket = typeof rawTicket === 'string' ? rawTicket : undefined;
        if (!pendingQuestions.redeem({ ticket, principalId: ctx.principalId, params: input })) {
          throw policy.inputError({ message: messages.forgedAnswer });
        }
        return describeAnswer(input, messages);
      }
      let question;
      try {
        question = parseQuestion({ input, toolId });
      } catch (error) {
        if (!(error instanceof QuestionShapeError)) throw error;
        throw policy.shapeError({ message: error.message, toolId, inputSchema: ASK_CHOICE_INPUT_SCHEMA });
      }
      if (ctx.signal.aborted) return { submitted: false, reason: 'abandoned', note: messages.abandoned };
      const exchange = ctx.emitSurface ? surfaceExchanges.open({ toolId, principalId: ctx.principalId, emit: ctx.emitSurface }) : undefined;
      const ticket = exchange ? undefined : pendingQuestions.mint({ principalId: ctx.principalId, question });
      const baseParams = exchange ? { [SURFACE_EXCHANGE_ID_PARAM]: exchange.id } : { [ASK_CHOICE_ANSWER_TICKET_PARAM]: ticket };
      let ui;
      try {
        ui = presentation.render({
          toolName: toolId, principalId: ctx.principalId, question, baseParams,
        }, { ...(exchange ? { cancelParams: { [SURFACE_EXCHANGE_ID_PARAM]: exchange.id, [SURFACE_DISMISSED_PARAM]: true } } : {}),
        });
        if (!exchange) return presentation.buildResult({ modelText: messages.pending, ui });
      } catch (error) {
        exchange?.close({});
        // A form that was not delivered must not leave a redeemable fallback ticket behind.
        if (ticket !== undefined) pendingQuestions.redeem({ ticket, principalId: ctx.principalId, params: {} });
        throw error;
      }
      return waitForAnswer({ exchange, ui, signal: ctx.signal, messages });
    },
  };
}
