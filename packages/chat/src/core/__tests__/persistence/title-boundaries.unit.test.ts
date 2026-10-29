import { expect, it } from 'vitest';
import { conversationTitleForDisplay, deriveConversationTitle } from '../../persistence/title.js';

it('does not derive a title from a non-word prompt even when it contains non-markdown punctuation', () => {
  expect(deriveConversationTitle({ prompt: '&&&& +++' })).toBe('');
});

it('retains the complete prefix when a title ceiling falls exactly before whitespace', () => {
  const prefix = 'A'.repeat(80);
  expect(deriveConversationTitle({ prompt: `${prefix} next` })).toBe(prefix);
  expect(conversationTitleForDisplay({ title: `${prefix} next`, titleSource: 'manual' })).toBe(prefix);
  expect(conversationTitleForDisplay({ title: '', titleSource: 'manual' })).toBe('');
  expect(conversationTitleForDisplay({ title: null, titleSource: 'fallback' })).toBeNull();
});
