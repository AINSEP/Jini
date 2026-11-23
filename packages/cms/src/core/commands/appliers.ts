import type { EntityReverter, RevertRegistry } from "@jini-ai/core/contracts/site/core-commands";
export type { EntityReverter, RevertRegistry } from "@jini-ai/core/contracts/site/core-commands";

/**
 * @file Inverse-applier registry.
 *
 * Purpose:
 * A generic `(entityType, operation)` -> `EntityReverter` registry that `revert.ts`'s
 * `revertChangeSet` consumes to (a) read an entity's current version for the revert guard and (b)
 * restore it from a change-set item's inverse payload. Keeps `revert.ts` free of per-entity-type
 * branching — new revertible entity types register an `EntityReverter` here. The
 * `EntityReverter`/`RevertRegistry` shapes are declared type-only in
 * `@jini-ai/core/contracts/site/core-commands` and re-exported here.
 *
 * Core holds only the generic registry, never feature-specific reverters.
 * Concrete reverters live with their domains; composition roots construct and register them at
 * boot. They close over the root's shared adapters rather than importing feature or DB code here.
 */

const registryKey = (entityType: string, operation: string): string =>
  `${entityType}:${operation}`;

export function createRevertRegistry(
  _required: Record<string, never>,
  _optional: Record<string, never> = {},
): RevertRegistry {
  const map = new Map<string, EntityReverter>();
  return {
    register(entityType, operation, reverter) {
      map.set(registryKey(entityType, operation), reverter);
    },
    resolve(entityType, operation) {
      return map.get(registryKey(entityType, operation));
    },
  };
}
