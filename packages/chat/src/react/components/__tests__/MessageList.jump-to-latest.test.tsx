import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { MessageList } from '../MessageList.js';

const messages: ChatMessage[] = [
  { id: '1', role: 'user', content: 'hi' },
  { id: '2', role: 'assistant', content: 'hello back', runStatus: 'succeeded' },
];

/** A transcript taller than its box, so "scrolled to 0" differs from "at the bottom". */
function overflowingList(initial: ChatMessage[] = messages) {
  const view = render(<MessageList messages={initial} />);
  const el = view.container.querySelector('.jini-message-list') as HTMLDivElement;
  Object.defineProperty(el, 'scrollHeight', { value: 300, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
  const scrollTo = vi.fn(({ top }: ScrollToOptions) => { el.scrollTop = top ?? 0; });
  el.scrollTo = scrollTo as unknown as typeof el.scrollTo;
  return { ...view, el, scrollTo };
}

function scrollList(el: HTMLElement, top: number) {
  el.scrollTop = top;
  fireEvent.scroll(el);
}

describe('MessageList "Jump to latest"', () => {
  it('is hidden while the transcript follows the newest message', () => {
    const { el } = overflowingList();
    scrollList(el, 200);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });

  it('appears once the user scrolls up and hides again back at the bottom', () => {
    const { el } = overflowingList();
    scrollList(el, 200);
    scrollList(el, 50);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
    scrollList(el, 200);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });

  it('scrolls to the newest message, hides, and resumes following new output', () => {
    const { el, scrollTo, rerender } = overflowingList();
    scrollList(el, 200);
    scrollList(el, 50);
    act(() => { screen.getByRole('button', { name: 'Jump to latest' }).click(); });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 300 }));
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    // Re-stuck: streamed output now follows to the bottom again.
    el.scrollTop = 120;
    rerender(<MessageList messages={[...messages, { id: '3', role: 'assistant', content: 'more', runStatus: 'running' }]} scrollIntent />);
    expect(el.scrollTop).toBe(300);
  });

  it('hides when the user sends a new message from a scrolled-up position', () => {
    const { el, rerender } = overflowingList();
    scrollList(el, 200);
    scrollList(el, 50);
    rerender(<MessageList messages={[...messages, { id: '3', role: 'user', content: 'next' }]} scrollIntent />);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });
});
