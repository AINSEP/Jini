import type { ByokRuntimeSummary, ChatPaneAgent, ChatPaneAgentSelection } from './types.js';

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

export function defaultChatPaneSelection(agent: ChatPaneAgent): ChatPaneAgentSelection {
  const model = preferredOptionId(agent.models);
  const reasoning = preferredOptionId(agent.reasoningOptions);
  return {
    agentId: agent.id,
    ...(model === undefined ? {} : { model }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

export function resolveChatPaneSelection(
  agents: readonly ChatPaneAgent[],
  requested: ChatPaneAgentSelection,
): ChatPaneAgentSelection {
  const requestedAgent = agents.find(
    (agent) => agent.id === requested.agentId && agent.available !== false,
  );
  const agent = requestedAgent ?? agents.find((candidate) => candidate.available !== false);
  if (!agent) return { agentId: '' };
  const defaults = defaultChatPaneSelection(agent);
  if (agent !== requestedAgent) return defaults;
  const model = requested.model
    && agent.supportsCustomModel
    ? requested.model
    : validatedOptionId(agent.models, requested.model, defaults.model);
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
  | 'streaming'
  | 'uploads-pending'
  | 'working-directory-pending'
  | 'working-directory-invalid'
  | 'working-directory-error';

export interface ChatPaneSendability {
  readonly selectedAgent: Pick<ChatPaneAgent, 'available'> | undefined;
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
export function isChatPaneQueueableBlocker(blocker: ChatPaneSendBlocker | null): boolean {
  return blocker === 'streaming';
}

export function orderChatPaneAgents(
  agents: readonly ChatPaneAgent[],
): ChatPaneAgent[] {
  return [...agents].sort((left, right) => {
    const availability =
      Number(left.available === false) - Number(right.available === false);
    return availability
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}
