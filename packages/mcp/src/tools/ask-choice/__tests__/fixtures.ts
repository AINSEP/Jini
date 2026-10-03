import {
  createAskChoiceTool, createAskChoiceAnswerTicketStore,
  type AskChoiceExchangeStore, type AskChoiceMessage, type AskChoicePresentation,
} from '../index.js';

export const TOOL_ID = 'question_pick';
export const SURFACE_EXCHANGE_ID_PARAM = '__exchangeId';
export const SURFACE_DISMISSED_PARAM = '__dismissed';
export const SURFACE_TYPED_ANSWER_PARAM = '__typedAnswer';
export const messages = {
  pending: 'A question has been shown to the administrator. NOTHING HAS BEEN ANSWERED YET. Their answer arrives only if they submit that form, which sends it itself. You cannot fill it in yourself: tell them the form is open and wait.',
  forgedAnswer: "question_pick: this answer does not match a form that is currently outstanding for this administrator — there is no such ticket, it already expired, or it was already used. The administrator's answer can only arrive by them submitting a real rendered form; never set 'choice' or 'selections' yourself. If a decision is still needed, call question_pick again with the question and wait for the real response.",
  submitted: 'Tell the administrator what you understood from their answer, in plain language, before proceeding.',
  typed: "The administrator answered in their own words instead of picking one of the options. Treat 'freeText' as what they said, not as a selection: none of the options you offered was chosen. Say what you understood before acting on it, and ask again if it is ambiguous.",
  noAnswer: 'The administrator did not provide an answer. Do not assume any answer.',
  cancelled: 'The administrator cancelled the form without answering. Do not assume any answer.',
  expired: 'The administrator did not respond before the form expired. Do not assume any answer.',
  abandoned: 'The form was dismissed because the run ended. Do not assume any answer.',
};

/** Renderer contract fixture: inspect structured content without a UI dependency or browser. */
export const presentation: AskChoicePresentation = {
  render: (spec, options) => ({ resource: { text: JSON.stringify({ ...spec, ...options }) } }),
  buildResult: ({ modelText, ui }) => ({ content: [
    { type: 'text', text: modelText },
    { type: 'resource', ...(ui as { resource: { text: string } }) },
  ] }),
};

export function createSurfaceExchangeStore(options: { idleTtlMs?: number } = {}) {
  const active = new Map<string, {
    toolId: string; principalId: string; accept: (message: AskChoiceMessage) => void;
  }>();
  let nextId = 0;
  const store: AskChoiceExchangeStore = {
    open({ toolId, principalId, emit }) {
      const id = `exchange-${++nextId}`;
      const buffered: AskChoiceMessage[] = [];
      let resolve: ((answer: AskChoiceMessage) => void) | undefined;
      let ended: AskChoiceMessage | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const accept = (answer: AskChoiceMessage) => {
        if (resolve) { const receiver = resolve; resolve = undefined; receiver(answer); }
        else buffered.push(answer);
      };
      const end = (status: 'expired' | 'abandoned') => {
        if (ended) return;
        ended = { status };
        active.delete(id);
        if (timer) clearTimeout(timer);
        accept(ended);
      };
      active.set(id, { toolId, principalId, accept });
      if (options.idleTtlMs !== undefined) timer = setTimeout(() => end('expired'), options.idleTtlMs);
      return {
        id,
        send: async ({ emission }) => { await emit({ emission }); },
        receive: async () => buffered.shift() ?? ended ?? await new Promise<AskChoiceMessage>(receiver => { resolve = receiver; }),
        close: () => end('abandoned'),
      };
    },
  };
  return {
    ...store,
    deliver(spec: { exchangeId: string; toolId: string; principalId: string; params: Record<string, unknown> }) {
      const entry = active.get(spec.exchangeId);
      if (!entry) return { ok: false, reason: 'unknown-or-closed' };
      if (entry.toolId !== spec.toolId || entry.principalId !== spec.principalId) return { ok: false, reason: 'binding-mismatch' };
      entry.accept({ status: 'received', params: spec.params });
      return { ok: true };
    },
    size: () => active.size,
  };
}

export function buildRegistration(surfaceExchanges: AskChoiceExchangeStore) {
  let id = 0;
  return createAskChoiceTool({
    toolId: TOOL_ID, description: 'Ask for missing information.', permission: 'assistant.use',
    policy: {
      authorize: () => undefined,
      inputError: ({ message }) => new Error(message),
      shapeError: ({ message, toolId, inputSchema }) => new Error(`${message} Retry ${toolId} with schema ${JSON.stringify(inputSchema)}`),
    },
    messages, presentation, surfaceExchanges,
    pendingQuestions: createAskChoiceAnswerTicketStore({ now: () => 0, newTicketId: () => `ticket-${++id}`, ttlMs: 300_000 }),
  });
}

export function buildHandler(surfaceExchanges: AskChoiceExchangeStore) {
  return buildRegistration(surfaceExchanges).handler;
}
