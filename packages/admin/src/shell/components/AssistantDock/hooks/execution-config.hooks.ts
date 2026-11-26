import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import type { CachedLoader, FetchQueryAdapter } from "@jini-ai/core/fetch";
import { isAbortError } from "@jini-ai/core/text";
import type { useAdminBootScope } from "../../../lib/admin-boot-scope.js";
import { subscribeExecutionConfigRefresh, subscribeStoredKeyRefresh } from "./execution-config-refresh.js";
import type { useExecutionConfigLedger } from "./execution-config-ledger.hooks.js";

export type ExecutionWrite = { previous: ExecutionConfig; next: ExecutionConfig };

export interface UseExecutionConfig {
  executionConfig: ExecutionConfig;
  /** Same object as `executionConfig`, mirrored into a ref — see the field's own doc below for why. */
  executionConfigRef: React.MutableRefObject<ExecutionConfig>;
  setExecutionConfig: React.Dispatch<React.SetStateAction<ExecutionConfig>>;
  handleExecutionModeChange: (mode: "local" | "api") => void;
  /**
   * Whether this admin has a BYOK credential saved server-side (2026-08-05) — `null` until the
   * initial GET settles, then `true`/`false`. See {@link AssistantDock}'s `apiModeAvailable` for why
   * this exists: `executionConfig.byok.apiKey` alone is no longer enough to answer "is BYOK
   * usable", because the key is write-only and empty on every fresh load even when one is stored.
   */
  hasStoredAdminKey: boolean | null;
  /**
   * True once the initial ledger GET (`loadExecutionConfig()`) has settled — resolved OR
   * rejected — false only during that first in-flight load. Added (2026-08-05) for
   * {@link useLocalCliSelection}'s initial hydration: `executionConfig.localCli.agentId` starts
   * `null` in `DEFAULT_EXECUTION_CONFIG`, and a load that resolves to "nothing was ever saved"
   * ALSO leaves it `null` — those two states are indistinguishable from `executionConfig` alone,
   * so a separate "has the GET settled at all" signal is what lets that hook's hydration effect
   * fire after the first read instead of never (waiting on a non-null `agentId` that may never arrive) or
   * too early (before the load has had any chance to run).
   */
  configLoaded: boolean;
  /** Await the current refresh, or re-read a Local CLI config older than five seconds. */
  readExecutionConfigForSend?: () => Promise<ExecutionConfig>;
}

/** IO seam for the dock's existing ledger and credential adapters; tests provide fakes. */
export interface DockExecutionConfigPort {
  loadConfig: () => Promise<ExecutionConfig>;
  loadCredential: () => Promise<{ isSet: boolean }>;
  now: () => number;
}

/**
 * Whether a BYOK credential is stored server-side for this admin — see {@link UseExecutionConfig.hasStoredAdminKey}'s
 * own doc for why `apiModeAvailable` cannot be answered from `executionConfig.byok.apiKey` alone
 * any more. Read-only and independent of the ledger load above: a failed GET here leaves this
 * `null`/`false` (picker reads as "not configured"), which is the same fail-soft posture the
 * ledger load's own `.catch` takes — never blocks the dock, only degrades one affordance.
 *
 * Re-reads on {@link subscribeToSettingsRefresh}, not just on mount. This dock mounts once at the
 * app shell and never remounts for the session (`AssistantDock.tsx`'s own header comment), so
 * without this a key saved, rotated, or cleared from a settings screen's OWN
 * `useAdminExecutionCredential` (a different, independently-mounted copy of the same server row —
 * see that hook's "Cross-mount staleness" doc) would leave this picker showing "not configured" (or
 * a stale "configured") for the rest of the session, not just briefly.
 */
