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

  // Owner bug 11-01: a long name ("Content Read Content…") squeezed the target out entirely — the
  // target was `flex: 1` (basis 0) beside a title that would not shrink. The target keeps its own
  // width up to a cap and the name truncates instead.
  it('lets the name truncate and keeps the target its own width up to a cap', () => {
    const title = /\.jini-chat-pane \.op-title\s*\{([^}]*)\}/.exec(CHAT_PANE_STYLES)?.[1] ?? '';
    const meta = /\.jini-chat-pane \.op-meta\.op-target\s*\{([^}]*)\}/.exec(CHAT_PANE_STYLES)?.[1] ?? '';
    expect(title).toMatch(/min-width:\s*0/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
    expect(title).not.toMatch(/flex-shrink:\s*0/);
    expect(meta).toMatch(/flex:\s*0 0 auto/);
    expect(meta).toMatch(/max-width:\s*\d+%/);
  });

  // Owner bug 11-01 (ui-look-4): the row hides its "Tool call · " prefix visually (it ate half a ~333px
  // dock row) but keeps it in the DOM for screen readers — clipped, never display:none.
  it('hides the tool row prefix visually without removing it from the accessibility tree', () => {
    const rule = /\.jini-chat-pane \.op-sr-prefix\s*\{([^}]*)\}/.exec(CHAT_PANE_STYLES)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(rule).not.toMatch(/display:\s*none/);
  });
});
