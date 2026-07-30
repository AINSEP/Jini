// Smoke test for the feature's public barrel: proves every advertised
// runtime export actually resolves through `index.js` (not just through
// each source file directly, which every other test in this directory
// exercises).
import { describe, expect, it } from 'vitest';
import * as RichTextInputFeature from './index.js';

describe('rich-text-input index barrel', () => {
  it('re-exports the constants, mention-parser, mention-node, serialize/deserialize, rules, hooks, and components it advertises', () => {
    const runtimeExports = [
      'DEFAULT_TRIGGERS',
      'DEFAULT_TEST_ID',
      'buildMentionToken',
      'parseMentionParts',
      'isMentionBoundary',
      'isMentionRightBoundary',
      'mentionTokenPresent',
      'foldPresentMentions',
      'MentionNode',
      '$createMentionNode',
      '$isMentionNode',
      'serializeRichText',
      'setRichTextFromPlainText',
      'detectActiveTrigger',
      'buildTriggerDeletionRegex',
      'buildAnyTriggerDeletionRegex',
      'buildTriggerMatch',
      'readCaretRect',
      'computeCaretFloatingLayerPosition',
      'RichTextInput',
      'CaretFloatingLayer',
      'useMentionColorStamping',
      'MENTION_COLOR_PROPERTY',
      'useCaretFloatingLayerPosition',
    ] as const;

    for (const name of runtimeExports) {
      expect(
        (RichTextInputFeature as Record<string, unknown>)[name],
        `expected index.js to export ${name}`,
      ).toBeDefined();
    }
  });
});
