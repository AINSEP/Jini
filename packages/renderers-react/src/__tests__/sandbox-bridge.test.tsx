import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useSandboxBridge } from '../sandbox-bridge.js';
import type { SandboxBridgeMessage } from '../types.js';

function makeFakeIframe(): HTMLIFrameElement {
  const postMessage = vi.fn();
  return { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
}

function dispatchMessage(source: unknown, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
}

describe('useSandboxBridge', () => {
  it('post() is a no-op when the iframe is not mounted yet', () => {
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: null };
    const { result } = renderHook(() => useSandboxBridge({ iframeRef, handlers: {} }));
    expect(() => result.current.post({ type: 'ping' })).not.toThrow();
  });

  it('post() forwards to the iframe contentWindow with a "*" target origin by default', () => {
    const iframe = makeFakeIframe();
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: iframe };
    const { result } = renderHook(() => useSandboxBridge({ iframeRef, handlers: {} }));
    result.current.post({ type: 'ping', value: 1 });
    expect(iframe.contentWindow!.postMessage).toHaveBeenCalledWith({ type: 'ping', value: 1 }, '*');
  });

  it('post() uses a configured targetOrigin', () => {
    const iframe = makeFakeIframe();
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: iframe };
    const { result } = renderHook(() =>
      useSandboxBridge({ iframeRef, handlers: {}, targetOrigin: 'https://sandbox.test' }),
    );
    result.current.post({ type: 'ping' });
    expect(iframe.contentWindow!.postMessage).toHaveBeenCalledWith(
      { type: 'ping' },
      'https://sandbox.test',
    );
  });

  it('dispatches an inbound message from the tracked iframe to the matching handler', () => {
    const iframe = makeFakeIframe();
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: iframe };
    const onPing = vi.fn();
    renderHook(() => useSandboxBridge({ iframeRef, handlers: { ping: onPing } }));
    dispatchMessage(iframe.contentWindow, { type: 'ping', value: 42 });
    expect(onPing).toHaveBeenCalledWith({ type: 'ping', value: 42 });
  });

  it('ignores a message whose source is not the tracked iframe', () => {
    const iframe = makeFakeIframe();
    const other = makeFakeIframe();
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: iframe };
    const onPing = vi.fn();
    renderHook(() => useSandboxBridge({ iframeRef, handlers: { ping: onPing } }));
    dispatchMessage(other.contentWindow, { type: 'ping' });
    expect(onPing).not.toHaveBeenCalled();
  });

  it('ignores a message when there is no iframe mounted at all', () => {
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: null };
    const onPing = vi.fn();
    renderHook(() => useSandboxBridge({ iframeRef, handlers: { ping: onPing } }));
    dispatchMessage(null, { type: 'ping' });
    expect(onPing).not.toHaveBeenCalled();
  });

  it('ignores malformed message data (no type, or non-object) without throwing', () => {
    const iframe = makeFakeIframe();
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: iframe };
    const onPing = vi.fn();
    renderHook(() => useSandboxBridge({ iframeRef, handlers: { ping: onPing } }));
    expect(() => dispatchMessage(iframe.contentWindow, null)).not.toThrow();
    expect(() => dispatchMessage(iframe.contentWindow, 'not-an-object')).not.toThrow();
    expect(() => dispatchMessage(iframe.contentWindow, { value: 1 })).not.toThrow();
    expect(onPing).not.toHaveBeenCalled();
  });

  it('ignores a message type with no registered handler', () => {
    const iframe = makeFakeIframe();
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: iframe };
    renderHook(() => useSandboxBridge({ iframeRef, handlers: {} }));
    expect(() => dispatchMessage(iframe.contentWindow, { type: 'unknown' })).not.toThrow();
  });

  it('uses the latest handlers passed on rerender without re-attaching the listener', () => {
    const iframe = makeFakeIframe();
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: iframe };
    const addSpy = vi.spyOn(window, 'addEventListener');
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const { rerender } = renderHook(
      ({ handlers }: { handlers: Record<string, (m: SandboxBridgeMessage) => void> }) =>
        useSandboxBridge({ iframeRef, handlers }),
      { initialProps: { handlers: { ping: firstHandler } } },
    );
    const messageListenerCalls = addSpy.mock.calls.filter(([type]) => type === 'message').length;
    rerender({ handlers: { ping: secondHandler } });
    const messageListenerCallsAfter = addSpy.mock.calls.filter(([type]) => type === 'message').length;
    expect(messageListenerCallsAfter).toBe(messageListenerCalls);

    dispatchMessage(iframe.contentWindow, { type: 'ping' });
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
    addSpy.mockRestore();
  });

  it('removes its message listener on unmount', () => {
    const iframe = makeFakeIframe();
    const iframeRef: RefObject<HTMLIFrameElement | null> = { current: iframe };
    const onPing = vi.fn();
    const { unmount } = renderHook(() => useSandboxBridge({ iframeRef, handlers: { ping: onPing } }));
    unmount();
    dispatchMessage(iframe.contentWindow, { type: 'ping' });
    expect(onPing).not.toHaveBeenCalled();
  });
});
