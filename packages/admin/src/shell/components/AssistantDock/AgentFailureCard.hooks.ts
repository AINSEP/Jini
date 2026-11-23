import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ChatMessage, ChatPaneAgentSelection, ChatPaneRuntimeAccess, ChatTransport, KitChatTranslator } from "../../../react/kit.js";
import { GENERIC_AGENT_FAILURE, extractAgentFailure, matchAgentFailureHint, projectAgentFailureMessage, redactAgentFailure,
  suggestedFailureAgent, withAgentFailureSurface, type AgentFailure, type FailureAgent } from "./agent-failure.js";
import { localFailureHints } from "./agent-failure-hints.js";

export interface FailureSurfaceActions {
  readonly agents: readonly FailureAgent[];
  readonly switchAgent: (input: { agentId: string }, options?: Record<string, never>) => void;
}
export const FailureSurfaceContext = createContext<FailureSurfaceActions>({ agents: [], switchAgent: () => undefined });

/** Capture the same live inventory the picker loads, never trust its persisted placeholder. */
export function useAgentFailureSurface({ transport, runtimeAccess, initialMessages, onSelectionChange, onExecutionModeChange }: {
  transport: ChatTransport; runtimeAccess: ChatPaneRuntimeAccess; initialMessages: ChatMessage[] | undefined;
  onSelectionChange: (selection: ChatPaneAgentSelection) => void; onExecutionModeChange: (mode: "local" | "api") => void;
}, _optional = {}) {
  const [agents, setAgents] = useState<readonly FailureAgent[]>([]);
  const inventoryGeneration = useRef(0);
  const access = useMemo<ChatPaneRuntimeAccess>(() => {
    async function capture({ load }: { load: () => Promise<readonly FailureAgent[]> }, _options: Record<string, never> = {}) {
      inventoryGeneration.current += 1;
      const generation = inventoryGeneration.current;
      const inventory = await load();
      if (generation === inventoryGeneration.current) setAgents(inventory);
      return inventory;
    }
    return { ...runtimeAccess,
      listAgents: () => capture({ load: () => runtimeAccess.listAgents() }),
      rescanAgents: () => capture({ load: () => runtimeAccess.rescanAgents() }),
    };
  }, [runtimeAccess]);
  const projectedTransport = useMemo(() => withAgentFailureSurface({ transport }, {}), [transport]);
  const messages = useMemo(() => initialMessages?.map(message => projectAgentFailureMessage({ message }, {})), [initialMessages]);
  const actions = useMemo<FailureSurfaceActions>(() => ({ agents, switchAgent({ agentId }, _options = {}) {
    if (!agents.some(agent => agent.id === agentId && agent.available === true)) return;
    onExecutionModeChange("local");
    // An agent change resets its model/effort, matching the picker's selection path.
    onSelectionChange({ agentId });
  } }), [agents, onSelectionChange, onExecutionModeChange]);
  return { transport: projectedTransport, runtimeAccess: access, initialMessages: messages, actions };
}

function failureData({ value }: { value: unknown }, _options: Record<string, never> = {}): AgentFailure | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<AgentFailure>;
  if (typeof data.reason !== "string" || typeof data.details !== "string") return null;
  const agent = typeof data.agentId === "string" ? { agentId: data.agentId } : {};
  if (data.reason === GENERIC_AGENT_FAILURE) return { reason: data.reason, details: redactAgentFailure({ text: data.details }, {}), ...agent };
  // The renderer is also a boundary: persisted extension data need not have used our transport.
  return extractAgentFailure({ events: [{ kind: "raw", line: data.details || data.reason }], ...agent }, {});
}

/** The same payload check as the card: malformed history must retain Jini's terminal fallback.
 * @complexity O(last event bytes), pure; earlier events do not control the card's current state.
 */
export function hasAgentFailureNotice({ events }: { events: readonly unknown[] }, _optional = {}): boolean {
  return failureData({ value: events[events.length - 1] }) !== null;
}

export function useAgentFailureCard({ events, runStreaming, runSucceeded, useTHook }: {
  events: readonly unknown[]; runStreaming: boolean; runSucceeded: boolean;
  /** The host's chat translator hook (the kit chat `useT`). */
  useTHook: () => KitChatTranslator;
}, _optional = {}) {
  const t = useTHook();
  const { agents, switchAgent } = useContext(FailureSurfaceContext);
  const failure = failureData({ value: events[events.length - 1] });
  if (runStreaming || runSucceeded || !failure) return null;
  const declaredHints = failureHintsForAgent({ agents, agentId: failure.agentId });
  const hint = matchAgentFailureHint({ failure, hints: [...declaredHints, ...localFailureHints({ agentId: failure.agentId }, {})] }, {});
  const alternative = suggestedFailureAgent({ hint, agents }, {});
  // Translate known guidance before redaction; runtime diagnostics remain verbatim and redacted.
  return { ...failure, hint: hint ? redactAgentFailure({ text: t(hint.hint) }, {}) : undefined,
    switchLabel: alternative ? t("Switch to {name}", { name: redactAgentFailure({ text: alternative.name }, {}) }) : undefined,
    switchAgent: alternative ? () => switchAgent({ agentId: alternative.id }) : undefined };
}

/** Read only the selected agent's declared hints; unknown agents retain local guidance. */
function failureHintsForAgent({ agents, agentId }: { agents: readonly FailureAgent[]; agentId: string | undefined }) {
  return agents.find(agent => agent.id === agentId)?.failureHints ?? [];
}
