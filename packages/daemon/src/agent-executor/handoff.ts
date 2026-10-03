import {
  type RuntimeAgentDef,
  type RuntimeLockHold,
} from '@jini-ai/agent-runtime';

/**
 * Phase 7: acquires a `runtimeLock` def's process-global mutex before `buildArgs` runs — see
 * `RuntimeLock`'s own doc for the concrete race. A no-op (`undefined`) for the 23 of 24 defs with no
 * `runtimeLock` declared.
 */
export async function acquireRuntimeLockIfConfigured(def: RuntimeAgentDef, model: string | undefined): Promise<RuntimeLockHold | undefined> {
  return def.runtimeLock?.acquire({ model });
}

/** Phase 14: starts a `runtimeLock` def's handoff watcher once a live process exists to consume the locked side effect — a no-op when the def declared no `waitForHandoff`. Deliberately not awaited; see `RuntimeLockHold.waitForHandoff`'s own doc. */
export function armHandoffWatcher({ runtimeLockHold, handoffInput, release }: { readonly runtimeLockHold: RuntimeLockHold | undefined; readonly handoffInput: { readonly logFilePath: string | undefined; readonly model: string | undefined; readonly processExited: AbortSignal }; readonly release: () => void }
): void {
  if (!runtimeLockHold?.waitForHandoff) return;
  void runtimeLockHold.waitForHandoff(handoffInput).then(release, release);
}
