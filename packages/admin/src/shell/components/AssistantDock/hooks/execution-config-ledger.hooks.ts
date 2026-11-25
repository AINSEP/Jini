import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";

import type { CachedLoader, FetchQueryAdapter } from "@jini-ai/core/fetch";
import { isAbortError } from "@jini-ai/core/text";

export const EXECUTION_CONFIG_MAX_AGE_MS = 5_000;

type ExecutionLedgerState = {
  executionConfigRef: React.MutableRefObject<ExecutionConfig>;
  localWriteRef: React.MutableRefObject<number>;
  lifecycleRef: React.MutableRefObject<AbortController | null>;
  refreshGeneration: React.MutableRefObject<number>;
  lastLoadedAt: React.MutableRefObject<number | null>;
  activeRefresh: React.MutableRefObject<Promise<ExecutionConfig> | null>;
  setExecutionConfigState: React.Dispatch<React.SetStateAction<ExecutionConfig>>;
  setConfigLoaded: React.Dispatch<React.SetStateAction<boolean>>;
};

function refreshExecutionConfigRead(
  { state, configLoader, retry }: { state: ExecutionLedgerState; configLoader: CachedLoader<{ config: ExecutionConfig; loadedAt: number }>; retry: Parameters<typeof useExecutionConfigLedger>[0]["retry"] },
  _options: Record<string, never> = {},
): Promise<ExecutionConfig> {
  const { lifecycleRef, refreshGeneration, localWriteRef, lastLoadedAt, executionConfigRef, setExecutionConfigState, setConfigLoaded, activeRefresh } = state;
  const controller = lifecycleRef.current;
  if (!controller) throw new Error("assistant dock execution config lifecycle is missing");
  refreshGeneration.current += 1;
  const generation = refreshGeneration.current;
  const writesAtStart = localWriteRef.current;
  // A refresh notification invalidates the old read even if this request fails. Otherwise Send
  // could reuse a recent cache entry after Settings told us its saved value had changed.
  lastLoadedAt.current = null;
  // Retried while the API is unreachable: the dock mounts once per session, so a load during
  // a dev-API restart must recover without a page reload. A local write or newer refresh makes
  // this response obsolete; unlike the old boolean guard, it does not block ALL future reads.
  const pending = retry({ load: () => configLoader.load(), signal: controller.signal })
    .then(({ config, loadedAt }) => {
      if (controller.signal.aborted || generation !== refreshGeneration.current || writesAtStart !== localWriteRef.current) {
        return executionConfigRef.current;
      }
      executionConfigRef.current = config;
      setExecutionConfigState(config);
      lastLoadedAt.current = loadedAt;
      return config;
    })
    .finally(() => {
      // Settled means resolved OR rejected: a failed first load still allows picker hydration
      // from defaults. An unmount cancellation must never update the cleaned-up mount.
      if (!controller.signal.aborted) setConfigLoaded(true);
      if (activeRefresh.current === pending) activeRefresh.current = null;
    });
  activeRefresh.current = pending;
  return pending;
}

function subscribeExecutionConfigRefresh(
  { state, refreshExecutionConfig, invalidate, configKey, subscribeRefresh, onLoadFailure }: {
    state: Pick<ExecutionLedgerState, "lifecycleRef" | "activeRefresh">;
    refreshExecutionConfig: () => Promise<ExecutionConfig>;
    invalidate: ReturnType<FetchQueryAdapter["useInvalidate"]>;
    configKey: string[];
    subscribeRefresh: Parameters<typeof useExecutionConfigLedger>[0]["subscribeRefresh"];
    onLoadFailure: (error: unknown) => void;
  },
  _options: Record<string, never> = {},
): () => void {
  const { lifecycleRef, activeRefresh } = state;
  const controller = new AbortController();
  lifecycleRef.current = controller;
  // Another window/desktop can save execution config while this dock stays mounted. Settings
  // already publishes this namespace on save; focus/visible also catch changes outside the tab.
  const refresh = () => {
    void refreshExecutionConfig().catch((error: unknown) => {
      // The dock is present on every route. Keep defaults/current state on a background failure,
      // but a pre-send refresh rejection is propagated so it cannot silently send a stale pick.
      if (!isAbortError({ error })) onLoadFailure(error);
    });
  };
  const revalidate = () => { invalidate({ key: configKey }); refresh(); };
  refresh();
  const unsubscribe = subscribeRefresh({ revalidate });
  return () => {
    controller.abort();
    unsubscribe();
    activeRefresh.current = null;
  };
}

