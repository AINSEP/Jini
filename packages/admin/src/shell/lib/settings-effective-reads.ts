export interface SettingResolvedValue {
  key: string;
  value: unknown;
  sourceLayer: "user" | "workspace" | "global" | "default";
  defVersion: number;
}

type EffectiveSettings = { data: SettingResolvedValue[] };

/**
 * Share one effective-settings request across direct callers until it settles. About 100 hooks
 * each call `useWiredAdminLocale()`, and their mount effects all run in the same commit, so without
 * sharing one admin page load sent ~100 identical `settings/effective?namespace=core.language`
 * GETs (2026-09-23). Interface and execution slices also read outside the hook query cache.
 * Only the in-flight request is shared, never a settled value, so a later mount still reads the
 * server's current settings. Hook observers additionally share their query cache.
 *
 * The host API supplies its authorized request port and full path, including workspace and optional
 * principal: namespace alone would incorrectly share different principals' effective values.
 */
const readsInFlight = new Map<string, { namespace: string; read: Promise<EffectiveSettings> }>();

/** Returns the pending authorized read for this exact URL; success and failure both release it.
 * Errors propagate unchanged. @complexity O(1) map operations per read. */
export function shareSettingsEffectiveRead(
  { namespace, path, port }: { namespace: string; path: string; port: { read: () => Promise<EffectiveSettings> } },
  _optional: Record<string, never> = {},
): Promise<EffectiveSettings> {
  const pending = readsInFlight.get(path);
  if (pending) return pending.read;
  const read = port.read().finally(() => {
    if (readsInFlight.get(path)?.read === read) readsInFlight.delete(path);
  });
  readsInFlight.set(path, { namespace, read });
  return read;
}

/** The synchronous bus fan-out invalidates once while still notifying every listener. */
const refreshDispatching = new Set<string>();
let refreshAllDispatching = false;

/**
 * A settings refresh can supersede an in-flight read. The bus calls subscribers synchronously;
 * drop the shared read once per dispatch turn so later subscribers join the new request.
 * Called before fan-out, including when no locale observer is mounted. Existing callers keep
 * their promises; their own settlement guards still decide whether an older response may land.
 * @complexity O(r × n) for r pending URLs and n notified namespaces; unknown scope clears all.
 */
export function dropInFlightSettingsReads(
  { namespaces }: { namespaces: readonly string[] | null },
  _optional?: Record<string, never>,
): void {
  if (refreshAllDispatching) return;
  const affected = namespaces?.filter((namespace) => !refreshDispatching.has(namespace)) ?? null;
  if (affected === null) refreshAllDispatching = true;
  else for (const namespace of affected) refreshDispatching.add(namespace);
  for (const [path, pending] of readsInFlight) {
    if (affected === null || affected.includes(pending.namespace)) readsInFlight.delete(path);
  }
  queueMicrotask(() => {
    refreshDispatching.clear();
    refreshAllDispatching = false;
  });
}
