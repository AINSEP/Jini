/**
 * @file Inverse-applier registry contract.
 *
 * Purpose:
 * The type-only half of `@jini-ai/cms/core/commands`'s `appliers.ts` (which re-exports it): a
 * generic `(entityType, operation)` -> `EntityReverter` registry that `revert.ts`'s
 * `revertChangeSet` consumes to (a) read an entity's current version for the revert guard and (b)
 * restore it from a change-set item's inverse payload. The registry factory stays in cms.
 *
 * Core holds only the generic registry contract, never feature-specific reverters.
 * Concrete reverters live with their domains; composition roots construct and register them at
 * boot. They close over the root's shared adapters rather than importing feature or DB code here.
 */

import type { UUID } from "../../primitives/index.js";
import type { ChangeSetItemRecord } from "../events/change-set.js";

/** Restore + version-read behavior for one `(entityType, operation)`. */
export interface EntityReverter {
  /**
   * Optional per-item authorization for undoing this kind. A grant to revert an ordinary audited
   * change must not confer a stricter write authority this kind's inverse needs, so when set, the
   * revert executor asks the caller's item authorizer for `permission` on each item (as
   * `authorizationEntityType ?? item.entityType`) before reading any version or writing any
   * inverse, and fails closed when no authorizer is supplied. `allowForce: false` refuses an
   * operator force past a newer version. The policy comes from this registration only, never from
   * client input or the stored inverse. Omitted: the kind keeps its existing behavior.
   */
  policy?: { permission: string; authorizationEntityType?: string; allowForce?: boolean };
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
  /**
   * Apply the item's inverse as a new write (bumps the entity version). `actorId` is the principal
   * performing the revert now, never the item's original writer.
   */
  applyInverse(required: { workspaceId: UUID; item: ChangeSetItemRecord }, optional?: { actorId?: UUID }): Promise<void>;
}

/** A mutable registry of entity reverters keyed by `(entityType, operation)`. */
export interface RevertRegistry {
  register(entityType: string, operation: string, reverter: EntityReverter): void;
  resolve(entityType: string, operation: string): EntityReverter | undefined;
}
