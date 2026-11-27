/**
 * @file `liveAnchorSelection` / `runFind` against a real (jsdom) document: the window's own text
 * selection is the anchor Chromium resumes a top-level search from, so `runFind` must clear THAT
 * selection — not a fake — before it asks the bridge to search. `find-rules.test.ts` covers the
 * no-DOM side (bare node, where there is no selection at all).
 */
import { afterEach, expect, it } from 'vitest';
import { liveAnchorSelection, runFind, type FindBridge } from '../find-target.js';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

it('returns the window document selection and runFind clears it before searching the top frame', () => {
  document.body.innerHTML = '<p id="text">hello world</p>';
  const range = document.createRange();
  range.selectNodeContents(document.getElementById('text')!);
  document.getSelection()!.addRange(range);
  expect(liveAnchorSelection()).toBe(document.getSelection());

  const searches: unknown[] = [];
  let rangesWhenSearched = -1;
  const bridge: FindBridge = {
    onFindToggle: () => () => {},
    findInPage: (request) => { rangesWhenSearched = document.getSelection()!.rangeCount; searches.push(request); },
    stopFindInPage: () => {},
    onFindResult: () => () => {},
  };
  runFind({ target: { kind: 'top' }, bridge, text: 'hello', options: { forward: true, findNext: false } });

  expect(searches).toEqual([{ text: 'hello', forward: true, findNext: false }]);
  expect(rangesWhenSearched).toBe(0);
});