export function useExecutionConfigLedger(
  { io, configLoader, invalidate, configKey, initialConfig, retry, subscribeRefresh, onLoadFailure }: {
    io: { current: { now(): number } };
    configLoader: CachedLoader<{ config: ExecutionConfig; loadedAt: number }>;
    invalidate: ReturnType<FetchQueryAdapter["useInvalidate"]>;
    configKey: string[];
    initialConfig: ExecutionConfig;
    retry: <T>(required: { load: () => Promise<T>; signal: AbortSignal }, optional?: Record<string, never>) => Promise<T>;
    subscribeRefresh: (required: { revalidate: () => void }, optional?: Record<string, never>) => () => void;
    onLoadFailure: (error: unknown) => void;
  },
  _options: Record<string, never> = {},
) {
  const { executionConfig, executionConfigRef, localWriteRef, setExecutionConfigState, setExecutionConfig } = useOptimisticExecutionConfig({ initialConfig });
  /** Backs {@link UseExecutionConfig.configLoaded} — see that field's own doc. */
  const [configLoaded, setConfigLoaded] = useState(false);

  const lifecycleRef = useRef<AbortController | null>(null);
  const refreshGeneration = useRef(0);
  const lastLoadedAt = useRef<number | null>(null);
  const activeRefresh = useRef<Promise<ExecutionConfig> | null>(null);

  const refreshExecutionConfig = useCallback(() => {
    return refreshExecutionConfigRead({
      state: { lifecycleRef, refreshGeneration, localWriteRef, lastLoadedAt, executionConfigRef, setExecutionConfigState, setConfigLoaded, activeRefresh },
      configLoader, retry,
    });
  }, [configLoader, retry]);

  const readExecutionConfigForSend = useCallback(async () => {
    // A focus/SSE/Settings refresh may still be in flight when Send is clicked. Await the newest
    // read and use its ref immediately, without relying on React to render the picker first.
    if (!activeRefresh.current && (lastLoadedAt.current === null || io.current.now() - lastLoadedAt.current >= EXECUTION_CONFIG_MAX_AGE_MS)) {
      invalidate({ key: configKey });
      refreshExecutionConfig();
    }
    while (activeRefresh.current) await activeRefresh.current;
    return executionConfigRef.current;
  }, [refreshExecutionConfig, invalidate, configKey]);

  useEffect(() => {
    return subscribeExecutionConfigRefresh({ state: { lifecycleRef, activeRefresh }, refreshExecutionConfig, invalidate, configKey, subscribeRefresh, onLoadFailure });
  }, [refreshExecutionConfig, invalidate, configKey, subscribeRefresh, onLoadFailure]);

  return { executionConfig, executionConfigRef, setExecutionConfig, configLoaded, readExecutionConfigForSend };
}

function useOptimisticExecutionConfig(
  { initialConfig }: { initialConfig: ExecutionConfig },
  _optional: Record<string, never> = {},
) {
  /**
   * Refreshed from `execution-settings.ts`'s ledger+localStorage-backed store — the SAME source
   * the Execution-mode settings tab reads/writes — so a mode chosen there is reflected here without
   * a page reload, and a mode picked directly from this dock persists back the same way.
   *
   * Held in a ref (kept in sync below) rather than read directly by the memoized `transport`: the
   * transport is built once (see its own comment) and reads this via `getExecutionConfig()` on every
   * `startRun` call, so a mode change mid-session takes effect on the NEXT message without forcing a
   * new transport instance — the same "read fresh, don't capture" pattern `runContext`'s
   * `frontendBindToken` already uses a few lines down.
   */
  const [executionConfig, setExecutionConfigState] = useState<ExecutionConfig>(initialConfig);
  const executionConfigRef = useRef(executionConfig);
  executionConfigRef.current = executionConfig;

  /**
   * Counts THIS mount's local writes — a mode switch from
   * `handleExecutionModeChange` below, or (through the wrapped `setExecutionConfig` this hook
   * exposes) a BYOK model pick from `useByokRuntime`'s `handleByokModelChange`. Each refresh samples
   * this count before reading: without it, an operator who switches modes before the initial
   * `loadExecutionConfig()` resolves would see the switch silently revert. The load starts on
   * mount and reads whatever the server held BEFORE the switch's own `saveExecutionConfig` call;
   * if it resolves after the switch (a real race — both are ordinary network calls with no
   * ordering guarantee), applying it unconditionally overwrites the operator's just-made,
   * already-persisted choice with the stale pre-switch value. That leaves the UI showing a
   * different mode than the server holds — exactly the disagreement
   * `handleExecutionModeChange`'s own doc comment says the ADR-028 chokepoint exists to prevent.
   *
   * A ref, not state: incrementing it must not itself trigger a render, and it needs to be readable
   * synchronously when deciding whether a refresh response is still current.
   */
  const localWriteRef = useRef(0);

  /**
   * The `Dispatch` this hook exposes — to its own `handleExecutionModeChange` below, and to
   * `useByokRuntime`'s `handleByokModelChange` (passed `executionConfig`/`setExecutionConfig` as
   * an input pair). Wraps the raw state setter so any update that actually changes the value
   * marks {@link localWriteRef}.
   *
   * Relies on the "return `previous` unchanged to bail out" convention every updater passed
   * through here already follows (`handleExecutionModeChange`'s and `handleByokModelChange`'s own
   * `if (previous.… === next) return previous;` guards) rather than re-deriving no-op-ness itself:
   * comparing the updater's result to `previous` by reference is enough to tell a genuine write
   * apart from a no-op, so an operator re-picking the mode/model already active does not
   * permanently block a legitimate mount-load from applying.
   *
   * Runs an updater once, synchronously, against {@link executionConfigRef} (moved forward on every
   * write, so two picks before a re-render compose), and hands React the resulting value rather
   * than the updater. `applyExecutionConfigChange` (`../execution-config-write.ts`) relies on that
   * to read what a pick changed right after the call and save it outside the updater — StrictMode
   * runs updaters twice, and a save inside one wrote two revisions per pick (2026-09-23).
   */
  const setExecutionConfig = useCallback<React.Dispatch<React.SetStateAction<ExecutionConfig>>>((action) => {
    const previous = executionConfigRef.current;
    const next = typeof action === "function"
      ? (action as (current: ExecutionConfig) => ExecutionConfig)(previous)
      : action;
    if (next === previous) return;
    localWriteRef.current += 1;
    executionConfigRef.current = next;
    setExecutionConfigState(next);
  }, []);

  return { executionConfig, executionConfigRef, localWriteRef, setExecutionConfigState, setExecutionConfig };
}
