import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { DRAFT_TEST_SCOPE } from '../../constants.js';
import type { SourceConfigDependencies, SourceConfigPort } from '../../ports.js';
import {
  isActionPending,
  removeSourceById,
  updateSourceById,
  upsertSourceById,
  withoutPendingAction,
  withPendingAction,
} from '../../rules.js';
import type {
  SourceActionKind,
  SourceConfigItem,
  SourceFieldValues,
  SourceTestResult,
  SourceUpdateInput,
} from '../../types.js';

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
  /**
   * Patches an existing source's `label`/`enabled`/`fields` (see `ports.ts`'s
   * `updateSource` doc comment). No-op when the port has no `updateSource`.
   *
   * **Passes `patch` through unvalidated, deliberately** — this hook is given a
   * `port` and no `fieldSpecs`, so it has nothing to validate against. The
   * shipped edit UI (`SourceConfigItemCard`) runs `validateSourceDraft` before
   * calling this, the same check the add form runs; a host driving this method
   * directly owns that check itself, exactly as `validateSourceDraft`'s own doc
   * says for `addSource`. Stated here because the gap used to be silent: the
   * edit path ran no validation at any layer.
   */
  update: (id: string, patch: SourceUpdateInput) => Promise<void>;
}

const LOAD_FAILED_MESSAGE = 'Failed to load sources.';

type SetSources<TSource> = Dispatch<SetStateAction<TSource[]>>;
type SetPendingKeys = Dispatch<SetStateAction<ReadonlySet<string>>>;

/** Loads the source list from the port; `reload` re-fetches. */
function useSourceListLoader<TSource extends SourceConfigItem>(port: SourceConfigPort<TSource>) {
  const [sources, setSources] = useState<TSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    // `reload` is port-derived, so its identity changes only when the port changes.
  }, [reload]);

  return { sources, setSources, loading, error, reload };
}

/** Marks `key`/`kind` pending for the duration of `task`, even if it throws. */
async function runPending<T>({ setPendingKeys, key, kind, task }: {
  setPendingKeys: SetPendingKeys;
  key: string;
  kind: SourceActionKind;
  task: () => Promise<T>;
}): Promise<T> {
  setPendingKeys((current) => withPendingAction({ pendingKeys: current, id: key, kind }));
  try {
    return await task();
  } finally {
    setPendingKeys((current) => withoutPendingAction({ pendingKeys: current, id: key, kind }));
  }
}

/** Source test runs (a saved item, or the add-form's unsaved draft) and their results. */
function useSourceTester<TSource extends SourceConfigItem>(
  port: SourceConfigPort<TSource>,
  setPendingKeys: SetPendingKeys,
) {
  const [testResults, setTestResults] = useState<Record<string, SourceTestResult>>({});

  const test = useCallback(
    async (id: string | undefined, draft?: SourceFieldValues) => {
      if (!port.testSource) return;
      const key = id ?? DRAFT_TEST_SCOPE;
      await runPending({
        setPendingKeys,
        key,
        kind: 'test',
        task: async () => {
        const result = await port.testSource!(id, draft);
        setTestResults((current) => ({ ...current, [key]: result }));
      },
      });
    },
    [port, setPendingKeys],
  );

  return { testResults, test };
}

interface SourceMutationsDeps<TSource extends SourceConfigItem> {
  port: SourceConfigPort<TSource>;
  setSources: SetSources<TSource>;
  setPendingKeys: SetPendingKeys;
}

/** Per-item remove/refresh/trust/test/update actions, each tracked via `pendingKeys`. */
function useSourceMutations<TSource extends SourceConfigItem>({
  port,
  setSources,
  setPendingKeys,
}: SourceMutationsDeps<TSource>) {
  const { testResults, test } = useSourceTester(port, setPendingKeys);

  const remove = useCallback(
    async (id: string) => {
      await runPending({
        setPendingKeys,
        key: id,
        kind: 'remove',
        task: async () => {
        const ok = await port.removeSource(id);
        if (ok) setSources((current) => removeSourceById({ list: current, id }));
      },
      });
    },
    [port, setSources, setPendingKeys],
  );

  const patchWith = useCallback(
    (kind: SourceActionKind, id: string, call: () => Promise<TSource | null | undefined>) =>
      runPending({
        setPendingKeys,
        key: id,
        kind,
        task: async () => {
        const updated = await call();
        if (updated) setSources((current) => updateSourceById({ list: current, id, patch: updated }));
      },
      }),
    [setSources, setPendingKeys],
  );

  const refresh = useCallback(
    async (id: string) => {
      if (port.refreshSource) await patchWith('refresh', id, () => port.refreshSource!(id));
    },
    [port, patchWith],
  );

  const setTrust = useCallback(
    async (id: string, trust: string) => {
      if (port.setTrust) await patchWith('trust', id, () => port.setTrust!(id, trust));
    },
    [port, patchWith],
  );

  const update = useCallback(
    async (id: string, patch: SourceUpdateInput) => {
      if (port.updateSource) await patchWith('update', id, () => port.updateSource!(id, patch));
    },
    [port, patchWith],
  );

  return { testResults, remove, refresh, setTrust, test, update };
}

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
  const { sources, setSources, loading, error, reload } = useSourceListLoader(port);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const { testResults, remove, refresh, setTrust, test, update } = useSourceMutations({
    port,
    setSources,
    setPendingKeys,
  });

  const addSourceToList = useCallback((source: TSource) => {
    setSources((current) => upsertSourceById({ list: current, next: source }));
  }, [setSources]);

  const capabilities = useMemo<SourceConfigListCapabilities>(
    () => ({
      canRefresh: Boolean(port.refreshSource),
      canSetTrust: Boolean(port.setTrust),
      canTest: Boolean(port.testSource),
      canUpdate: Boolean(port.updateSource),
    }),
    [port],
  );

  const isPending = useCallback((id: string, kind: SourceActionKind) => isActionPending({ pendingKeys, id, kind }), [pendingKeys]);

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
