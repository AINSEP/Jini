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

  it('keeps the runtime picker slot beside the leading controls and the send group at the end', () => {
    const { result } = renderHook(() => useComposer());
    render(
      <div className="jini-chat-pane">
        <style>{CHAT_PANE_STYLES}</style>
        <Composer composer={result.current} onSend={() => {}} slots={{ footerAccessories: <span>picker</span> }} />
      </div>,
    );
    const accessories = screen.getByText('picker').closest('.jini-composer-footer-accessories')!;
    const sendGroup = screen.getByRole('button', { name: 'Send' }).closest('.jini-composer-send-group')!;

    expect(getComputedStyle(accessories).marginLeft).not.toBe('auto');
    expect(getComputedStyle(sendGroup).marginLeft).toBe('auto');
  });
});
