import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useIframeKeepAlivePool } from '../hooks/useIframeKeepAlivePool.js';
import { setForwardedRef, syncIframeProps, type PooledIframeProps } from '../dom-sync.js';

const subscribeToNoopStore = () => () => {};
const getClientSnapshot = () => false;
const getServerSnapshot = () => true;

/**
 * Which attributes/style keys are currently applied to a given pooled iframe,
 * tracked against the ELEMENT rather than the component.
 *
 * `syncIframeProps` removes a stale attribute by iterating the set it is handed.
 * That set used to be a `useRef` on the component — but the element is owned by
 * the pool, keyed by `cacheKey`, and deliberately SURVIVES unmount. So a remount
 * got a fresh empty set, the removal loop iterated nothing, and a `sandbox` or
 * `allow` applied by the previous mount stayed on the element while it was
 * reused for a different `src`. Security attributes silently persisting onto
 * different content is the whole hazard; keying the record to the element makes
 * the record live exactly as long as the thing it describes.
 *
 * A `WeakMap` so a genuinely evicted iframe's record is collected with it.
 */
const appliedByFrame = new WeakMap<HTMLIFrameElement, { attributes: Set<string>; styleKeys: Set<string> }>();

function appliedFor(frame: HTMLIFrameElement): { attributes: Set<string>; styleKeys: Set<string> } {
  let record = appliedByFrame.get(frame);
  if (!record) {
    record = { attributes: new Set<string>(), styleKeys: new Set<string>() };
    appliedByFrame.set(frame, record);
  }
  return record;
}

function useIsServerRender() {
  return useSyncExternalStore(subscribeToNoopStore, getClientSnapshot, getServerSnapshot);
}

/**
 * An `<iframe>` whose element is kept alive in the nearest
 * `IframeKeepAlivePoolProvider` (or a local single-entry fallback pool if
 * none is mounted) across unmount/remount under the same `cacheKey`,
 * instead of reloading. Renders a plain `<iframe>` during SSR, since the
 * pool is a client-only concept.
 */
export const PooledIframe = forwardRef<HTMLIFrameElement, PooledIframeProps>(function PooledIframe({
  cacheKey,
  src,
  ...props
}, forwardedRef) {
  const isServerRender = useIsServerRender();
  if (isServerRender) return <iframe {...props} src={src} />;
  return (
    <ClientPooledIframe
      ref={forwardedRef}
      cacheKey={cacheKey}
      src={src}
      {...props}
    />
  );
});

const ClientPooledIframe = forwardRef<HTMLIFrameElement, PooledIframeProps>(function ClientPooledIframe({
  cacheKey,
  src,
  ...props
}, forwardedRef) {
  const pool = useIframeKeepAlivePool();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const propsRef = useRef<PooledIframeProps>({ cacheKey, src, ...props });
  propsRef.current = { cacheKey, src, ...props };

  useLayoutEffect(() => {
    // `hostRef` attaches to the unconditionally-rendered `<span>` below during
    // the same commit, before any layout effect runs — it's always set here.
    const frame = pool.attach(cacheKey, hostRef.current!, () => document.createElement('iframe'));
    iframeRef.current = frame;
    return () => {
      setForwardedRef(forwardedRef, null);
      iframeRef.current = null;
      pool.release(cacheKey);
    };
  }, [cacheKey, pool, forwardedRef]);

  useLayoutEffect(() => {
    // The effect above always runs first (declared earlier in the same
    // component, same commit) and sets `iframeRef.current` before this one
    // ever runs, so it's always populated here.
    const frame = iframeRef.current!;
    // Keyed to the ELEMENT, not this component — see `appliedByFrame`.
    const applied = appliedFor(frame);
    syncIframeProps(frame, propsRef.current, applied.attributes, applied.styleKeys);
    setForwardedRef(forwardedRef, frame);
  });

  return <span ref={hostRef} className="pooled-iframe-host" />;
});
