/**
 * @module prompt-augmenter
 *
 * Port replacing OD's `apps/daemon/src/runtimes/chat-prompt-inputs.ts` (design-system
 * selection resolution — `resolveEffectiveDesignSystemSelection`,
 * `designSystemIdFromPluginSnapshot`, `formatDesignFilesWorkspaceHint`,
 * Codex image-generation prompt overrides, comment-attachment rendering,
 * research-command-contract composition — all genuinely OD-product prompt
 * content) and the workspace-context-kind half of OD's
 * `runtimes/chat-run-context.ts` (not present on this branch as a separate
 * file, but the same `'design-system'`-as-a-context-kind concept lives
 * inline in `chat-prompt-inputs.ts`).
 *
 * None of that OD logic is ported — per the task charter, this file defines
 * only the injection seam. The shape below is r1b §1's proposed
 * `PromptAugmenter` signature, used as-is (it matched the real source: the
 * engine composes a base prompt and a generic `RunContextSelection`, then
 * calls out to the host for product-specific augmentation and an optional
 * system-prompt overlay).
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
