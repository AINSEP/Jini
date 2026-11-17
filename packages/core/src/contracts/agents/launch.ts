/**
 * @file What an agent runtime hands a launcher: the resolved executable, staged prompt and log files, the
 * host-implemented prompt augmenter seam and the service-failure classes. Types only.
 */
export type AgentLaunchKind = 'selected' | 'codex-native';

export type AgentLaunchResolution = {
  configuredOverridePath: string | null;
  pathResolvedPath: string | null;
  selectedPath: string | null;
} & {
  launchPath: string | null;
  launchKind: AgentLaunchKind;
  childPathPrepend: string[];
  diagnostic: string | null;
};

export type PreparedAgentLogFile = {
  /** Absolute path to hand over as `RuntimeContext.agentLogFilePath`. The file itself does not exist yet — the spawned CLI creates it. */
  path: string;
  /** Removes the staged directory and whatever the CLI wrote into it. Safe to call more than once (`force: true`). */
  cleanup: () => Promise<void>;
};

export type PreparedPromptFile = {
  path: string;
  cleanup: () => Promise<void>;
};

/** A single item in the run's attached/selected workspace context. `kind` is host-defined — the engine treats it as an opaque string. */
export interface WorkspaceContextItem {
  id: string;
  kind: string;
  label: string;
}

export interface RunContextSelection {
  items: WorkspaceContextItem[];
}

export interface PromptAugmenter {
  /**
   * Which workspace-context `kind` strings this consumer recognizes (OD:
   * design-system, design-files, live-artifact, …). The engine itself only
   * knows generic kinds: file, folder, browser, terminal, project,
   * local-code.
   */
  contextKinds(): readonly string[];
  /**
   * Inject product context blocks (design-system selection, skills, brand,
   * …) into the composed user request. The engine passes the base prompt +
   * selection; the adapter returns the augmented text.
   */
  augmentUserRequest(input: {
    basePrompt: string;
    selection: RunContextSelection;
    agentId: string;
    hasPriorAssistantTurn: boolean;
  }): Promise<string> | string;
  /**
   * Optional system-prompt overlay. Product-specific discovery /
   * question-form protocols live here, not in the engine.
   */
  systemOverlay?(input: { agentId: string; turnIndex: number }): string | null;
}

// Model-service failure classes that map a CLI agent's raw error text to a
// structured API error code. `classifyAgentAuthFailure` only covers the
// agents that ship a tailored sign-in hint; every other CLI agent used to
// collapse auth / quota / upstream failures into a generic execution
// failure. This agent-agnostic, text-based classifier recovers the
// specific class so the chat shows an accurate reason.
export type AgentServiceFailureCode = 'AGENT_AUTH_REQUIRED' | 'RATE_LIMITED' | 'UPSTREAM_UNAVAILABLE';
