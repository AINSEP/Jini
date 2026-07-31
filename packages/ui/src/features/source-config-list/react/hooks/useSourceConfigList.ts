import { useCallback, useEffect, useMemo, useState } from 'react';
import { DRAFT_TEST_SCOPE } from '@jini-ai/ui-core';
import { isActionPending, removeSourceById, updateSourceById, upsertSourceById, withoutPendingAction, withPendingAction } from '@jini-ai/ui-core';
import type { SourceConfigDependencies, SourceConfigPort } from '@jini-ai/ui-core';
import type { SourceActionKind, SourceConfigItem, SourceFieldValues, SourceTestResult, SourceUpdateInput } from '@jini-ai/ui-core';

export interface SourceConfigListCapabilities {
  canRefresh: boolean;
  canSetTrust: boolean;
  canTest: boolean;
  canUpdate: boolean;
}

export interface UseSourceConfigListParams<TSource extends SourceConfigItem> {
  port: SourceConfigPort<TSource>;
}

export interface SourceConfigListController<TSource extends SourceConfigItem> {
  sources: TSource[];
  loading: boolean;
  error: string | null;
  pendingKeys: ReadonlySet<string>;
  testResults: Record<string, SourceTestResult>;
  capabilities: SourceConfigListCapabilities;
  isPending: (id: string, kind: SourceActionKind) => boolean;
  reload: () => Promise<void>;
  addSourceToList: (source: TSource) => void;
  remove: (id: string) => Promise<void>;
  refresh: (id: string) => Promise<void>;
  setTrust: (id: string, trust: string) => Promise<void>;
  /**
   * `id === undefined` tests the add-form's still-unsaved draft (the byok
   * "test before save" flow — see `ports.ts`'s `testSource` doc comment);
   * pending/result state for that case is tracked under
   * {@link DRAFT_TEST_SCOPE} instead of a real item id.
   */
  test: (id: string | undefined, draft?: SourceFieldValues) => Promise<void>;
  /** Patches an existing source's `label`/`enabled`/`fields` (see `ports.ts`'s `updateSource` doc comment). No-op when the port has no `updateSource`. */
  update: (id: string, patch: SourceUpdateInput) => Promise<void>;
}

const LOAD_FAILED_MESSAGE = 'Failed to load sources.';

/**
 * Loads a source list from the injected port and exposes per-item
 * refresh/remove/trust-change/test actions, each tracked independently via
 * `pendingKeys` (see `rules.ts`'s `pendingActionKey`) so one card's in-flight
 * action never disables an unrelated card. `capabilities` is derived from
 * which optional port methods the host actually implements — the React
 * layer never needs a separate set of boolean feature flags to keep in sync
 * with the port.
 */
export function useSourceConfigList<TSource extends SourceConfigItem>(
  params: UseSourceConfigListParams<TSource>,
): SourceConfigListController<TSource> {
  const { port } = params;
  const [sources, setSources] = useState<TSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, SourceTestResult>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await port.fetchSources();
      setSources(fetched);
      setError(null);
    } catch {
      setError(LOAD_FAILED_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, [port]);

  useEffect(() => {
    void reload();
    // `reload` intentionally excluded: it's `port`-derived and re-running it
    // on every `reload` identity change would just mean "port changed",
    // which the `[port]` dep below already covers via `reload`'s own
    // `[port]` dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port]);

  const addSourceToList = useCallback((source: TSource) => {
    setSources((current) => upsertSourceById(current, source));
  }, []);

  const remove = useCallback(
    async (id: string) => {
      setPendingKeys((current) => withPendingAction(current, id, 'remove'));
      try {
        const ok = await port.removeSource(id);
        if (ok) setSources((current) => removeSourceById(current, id));
      } finally {
        setPendingKeys((current) => withoutPendingAction(current, id, 'remove'));
      }
    },
    [port],
  );

  const refresh = useCallback(
    async (id: string) => {
      if (!port.refreshSource) return;
      setPendingKeys((current) => withPendingAction(current, id, 'refresh'));
      try {
        const refreshed = await port.refreshSource(id);
        if (refreshed) setSources((current) => updateSourceById(current, id, refreshed));
      } finally {
        setPendingKeys((current) => withoutPendingAction(current, id, 'refresh'));
      }
    },
    [port],
  );

  const setTrust = useCallback(
    async (id: string, trust: string) => {
      if (!port.setTrust) return;
      setPendingKeys((current) => withPendingAction(current, id, 'trust'));
      try {
        const updated = await port.setTrust(id, trust);
        if (updated) setSources((current) => updateSourceById(current, id, updated));
      } finally {
        setPendingKeys((current) => withoutPendingAction(current, id, 'trust'));
      }
    },
    [port],
  );

  const test = useCallback(
    async (id: string | undefined, draft?: SourceFieldValues) => {
      if (!port.testSource) return;
      const key = id ?? DRAFT_TEST_SCOPE;
      setPendingKeys((current) => withPendingAction(current, key, 'test'));
      try {
        const result = await port.testSource(id, draft);
        setTestResults((current) => ({ ...current, [key]: result }));
      } finally {
        setPendingKeys((current) => withoutPendingAction(current, key, 'test'));
      }
    },
    [port],
  );

  const update = useCallback(
    async (id: string, patch: SourceUpdateInput) => {
      if (!port.updateSource) return;
      setPendingKeys((current) => withPendingAction(current, id, 'update'));
      try {
        const updated = await port.updateSource(id, patch);
        if (updated) setSources((current) => updateSourceById(current, id, updated));
      } finally {
        setPendingKeys((current) => withoutPendingAction(current, id, 'update'));
      }
    },
    [port],
  );

  const capabilities = useMemo<SourceConfigListCapabilities>(
    () => ({
      canRefresh: Boolean(port.refreshSource),
      canSetTrust: Boolean(port.setTrust),
      canTest: Boolean(port.testSource),
      canUpdate: Boolean(port.updateSource),
    }),
    [port],
  );

  const isPending = useCallback((id: string, kind: SourceActionKind) => isActionPending(pendingKeys, id, kind), [pendingKeys]);

  return {
    sources,
    loading,
    error,
    pendingKeys,
    testResults,
    capabilities,
    isPending,
    reload,
    addSourceToList,
    remove,
    refresh,
    setTrust,
    test,
    update,
  };
}

export type UseWiredSourceConfigListParams<TSource extends SourceConfigItem> = {
  dependencies: SourceConfigDependencies<TSource>;
};

/**
 * Wirer: binds `port` from a host-supplied `dependencies`. Unlike
 * `features/asset-grid/`'s `useWiredAssetGridData`, `dependencies` here has
 * no zero-config default — see `dependencies.ts`'s file-level comment for
 * why a generic `TSource` can't have a synthesizable fallback `createSource`.
 */
export function useWiredSourceConfigList<TSource extends SourceConfigItem>(
  params: UseWiredSourceConfigListParams<TSource>,
): SourceConfigListController<TSource> {
  return useSourceConfigList({ port: params.dependencies.port });
}
