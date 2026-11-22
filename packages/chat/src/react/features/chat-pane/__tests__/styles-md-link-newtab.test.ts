import { describe, expect, it } from 'vitest';
import { CHAT_PANE_STYLES } from '../styles.js';

/**
 * The small arrow after a link to the owner's own site/admin (`MarkdownLink`) is an icon-only
 * control: it needs its own size and a visible keyboard focus ring, or it is a 11px target nobody
 * can see they have reached.
 */
describe('CHAT_PANE_STYLES — new-tab icon after an own link', () => {
  it('draws the icon as a small inline control sitting right after the link text', () => {
    const rule = /\.jini-chat-pane \.jini-md-link-newtab\s*\{([^}]*)\}/.exec(CHAT_PANE_STYLES)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*inline-flex/);
    expect(rule).toMatch(/text-decoration:\s*none/);
  });

  it('shows a focus ring when the icon is reached by keyboard', () => {
    const rule = /\.jini-chat-pane \.jini-md-link-newtab:focus-visible\s*\{([^}]*)\}/.exec(CHAT_PANE_STYLES)?.[1] ?? '';
    expect(rule).toMatch(/outline:\s*2px solid/);
  });
});
