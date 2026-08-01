// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PooledIframe } from './PooledIframe.js';
import { IframeKeepAliveProvider } from './IframeKeepAliveProvider.js';

describe('PooledIframe (client render)', () => {
  it('renders an iframe with the given src and forwards the ref', () => {
    const ref = createRef<HTMLIFrameElement>();
    const { container } = render(<PooledIframe ref={ref} cacheKey="a" src="about:blank" />);
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toBe('about:blank');
    expect(ref.current).toBe(iframe);
  });

  it('syncs plain attributes and style on re-render, appending px to unitless-length numbers', () => {
    const { container, rerender } = render(
      <PooledIframe cacheKey="a" src="about:blank" title="one" style={{ width: 10, opacity: 0.5 }} />,
    );
    let iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('title')).toBe('one');
    expect(iframe?.style.getPropertyValue('width')).toBe('10px');
    expect(iframe?.style.getPropertyValue('opacity')).toBe('0.5');

    rerender(<PooledIframe cacheKey="a" src="about:blank" title="two" />);
    iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('title')).toBe('two');
    expect(iframe?.style.getPropertyValue('width')).toBe('');
  });

  it('wires onLoad to the iframe onload handler', () => {
    const onLoad = vi.fn();
    const { container } = render(<PooledIframe cacheKey="a" src="about:blank" onLoad={onLoad} />);
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('keeps the same underlying iframe element across the child unmounting/remounting under a shared pool, un-parking it on reuse', () => {
    const ref1 = createRef<HTMLIFrameElement>();
    const ref2 = createRef<HTMLIFrameElement>();
    // The Provider itself must stay mounted across the swap — only its
    // child (PooledIframe) unmounts and remounts — since the pool's state
    // lives in the Provider's own refs and is destroyed with it.
    const { rerender } = render(
      <IframeKeepAliveProvider>
        <PooledIframe ref={ref1} cacheKey="shared" src="about:blank" />
      </IframeKeepAliveProvider>,
    );
    const capturedFirst = ref1.current;
    expect(capturedFirst).not.toBeNull();

    rerender(<IframeKeepAliveProvider>{null}</IframeKeepAliveProvider>);
    expect(capturedFirst?.getAttribute('aria-hidden')).toBe('true');

    rerender(
      <IframeKeepAliveProvider>
        <PooledIframe ref={ref2} cacheKey="shared" src="about:blank" />
      </IframeKeepAliveProvider>,
    );
    expect(ref2.current).toBe(capturedFirst);
    expect(capturedFirst?.hasAttribute('aria-hidden')).toBe(false);
    expect(capturedFirst?.hasAttribute('data-pool-active')).toBe(false);
  });

  it('releases the element from the pool on unmount', () => {
    const ref = createRef<HTMLIFrameElement>();
    let host: HTMLElement | null = null;
    const { unmount, container } = render(
      <IframeKeepAliveProvider>
        <PooledIframe ref={ref} cacheKey="release-me" src="about:blank" />
      </IframeKeepAliveProvider>,
    );
    host = container;
    const el = ref.current;
    unmount();
    expect(host.contains(el)).toBe(false);
  });
});

describe('PooledIframe — security attributes across pool reuse', () => {
  it('drops a sandbox applied by a previous mount when the frame is reused under the same cacheKey', () => {
    // The element is owned by the pool and deliberately survives unmount, but
    // the applied-attribute record used to be a `useRef` on the COMPONENT. A
    // remount therefore got a fresh empty record, the removal loop in
    // `syncIframeProps` iterated nothing, and the old `sandbox`/`allow` stayed
    // on the element while it was reused for different content.
    //
    // ONE provider across all three renders — a second `render()` would build a
    // second pool and hand out a fresh element, which is not the scenario.
    const { container, rerender } = render(
      <IframeKeepAliveProvider>
        <PooledIframe cacheKey="reused" src="https://a.example" sandbox="allow-scripts" allow="camera" />
      </IframeKeepAliveProvider>,
    );
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');

    // Unmount just the child; the pool parks the element rather than dropping it.
    rerender(<IframeKeepAliveProvider>{null}</IframeKeepAliveProvider>);
    // Remount under the SAME cacheKey for different content, without the
    // security attributes.
    rerender(
      <IframeKeepAliveProvider>
        <PooledIframe cacheKey="reused" src="https://b.example" />
      </IframeKeepAliveProvider>,
    );

    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('https://b.example');
    expect(frame?.getAttribute('sandbox')).toBeNull();
    expect(frame?.getAttribute('allow')).toBeNull();
  });

  it('still removes a stale attribute within a single mount', () => {
    const { container, rerender } = render(
      <PooledIframe cacheKey="same-mount" src="about:blank" sandbox="allow-scripts" />,
    );
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    rerender(<PooledIframe cacheKey="same-mount" src="about:blank" />);
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBeNull();
  });
});

