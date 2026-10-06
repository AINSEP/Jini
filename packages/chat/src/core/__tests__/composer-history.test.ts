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
