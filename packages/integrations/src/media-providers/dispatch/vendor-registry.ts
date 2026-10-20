/** Host-owned (provider, route) registration. Builtin registration stays in builtin-vendors. */
import type { VendorAdapter } from './vendor-adapter.js';
import { registerBuiltinVendorAdapters } from './builtin-vendors.js';

export class VendorAdapterRegistry {
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

/** Creates a fresh, empty registry for host-owned registrations. */
export function createVendorAdapterRegistry(): VendorAdapterRegistry {
  return new VendorAdapterRegistry();
}

/** Creates a fresh registry populated by the existing builtin-registration owner.
 * @returns An independent registry; duplicate route registration still throws.
 */
export function createBuiltinVendorAdapterRegistry(
  _required: Record<string, never> = {},
  _options: Record<string, never> = {},
): VendorAdapterRegistry {
  const registry = createVendorAdapterRegistry();
  registerBuiltinVendorAdapters({ registry });
  return registry;
}

// Preserve lazy singleton contents for existing callers; engines never consult it.
class BuiltinVendorAdapterRegistry extends VendorAdapterRegistry {
  private initialized = false;

  private initialize(): void {
    if (this.initialized) return;
    // Mark first: explicit registration below calls this instance's overridden register.
    this.initialized = true;
    registerBuiltinVendorAdapters({ registry: this });
  }

  override register<Meta>(required: { providerId: string; routeKey: string; adapter: VendorAdapter<Meta> }): void {
    this.initialize();
    super.register(required);
  }

  override get(required: { providerId: string; routeKey: string }): VendorAdapter<never> | undefined {
    this.initialize();
    return super.get(required);
  }

  override has(required: { providerId: string; routeKey: string }): boolean {
    this.initialize();
    return super.has(required);
  }

  override list(): ReadonlyArray<readonly [string, string]> {
    this.initialize();
    return super.list();
  }
}

/** @deprecated Construct and inject createBuiltinVendorAdapterRegistry() per host instead. */
export const mediaVendorRegistry: VendorAdapterRegistry = new BuiltinVendorAdapterRegistry();
