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
// rendered test (see packages/ui/archived provenance ledger's 2026-07-22 dated entry;
// same "extract into a directly-testable pure function" precedent as
// `@jini-ai/mcp`'s `oauth.ts` readCappedText).
export function resolveGlobalKeydownTarget(
  { target }: { target: 'window' | 'document' },
  { globals = globalThis }: { globals?: { window?: EventTarget; document?: EventTarget } } = {},
): EventTarget | undefined {
  return target === 'document' ? globals.document : globals.window;
}

export interface UseGlobalKeydownOptions {
  resolveTarget?: (requiredArgs: { target: 'window' | 'document' }) => EventTarget | undefined;
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
  { handler }: { handler: (event: KeyboardEvent) => void },
  options: UseGlobalKeydownOptions = {},
): void {
  const { enabled = true, target = 'window', capture = false, resolveTarget = resolveGlobalKeydownTarget } = options;

  // Latest-ref indirection so callers don't need to memoize `handler` for
  // the listener effect below to stay attached with fresh behavior.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    const eventTarget = resolveTarget({ target });
    // A host may intentionally provide no target while its surface is detached.
    if (typeof eventTarget === 'undefined') return;

    function onKeyDown(event: KeyboardEvent) {
      handlerRef.current(event);
    }

    eventTarget.addEventListener('keydown', onKeyDown as EventListener, capture);
    return () => eventTarget.removeEventListener('keydown', onKeyDown as EventListener, capture);
  }, [enabled, target, capture, resolveTarget]);
}
