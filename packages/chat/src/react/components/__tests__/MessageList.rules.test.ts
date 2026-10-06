import { describe, expect, it } from 'vitest';
import { nextStickToBottom } from '../MessageList.rules.js';

describe('nextStickToBottom', () => {
  const box = (scrollTop: number, scrollHeight = 500) => ({ scrollTop, scrollHeight, clientHeight: 100 });

  it('re-sticks whenever the transcript is at the bottom, even if it was unstuck', () => {
    expect(nextStickToBottom(box(400), { wasSticking: false, previousScrollTop: 0 })).toBe(true);
  });

  it('unsticks when the position moved up', () => {
    expect(nextStickToBottom(box(150), { wasSticking: true, previousScrollTop: 200 })).toBe(false);
  });

  it('keeps sticking when the position did not move but the content grew past it', () => {
    expect(nextStickToBottom(box(200), { wasSticking: true, previousScrollTop: 200 })).toBe(true);
  });

  it('stays unstuck when the user scrolls down but not all the way', () => {
    expect(nextStickToBottom(box(300), { wasSticking: false, previousScrollTop: 100 })).toBe(false);
  });
});
