import { matchesOptions, parseQuestion, QuestionShapeError } from './question.js';
import { ASK_CHOICE_INPUT_SCHEMA } from './schema.js';
import type {
  AskChoiceCall, AskChoiceExchange, AskChoiceExchangeStore, AskChoiceMessages,
  AskChoicePendingStore, AskChoicePolicy, AskChoicePresentation, AskChoiceQuestion,
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

async function waitForAnswer({ exchange, ui, signal, messages, question }: {
  exchange: AskChoiceExchange; ui: unknown; signal: AbortSignal; messages: AskChoiceMessages; question: AskChoiceQuestion;
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
    const described = describeAnswer(answer.params, messages);
    if (described.submitted !== true) return described;
    // Live exchanges need the same offered-option boundary as fallback tickets.
    if (!matchesOptions({ question, params: answer.params })) return { submitted: false, reason: 'invalid-answer', note: messages.noAnswer };
    const action = answer.params['__choiceAction'];
    if (question.actions && !question.actions.some(offered => offered.id === action)) return { submitted: false, reason: 'invalid-answer', note: messages.noAnswer };
    return { ...described, ...(question.actions ? { action } : {}) };
  } finally {
    signal.removeEventListener('abort', close);
    close();
  }
}

/** Run a trusted host question through the same abort, delivery, validation and cleanup lifecycle
 * as the model-facing tool. The host owns presentation and action policy, never exchange mechanics.
 * @returns Classified human answer, including an offered action when configured.
 * @complexity O(n) offered options and selections.
 */
export async function askChoice(
  { exchange, question, toolId, principalId, presentation, signal, messages }: {
    exchange: AskChoiceExchange; question: AskChoiceQuestion; toolId: string; principalId: string;
    presentation: Pick<AskChoicePresentation, 'render'>; signal: AbortSignal; messages: AskChoiceMessages;
  }, _options = {},
): Promise<Record<string, unknown>> {
  let ui;
  try {
    ui = presentation.render({ toolName: toolId, principalId, question,
      baseParams: { [SURFACE_EXCHANGE_ID_PARAM]: exchange.id },
    }, { cancelParams: { [SURFACE_EXCHANGE_ID_PARAM]: exchange.id, [SURFACE_DISMISSED_PARAM]: true } });
  } catch (error) {
    exchange.close({});
    throw error;
  }
  return waitForAnswer({ exchange, ui, signal, messages, question });
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
      if (exchange) return askChoice({ exchange, question, toolId, principalId: ctx.principalId, presentation, signal: ctx.signal, messages });
      const ticket = pendingQuestions.mint({ principalId: ctx.principalId, question });
      const baseParams = { [ASK_CHOICE_ANSWER_TICKET_PARAM]: ticket };
      let ui;
      try {
        ui = presentation.render({
          toolName: toolId, principalId: ctx.principalId, question, baseParams,
        });
        return presentation.buildResult({ modelText: messages.pending, ui });
      } catch (error) {
        // A form that was not delivered must not leave a redeemable fallback ticket behind.
        if (ticket !== undefined) pendingQuestions.redeem({ ticket, principalId: ctx.principalId, params: {} });
        throw error;
      }
    },
  };
}
