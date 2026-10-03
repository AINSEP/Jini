/**
 * Generalized from OD `apps/packaged/src/launch.ts`'s
 * `claimPackagedSingleInstanceLock` — the only OD-specific thing about the
 * original was its name and the namespace-scoped paths threaded alongside it
 * elsewhere in that file. The lock mechanism itself was already generic.
 */

export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  onSecondInstance({ listener }: { listener: () => void }): void;
}

/** Bound to one host app instance, matching how `WindowLifecyclePort`/`ProtocolHandlerPort` are bound at construction rather than taking the host handle per call. */
export interface SingleInstanceLockPort {
  claim({ onSecondInstance }: { onSecondInstance: () => void }): boolean;
}

export function claimSingleInstanceLock({ app, onSecondInstance }: { app: SingleInstanceApp; onSecondInstance: () => void }): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.onSecondInstance({ listener: onSecondInstance });
  return true;
}

export function createSingleInstanceLockPort({ app }: { app: SingleInstanceApp }): SingleInstanceLockPort {
  return { claim: ({ onSecondInstance }) => claimSingleInstanceLock({ app, onSecondInstance }) };
}
