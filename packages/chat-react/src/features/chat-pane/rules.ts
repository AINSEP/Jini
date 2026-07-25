import type { ChatPaneAgent, ChatPaneAgentSelection } from './types.js';

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
}

/**
 * The single source of truth for "may this pane send right now?", shared by the composer-driven
 * `send()` and every agent-driven caller so the two can never enforce different rules.
 *
 * @param state - Current pane readiness inputs.
 * @returns The first blocker found, or `null` when sending is allowed.
 */
export function findChatPaneSendBlocker(state: ChatPaneSendability): ChatPaneSendBlocker | null {
  if (state.selectedAgent === undefined) return 'no-agent-selected';
  if (state.selectedAgent.available === false) return 'agent-unavailable';
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
