/**
 * `VendorAdapterRegistry` — the registration surface a vendor module calls
 * at import time instead of `engine.ts`'s `ROUTES` table pointing directly
 * at a hand-written render function. A migrated vendor registers its
 * `VendorAdapter` here, keyed by `(providerId, routeKey)` — the same
 * `routeKey` shape `engine.ts`'s internal `routeKeyFor` already produces
 * (`'image'`, `'video'`, `'audio:speech'`, ...). `engine.ts` consults this
 * registry first when resolving a renderer, falling back to the static
 * `ROUTES` table for vendors not yet migrated onto the generic engine — see
 * `source-map.md`'s 2026-07-21 dispatch-engine-generalization section for
 * exactly which vendors are registered here today, and why the rest
 * legitimately aren't (yet).
 */
import type { VendorAdapter } from './vendor-adapter.js';

export class VendorAdapterRegistry {
  private readonly table = new Map<string, Map<string, VendorAdapter<never>>>();

  /** Registers `adapter` for `(providerId, routeKey)`. Throws if that pair is already registered — a vendor module should register each of its (provider, surface) pairs exactly once, at module load. */
  register<Meta>(providerId: string, routeKey: string, adapter: VendorAdapter<Meta>): void {
    let bySurface = this.table.get(providerId);
    if (!bySurface) {
      bySurface = new Map();
      this.table.set(providerId, bySurface);
    }
    if (bySurface.has(routeKey)) {
      throw new Error(`a vendor adapter is already registered for "${providerId}" / "${routeKey}"`);
    }
    bySurface.set(routeKey, adapter as unknown as VendorAdapter<never>);
  }

  /** Looks up the adapter registered for `(providerId, routeKey)`, or `undefined` if none is registered. */
  get(providerId: string, routeKey: string): VendorAdapter<never> | undefined {
    return this.table.get(providerId)?.get(routeKey);
  }

  /** Whether an adapter is registered for `(providerId, routeKey)`. */
  has(providerId: string, routeKey: string): boolean {
    return this.table.get(providerId)?.has(routeKey) ?? false;
  }

  /** Every `(providerId, routeKey)` pair currently registered — used by tests (and any diagnostics a host wants) to enumerate exactly which vendors run through the generic engine. */
  list(): ReadonlyArray<readonly [providerId: string, routeKey: string]> {
    const out: Array<readonly [string, string]> = [];
    for (const [providerId, bySurface] of this.table) {
      for (const routeKey of bySurface.keys()) {
        out.push([providerId, routeKey]);
      }
    }
    return out;
  }
}

/** Creates a fresh, empty registry — mainly useful for tests that want isolation from the shared `mediaVendorRegistry` singleton. */
export function createVendorAdapterRegistry(): VendorAdapterRegistry {
  return new VendorAdapterRegistry();
}

/**
 * The shared registry every migrated vendor module registers into at import
 * time, and `engine.ts` consults for dispatch. A host embedding
 * `@jini-ai/media` that wants a clean, isolated registry (e.g. to register its
 * own vendor adapters without touching this module's set) can still call
 * `createVendorAdapterRegistry()` directly instead of using this singleton.
 */
export const mediaVendorRegistry: VendorAdapterRegistry = createVendorAdapterRegistry();
