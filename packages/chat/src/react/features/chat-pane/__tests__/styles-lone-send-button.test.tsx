import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Composer } from '../../../components/Composer.js';
import { useComposer } from '../../../hooks/useComposer.js';
import { CHAT_PANE_STYLES } from '../styles.js';

afterEach(cleanup);

// Regression for b1d7a7b7: the footer is space-between, so with no accessory controls (the public
// visitor chat) the send group is its only child and sat at the bottom-left.
describe('lone composer send button', () => {
  it('pushes the send group to the footer end when it is the only child', () => {
    const { result } = renderHook(() => useComposer());
    render(
      <div className="jini-chat-pane">
        <style>{CHAT_PANE_STYLES}</style>
        <Composer composer={result.current} onSend={() => {}} />
      </div>,
    );
    const sendGroup = screen.getByRole('button', { name: 'Send' }).closest('.jini-composer-send-group')!;

    expect(sendGroup.parentElement!.children).toHaveLength(1);
    // jsdom resolves the declaration but cannot lay out flex, so the margin is the observable.
    expect(getComputedStyle(sendGroup).marginLeft).toBe('auto');
  });

  // Owner, 2026-10-21: a fixed white icon on the text-strong fill was a blank white square in a dark host theme.
  it('draws the send icon in the panel colour so it inverts with the theme', () => {
    const { result } = renderHook(() => useComposer());
    render(
      <div className="jini-chat-pane">
        <style>{CHAT_PANE_STYLES}</style>
        <Composer composer={result.current} onSend={() => {}} />
      </div>,
    );
    const send = getComputedStyle(screen.getByRole('button', { name: 'Send' }));

    // Empty composer, so this is the disabled state; jsdom keeps var() unresolved, which is the point.
    // jsdom drops var() backgrounds, so the fills are checked on the stylesheet text.
    expect(send.color).toBe('var(--jini-chat-faint)');
    expect(CHAT_PANE_STYLES).toMatch(/\.jini-composer-send:disabled \{[^}]*background: var\(--jini-chat-subtle\);/);
    expect(CHAT_PANE_STYLES).toMatch(/\.jini-composer-send \{[^}]*color: var\(--jini-chat-panel\);[^}]*background: var\(--jini-chat-text-strong\);/);
  });

  // Owner, 2026-10-18: the model/effort cluster moved from beside the "+" to beside send.
  it('pushes the runtime picker slot to the trailing edge, right next to the send group', () => {
    const { result } = renderHook(() => useComposer());
    render(
      <div className="jini-chat-pane">
        <style>{CHAT_PANE_STYLES}</style>
        <Composer composer={result.current} onSend={() => {}} slots={{ footerAccessories: <span>picker</span> }} />
      </div>,
    );
    const accessories = screen.getByText('picker').closest('.jini-composer-footer-accessories')!;
    const sendGroup = screen.getByRole('button', { name: 'Send' }).closest('.jini-composer-send-group')!;

    const footer = accessories.parentElement!;
    // DOM order: the "+" side first, then the cluster, then send.
    expect(footer.lastElementChild).toBe(sendGroup);
    expect(accessories.nextElementSibling).toBe(sendGroup);
    expect(getComputedStyle(accessories).marginLeft).toBe('auto');
    expect(getComputedStyle(sendGroup).marginLeft).toBe('0px');
  });
});
