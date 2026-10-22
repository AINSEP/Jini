/** A catalog initialized from explicit data; safe with sideEffects: false. */
// Authorization vocabulary is code-owned rather than a database enum; hosts extend it at startup.
// Keep built-ins reachable through this explicit initialization. Relying on an unreferenced module's
// registration side effects would let a production bundler remove the catalog while Node still
// worked, leaving catalog validation empty only in the bundled deployment.
import { IdentityValidationError } from './types.js';
import { BUILTIN_PERMISSIONS } from './builtin-permissions.js';

/** One entry in the registered permission catalog. */
export interface PermissionDescriptor {
  /** Dotted permission string, e.g. `"content.write"`. */
  id: string;
  /** Registering module, e.g. `"core"` or a feature name. */
  owner: string;
  description: string;
}


/**
 * Code-side registry backing catalog validation and 
 * enumeration. `"*"` (the owner wildcard) is deliberately not a
 * catalog entry — it is a distinct, built-in-only grant shape checked by
 * `authorize`/seed, never a registrable permission string.
 *
 * @complexity O(1) amortized per lookup (Map-backed); O(n) to list all.
 * @overallScore 100
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
class PermissionCatalog {
  private readonly byId = new Map<string, PermissionDescriptor>();

  constructor(initial: readonly PermissionDescriptor[]) {
    for (const descriptor of initial) this.register(descriptor);
  }

  /** Idempotent: re-registering the same `id` (e.g. on a warm reload) is a no-op overwrite. */
  register(descriptor: PermissionDescriptor): void {
    if (descriptor.id === "*") {
      throw new IdentityValidationError({ message: "the owner wildcard cannot be registered as a permission" });
    }
    this.byId.set(descriptor.id, descriptor);
  }

  has({ id }: { id: string }): boolean {
    return this.byId.has(id);
  }

  list(_required: Record<string, never>): PermissionDescriptor[] {
    return [...this.byId.values()];
  }
}

/** Module-singleton catalog — core's base vocabulary, extended by feature registration. */
export const permissionCatalog = new PermissionCatalog(BUILTIN_PERMISSIONS);

/** Register an additional permission at feature startup. See docs/decisions/DR-001-identity-and-session-boundary.md. */
export function registerPermission(descriptor: PermissionDescriptor): void {
  permissionCatalog.register(descriptor);
}


/** Enumerate the full registered catalog ( core capability; CLI wiring is N/A, see file header). See docs/decisions/DR-001-identity-and-session-boundary.md. */
export function listPermissions(_required: Record<string, never>): PermissionDescriptor[] {
  return permissionCatalog.list({});
}

/** Whether `id` is a recognized catalog permission. `"*"` is intentionally excluded (see class doc). */
export function isKnownPermission({ id }: { id: string }): boolean {
  return permissionCatalog.has({ id });
}