export function useStoredAdminKey(
  { credentialLoader, invalidate, credentialKey, retry, subscribeRefresh, onLoadFailure }: {
    credentialLoader: CachedLoader<{ isSet: boolean }>;
    invalidate: ReturnType<FetchQueryAdapter["useInvalidate"]>;
    credentialKey: string[];
    retry: Parameters<typeof useExecutionConfigLedger>[0]["retry"];
    subscribeRefresh: Parameters<typeof useExecutionConfigLedger>[0]["subscribeRefresh"];
    onLoadFailure: (error: unknown) => void;
  },
  _options: Record<string, never> = {},
): boolean | null {
  const [hasStoredAdminKey, setHasStoredAdminKey] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Same restart-survival and cancellation handling as the ledger load above; `hasStoredAdminKey`
    // stays `null` (unknown) while retrying rather than claiming "not configured".
    const refresh = () => {
      void retry({ load: () => credentialLoader.load(), signal: controller.signal })
        .then((view) => {
          if (!controller.signal.aborted) setHasStoredAdminKey(view.isSet);
        })
        .catch((error: unknown) => {
          if (isAbortError({ error })) return;
          onLoadFailure(error);
        });
    };
    refresh();
    const unsubscribe = subscribeRefresh({ revalidate: () => {
      invalidate({ key: credentialKey });
      refresh();
    } });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [credentialLoader, invalidate, credentialKey, retry, subscribeRefresh, onLoadFailure]);
  return hasStoredAdminKey;
}

/**
 * Owns the runtime picker's Local CLI / API · BYOK state (ADR-049's picker, 2026-08-04 wiring) and
 * the mode-switch write-back. Split out of `AssistantDock` so the config-load failure path (the
 * `.catch()` below) and the mode-switch persistence path can be driven directly with `renderHook`
 * against a mocked `execution-settings.ts`, rather than only indirectly through a full dock mount.
 *
 * @returns `executionConfig` (the live value), `executionConfigRef` (read-fresh mirror for
 *   consumers that must not capture a stale closure), `setExecutionConfig`, and
 *   `handleExecutionModeChange` (persists a mode switch back through the ADR-028 chokepoint).
 * @param options.port - Ledger/credential IO; defaults to the existing host adapters.
 * @param options.persistWrite - Write seam for component tests; defaults to the shared dock writer.
 * @example
 * const { executionConfig, handleExecutionModeChange } = useExecutionConfig();
 */
export function useExecutionConfig(
  { port, initialConfig, namespace, useBootScopeHook, useCachedLoaderHook, useInvalidateHook, useLedgerHook, useStoredKeyHook, ledgerIo, storedKeyIo, applyChange, persistWrite }: {
    port: DockExecutionConfigPort;
    initialConfig: ExecutionConfig;
    namespace: string;
    useBootScopeHook: typeof useAdminBootScope;
    useCachedLoaderHook: FetchQueryAdapter["useCachedLoader"];
    useInvalidateHook: FetchQueryAdapter["useInvalidate"];
    useLedgerHook: typeof useExecutionConfigLedger;
    useStoredKeyHook: typeof useStoredAdminKey;
    ledgerIo: Pick<Parameters<typeof useExecutionConfigLedger>[0], "retry" | "subscribeRefresh" | "onLoadFailure">;
    storedKeyIo: Pick<Parameters<typeof useStoredAdminKey>[0], "retry" | "subscribeRefresh" | "onLoadFailure">;
    applyChange: (required: { setExecutionConfig: React.Dispatch<React.SetStateAction<ExecutionConfig>>; change: (previous: ExecutionConfig) => ExecutionConfig }, optional?: Record<string, never>) => ExecutionWrite | null;
    persistWrite: (required: { write: ExecutionWrite }, optional?: Record<string, never>) => Promise<boolean>;
  },
  _optional: Record<string, never> = {},
): UseExecutionConfig {
  const io = useRef(port);
  io.current = port;
  const { queryScope } = useBootScopeHook();
  const configKey = useMemo(() => ["settings", namespace, queryScope, "dock"], [namespace, queryScope]);
  const credentialKey = useMemo(() => ["admin-execution-credential", queryScope, "presence"], [queryScope]);
  const loadConfig = useCallback(async () => ({ config: await io.current.loadConfig(), loadedAt: io.current.now() }), []);
  const loadCredential = useCallback(() => io.current.loadCredential(), []);
  // The provider retains reads across StrictMode replay and ordinary dock remounts. Explicit
  // refreshes revoke them; focus/pre-send reads keep the existing five-second freshness bound.
  const configLoader = useCachedLoaderHook({ key: configKey, fetch: loadConfig }, { staleTime: Infinity });
  const credentialLoader = useCachedLoaderHook({ key: credentialKey, fetch: loadCredential }, { staleTime: Infinity });
  const invalidate = useInvalidateHook();
  const { executionConfig, executionConfigRef, setExecutionConfig, configLoaded, readExecutionConfigForSend } = useLedgerHook({ io, configLoader, invalidate, configKey, initialConfig, ...ledgerIo });
  const hasStoredAdminKey = useStoredKeyHook({ credentialLoader, invalidate, credentialKey, ...storedKeyIo });

  /**
   * Persists a mode switch made from THIS dock's own picker back through the same
   * `saveExecutionConfig` chokepoint the Execution-mode settings tab uses (ADR-028's single write
   * chokepoint), so the two surfaces can never disagree about which mode is active.
   *
   * `publishSettingsRefresh([EXECUTION_NAMESPACE])` on save success — same cross-mount staleness
   * fix `handleByokModelChange` below already applies to a model pick, now applied here too so an
   * already-open settings tab (or another `AssistantDock` mount) re-reads instead of sitting on the
   * mode the operator just changed away from.
   */
  const handleExecutionModeChange = useCallback((mode: "local" | "api") => {
    const nextMode: ExecutionConfig["mode"] = mode === "api" ? "byok" : "local-cli";
    const write = applyChange({ setExecutionConfig, change: (previous) =>
      previous.mode === nextMode ? previous : { ...previous, mode: nextMode } });
    if (write) persistWrite({ write });
    // `setExecutionConfig` added: it's a `useCallback([], ...)`-wrapped setter (itself stable for
    // the component's lifetime, see its own declaration above), so listing it is a no-op that only
    // satisfies the linter — Part 2 triage fix, not a suppression.
  }, [setExecutionConfig, applyChange, persistWrite]);

  return {
    executionConfig,
    executionConfigRef,
    setExecutionConfig,
    handleExecutionModeChange,
    hasStoredAdminKey,
    configLoaded,
    readExecutionConfigForSend,
  };
}


