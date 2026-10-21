import { describe, expect, it } from 'vitest';
import { conversationTitleForDisplay, deriveConversationTitle } from '../../persistence/title.js';

describe('conversation title edges', () => {
  it('derives no title from a prompt made only of stop words', () => {
    expect(deriveConversationTitle({ prompt: 'the and of' })).toBe('');
  });

  it("derives no title when the prompt's first clause is empty", () => {
    expect(deriveConversationTitle({ prompt: '!\nRefactor billing' })).toBe('');
  });

  it('shows a saved title that is only markup as untitled', () => {
    expect(conversationTitleForDisplay({ title: '``~~', titleSource: 'manual' })).toBeNull();
  });
});
