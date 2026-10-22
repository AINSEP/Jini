import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { A2uiInterpreter, ComponentInstance, SurfaceSnapshot } from './protocol.js';

/**
 * Subscribes a component to one A2UI surface's root, re-rendering when its components or data
 * change (a message applied via `interpreter.applyAgentMessage` notifies for any surface — the
 * interpreter has no per-surface subscription granularity, so this hook re-reads the whole
 * surface on every notification and lets `useSyncExternalStore`'s reference-equality check skip
 * the render if this particular surface's components and data model are unchanged). Descendant
 * and binding updates must render even when the root object itself is unchanged.
 *
 * Returns `undefined` when the surface doesn't exist yet, or exists but has no `'root'`
 * component yet (a legal, "still streaming in" state per the interpreter's own `getRoot` doc).
 * @complexity O(n) time per snapshot read and O(n) retained space for n surface components.
 */
export function useA2uiSurfaceRoot({ interpreter, surfaceId }: { interpreter: A2uiInterpreter; surfaceId: string }): ComponentInstance | undefined {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const unsubscribe = interpreter.subscribe({ listener: () => onStoreChange() });
    return () => unsubscribe({});
  }, [interpreter]);
  const getSnapshot = useMemo(() => {
    let snapshot: SurfaceSnapshot | undefined;
    return () => {
      const current = interpreter.getSurface({ surfaceId });
      if (!current) {
        snapshot = undefined;
        return snapshot;
      }
      // getSurface returns a new wrapper around a mutable component map. Cache a copy,
      // comparing component identities and immutable data-model identity so repeated reads
      // stay stable and changes before subscription are still visible to React's recheck.
      let unchanged = snapshot !== undefined && snapshot.catalogId === current.catalogId
        && Object.is(snapshot.dataModel, current.dataModel) && snapshot.components.size === current.components.size;
      if (unchanged) {
        for (const [id, component] of current.components) {
          if (snapshot!.components.get(id) !== component) { unchanged = false; break; }
        }
      }
      if (!unchanged) snapshot = { ...current, components: new Map(current.components) };
      return snapshot;
    };
  }, [interpreter, surfaceId]);
  return useSyncExternalStore(subscribe, getSnapshot)?.components.get('root');
}
