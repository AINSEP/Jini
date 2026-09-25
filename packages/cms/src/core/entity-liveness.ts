import { ToolInputError } from "@jini-ai/core";

/**
 * @file The write-side counterpart to `not-trashed.ts`'s read-side `notTrashed()` filter (Tovu
 * `features/trash/not-trashed.ts`).
 *
 * Purpose:
 * A recurring defect across this codebase's writers: a mutation loads its row with a `findById`
 * (or equivalent) that returns trashed and tombstoned rows just as readily as live ones, and never
 * asks whether the row it found is actually live before saving over it. Fixed per writer, that is
 * an unbounded number of near-identical patches, each one easy to forget on the next new writer.
 * This module is the one shared check every writer calls right after its own load, so the check
 * exists exactly once.
 *
 * Why it lives in `@jini-ai/cms/core` rather than in a Tovu module or a Jini domain package:
 * Tovu's writers (pages, SEO, redirects) and Jini's own domain writers (media, content-types,
 * taxonomy) both need it, Jini cannot import anything Tovu owns, and duplicating the check per side
 * reintroduces the drift this module exists to remove. `core` is the one place both reach.
 *
 * Why `EntityNotLiveError` extends `ToolInputError` rather than a plain `Error`: the daemon's tool
 * executor already treats `ToolInputError` as caller-facing (see `registration-kit.ts`'s doc
 * comment), so every domain's agent tool surfaces this error's message to the caller with no
 * per-domain allowlist entry, and every HTTP route that already maps `ToolInputError`-family errors
 * picks it up for free. A per-domain rule added to `contracts/core/model-facing-tool-errors.ts`
 * instead would be exactly the "correct primitive, unwired call site" defect this codebase keeps
 * hitting — the check would exist but a caller could still fail to wire it in.
 *
 * The message is built only from a fixed string, the entity kind and the caller's own id (never
 * from row content), so it satisfies `contracts/core/model-facing-tool-errors.ts`'s safety rule for
 * a caller-facing message with no redaction step.
 */

/** A record's liveness as far as this guard is concerned. `"live"` never throws. */
export type EntityLiveness = "live" | "trashed" | "tombstoned";

/**
 * Thrown by {@link assertEntityLive} for a non-live entity. `code` is the stable machine-readable
 * discriminant; `entityType`/`entityId`/`state` are the values the message was built from, kept on
 * the instance so a caller that wants to branch on them (rather than parse the message) can.
 */
export class EntityNotLiveError extends ToolInputError {
  readonly code: "ENTITY_IN_TRASH" | "ENTITY_TOMBSTONED";

  constructor(
    readonly entityType: string,
    readonly entityId: string,
    readonly state: "trashed" | "tombstoned"
  ) {
    super(buildEntityNotLiveMessage(entityType, entityId, state));
    this.name = "EntityNotLiveError";
    this.code = state === "trashed" ? "ENTITY_IN_TRASH" : "ENTITY_TOMBSTONED";
  }
}

/** @complexity O(1). Pure string formatting; the two messages are tested byte-for-byte. */
function buildEntityNotLiveMessage(entityType: string, entityId: string, state: "trashed" | "tombstoned"): string {
  if (state === "trashed") {
    return `ENTITY_IN_TRASH: ${entityType} '${entityId}' is in the Trash. Restore it from the Trash before changing it.`;
  }
  return `ENTITY_TOMBSTONED: ${entityType} '${entityId}' was permanently deleted and can't be changed.`;
}

/**
 * Throws {@link EntityNotLiveError} unless `required.state` is `"live"`. Call this immediately
 * after a writer's own load, before any mutation of the loaded row.
 * @complexity O(1).
 */
export function assertEntityLive(required: { entityType: string; entityId: string; state: EntityLiveness }): void {
  if (required.state === "live") return;
  throw new EntityNotLiveError(required.entityType, required.entityId, required.state);
}
