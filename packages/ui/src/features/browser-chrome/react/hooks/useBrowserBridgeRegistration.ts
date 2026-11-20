import { useEffect, useRef } from 'react';
import type { BrowserTabHandle } from '../../types.js';
import type { BrowserBridgeRegistrationPort } from '../../ports.js';
import { createNoopBrowserBridgeRegistration } from '../../dependencies.js';

/**
 * Registers/unregisters a live browser tab's handle with a host-supplied
 * bridge whenever `scopeKey` or `handle` changes, and unregisters on
 * unmount. Mirrors the origin's `registerBrandBrowser` effect, generalized:
 * this hook only owns the register-on-mount/unregister-on-unmount lifecycle,
 * never what the handle is used for.
 */
export function useBrowserBridgeRegistration(
  scopeKey: string | undefined,
  handle: BrowserTabHandle | null,
  dependencies: { bridgeRegistration: BrowserBridgeRegistrationPort },
): void {
  const bridgeRef = useRef(dependencies.bridgeRegistration);
  bridgeRef.current = dependencies.bridgeRegistration;

  useEffect(() => {
    if (!scopeKey) return undefined;
    bridgeRef.current.registerBrowserHandle(scopeKey, handle);
    return () => bridgeRef.current.registerBrowserHandle(scopeKey, null);
  }, [scopeKey, handle]);
}

// Module-level singleton no-op — see the wirer's doc comment below.
const defaultBridgeRegistration: BrowserBridgeRegistrationPort = createNoopBrowserBridgeRegistration();

/**
 * Production wiring for `useBrowserBridgeRegistration`. Unlike
 * `useWiredBrowserHistory`, there is no generic "real" default for this
 * port — registering a live browser tab's handle only means something in
 * the context of a host's own external bridge, which by definition this
 * package can't know about (see `ports.ts`'s doc comment). This wirer binds
 * the no-op from `dependencies.ts`, i.e. "do nothing" is the correct
 * zero-arg production default. A host that actually wants bridge
 * registration supplies its own port and calls
 * `useBrowserBridgeRegistration` directly instead of this wirer — the same
 * swappable-port carve-out as a test double, just for a real host
 * implementation instead.
 */
export function useWiredBrowserBridgeRegistration({ scopeKey, handle }: { scopeKey: string | undefined; handle: BrowserTabHandle | null }, _optional = {}): void {
  useBrowserBridgeRegistration(scopeKey, handle, { bridgeRegistration: defaultBridgeRegistration });
}
