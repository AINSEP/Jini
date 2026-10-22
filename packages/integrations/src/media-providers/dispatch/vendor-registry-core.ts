/** Host-owned registry mechanics; builtin composition lives in vendor-registry.ts. */
import type { VendorAdapter, VendorAdapterLookup } from './types.js';

export class VendorAdapterRegistry implements VendorAdapterLookup {
  private readonly table = new Map<string, Map<string, VendorAdapter<never>>>();

  /** Registers `adapter` for `(providerId, routeKey)`. Throws if that pair is already registered — populate each host registry exactly once. */
  register<Meta>({ providerId, routeKey, adapter }: { providerId: string; routeKey: string; adapter: VendorAdapter<Meta> }): void {
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
  get({ providerId, routeKey }: { providerId: string; routeKey: string }): VendorAdapter<never> | undefined {
    return this.table.get(providerId)?.get(routeKey);
  }

  /** Whether an adapter is registered for `(providerId, routeKey)`. */
  has({ providerId, routeKey }: { providerId: string; routeKey: string }): boolean {
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
