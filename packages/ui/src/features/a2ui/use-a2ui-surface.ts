import { useCallback, useSyncExternalStore } from 'react';
import type { A2uiInterpreter, ComponentInstance } from './protocol.js';

/**
 * Subscribes a component to one A2UI surface's root, re-rendering whenever the interpreter
 * notifies (a message applied via `interpreter.applyAgentMessage` touched any surface — the
 * interpreter has no per-surface subscription granularity, so this hook re-reads `getRoot` on
 * every notification and lets `useSyncExternalStore`'s reference-equality check skip the render
 * if this particular surface's root object is unchanged).
 *
 * Returns `undefined` when the surface doesn't exist yet, or exists but has no `'root'`
 * component yet (a legal, "still streaming in" state per the interpreter's own `getRoot` doc).
 */
export function useA2uiSurfaceRoot(interpreter: A2uiInterpreter, surfaceId: string): ComponentInstance | undefined {
  const subscribe = useCallback((onStoreChange: () => void) => interpreter.subscribe(onStoreChange), [interpreter]);
  const getSnapshot = useCallback(() => interpreter.getRoot(surfaceId), [interpreter, surfaceId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
