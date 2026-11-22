/**
 * The only file in this feature allowed to touch a concrete adapter.
 *
 * `data` (the asset-catalog fetch transport) is genuinely host-specific, so
 * this package ships an in-memory fake/test double instead of a real
 * transport — a real host supplies its own `AssetGridDataPort`.
 *
 * `liveUpdates`, by contrast, only touches the generic browser `EventSource`
 * API with no backend-specific shape beyond a URL and two event names, so
 * this package ships a real SSR-guarded browser implementation for it too —
 * a host only needs to supply its own `data` port (and, if it wants live
 * updates, the SSE endpoint URL).
 */
import { fakeLatencyDelay } from '../../utils/fake-latency.js';
import { parseLiveUpdateAssetId } from './rules.js';
import type { AssetGridItem, AssetGridQuery } from './types.js';
import type {
  AssetGridDataPort,
  AssetGridDependencies,
  AssetGridLiveUpdateHandlers,
  AssetGridLiveUpdatesPort,
} from './ports.js';

export interface FakeAssetGridDataPortOptions<TAsset extends AssetGridItem> {
  assets?: TAsset[];
  /** Simulated network latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
  /** Override the default "match every field loosely against `query`" filter. */
  matchesQuery?: (asset: TAsset, query: AssetGridQuery) => boolean;
}

/** An in-memory test double good enough for demos and for driving this feature's own hook/component tests. */
export function createFakeAssetGridDataPort<TAsset extends AssetGridItem>(
  options: FakeAssetGridDataPortOptions<TAsset> = {},
): AssetGridDataPort<TAsset> {
  const assets = options.assets ? [...options.assets] : [];
  const matchesQuery = options.matchesQuery ?? (() => true);
  const delay = fakeLatencyDelay({}, { latencyMs: options.latencyMs });

  return {
    fetchAssets(query: AssetGridQuery) {
      return delay({ value: assets.filter((a) => matchesQuery(a, query)) });
    },
    fetchAssetById(id: string) {
      return delay({ value: assets.find((a) => a.id === id) ?? null });
    },
  };
}

export interface BrowserSseLiveUpdatesOptions {
  url: string;
  ingestEventName?: string;
  deleteEventName?: string;
  /** The field name a live-update event's JSON `data:` payload carries the asset id under. */
  idField?: string;
}

/** A real `EventSource`-backed live-updates port. SSR-guarded: `subscribe` is a no-op off the browser. */
export function createBrowserSseLiveUpdatesPort(options: BrowserSseLiveUpdatesOptions): AssetGridLiveUpdatesPort {
  const ingestEventName = options.ingestEventName ?? 'ingest';
  const deleteEventName = options.deleteEventName ?? 'delete';
  const idField = options.idField ?? 'id';

  return {
    subscribe(handlers: AssetGridLiveUpdateHandlers): () => void {
      if (typeof EventSource === 'undefined') return () => {};
      let source: EventSource | null = null;
      try {
        source = new EventSource(options.url);
      } catch {
        return () => {};
      }
      const onIngest = (ev: MessageEvent) => {
        const id = parseLiveUpdateAssetId({ data: ev.data }, { idField });
        if (id) handlers.onIngest(id);
        else handlers.onFullReload();
      };
      const onDelete = (ev: MessageEvent) => {
        const id = parseLiveUpdateAssetId({ data: ev.data }, { idField });
        if (id) handlers.onDelete(id);
        else handlers.onFullReload();
      };
      source.addEventListener(ingestEventName, onIngest);
      source.addEventListener(deleteEventName, onDelete);
      const es = source;
      return () => es.close();
    },
  };
}

export function createFakeAssetGridDependencies<TAsset extends AssetGridItem>(
  options: FakeAssetGridDataPortOptions<TAsset> = {},
): AssetGridDependencies<TAsset> {
  return { data: createFakeAssetGridDataPort(options) };
}
