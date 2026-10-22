import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
/** StrictMode gets a fresh effect-owned controller. Scope changes drop old data synchronously,
 * before the replacement effect runs; retired controllers abort requests and unsubscribe refresh. */
export function usePeopleController<S, C extends {
  getSnapshot(required?: Record<string, never>, optional?: Record<string, never>): S;
  subscribe(required: { listener: () => void }, optional?: Record<string, never>): () => void;
  dispose(required: Record<string, never>, optional?: Record<string, never>): void;
}>({ scope, key, create, start }: { scope: object; key: string; create: () => C; start: (controller: C) => void }, _optional: Record<string, never> = {}) {
  const [attachment, setAttachment] = useState<{ scope: object; key: string; controller: C } | null>(null);
  const controller = attachment?.scope === scope && attachment.key === key ? attachment.controller : null;
  useEffect(() => {
    const current = create(); setAttachment({ scope, key, controller: current }); start(current);
    return () => current.dispose({});
    // create/start are render closures; scope and key encode their entire injected dependency set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, key]);
  const subscribe = useCallback((listener: () => void) => controller?.subscribe({ listener }) ?? (() => {}), [controller]);
  const read = useCallback(() => controller?.getSnapshot({}) ?? null, [controller]);
  const state = useSyncExternalStore(subscribe, read, () => null);
  return { controller, state };
}
