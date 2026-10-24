import { acceptedInputsFromMessages, acceptedInputUserEvent, projectAcceptedInputEvents } from '../accepted-input.js';
import type { AgentEvent } from '../events.js';
import { describe, expect, it } from 'vitest';
import { composerHistoryKeyAction, createComposerHistoryState, mergeComposerHistory, normalizeComposerHistory, transitionComposerHistory, type ComposerHistoryState } from '../composer-history.js';

const entries = ['old\nmultiline', 'latest'];
function move(state: ComposerHistoryState, action: 'previous' | 'next' | 'restore' | 'edit' | 'reset', text: string) {
  return transitionComposerHistory({ state, action, text, entries });
}

describe('composer history', () => {
  it.each(['', '  unfinished\n  draft with spaces  \n'])('stashes and restores the exact draft %j after browsing both directions', (draft) => {
    const latest = move(createComposerHistoryState({}), 'previous', draft);
    expect(latest.text).toBe('latest');
    const oldest = move(latest.state, 'previous', latest.text);
    expect(oldest.text).toBe('old\nmultiline');
    const boundary = move(oldest.state, 'previous', oldest.text);
    expect(boundary.text).toBe('old\nmultiline');
    const forward = move(boundary.state, 'next', boundary.text);
    expect(forward.text).toBe('latest');
    const restored = move(forward.state, 'next', forward.text);
    expect(restored.text).toBe(draft);
    expect(restored.state.index).toBeNull();
  });

  it('Escape restores the draft from any entry', () => {
    const latest = move(createComposerHistoryState({}), 'previous', 'my draft');
    const old = move(latest.state, 'previous', latest.text);
    expect(move(old.state, 'restore', old.text).text).toBe('my draft');
  });

  it('an edit becomes the working draft and never mutates a stored entry', () => {
    const original = [...entries];
    const recalled = move(createComposerHistoryState({}), 'previous', 'initial');
    const edited = move(recalled.state, 'edit', 'latest amended');
    expect(edited.state.index).toBeNull();
    expect(move(edited.state, 'restore', edited.text).handled).toBe(false);
    const again = move(edited.state, 'previous', edited.text);
    expect(again.text).toBe('latest');
    expect(move(again.state, 'next', again.text).text).toBe('latest amended');
    expect(entries).toEqual(original);
  });

  it('reset after send discards the old stash', () => {
    const recalled = move(createComposerHistoryState({}), 'previous', 'do not resurrect');
    const reset = move(recalled.state, 'reset', '');
    expect(move(reset.state, 'restore', '').handled).toBe(false);
    expect(move(reset.state, 'next', '').text).toBe('');
  });

  it('snapshots entries so a new sent message does not shift browsing', () => {
    const recalled = move(createComposerHistoryState({}), 'previous', 'draft');
    const next = transitionComposerHistory({ state: recalled.state, action: 'previous', text: recalled.text, entries: ['other', ...entries, 'new'] });
    expect(next.text).toBe('old\nmultiline');
  });

  it('leaves native keys alone with no entries or no active browse', () => {
    const state = createComposerHistoryState({});
    expect(transitionComposerHistory({ state, action: 'previous', text: 'draft', entries: [] }).handled).toBe(false);
    expect(move(state, 'next', 'draft').handled).toBe(false);
    expect(move(state, 'restore', 'draft').handled).toBe(false);
  });

  it('collapses only consecutive duplicate texts, preserves whitespace, and caps newest last', () => {
    expect(normalizeComposerHistory({ entries: ['', ' ', ' a ', ' a ', 'b', ' a '] })).toEqual([' a ', 'b', ' a ']);
    const many = Array.from({ length: 120 }, (_, i) => `prompt ${i}`);
    expect(normalizeComposerHistory({ entries: many })).toEqual(many.slice(20));
    expect(normalizeComposerHistory({ entries: many }, { cap: 2 })).toEqual(['prompt 118', 'prompt 119']);
  });

  it('restores an empty draft when a browsing state carries no stashed draft', () => {
    const state: ComposerHistoryState = { entries: ['a'], index: 0, draft: null };
    expect(transitionComposerHistory({ state, action: 'restore', text: 'a', entries })).toEqual({
      state: { entries: [], index: null, draft: null },
      text: '',
      handled: true,
    });
  });

  it('merges the active transcript without repeating the overlap with recent sends', () => {
    expect(mergeComposerHistory({ recent: ['other', 'a', 'b'], current: ['a', 'b', 'c'] })).toEqual(['other', 'a', 'b', 'c']);
    expect(mergeComposerHistory({ recent: ['a', 'b'], current: [] })).toEqual(['a', 'b']);
    expect(mergeComposerHistory({ recent: ['a', 'b'], current: ['a', 'a'] })).toEqual(['a', 'b', 'a']);
  });
});

