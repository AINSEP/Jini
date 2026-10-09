import { configuredPickerModel, pickerModelOptions, isConcretePickerModel } from './model-options.js';
import type { ChatMessage } from '@jini-ai/chat';

import type { ByokRuntimeSummary, ChatPaneAgent, ChatPaneAgentSelection, TypedAnswerNotice } from './types.js';

function preferredOptionId(
  options: readonly { id: string }[] | undefined,
): string | undefined {
  return options?.find((option) => option.id === 'default')?.id ?? options?.[0]?.id;
}

function validatedOptionId(
  options: readonly { id: string }[] | undefined,
  requested: string | undefined,
  fallback: string | undefined,
): string | undefined {
  if (requested && options?.some((option) => option.id === requested)) return requested;
  return fallback;
}

export function defaultChatPaneSelection({ agent }: { agent: ChatPaneAgent }): ChatPaneAgentSelection {
  // An unresolved native route requires an intentional concrete choice. Legacy hosts without
  // structured resolution retain their first-concrete-entry behavior.
  const model = configuredPickerModel(agent) || (agent.defaultModelResolution?.status === 'unresolved' ? undefined : pickerModelOptions(agent)[0]?.id);
  const reasoning = preferredOptionId(agent.reasoningOptions);
  return {
    agentId: agent.id,
    ...(model === undefined ? {} : { model }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

export function resolveChatPaneSelection({ agents, requested }: { agents: readonly ChatPaneAgent[]; requested: ChatPaneAgentSelection }
): ChatPaneAgentSelection {
  const requestedAgent = agents.find(
    (agent) => agent.id === requested.agentId && agent.id !== 'gemini' && agent.available !== false,
  );
  const agent = requestedAgent ?? agents.find((candidate) => candidate.id !== 'gemini' && candidate.available !== false);
  if (!agent) return { agentId: '' };
  const defaults = defaultChatPaneSelection({ agent: agent });
  if (agent !== requestedAgent) return defaults;
  const model = requested.model
    && isConcretePickerModel(requested.model)
    && agent.supportsCustomModel
    && agent.supportsConcreteModelSelection !== false
    ? requested.model
    : validatedOptionId(pickerModelOptions(agent), requested.model, defaults.model);
  const reasoning = validatedOptionId(
    agent.reasoningOptions,
    requested.reasoning,
    defaults.reasoning,
  );
  return {
    agentId: agent.id,
    ...(model === undefined ? {} : { model }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

/**
 * Why a send would be refused, or `null` when the pane is ready to send.
 *
 * Deliberately excludes "the composer draft is empty" — that is the composer-driven path's own
 * precondition (`composer.canSubmit`), not a property of the pane. An agent-driven send supplies
 * its own prompt and must still clear every blocker below.
 */
export type ChatPaneSendBlocker =
  | 'no-agent-selected'
  | 'agent-unavailable'
  | 'model-unresolved'
  | 'streaming'
  | 'uploads-pending'
  | 'working-directory-pending'
  | 'working-directory-invalid'
  | 'working-directory-error';

export interface ChatPaneSendability {
  readonly selectedAgent: Pick<ChatPaneAgent, 'available' | 'modelCatalog' | 'supportsConcreteModelSelection'> | undefined;
  readonly model?: string;
  readonly isStreaming: boolean;
  readonly activeUploadCount: number;
  readonly workingDirectoryPending: boolean;
  readonly workingDirectoryInvalid: boolean;
  readonly workingDirectoryError: Error | null;
  /**
   * Set by callers that resolved {@link isChatPaneApiModeConfigured} `true`, so a configured
   * BYOK turn is not refused merely because no CLI is selected. Defaults to `false` when
   * omitted, which preserves the original all-fail-closed behavior for CLI-only callers.
   */
  readonly apiModeConfigured?: boolean;
}

/**
 * Whether the API/BYOK execution path is genuinely usable right now, independent of the local CLI
 * runtime inventory.
 *
 * A BYOK turn calls the configured provider directly over HTTP and never touches a detected CLI,
 * so `selectedAgent === undefined` must not fail-closed a working BYOK setup (e.g. a host with
 * zero agent CLIs on PATH). Being in API mode is not sufficient on its own, though:
 * `apiModeAvailable` says the mode is selectable at all, and `byokRuntime.model` says a model was
 * actually chosen — without one there is nothing to send the turn to (see
 * `RuntimeByokDetails`'s "No model configured" state), so this stays `false` until all three
 * line up.
 */
export function isChatPaneApiModeConfigured({
  executionMode,
  apiModeAvailable,
  byokRuntime,
}: {
  readonly executionMode: 'local' | 'api';
  readonly apiModeAvailable: boolean;
  readonly byokRuntime: ByokRuntimeSummary | undefined;
}): boolean {
  return executionMode === 'api' && apiModeAvailable && Boolean(byokRuntime?.model?.trim());
}

/**
 * The single source of truth for "may this pane send right now?", shared by the composer-driven
 * `send()` and every agent-driven caller so the two can never enforce different rules.
 *
 * @param state - Current pane readiness inputs.
 * @returns The first blocker found, or `null` when sending is allowed.
 */
export function findChatPaneSendBlocker(state: ChatPaneSendability): ChatPaneSendBlocker | null {
  if (state.selectedAgent === undefined) {
    if (!state.apiModeConfigured) return 'no-agent-selected';
  } else if (state.selectedAgent.available === false) {
    return 'agent-unavailable';
  }
  if (!state.apiModeConfigured && state.selectedAgent && (state.selectedAgent.modelCatalog || state.selectedAgent.supportsConcreteModelSelection === false) && (!state.model || !isConcretePickerModel(state.model) || state.selectedAgent.supportsConcreteModelSelection === false)) return 'model-unresolved';
  if (state.isStreaming) return 'streaming';
  if (state.activeUploadCount > 0) return 'uploads-pending';
  if (state.workingDirectoryPending) return 'working-directory-pending';
  if (state.workingDirectoryInvalid) return 'working-directory-invalid';
  if (state.workingDirectoryError !== null) return 'working-directory-error';
  return null;
}

const SEND_BLOCKER_MESSAGES: Record<ChatPaneSendBlocker, string> = {
  'no-agent-selected': 'no agent is selected',
  'agent-unavailable': 'the selected agent is unavailable',
  'model-unresolved': 'choose a concrete model before sending',
  streaming: 'a run is already streaming — cancel it first',
  'uploads-pending': 'attachment uploads are still in flight',
  'working-directory-pending': 'the working directory is still being validated',
  'working-directory-invalid': 'the working directory is invalid',
  'working-directory-error': 'the working directory could not be read',
};

/** Human/model-readable reason for a blocker, so a refused agent send explains itself. */
export function describeChatPaneSendBlocker(blocker: ChatPaneSendBlocker): string {
  return SEND_BLOCKER_MESSAGES[blocker];
}

/**
 * Whether a refused send should be QUEUED and retried rather than dropped on the floor.
 *
 * Only `streaming` qualifies: it is the one blocker guaranteed to clear on its own, from a run
 * that is already underway. Every other blocker needs an operator action — pick an agent, wait for
 * uploads, fix the working directory — so queueing behind one would hold a prompt indefinitely
 * against a condition nothing is going to change.
 *
 * Note the ordering dependency in {@link findChatPaneSendBlocker}: `streaming` is reported AHEAD of
 * `uploads-pending` and the working-directory blockers, so a `streaming` verdict does not prove
 * those are clear. A flush path must therefore wait for a fully `null` blocker before sending,
 * not merely for streaming to end.
 */
export function isChatPaneQueueableBlocker({ blocker }: { blocker: ChatPaneSendBlocker | null }): boolean {
  return blocker === 'streaming';
}

/**
 * Whether the run in flight is holding a question open for the human: the newest message is the
 * assistant's, and it carries an interactive surface (`kind: 'ext'`, e.g. an MCP-UI card) that
 * arrived inside a still-open call to the host's question tool (`toolName`). That is the one moment
 * text typed into the composer is an ANSWER rather than a next turn — the tool is parked waiting on
 * it, and queueing the text behind the run would only deliver it after the question had expired, as
 * a new paid run.
 *
 * Only the question tool counts. Other tools park on cards too — a delete confirm, an approval —
 * but they take no typed answer: the server routes typed text only to the question tool, so treating
 * those as waiting would refuse the text with "no longer waiting" and drop it instead of queueing.
 * A call is the question tool when ANY `tool_use` for its id names it, since the same call's
 * `tool_use` can arrive more than once (the CLI re-emits it). A vendor's wrapper row
 * (`execute_delegated_tool`) and the daemon's canonical row do NOT share an id — the wrapper carries
 * the CLI's `toolu_…` id and the canonical row a fresh UUID from `@jini-ai/mcp`. The canonical row
 * opens after its wrapper, so it is the newest open call when the surface arrives, and that is
 * what attributes the surface to the question tool.
 *
 * A surface is attributed to the newest call still open when it arrived — the same rule
 * `useExtEventGroups` uses to give a card its `call` — so an older call returning does not settle
 * it. Once its call returns (answered, expired, abandoned), typing is a next turn again.
 *
 * @complexity O(e·c): e events in the newest message, c calls open at once (one or two in practice).
 */
export function isAwaitingTypedAnswer({ messages, toolName }: {
  messages: readonly ChatMessage[];
  toolName: string;
}): boolean {
  return findAwaitedTypedAnswerId({ messages, toolName }) !== null;
}

/**
 * The tool-use id of the question {@link isAwaitingTypedAnswer} sees waiting, or `null` — the newest
 * one when several are open. The id lets the pane tell one question from the next: a draft typed
 * for a question stays tied to THAT question after it closes (see `useChatPane`'s held answer).
 *
 * @complexity O(e·c), as {@link isAwaitingTypedAnswer}.
 */
export function findAwaitedTypedAnswerId({ messages, toolName }: {
  messages: readonly ChatMessage[];
  toolName: string;
}): string | null {
  const newest = messages.at(-1);
  if (newest?.role !== 'assistant') return null;
  // Open call id -> whether it is the question tool. Insertion-ordered, so the last entry is the
  // newest call still open; a repeat id keeps its slot and only ORs in its name.
  const openCalls = new Map<string, boolean>();
  const awaited = new Set<string>();
  for (const event of newest.events ?? []) {
    if (event.kind === 'tool_use') openCalls.set(event.id, openCalls.get(event.id) === true || event.name === toolName);
    if (event.kind === 'tool_result') {
      openCalls.delete(event.toolUseId);
      awaited.delete(event.toolUseId);
    }
    const owner = event.kind === 'ext' ? [...openCalls].at(-1) : undefined;
    if (owner?.[1] === true) awaited.add(owner[0]);
  }
  return [...awaited].at(-1) ?? null;
}

/**
 * Whether a composer send is an answer to a waiting question rather than a next turn: a run is
 * streaming ({@link isChatPaneQueueableBlocker}), the turn has no attachments (a typed answer
 * carries text only), and that run is holding the `toolName` question open
 * ({@link isAwaitingTypedAnswer}).
 *
 * @complexity O(e·c), from {@link isAwaitingTypedAnswer}.
 */
export function isTypedAnswerTurn({ blocker, attachmentCount, messages, toolName }: {
  blocker: ChatPaneSendBlocker | null;
  attachmentCount: number;
  messages: readonly ChatMessage[];
  toolName: string;
}): boolean {
  return isChatPaneQueueableBlocker({ blocker }) && attachmentCount === 0 && isAwaitingTypedAnswer({ messages, toolName });
}

/**
 * The run a composer send can go INTO instead of queueing behind, or `null`: a run is streaming
 * ({@link isChatPaneQueueableBlocker}), the turn has no attachments (a mid-run message carries text
 * only — the live agent's stdin takes no files), and the newest message is that run's assistant
 * turn with a known `runId`.
 *
 * @complexity O(1).
 */
export function findMidRunMessageRunId({ blocker, attachmentCount, messages }: {
  blocker: ChatPaneSendBlocker | null;
  attachmentCount: number;
  messages: readonly ChatMessage[];
}): string | null {
  if (!isChatPaneQueueableBlocker({ blocker }) || attachmentCount !== 0) return null;
  const last = messages.at(-1);
  return last?.role === 'assistant' && last.runId ? last.runId : null;
}

const TYPED_ANSWER_NOTICES: Record<TypedAnswerNotice, string> = {
  'not-pending': 'That question is no longer waiting for an answer, so your message was not sent.',
  failed: 'Your answer could not be delivered. Try sending it again.',
};

/** The English copy (and i18n key) for why a typed answer was not sent. */
export function describeTypedAnswerNotice({ notice }: { notice: TypedAnswerNotice }): string {
  return TYPED_ANSWER_NOTICES[notice];
}

export function orderChatPaneAgents({ agents }: { agents: readonly ChatPaneAgent[] }
): ChatPaneAgent[] {
  return [...agents].sort((left, right) => {
    const availability =
      Number(left.available === false) - Number(right.available === false);
    return availability
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}
