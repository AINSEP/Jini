import { useSyncExternalStore, useEffect, useCallback } from 'react';
import type { createOverlayController } from './overlays.js';
export interface OverlayHostProps {
  readonly controller: ReturnType<typeof createOverlayController>;
}
export function useOverlayHost(
  { controller }: OverlayHostProps,
  _optional: Record<string, never> = {},
) {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe({ listener }),
    [controller],
  );
  const snapshot = useSyncExternalStore(subscribe, controller.getSnapshot, controller.getSnapshot);
  // Host unmount cancels a waiting service call but keeps the controller replay-safe.
  useEffect(() => () => controller.cancel(), [controller]);
  return snapshot.entries.map((entry) => ({ id: entry.id, content: entry.render() }));
}
