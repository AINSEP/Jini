import type { AgentEvent } from '../../core/events.js';
import type { ChatMessage } from '../../core/messages.js';
import { assistantContentFromEvents } from '../../core/assistant-content.js';
import type { ChatTransport } from '../../core/transport.js';
import type { BrowserSessionStore } from '../browser/session-store.js';
import { extractPageActions, splitPageActions } from '../../core/browser/page-actions.js';
import type { PageActionPort, NavigateAction, NonNavigateAction } from '../../core/browser/page-actions.js';

export interface VanillaChatState {
  readonly open: boolean;
  readonly messages: ChatMessage[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly proposal: { navigate: NavigateAction; bundled: NonNavigateAction | null } | null;
}
export interface VanillaChatControllerArgs {
  readonly transport: ChatTransport;
  readonly session: BrowserSessionStore;
  readonly pageActions: PageActionPort;
  readonly directiveEventName: string;
  readonly agentId: string;
  readonly ids: (args: Record<string, never>) => string;
  readonly createAbortController: (args: Record<string, never>) => AbortController;
  readonly onChange: (args: { state: VanillaChatState }) => void;
}

/**
 * Framework-free visitor state over the existing transport/session/page-action owners.
 * Restored messages never replay directives. Only a successful live settlement can act;
 * persistence and queued effects finish synchronously before navigation tears down the page.
 * Reset invalidates callbacks before aborting, preventing late chunks from reviving a thread.
 * @complexity O(retained transcript + reply events + reply characters) per update; storage writes
 * occur only on settle/open/reset/navigation, never per streamed chunk. Session bounds persisted bytes.
 */
export function createVanillaChatController(args: VanillaChatControllerArgs, _options = {}) {
  const initial = args.session.load({});
  let state: VanillaChatState = { ...initial, busy: false, error: null, proposal: null };
  let generation = 0;
  let active: AbortController | null = null;
  const publish = ({ persist = true }: { persist?: boolean } = {}) => {
    if (persist) args.session.save({ state: { open: state.open, messages: state.messages } });
    args.onChange({ state });
  };
  const go = (proposal: NonNullable<VanillaChatState['proposal']>) => {
    if (!args.pageActions.allows({ action: proposal.navigate })) return;
    if (proposal.bundled && args.pageActions.allows({ action: proposal.bundled })) args.session.enqueue({ action: proposal.bundled });
    state = { ...state, proposal: null };
    publish();
    args.pageActions.navigate({ action: proposal.navigate });
  };
  const settleActions = (events: AgentEvent[]) => {
    const actions = extractPageActions({ events, directiveEventName: args.directiveEventName })
      .filter(action => args.pageActions.allows({ action }));
    const { navigate, other } = splitPageActions({ actions });
    if (!navigate) {
      if (other) args.pageActions.execute({ action: other });
      return;
    }
    const proposal = { navigate, bundled: other };
    if (navigate.auto) go(proposal);
    else { state = { ...state, proposal }; publish(); }
  };
  return {
    getState(_input: Record<string, never> = {}, _opts = {}) { return state; },
    setOpen({ open }: { open: boolean }, _opts = {}) { state = { ...state, open }; publish(); },
    async send({ text }: { text: string }, _opts = {}) {
      const content = text.trim();
      if (!content || state.busy) return false;
      generation += 1;
      const token = generation;
      const abort = args.createAbortController({});
      active = abort;
      const history = [...state.messages, { id: args.ids({}), role: 'user' as const, content }];
      const reply: ChatMessage = { id: args.ids({}), role: 'assistant', content: '', events: [], runStatus: 'running' };
      state = { ...state, messages: [...history, reply], busy: true, error: null, proposal: null };
      publish({ persist: false });
      let events: AgentEvent[] = [];
      let failed = false;
      let settled = false;
      const current = () => token === generation && !settled;
      const updateReply = (next: ChatMessage, { persist = false }: { persist?: boolean } = {}) => {
        state = { ...state, messages: state.messages.map(message => message.id === reply.id ? next : message) };
        publish({ persist });
      };
      const fail = (error: Error) => {
        if (!current()) return;
        failed = true;
        state = { ...state, error: error.message };
        updateReply({ ...reply, content: assistantContentFromEvents({ events }), events: [...events], runStatus: 'failed' });
      };
      const done = (final: AgentEvent[]) => {
        if (!current()) return;
        settled = true;
        active = null;
        events = final;
        state = { ...state, busy: false };
        const completedStatus = abort.signal.aborted ? 'canceled' : 'succeeded';
        updateReply({ ...reply, content: assistantContentFromEvents({ events }), events: [...events],
          runStatus: failed ? 'failed' : completedStatus }, { persist: true });
        if (!failed && !abort.signal.aborted) settleActions(events);
      };
      try {
        await args.transport.startRun({ history, agentId: args.agentId, assistantMessageId: reply.id, signal: abort.signal }, {
          onEvent(event) {
            if (!current()) return;
            events = [...events, event];
            updateReply({ ...reply, content: assistantContentFromEvents({ events }), events: [...events], runStatus: failed ? 'failed' : 'running' });
          },
          onError: fail,
          onDone: done,
        });
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); done(events); }
      return true;
    },
    acceptProposal(_input: Record<string, never> = {}, _opts = {}) { if (state.proposal) go(state.proposal); },
    cancel(_input: Record<string, never> = {}, _opts = {}) { active?.abort(); },
    reset(_input: Record<string, never> = {}, _opts = {}) {
      generation += 1;
      active?.abort();
      active = null;
      args.session.clear({});
      state = { open: state.open, messages: [], busy: false, error: null, proposal: null };
      publish();
    },
    dispose(_input: Record<string, never> = {}, _opts = {}) { generation += 1; active?.abort(); active = null; },
  };
}
