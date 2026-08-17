import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHAT_PANE_CONTROLS_HEIGHT_CSS_VAR,
  useChatPaneControlsHeight,
} from '../../hooks/useChatPaneControlsHeight.hooks.js';

function Harness() {
  const { rootRef, controlsRef } = useChatPaneControlsHeight();
  return (
    <section ref={rootRef as React.RefObject<HTMLElement>}>
      <div ref={controlsRef} data-testid="controls" />
    </section>
  );
}

describe('useChatPaneControlsHeight', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('publishes the controls element\'s real, live-measured height as a CSS var on the pane root', () => {
    // Reproduces the bug `styles.ts`'s own comment documents happened once already: a hardcoded
    // padding-bottom guess going stale the moment the composer's real content outgrows it. This
    // proves the reservation now tracks a REAL measurement instead of a number nobody kept in sync.
    type ResizeCallback = (entries: Array<{ contentRect: { height: number } }>) => void;
    const callbacks: ResizeCallback[] = [];
    class FakeResizeObserver {
      constructor(cb: ResizeCallback) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    const fireResize = (height: number) => {
      for (const cb of callbacks) cb([{ contentRect: { height } }]);
    };

    const { container } = render(<Harness />);
    const root = container.querySelector('section') as HTMLElement;
    expect(root.style.getPropertyValue(CHAT_PANE_CONTROLS_HEIGHT_CSS_VAR)).toBe('');

    // The composer grew (an attachment tray appeared, a multi-line draft wrapped) — the exact
    // scenario a flat 240px guess cannot see coming.
    fireResize(185.4);
    expect(root.style.getPropertyValue(CHAT_PANE_CONTROLS_HEIGHT_CSS_VAR)).toBe('186px');

    fireResize(302.1);
    expect(root.style.getPropertyValue(CHAT_PANE_CONTROLS_HEIGHT_CSS_VAR)).toBe('303px');
  });

  it('degrades to no-op (keeping the CSS fallback) when ResizeObserver is unavailable', () => {
    // @ts-expect-error -- deliberately simulating an environment without it (SSR, an unpolyfilled test env)
    delete globalThis.ResizeObserver;
    expect(() => render(<Harness />)).not.toThrow();
  });
});
