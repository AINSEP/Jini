// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EmbedChatHeader } from '../header.js';
import type { useEmbedChatHeader } from '../header.hooks.js';

describe('EmbedChatHeader injected hook', () => {
  const copy = { eyebrow: 'Eyebrow', cancel: 'Keep it', discard: 'Throw away', newThread: 'New thread' };
  const base = { title: 'Embedded chat', hasMessages: true, onReset: vi.fn(), keyboard: {} as never, copy };

  it('shows the discard confirmation when the injected hook reports confirming', () => {
    const cancel = vi.fn();
    const useFake = vi.fn(() => ({ confirming: true, cancel, requestReset: vi.fn(), confirmReset: vi.fn(), headerRef: createRef(), resetButtonRef: createRef() })) as unknown as typeof useEmbedChatHeader;
    render(<EmbedChatHeader {...base} useEmbedChatHeaderHook={useFake} />);
    expect(screen.getByRole('button', { name: 'Throw away' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(useFake).toHaveBeenCalledWith(expect.objectContaining({ hasMessages: true }));
  });

  it('shows the new-thread button and routes its click to the injected requestReset', () => {
    const requestReset = vi.fn();
    const useFake = (() => ({ confirming: false, cancel: vi.fn(), requestReset, confirmReset: vi.fn(), headerRef: createRef(), resetButtonRef: createRef() })) as unknown as typeof useEmbedChatHeader;
    render(<EmbedChatHeader {...base} useEmbedChatHeaderHook={useFake} />);
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
    expect(requestReset).toHaveBeenCalledTimes(1);
  });
});
