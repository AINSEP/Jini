import { describe, expect, it } from 'vitest';
import { conversationListView, selectionRunContext } from '../rules.js';

const SUMMARIES = [
  { id: 'c1', title: 'First', messageCount: 2, createdAt: 1, updatedAt: 2 },
  { id: 'c2', title: null, messageCount: 0, createdAt: 3, updatedAt: 3 },
] as const;

describe('conversationListView', () => {
  it('the conversation list gets a COPY of the readonly list: same items, same order, new array', () => {
    const { listItems } = conversationListView({ conversations: SUMMARIES, activeId: null });
    expect(listItems).not.toBe(SUMMARIES);
    expect(listItems).toEqual(SUMMARIES);
  });

  it('no conversationId prop at all while nothing is active', () => {
    const { conversationIdProp } = conversationListView({ conversations: SUMMARIES, activeId: null });
    expect(conversationIdProp).toEqual({});
    expect(Object.hasOwn(conversationIdProp, 'conversationId')).toBe(false);
  });

  it('the active conversation id is passed through when one is active', () => {
    const { conversationIdProp } = conversationListView({ conversations: SUMMARIES, activeId: 'c2' });
    expect(conversationIdProp).toEqual({ conversationId: 'c2' });
  });
});

describe('selectionRunContext', () => {
  const runInput = (selection: { agentId: string; model?: string; reasoning?: string }) =>
    ({ prompt: 'hello', workingDirectory: null, selection });

  it('the run context is empty when the operator picked neither a model nor a reasoning level', () => {
    const context = selectionRunContext(runInput({ agentId: 'claude' }));
    expect(context).toEqual({});
    expect(Object.hasOwn(context, 'model')).toBe(false);
    expect(Object.hasOwn(context, 'reasoning')).toBe(false);
  });

  it('the run context carries each picked field and only that field', () => {
    expect(selectionRunContext(runInput({ agentId: 'claude', model: 'opus' }))).toEqual({ model: 'opus' });
    expect(selectionRunContext(runInput({ agentId: 'claude', reasoning: 'high' }))).toEqual({ reasoning: 'high' });
    expect(selectionRunContext(runInput({ agentId: 'claude', model: 'opus', reasoning: 'high' }))).toEqual({ model: 'opus', reasoning: 'high' });
  });
});
