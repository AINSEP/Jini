/**
 * @file The inverse-applier (revert) registry port. Types only.
 *
 * Additive copy of `EntityReverter` and `RevertRegistry` from `@jini-ai/cms/core/commands`
 * (`core/commands/appliers.ts`). The `createRevertRegistry` factory and `revertChangeSet` stay in
 * cms, which keeps its identical declarations and exports until the paired cutover.
 *
 * A generic `(entityType, operation)` -> `EntityReverter` registry that `revert.ts`'s
 * `revertChangeSet` consumes to (a) read an entity's current version for the revert guard and (b)
 * restore it from a change-set item's inverse payload. Keeps `revert.ts` free of per-entity-type
 * branching — new revertible entity types register an `EntityReverter` here.
 *
 * Core holds only the generic registry, never feature-specific reverters.
 * Concrete reverters live with their domains; composition roots construct and register them at
 * boot. They close over the root's shared adapters rather than importing feature or DB code here.
 */

import type { UUID } from "../../primitives/ids.js";
import type { ChangeSetItemRecord } from "../events/change-set.js";

/** Restore + version-read behavior for one `(entityType, operation)`. */
export interface EntityReverter {
  /** Current entity version, or null when the entity no longer exists. */
  currentVersion(required: { workspaceId: UUID; entityId: UUID }): Promise<number | null>;
  /**
   * Optional: the raw principal id that produced the entity's CURRENT (still-live) write — used
   * only to enrich `revert.ts`'s version-conflict message with "who changed this" so a human can
   * judge whether to force past it. Optional: a missing or null result means "unknown".
   * Returns the raw id (never a
   * resolved display name), matching `gated-mutations/composition.ts`'s own disclosed
   * `resolveActorClassIdentity` precedent — resolving a friendlier name belongs at the route layer,
   * which already has `deps.principalRepo`, not here.
   */
  currentActor?(required: { workspaceId: UUID; entityId: UUID }): Promise<string | null>;
  /** Apply the item's inverse as a new write (bumps the entity version). */
  applyInverse(required: { workspaceId: UUID; item: ChangeSetItemRecord }): Promise<void>;
}

/** A mutable registry of entity reverters keyed by `(entityType, operation)`. */
export interface RevertRegistry {
  register(entityType: string, operation: string, reverter: EntityReverter): void;
  resolve(entityType: string, operation: string): EntityReverter | undefined;
}
