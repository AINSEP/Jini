/**
 * The only file in this feature allowed to touch a concrete adapter.
 *
 * Unlike `features/asset-grid/`'s read-only `AssetGridDataPort` (which can
 * ship a useful zero-config fake because it never has to synthesize a new
 * item from a host-specific shape), this feature's `addSource` inherently
 * needs to know how to build a `TSource` from an arbitrary host's
 * `AddSourceInput` — there's no generic default that could do that for an
 * arbitrary generic `TSource`. So `createFakeSourceConfigPort` takes a
 * required `createSource` callback; a host wires its own real transport the
 * same way, and this fake is good enough to drive this feature's own
 * hook/component tests and any host's local dev/demo needs.
 */
import type { AddSourceInput, AddSourceResult, SourceConfigItem, SourceFieldValues, SourceTestResult, SourceUpdateInput } from './types.js';
import type { SourceConfigDependencies, SourceConfigPort } from './ports.js';

export interface FakeSourceConfigPortOptions<TSource extends SourceConfigItem> {
  sources?: TSource[];
  /** Simulated network latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
  /** Builds the persisted source from an add-form submission. */
  createSource: (input: AddSourceInput) => TSource;
  /** Whether the fake wires `refreshSource`. Defaults to true. */
  supportsRefresh?: boolean;
  /** Whether the fake wires `setTrust`. Defaults to true. */
  supportsTrust?: boolean;
  /** Whether the fake wires `testSource`. Defaults to true. */
  supportsTest?: boolean;
  /** Whether the fake wires `updateSource`. Defaults to true. */
  supportsUpdate?: boolean;
  /** Called by the fake's `refreshSource` (when enabled) to compute the refreshed value. Defaults to returning the stored source unchanged. */
  onRefresh?: (source: TSource) => TSource;
  /** Called by the fake's `testSource` (when enabled). `id` is `undefined` when testing the add-form's unsaved draft. Defaults to always-ok. */
  onTest?: (id: string | undefined, draft: SourceFieldValues | undefined, source: TSource | undefined) => SourceTestResult;
  /** Called by the fake's `updateSource` (when enabled) to merge a patch onto the stored source. Defaults to a plain shallow merge (`fields` merged key-by-key, everything else replaced). */
  onUpdate?: (source: TSource, patch: SourceUpdateInput) => TSource;
}

type Delay = <T>(value: T) => Promise<T>;

interface FakeStore<TSource extends SourceConfigItem> {
  store: TSource[];
  delay: Delay;
}

function createDelay({ latencyMs }: { latencyMs: number }): Delay {
  return <T>(value: T): Promise<T> =>
    latencyMs > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs)) : Promise.resolve(value);
}

/**
 * Replaces the stored source with `id` by `transform(current)`; resolves
 * `null` (and leaves the store untouched) when no source has that id.
 */
function replaceById<TSource extends SourceConfigItem>({
  fake: { store, delay },
  id,
  transform,
}: {
  fake: FakeStore<TSource>;
  id: string;
  transform: (current: TSource) => TSource;
}): Promise<TSource | null> {
  const index = store.findIndex((source) => source.id === id);
  if (index === -1) return delay(null);
  const updated = transform(store[index]!);
  store[index] = updated;
  return delay(updated);
}

/** The default `onUpdate`: `fields` merged key-by-key, `label`/`enabled` replaced only when the patch carries them. */
function mergeSourcePatch<TSource extends SourceConfigItem>(current: TSource, patch: SourceUpdateInput): TSource {
  return {
    ...current,
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.fields !== undefined ? { fields: { ...current.fields, ...patch.fields } } : {}),
  } as TSource;
}

const DEFAULT_TEST_RESULT: SourceTestResult = { ok: true, message: 'Connection ok.', latencyMs: 0 };

function createTestSource<TSource extends SourceConfigItem>(
  { store, delay }: FakeStore<TSource>,
  { onTest }: Pick<FakeSourceConfigPortOptions<TSource>, 'onTest'>,
): NonNullable<SourceConfigPort<TSource>['testSource']> {
  return (id: string | undefined, draft?: SourceFieldValues): Promise<SourceTestResult> => {
    const source = id === undefined ? undefined : store.find((s) => s.id === id);
    return delay(onTest ? onTest(id, draft, source) : { ...DEFAULT_TEST_RESULT });
  };
}

/** Wires the optional refresh/trust/test/update capabilities each `supports*` flag enables (all default to true). */
function wireOptionalCapabilities<TSource extends SourceConfigItem>({
  port,
  fake,
  options,
}: {
  port: SourceConfigPort<TSource>;
  fake: FakeStore<TSource>;
  options: FakeSourceConfigPortOptions<TSource>;
}): void {
  if (options.supportsRefresh ?? true) {
    const onRefresh = options.onRefresh ?? ((source: TSource) => source);
    port.refreshSource = (id: string) => replaceById({ fake, id, transform: onRefresh });
  }
  if (options.supportsTrust ?? true) {
    port.setTrust = (id: string, trust: string) => replaceById({ fake, id, transform: (current) => ({ ...current, trust }) });
  }
  wireTestAndUpdate({ port, fake, options });
}

function wireTestAndUpdate<TSource extends SourceConfigItem>({
  port,
  fake,
  options,
}: {
  port: SourceConfigPort<TSource>;
  fake: FakeStore<TSource>;
  options: FakeSourceConfigPortOptions<TSource>;
}): void {
  if (options.supportsTest ?? true) {
    port.testSource = createTestSource(fake, options);
  }
  if (options.supportsUpdate ?? true) {
    const onUpdate = options.onUpdate ?? mergeSourcePatch;
    port.updateSource = (id: string, patch: SourceUpdateInput) => replaceById({ fake, id, transform: (current) => onUpdate(current, patch) });
  }
}

/** An in-memory test double good enough for demos and for driving this feature's own hook/component tests. */
export function createFakeSourceConfigPort<TSource extends SourceConfigItem>(
  options: FakeSourceConfigPortOptions<TSource>,
): SourceConfigPort<TSource> {
  const store = options.sources ? [...options.sources] : [];
  const delay = createDelay({ latencyMs: options.latencyMs ?? 0 });

  const port: SourceConfigPort<TSource> = {
    fetchSources() {
      return delay([...store]);
    },
    addSource(input: AddSourceInput): Promise<AddSourceResult<TSource>> {
      const created = options.createSource(input);
      store.push(created);
      return delay({ ok: true, source: created });
    },
    removeSource(id: string): Promise<boolean> {
      const index = store.findIndex((source) => source.id === id);
      if (index === -1) return delay(false);
      store.splice(index, 1);
      return delay(true);
    },
  };

  wireOptionalCapabilities({ port, fake: { store, delay }, options });
  return port;
}

export function createFakeSourceConfigDependencies<TSource extends SourceConfigItem>(
  options: FakeSourceConfigPortOptions<TSource>,
): SourceConfigDependencies<TSource> {
  return { port: createFakeSourceConfigPort(options) };
}
