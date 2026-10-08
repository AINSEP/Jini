/**
 * @module prompt-augmenter
 * Product context, artifact conventions, research contracts and system overlays are host-owned.
 * The engine composes a base prompt and generic RunContextSelection, then calls this port rather
 * than depending on a product's design/annotation/workspace model.
 */

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

/** Passes the base prompt through unchanged and adds no system overlay. */
export const noopPromptAugmenter: PromptAugmenter = {
  contextKinds: () => ['file', 'folder', 'browser', 'terminal', 'project', 'local-code'],
  augmentUserRequest: ({ basePrompt }) => basePrompt,
};
