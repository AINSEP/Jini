import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationList, type ConversationListProps } from '../ConversationList.js';
import { conversationTriggerAttributes } from '../ConversationList.rules.js';

const t = (key: string) => key;

describe('conversationTriggerAttributes', () => {
  it('names the active conversation in both the label and the native title by default', () => {
    expect(conversationTriggerAttributes({ activeTitle: 'Launch plan', t })).toEqual({
      'aria-label': 'Conversations — Launch plan',
      title: 'Launch plan',
    });
    expect(conversationTriggerAttributes({ activeTitle: null, t })).toEqual({
      'aria-label': 'Conversations',
      title: 'Conversations',
    });
  });

  it('uses a host label for both when given', () => {
    expect(conversationTriggerAttributes({ activeTitle: 'Launch plan', t }, { label: 'Chats' })).toEqual({
      'aria-label': 'Chats',
      title: 'Chats',
    });
  });

  it('omits the native title when the host draws its own tooltip', () => {
    expect(conversationTriggerAttributes({ activeTitle: 'Launch plan', t }, { label: 'Chats', nativeTitle: false })).toEqual({
      'aria-label': 'Chats',
    });
  });
});

function renderList(extra: Partial<ConversationListProps> = {}) {
  return render(
    <ConversationList
      conversations={[{ id: 'c1', title: 'Launch plan' }]}
      activeConversationId="c1"
      onSelect={() => {}}
      onCreate={() => {}}
      onDelete={() => {}}
      onRename={() => {}}
      {...extra}
    />,
  );
}

describe('ConversationList trigger', () => {
  it('keeps its native title by default', () => {
    renderList();
    const trigger = screen.getByTestId('conversation-trigger');
    expect(trigger).toHaveAttribute('title', 'Launch plan');
    expect(trigger).toHaveAccessibleName('Conversations — Launch plan');
  });

  it('takes a host label and drops the native title with nativeTitle={false}', () => {
    renderList({ triggerLabel: 'Chats', nativeTitle: false });
    const trigger = screen.getByTestId('conversation-trigger');
    expect(trigger).not.toHaveAttribute('title');
    expect(trigger).toHaveAccessibleName('Chats');
  });
});
