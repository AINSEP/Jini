import type { RichTextTriggerConfig } from './types.js';

/** Lexical editor theme: maps node types to CSS class names. */
export const EDITOR_THEME = {
  paragraph: 'rich-text-input-paragraph',
} as const;

export const DEFAULT_TEST_ID = 'rich-text-input';

/** Matches the origin's two triggers: an inline `@mention` and a
 *  line-start-anchored `/command`. A host may override this entirely. */
export const DEFAULT_TRIGGERS: readonly RichTextTriggerConfig[] = [
  { id: 'mention', character: '@', anchor: 'inline' },
  { id: 'command', character: '/', anchor: 'line-start' },
];

/** CaretFloatingLayer positioning constants. */
export const CARET_LAYER_GAP = 8; // gap between caret and popover edge
export const CARET_LAYER_MARGIN = 8; // viewport edge margin
export const CARET_LAYER_HARD_MAX_HEIGHT = 460; // never taller than this
export const CARET_LAYER_MIN_WIDTH = 320;
export const CARET_LAYER_PREFERRED_WIDTH = 420;
