import { describe, expect, it } from 'vitest';
import { CHAT_PANE_STYLES } from '../styles.js';

/**
 * The tool-row spinner (`<Icon name="spinner">`, class `jini-icon-spin`) and the running title's
 * shimmer sat still in every host that injects only these styles: their keyframes lived in
 * `reference.css`, which no host imports.
 */
describe('CHAT_PANE_STYLES — running indicators actually move', () => {
  it('animates .jini-icon-spin with keyframes defined in the injected styles', () => {
    const rule = /([^{}]*\.jini-icon-spin[^{}]*)\{([^}]*)\}/.exec(CHAT_PANE_STYLES);
    expect(rule?.[2]).toMatch(/animation:\s*jini-chat-spin\b[^;]*infinite/);
    expect(CHAT_PANE_STYLES).toMatch(/@keyframes jini-chat-spin\s*\{/);
  });

  it('pulses the shimmer text instead of a static opacity', () => {
    const rule = /\.jini-chat-pane \.shimmer-text\s*\{([^}]*)\}/.exec(CHAT_PANE_STYLES);
    expect(rule?.[1]).toMatch(/animation:\s*jini-chat-shimmer\b[^;]*infinite/);
    expect(CHAT_PANE_STYLES).toMatch(/@keyframes jini-chat-shimmer\s*\{/);
  });
});
