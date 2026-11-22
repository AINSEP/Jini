import type { ReactNode } from 'react';
import { DEFAULT_MAX_MOUNTED_IFRAMES } from '../../constants.js';
import { useIframeKeepAliveProvider } from './IframeKeepAliveProvider.hooks.js';
import { IframeKeepAliveContext } from '../pool-context.js';

interface IframeKeepAliveProviderProps {
  children: ReactNode;
  /** Maximum iframes kept mounted (active + parked) at once. Defaults to `DEFAULT_MAX_MOUNTED_IFRAMES`. */
  maxMounted?: number | undefined;
}

/**
 * Caps how many iframes stay mounted at once: attached iframes go live under
 * their host element; released ones are parked in a mounted pool container (hidden, inert)
 * instead of destroyed, so revisiting the same key skips a reload; least-
 * recently-used parked entries are evicted once the pool exceeds
 * `maxMounted`. Active entries are never evicted.
 */
export function IframeKeepAliveProvider({
  children,
  maxMounted = DEFAULT_MAX_MOUNTED_IFRAMES, useIframeKeepAliveProviderHook = useIframeKeepAliveProvider,
}: IframeKeepAliveProviderProps & { useIframeKeepAliveProviderHook?: typeof useIframeKeepAliveProvider }) {
  const { parkedHostRef, pool } = useIframeKeepAliveProviderHook({ maxMounted });

  return (
    <IframeKeepAliveContext.Provider value={pool}>
      {children}
      <div ref={parkedHostRef} className="jini-iframe-keep-alive-pool" aria-hidden="true" />
    </IframeKeepAliveContext.Provider>
  );
}
