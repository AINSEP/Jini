import { matchesOptions, parseQuestion, QuestionShapeError } from './question.js';
import { ASK_CHOICE_INPUT_SCHEMA, ASK_CHOICE_INVOCATION_SCHEMA } from './schema.js';
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

// Classifies a delivered form answer: cancel wins over typed text, typed text wins over picks,
// and picks must stay inside the offered options and actions.
function classifyReceived({ params, question, messages }: {
  params: Record<string, unknown>; question: AskChoiceQuestion; messages: AskChoiceMessages;
}): Record<string, unknown> {
  if (params[SURFACE_DISMISSED_PARAM] === true) return { submitted: false, reason: 'cancelled', note: messages.cancelled };
  const typed = params[SURFACE_TYPED_ANSWER_PARAM];
  if (typeof typed === 'string' && typed.trim()) return { submitted: true, freeText: typed.trim(), note: messages.typed };
  const described = describeAnswer(params, messages);
  if (described.submitted !== true) return described;
  return withOfferedAction({ described, params, question, messages });
}

function withOfferedAction({ described, params, question, messages }: {
  described: Record<string, unknown>; params: Record<string, unknown>; question: AskChoiceQuestion; messages: AskChoiceMessages;
}): Record<string, unknown> {
  const invalid = { submitted: false, reason: 'invalid-answer', note: messages.noAnswer };
  // Live exchanges need the same offered-option boundary as fallback tickets.
  if (!matchesOptions({ question, params })) return invalid;
  if (!question.actions) return described;
  const action = params['__choiceAction'];
  if (!question.actions.some(offered => offered.id === action)) return invalid;
  return { ...described, action };
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
    return classifyReceived({ params: answer.params, question, messages });
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
    invocationSchema: ASK_CHOICE_INVOCATION_SCHEMA,
    async handler({ ctx }: { ctx: AskChoiceCall }): Promise<Record<string, unknown>> {
      await policy.authorize({ ctx, toolId });
      const input = typeof ctx.input === 'object' && ctx.input !== null ? ctx.input as Record<string, unknown> : {};
      if (isAnswerCall(input)) return redeemAnswer({ input, ctx, pendingQuestions, policy, messages });
      const question = parseOrRefuse({ input, toolId, policy });
      if (ctx.signal.aborted) return { submitted: false, reason: 'abandoned', note: messages.abandoned };
      const exchange = ctx.emitSurface ? surfaceExchanges.open({ toolId, principalId: ctx.principalId, emit: ctx.emitSurface }) : undefined;
      if (exchange) return askChoice({ exchange, question, toolId, principalId: ctx.principalId, presentation, signal: ctx.signal, messages });
      return presentFallback({ question, toolId, principalId: ctx.principalId, pendingQuestions, presentation, messages });
    },
  };
}

// A second call carrying a pick (and no question title) is an answer to a fallback form.
function isAnswerCall(input: Record<string, unknown>): boolean {
  return typeof input['title'] !== 'string' && typeof input['question'] !== 'string' && (typeof input['choice'] === 'string' || Array.isArray(input['selections']));
}

// The ticket is the only proof the answer came from a rendered form: redeem is fail-closed.
function redeemAnswer({ input, ctx, pendingQuestions, policy, messages }: {
  input: Record<string, unknown>; ctx: AskChoiceCall; pendingQuestions: AskChoicePendingStore; policy: AskChoicePolicy; messages: AskChoiceMessages;
}): Record<string, unknown> {
  const rawTicket = input[ASK_CHOICE_ANSWER_TICKET_PARAM];
  const ticket = typeof rawTicket === 'string' ? rawTicket : undefined;
  if (!pendingQuestions.redeem({ ticket, principalId: ctx.principalId, params: input })) {
    throw policy.inputError({ message: messages.forgedAnswer });
  }
  return describeAnswer(input, messages);
}

function parseOrRefuse({ input, toolId, policy }: { input: Record<string, unknown>; toolId: string; policy: AskChoicePolicy }): AskChoiceQuestion {
  try {
    return parseQuestion({ input, toolId });
  } catch (error) {
    if (!(error instanceof QuestionShapeError)) throw error;
    throw policy.shapeError({ message: error.message, toolId, inputSchema: ASK_CHOICE_INPUT_SCHEMA });
  }
}

// No emit seam: return the form itself, bound to a freshly minted single-use ticket.
function presentFallback({ question, toolId, principalId, pendingQuestions, presentation, messages }: {
  question: AskChoiceQuestion; toolId: string; principalId: string;
  pendingQuestions: AskChoicePendingStore; presentation: AskChoicePresentation; messages: AskChoiceMessages;
}): Record<string, unknown> {
  const ticket = pendingQuestions.mint({ principalId, question });
  try {
    const ui = presentation.render({ toolName: toolId, principalId, question, baseParams: { [ASK_CHOICE_ANSWER_TICKET_PARAM]: ticket } });
    return presentation.buildResult({ modelText: messages.pending, ui });
  } catch (error) {
    // A form that was not delivered must not leave a redeemable fallback ticket behind.
    pendingQuestions.redeem({ ticket, principalId, params: {} });
    throw error;
  }
}
