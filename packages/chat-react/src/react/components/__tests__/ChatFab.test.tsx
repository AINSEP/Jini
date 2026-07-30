import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatFab } from '../ChatFab.js';

// jsdom's PointerEvent support is incomplete/absent depending on version (matching
// ui/src/react/__tests__/components/TooltipLayer.test.tsx's pattern); setPointerCapture/
// releasePointerCapture/hasPointerCapture aren't implemented in jsdom at all.
beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
      }
    }
    // @ts-expect-error -- test-environment polyfill
    globalThis.PointerEvent = PointerEventPolyfill;
  }
  if (!('setPointerCapture' in Element.prototype)) {
    // @ts-expect-error -- test-environment polyfill
    Element.prototype.setPointerCapture = () => {};
  }
  if (!('releasePointerCapture' in Element.prototype)) {
    // @ts-expect-error -- test-environment polyfill
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!('hasPointerCapture' in Element.prototype)) {
    // @ts-expect-error -- test-environment polyfill
    Element.prototype.hasPointerCapture = () => false;
  }
});

describe('ChatFab', () => {
  it('renders the closed state with the default label', () => {
    render(<ChatFab open={false} onToggle={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Show chat' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveClass('chat-fab');
    expect(button).not.toHaveClass('chat-fab-open');
    expect(button).toHaveTextContent('💬');
  });

  it('renders the open state with a custom label', () => {
    render(<ChatFab open onToggle={vi.fn()} label="workspace chat" />);
    const button = screen.getByRole('button', { name: 'Hide workspace chat' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveClass('chat-fab', 'chat-fab-open');
    expect(button).toHaveTextContent('×');
  });

  it('calls onToggle on a plain click', async () => {
    const onToggle = vi.fn();
    render(<ChatFab open={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onToggle on Enter and Space, and ignores other keys', () => {
    const onToggle = vi.fn();
    render(<ChatFab open={false} onToggle={onToggle} />);
    const button = screen.getByRole('button');

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(onToggle).not.toHaveBeenCalled();

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('has no inline position until dragged, and gains one once dragged past the threshold', () => {
    const onToggle = vi.fn();
    render(<ChatFab open={false} onToggle={onToggle} />);
    const button = screen.getByRole('button');
    button.getBoundingClientRect = () => ({
      left: 100,
      top: 200,
      width: 50,
      height: 40,
      right: 150,
      bottom: 240,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    }) as DOMRect;
    Object.defineProperty(button, 'offsetWidth', { configurable: true, value: 50 });
    Object.defineProperty(button, 'offsetHeight', { configurable: true, value: 40 });
    vi.spyOn(button, 'hasPointerCapture').mockReturnValue(true);

    expect(button.style.left).toBe('');

    act(() => button.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 210, pointerId: 1, bubbles: true })));
    act(() => button.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 215, pointerId: 1, bubbles: true })));
    act(() => button.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));

    expect(onToggle).not.toHaveBeenCalled();
    expect(button.style.left).toBe('120px');
    expect(button.style.top).toBe('205px');
    expect(button.style.right).toBe('auto');
    expect(button.style.bottom).toBe('auto');
  });
});
