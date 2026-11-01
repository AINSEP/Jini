import { describe, expect, it } from 'vitest';
import { CHAT_PANE_STYLES } from '../styles.js';

/**
 * A tool row with no target argument (no `.op-meta` to fill the row) drew its expand chevron right
 * after the title instead of at the row's right edge, so a stack of rows had chevrons at different x.
 */
describe('CHAT_PANE_STYLES — tool row chevron', () => {
  it('pins .op-expand-chev to the right edge whether or not .op-meta is present', () => {
    const rule = /\.jini-chat-pane \.op-expand-chev\s*\{([^}]*)\}/.exec(CHAT_PANE_STYLES);
    expect(rule?.[1]).toMatch(/margin-left:\s*auto/);
  });
});