describe('caret-line gating', () => {
  const text = 'first\nmiddle\nlast';
  function key(key: string, start: number, end = start, extra = {}) {
    return composerHistoryKeyAction({ key, text, selectionStart: start, selectionEnd: end, ...extra });
  }
  it('Up browses only on the first line and Down only on the last', () => {
    expect(key('ArrowUp', 3)).toBe('previous');
    expect(key('ArrowUp', 8)).toBeNull();
    expect(key('ArrowDown', 8)).toBeNull();
    expect(key('ArrowDown', text.length)).toBe('next');
  });
  it('allows copying/selecting a single boundary line but preserves spanning selections', () => {
    expect(key('ArrowUp', 0, 5)).toBe('previous');
    expect(key('ArrowUp', 0, 8)).toBeNull();
    expect(key('ArrowDown', 8, text.length)).toBeNull();
  });
  it('treats a backwards selection the same as a forwards one', () => {
    expect(key('ArrowUp', 5, 0)).toBe('previous');
    expect(key('ArrowUp', 8, 0)).toBeNull();
  });
  it('honors visual soft-wrap boundaries supplied by a DOM host', () => {
    expect(key('ArrowUp', 3, 3, { firstLine: false })).toBeNull();
    expect(key('ArrowDown', text.length, text.length, { lastLine: false })).toBeNull();
  });
  it.each(['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'isComposing', 'popupOpen'])('does not steal arrows or Escape with %s', (flag) => {
    expect(key('ArrowUp', 0, 0, { [flag]: true })).toBeNull();
    expect(key('ArrowDown', text.length, text.length, { [flag]: true })).toBeNull();
    expect(key('Escape', 8, 8, { [flag]: true })).toBeNull();
  });
  it('handles single-line and empty drafts, trailing newlines, and unrelated keys', () => {
    expect(composerHistoryKeyAction({ key: 'ArrowUp', text: '', selectionStart: 0, selectionEnd: 0 })).toBe('previous');
    expect(composerHistoryKeyAction({ key: 'ArrowDown', text: 'one\n', selectionStart: 4, selectionEnd: 4 })).toBe('next');
    expect(key('Escape', 8)).toBe('restore');
    expect(key('Enter', 0)).toBeNull();
  });
});


describe('accepted input projection for recall and bubbles', () => {
  it('replaces an optimistic typed answer with its saved result exactly once in either arrival order', () => {
    const optimistic = acceptedInputUserEvent({ input: { id: 'answer:ask', text: 'typed answer' }, toolUseId: 'ask' });
    const result: AgentEvent = { kind: 'tool_result', toolUseId: 'ask', content: JSON.stringify({ submitted: true, freeText: 'typed answer' }), isError: false };
    for (const events of [[optimistic, result], [result, optimistic]]) {
      const projected = projectAcceptedInputEvents({ events });
      expect(acceptedInputsFromMessages({ messages: [{ id: 'a', role: 'assistant', content: '', events: projected }] }).map(input => input.text)).toEqual(['typed answer']);
      expect(projectAcceptedInputEvents({ events: projected })).toEqual(projected);
      expect(projected.filter(event => event.kind === 'ext' && event.name === 'user_message')).toHaveLength(1);
    }
  });

  it('matches only the new steering event when a previous accepted input has identical text', () => {
    const earlier: AgentEvent = { kind: 'ext', name: 'user_message', data: { id: 'old', text: 'again' } };
    const wire: AgentEvent = { kind: 'ext', name: 'user_message', data: { id: 'wire', text: 'again' } };
    const optimistic = acceptedInputUserEvent({ input: { id: 'local', text: 'again' }, afterInputId: 'old' });
    for (const events of [[earlier, optimistic, wire], [earlier, wire, optimistic]]) {
      const projected = projectAcceptedInputEvents({ events });
      const inputs = acceptedInputsFromMessages({ messages: [{ id: 'a', role: 'assistant', content: '', events: projected }] });
      expect(inputs.map(input => input.id)).toEqual(['old', 'local']);
      expect(inputs.map(input => input.text)).toEqual(['again', 'again']);
      expect(inputs[1]?.aliases).toEqual(['wire']);
      expect(projectAcceptedInputEvents({ events: [...projected, wire] })).toEqual(projected);
    }
  });

  it('preserves distinct real receipts and projects constituent queued inputs instead of the merged prompt', () => {
    const events: AgentEvent[] = ['a', 'b'].map(id => ({ kind: 'ext', name: 'user_message', data: { id, text: 'same text' } }));
    expect(acceptedInputsFromMessages({ messages: [{ id: 'reply', role: 'assistant', content: '', events }] }).map(input => input.id)).toEqual(['a', 'b']);
    expect(acceptedInputsFromMessages({ messages: [{ id: 'merged', role: 'user', content: 'first\n\nsecond', events: [
      acceptedInputUserEvent({ input: { id: 'first', text: 'first' } }, { receipt: 'accepted' }),
      acceptedInputUserEvent({ input: { id: 'second', text: 'second' } }, { receipt: 'accepted' }),
    ] }] })).toEqual([{ id: 'first', text: 'first' }, { id: 'second', text: 'second' }]);
  });

  it('excludes unaccepted sends, declined/error results and malformed result text', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_result', toolUseId: 'declined', content: JSON.stringify({ submitted: false, freeText: 'not accepted' }), isError: false },
      { kind: 'tool_result', toolUseId: 'error', content: JSON.stringify({ submitted: true, freeText: 'not accepted' }), isError: true },
      { kind: 'tool_result', toolUseId: 'invalid', content: 'not json', isError: false },
    ];
    expect(acceptedInputsFromMessages({ messages: [
      { id: 'pending', role: 'user', content: 'unaccepted', inputPending: true },
      { id: 'reply', role: 'assistant', content: '', events },
    ] })).toEqual([]);
  });
});


