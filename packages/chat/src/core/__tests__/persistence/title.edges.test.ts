import { describe, expect, it } from 'vitest';
import { conversationTitleForDisplay, deriveConversationTitle } from '../../persistence/title.js';

describe('conversation title edges', () => {
  it('retains stop words rather than dropping the prompt', () => {
    expect(deriveConversationTitle({ prompt: 'the and of' })).toBe('The and of');
  });

  it("derives no title when the prompt's first clause is empty", () => {
    expect(deriveConversationTitle({ prompt: '!\nRefactor billing' })).toBe('');
  });

  it('shows a saved title that is only markup as untitled', () => {
    expect(conversationTitleForDisplay({ title: '``~~', titleSource: 'manual' })).toBeNull();
  });
});
