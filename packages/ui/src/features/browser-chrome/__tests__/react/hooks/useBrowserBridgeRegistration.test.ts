import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBrowserBridgeRegistration, useWiredBrowserBridgeRegistration } from '../../../react/hooks/useBrowserBridgeRegistration.js';
import type { BrowserTabHandle } from '../../../types.js';
import type { BrowserBridgeRegistrationPort } from '../../../ports.js';

function makeHandle(url: string): BrowserTabHandle {
  return { isEmbeddedSurfaceAvailable: true, getURL: () => url };
}

describe('useBrowserBridgeRegistration', () => {
  it('does nothing when scopeKey is undefined', () => {
    const registerBrowserHandle = vi.fn();
    renderHook(() => useBrowserBridgeRegistration(undefined, makeHandle('https://a.com'), { bridgeRegistration: { registerBrowserHandle } }));
    expect(registerBrowserHandle).not.toHaveBeenCalled();
  });

  it('registers on mount and unregisters on unmount', () => {
    const registerBrowserHandle = vi.fn();
    const handle = makeHandle('https://a.com');
    const { unmount } = renderHook(() =>
      useBrowserBridgeRegistration('tab-1', handle, { bridgeRegistration: { registerBrowserHandle } }));

    expect(registerBrowserHandle).toHaveBeenCalledWith('tab-1', handle);

    unmount();
    expect(registerBrowserHandle).toHaveBeenLastCalledWith('tab-1', null);
  });

  it('re-registers when the handle identity changes', () => {
    const registerBrowserHandle = vi.fn();
    const port: BrowserBridgeRegistrationPort = { registerBrowserHandle };
    const { rerender } = renderHook(
      ({ handle }) => useBrowserBridgeRegistration('tab-1', handle, { bridgeRegistration: port }),
      { initialProps: { handle: makeHandle('https://a.com') } },
    );
    expect(registerBrowserHandle).toHaveBeenCalledTimes(1);

    const nextHandle = makeHandle('https://b.com');
    rerender({ handle: nextHandle });
    // unregister of the previous handle, then register of the new one.
    expect(registerBrowserHandle).toHaveBeenCalledWith('tab-1', null);
    expect(registerBrowserHandle).toHaveBeenLastCalledWith('tab-1', nextHandle);
  });

  it('re-registers under the new scopeKey when scopeKey changes', () => {
    const registerBrowserHandle = vi.fn();
    const handle = makeHandle('https://a.com');
    const { rerender } = renderHook(
      ({ scopeKey }) => useBrowserBridgeRegistration(scopeKey, handle, { bridgeRegistration: { registerBrowserHandle } }),
      { initialProps: { scopeKey: 'tab-1' } },
    );
    rerender({ scopeKey: 'tab-2' });
    expect(registerBrowserHandle).toHaveBeenCalledWith('tab-1', null);
    expect(registerBrowserHandle).toHaveBeenLastCalledWith('tab-2', handle);
  });
});

describe('useWiredBrowserBridgeRegistration', () => {
  it('binds the no-op bridge registration port and never throws', () => {
    const handle = makeHandle('https://a.com');
    const { unmount, rerender } = renderHook(
      ({ h }: { h: BrowserTabHandle | null }) => useWiredBrowserBridgeRegistration({ scopeKey: 'tab-1', handle: h }),
      { initialProps: { h: handle } },
    );
    rerender({ h: makeHandle('https://b.com') });
    expect(() => unmount()).not.toThrow();
  });
});
