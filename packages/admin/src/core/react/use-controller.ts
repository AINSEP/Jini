import { useEffect, useState, useSyncExternalStore, useCallback } from 'react';
import type { DependencyList } from 'react';
import type { ControllerStore } from '../module/controller-store.js';
/** Factory runs after commit, never during render. Each effect attachment owns a fresh
 * controller, so StrictMode's cleanup/replay cannot revive a disposed controller. */
export function useController<C extends ControllerStore<unknown>>(
  { create, dependencies }: { create: () => C; dependencies: DependencyList },
  {
    start,
  }: { start?: (required: { controller: C }, optional?: Record<string, never>) => void } = {},
) {
  const [controller, setController] = useState<C | null>(null);
  useEffect(() => {
    const current = create();
    setController(current);
    start?.({ controller: current });
    return () => current.dispose();
    // Dependencies are explicitly supplied by the owning hook, like useMemo's contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  const subscribe = useCallback(
    (listener: () => void) => controller?.subscribe({ listener }) ?? (() => {}),
    [controller],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (controller?.getSnapshot() ?? null) as ReturnType<C['getSnapshot']> | null,
    () => null,
  );
  return { controller, snapshot };
}
