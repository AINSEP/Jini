// Shared "run this keydown handler for as long as the feature is active"
// plumbing. useAssetGridKeyboardShortcuts (asset-grid) and
// useAnnotationKeyboardShortcuts (annotation-canvas, this package's own `./renderers` subpath)
// both wrote the identical shape: bail out of the effect while an `active`
// flag is false, otherwise attach one `window` keydown listener and remove it
// on cleanup/deactivation. useSketchDomEnhancements (sketch-editor) wrote the
// same lifecycle-scoped-listener shape twice more, on `document` with the
// capture phase, to win a race against a third-party library's own
// listeners. What's shared across all of these is the subscribe/enable/
// cleanup plumbing — which keys mean what stays entirely feature-owned in the
// `handler` callback passed in.

import { useEffect, useRef } from 'react';

// Resolves which global to attach the listener to. Exported (previously
// inlined in the effect below) so the "target unavailable" (SSR) branch has
// a direct unit test — driving it through a real `renderHook` mount hits
// React DOM internals that themselves dereference `window` well before this
// hook's own effect ever runs, making that branch unreachable via a
// rendered test (see packages/ui/source-map.md's 2026-07-22 dated entry;
// same "extract into a directly-testable pure function" precedent as
// `@jini-ai/mcp`'s `oauth.ts` readCappedText).
export function resolveGlobalKeydownTarget(target: 'window' | 'document'): EventTarget | undefined {
  return target === 'document' ? globalThis.document : globalThis.window;
}

export interface UseGlobalKeydownOptions {
  /** Skip attaching the listener while `false` (e.g. only while a surface is active/mounted-and-open). Defaults to `true`. */
  enabled?: boolean;
  /** Listener target. Defaults to `'window'`. */
  target?: 'window' | 'document';
  /** Attach in the capture phase — needed to run before a nested/portaled surface's own listeners. Defaults to `false`. */
  capture?: boolean;
}

/**
 * Attaches `handler` as a `keydown` listener for as long as `enabled` stays
 * `true`, removing it on cleanup or when `enabled` flips to `false`. A no-op
 * outside the browser (SSR).
 */
export function useGlobalKeydown(
  handler: (event: KeyboardEvent) => void,
  options: UseGlobalKeydownOptions = {},
): void {
  const { enabled = true, target = 'window', capture = false } = options;

  // Latest-ref indirection so callers don't need to memoize `handler` for
  // the listener effect below to stay attached with fresh behavior.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    const eventTarget = resolveGlobalKeydownTarget(target);
    // `resolveGlobalKeydownTarget` itself has a direct, real test proving
    // it CAN return `undefined` (see this file's own test). This call
    // site's guard against that, though, is empirically and structurally
    // unreachable through any real mount: `useEffect` bodies only ever run
    // client-side, after React has already committed real DOM nodes via
    // `ReactDOM` — which itself requires `window` (and, for a 'document'
    // target, `document`) to already exist. There is no real browser
    // session in which this hook's effect runs at all while its own
    // resolved target has vanished. See packages/ui/source-map.md's
    // 2026-07-22 dated entry.
    if (typeof eventTarget === 'undefined') return;

    function onKeyDown(event: KeyboardEvent) {
      handlerRef.current(event);
    }

    eventTarget.addEventListener('keydown', onKeyDown as EventListener, capture);
    return () => eventTarget.removeEventListener('keydown', onKeyDown as EventListener, capture);
  }, [enabled, target, capture]);
}
