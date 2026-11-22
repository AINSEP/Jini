/**
 * @module prompt-augmenter
 * Product context, artifact conventions, research contracts and system overlays are host-owned.
 * The engine composes a base prompt and generic RunContextSelection, then calls this port rather
 * than depending on a product's design/annotation/workspace model.
 */
import type { PromptAugmenter } from '@jini-ai/core/contracts/agents';


/** Passes the base prompt through unchanged and adds no system overlay. */
export const noopPromptAugmenter: PromptAugmenter = {
  contextKinds: () => ['file', 'folder', 'browser', 'terminal', 'project', 'local-code'],
  augmentUserRequest: ({ basePrompt }) => basePrompt,
};
