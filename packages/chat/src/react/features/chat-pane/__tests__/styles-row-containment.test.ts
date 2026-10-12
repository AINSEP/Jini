/**
 * Guards the long-chat typing fix (owner report 2026-10-11): off-screen transcript rows must skip
 * style/layout via `content-visibility: auto`, or a host rule that invalidates the whole document
 * per keystroke costs ~50 ms per key on a ~2,000-tool-card transcript. jsdom has no layout, so this
 * pins the rule's text: the containment itself, a remembered intrinsic size (so scroll-to-bottom
 * settles on real heights), and the clip margin that keeps focus rings at a row's edge visible.
 */
import { describe, expect, it } from 'vitest';
import { CHAT_PANE_STYLES } from '../styles.js';

function supportsBlock(css: string): string {
  const start = css.indexOf('@supports (overflow-clip-margin: 8px)');
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(open, i + 1);
  }
  throw new Error('unterminated @supports block');
}

describe('transcript row containment', () => {
  it('skips off-screen message rows, keeping their last real height and room for focus rings', () => {
    const block = supportsBlock(CHAT_PANE_STYLES);
    const rule = /\.jini-chat-pane \.jini-message \{([^}]*)\}/.exec(block)?.[1] ?? '';
    expect(rule).toMatch(/content-visibility:\s*auto/);
    expect(rule).toMatch(/contain-intrinsic-size:\s*auto \d+px/);
    expect(rule).toMatch(/overflow-clip-margin:\s*8px/);
  });
});