export function bindExecutionConfig({ hooks, deps }: {
  hooks: Pick<Parameters<typeof useExecutionConfig>[0], "useBootScopeHook" | "useCachedLoaderHook" | "useInvalidateHook" | "useLedgerHook" | "useStoredKeyHook">;
  deps: Pick<Parameters<typeof useExecutionConfig>[0], "port" | "initialConfig" | "namespace" | "applyChange"> & {
    refresh: Parameters<typeof subscribeExecutionConfigRefresh>[0]["deps"];
    retry: Parameters<typeof useExecutionConfigLedger>[0]["retry"];
    onConfigLoadFailure: (error: unknown) => void;
    onStoredKeyLoadFailure: (error: unknown) => void;
    persistWrite: (required: { write: ExecutionWrite; failureLog: string }) => Promise<boolean>;
    modeFailureLog: string;
  };
}, _optional = {}) {
  const ledgerIo = {
    retry: deps.retry,
    subscribeRefresh: ({ revalidate }: { revalidate: () => void }) => subscribeExecutionConfigRefresh({ revalidate, deps: deps.refresh }),
    onLoadFailure: deps.onConfigLoadFailure,
  };
  const storedKeyIo = {
    retry: deps.retry,
    subscribeRefresh: ({ revalidate }: { revalidate: () => void }) => subscribeStoredKeyRefresh({ revalidate, deps: deps.refresh }),
    onLoadFailure: deps.onStoredKeyLoadFailure,
  };
  return function useBoundExecutionConfig(_required: Record<string, never>, { port = deps.port, persistWrite = deps.persistWrite } = {}): UseExecutionConfig {
    const persistMode = useCallback(({ write }: { write: ExecutionWrite }) =>
      persistWrite({ write, failureLog: deps.modeFailureLog }), [persistWrite]);
    return useExecutionConfig({
      port, initialConfig: deps.initialConfig, namespace: deps.namespace,
      ...hooks, ledgerIo, storedKeyIo,
      applyChange: deps.applyChange, persistWrite: persistMode,
    });
  };
}
