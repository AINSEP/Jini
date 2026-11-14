import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { MessageList } from '../MessageList.js';
import { CHAT_PANE_STYLES } from '../../features/chat-pane/styles.js';

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

/** The body of the first CSS rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
}

describe('MessageList "Jump to latest"', () => {
  it('is hidden while the transcript follows the newest message and nothing overflows', () => {
    render(<MessageList messages={messages} />);
    expect(screen.queryByRole('button', { name: /Jump to/ })).toBeNull();
  });

  // Owner 2026-11-13: the centred "↓ Jump to latest" pill covered a message mid-transcript. It is
  // an icon-only arrow at the list's bottom-right: down when scrolled away from the latest, up when
  // at the bottom with history above.
  it('is an icon-only arrow with no visible text, named for screen readers', () => {
    const { el } = overflowingList();
    scrollList(el, 200);
    scrollList(el, 50);
    const button = screen.getByRole('button', { name: 'Jump to latest' });
    expect(button.textContent?.trim()).toBe('');
    expect(button).toHaveAttribute('title', 'Jump to latest');
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('turns into an up arrow ("Jump to top") at the bottom of an overflowing transcript', () => {
    const { el, scrollTo } = overflowingList();
    scrollList(el, 200);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    const up = screen.getByRole('button', { name: 'Jump to top' });
    expect(up.textContent?.trim()).toBe('');
    act(() => { up.click(); });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    // Now away from the latest: the down arrow replaces it straight away.
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
  });

  it('is anchored bottom-right of the list, never centred over messages, with a 40px touch target', () => {
    const wrap = ruleBody(CHAT_PANE_STYLES, '.jini-message-list__jump');
    expect(wrap).toContain('justify-content: flex-end;');
    expect(wrap).not.toContain('justify-content: center;');
    // In the pane it is pinned to the body's bottom-right, just above the composer overlay. Sticky
    // was measured from the list's content box in Chrome, i.e. ABOVE its composer-sized bottom
    // padding, which floated it mid-transcript on phones.
    const inPane = ruleBody(CHAT_PANE_STYLES, '.jini-chat-pane__body .jini-message-list__jump');
    expect(inPane).toContain('position: absolute;');
    expect(inPane).toContain('right: 22px;');
    expect(inPane).toContain('bottom: calc(var(--jini-chat-controls-height, 240px) + 8px);');
    const btn = ruleBody(CHAT_PANE_STYLES, '.jini-message-list__jump-btn');
    expect(btn).toContain('width: 40px;');
    expect(btn).toContain('height: 40px;');
    expect(btn).toContain('border-radius: 50%;');
    expect(btn).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
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
