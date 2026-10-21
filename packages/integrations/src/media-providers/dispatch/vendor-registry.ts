/** Host-owned (provider, route) registration. Builtin registration stays in builtin-vendors. */
import type { VendorAdapter } from './types.js';
import { VendorAdapterRegistry } from './vendor-registry-core.js';
export { VendorAdapterRegistry } from './vendor-registry-core.js';
import { registerBuiltinVendorAdapters } from './builtin-vendors.js';

/** Creates a fresh, empty registry for host-owned registrations. */
export function createVendorAdapterRegistry(): VendorAdapterRegistry {
  return new VendorAdapterRegistry();
}

/** Creates a fresh registry populated by the existing builtin-registration owner.
 * @deprecated Adapters only, no catalogue: plugin vendors cannot validate through it. Build one
 *   `createMediaProviderRegistry()` at composition and pass it as `registry` and `catalog`.
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
/** @deprecated Build one createMediaProviderRegistry() per host composition and inject it instead. */

/** @deprecated Construct and inject createBuiltinVendorAdapterRegistry() per host instead. */
export const mediaVendorRegistry: VendorAdapterRegistry = new BuiltinVendorAdapterRegistry();