it('reconciles several accepted steers whose wire receipts arrive together later', () => {
  const first = acceptedInputUserEvent({ input: { id: 'local-first', text: 'again' } });
  const second = acceptedInputUserEvent({ input: { id: 'local-second', text: 'again' }, afterInputId: 'local-first' });
  const wire: AgentEvent[] = ['wire-first', 'wire-second'].map(id => ({ kind: 'ext', name: 'user_message', data: { id, text: 'again' } }));
  const projected = projectAcceptedInputEvents({ events: [first, second, ...wire] });
  expect(acceptedInputsFromMessages({ messages: [{ id: 'a', role: 'assistant', content: '', events: projected }] }).map(input => input.id)).toEqual(['local-first', 'local-second']);
  expect(projectAcceptedInputEvents({ events: [...projected, ...wire] })).toEqual(projected);
});


it('queued_bubble_clears_only_on_consumption_receipt', () => {
  const queued: AgentEvent = { kind: 'ext', name: 'user_message', data: { id: 'wire', text: 'next', deliveryState: 'queued' } };
  const consumed: AgentEvent = { kind: 'ext', name: 'user_message', data: { id: 'wire', text: 'next', deliveryState: 'consumed' } };
  const optimistic = acceptedInputUserEvent({ input: { id: 'local', text: 'next' } });
  const read = (events: AgentEvent[]) => acceptedInputsFromMessages({ messages: [{ id: 'reply', role: 'assistant', content: '', events }] });
  expect(read([optimistic, queued])).toEqual([{ id: 'local', text: 'next', deliveryState: 'queued', aliases: ['wire'] }]);
  const projected = projectAcceptedInputEvents({ events: [optimistic, queued, { kind: 'text', text: 'work' }, consumed] });
  expect(read(projected)).toEqual([{ id: 'local', text: 'next', deliveryState: 'consumed', aliases: ['wire'] }]);
  expect(projected).toHaveLength(2);
  expect(projectAcceptedInputEvents({ events: [...projected, queued, consumed] })).toEqual(projected);
});


it('updates every constituent of a merged queued bubble on its shared consumption receipt', () => {
  const optimistic = acceptedInputUserEvent({ input: { id: 'merged', text: 'one\n\ntwo' },
    inputs: [{ id: 'one', text: 'one' }, { id: 'two', text: 'two' }] });
  const receipt = (deliveryState: 'queued' | 'consumed'): AgentEvent => ({ kind: 'ext', name: 'user_message', data: { id: 'wire', text: 'one\n\ntwo', deliveryState } });
  const queued = projectAcceptedInputEvents({ events: [optimistic, receipt('queued')] });
  const read = (events: AgentEvent[]) => acceptedInputsFromMessages({ messages: [{ id: 'reply', role: 'assistant', content: '', events }] });
  expect(read(queued).map(input => input.deliveryState)).toEqual(['queued', 'queued']);
  expect(read([...queued, receipt('consumed')]).map(input => input.deliveryState)).toEqual(['consumed', 'consumed']);
});
