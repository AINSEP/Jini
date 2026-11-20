// The trash domain owns the shared adapter/hooks; these follow-ups remain structural.
/**
 * @file Purge-only Trash follow-ups for `term`/`taxonomy` (T6, trash parallel plan §2 step 5 /
 * §6 Q2). The generic table adapter (`features/trash/table-adapter.ts`) already performs the row
 * removal itself (`registry.ts`'s `term`/`taxonomy` entries); what it does NOT do is write the
 * audit trail `deleteTerm`/`deleteTaxonomy` (`@jini-ai/cms/taxonomy`) used to write alongside their
 * own delete — a `taxonomy_revisions` row plus a `taxonomy.term_deleted`/`taxonomy.deleted` event.
 * These two factories reproduce exactly those two writes, from `withFollowUps`'s `beforePurge`/
 * `afterPurge` hooks (`@jini-ai/cms/trash`), so nothing about the Trash's own purge path
 * has to know taxonomy-specific shapes.
 *
 * Trash and restore get NO extra hook here (the decision, plan §6 Q2): the Jini `TaxonomyRevisionRow`
 * union has no "trashed"/"restored" `op`, and adding one means a package release out of this
 * dispatch's scope. Both transitions still get the Trash's own generic `onChanged` watermark bump.
 *
 * No `features/trash` import (binding rule 2, "domains never import from trash") — every port below
 * is a structural type matching `follow-ups.ts`'s `BeforePurge`/`AfterPurge` shape, composed at
 * `server/runtime/composition/deps.ts`.
 *
 * Neither `TrashPort.purgeSelected` nor `TrashAdapter.purge` threads an actor or a timestamp down to
 * the adapter (`write-service.ts`'s `purgeSelected` calls `adapter.purge({workspaceId, entityId,
 * expectedVersion})` only, confirmed by reading it) — so `actorId` here is read back off the Trash
 * row itself via `trash.findByEntity`, which still exists at `beforePurge` time: `purgeSelected`
 * only deletes the index row AFTER `adapter.purge` (and therefore this hook) has already run. That
 * is "whoever most recently trashed this row", not a separate "who purged it" identity nothing in
 * this generic mechanism carries — disclosed here rather than silently misattributed. `at`/
 * `occurredAt` comes from the injected `clock`, read once per hook firing (purge has no caller-
 * supplied timestamp to reuse, unlike `hide`/`unhide`).
 */

/** The read `beforePurge` needs to find the Trash row's own recorded actor — `SqliteTrashRepo`/
 *  `InMemoryTrashRepo`'s `findByEntity` shape, declared here rather than imported from
 *  `features/trash`. */
export interface PurgeTrashLookupPort {
  findByEntity(required: {
    workspaceId: string;
    entityType: string;
    entityId: string;
  }): Promise<{ actorPrincipalId: string } | null>;
}

/** `TaxonomyRevisionRepoPort` (`@jini-ai/cms/taxonomy`)'s exact shape, declared structurally. */
export interface TaxonomyRevisionWritePort {
  insert(row: {
    taxonomyId: string;
    op: "delete";
    previousState: Record<string, unknown> | null;
    actorId: string;
    recordedAt: string;
  }): Promise<unknown>;
}

/** The loose `{enqueue({event})}` shape `toTaxonomyOutbox` (`@jini-ai/cms/taxonomy`) adapts a real
 *  outbox into — matched structurally so this file imports neither. Declared as a function-typed
 *  PROPERTY, not a method: method parameters are checked bivariantly, which is how the old flat
 *  `enqueue(event)` shape kept type-checking against Jini's `enqueue({event})` while every purge
 *  follow-up threw at runtime. A property is checked contravariantly, so a shape drift fails tsc. */
export interface TaxonomyEventOutboxPort {
  enqueue: (required: { event: Record<string, unknown> }) => Promise<void>;
}

/** `SqliteTermRepo.findForPurgeAudit`'s exact shape (`repo.sqlite.ts`) — trash-blind, since a
 *  purge only ever runs on an already-hidden row. */
export interface TermPurgeAuditReadPort {
  findForPurgeAudit(required: { id: string }): Promise<{ id: string; name: string; taxonomyId: string } | null>;
}

/** `SqliteTermRepo.listIdsForPurgeAudit`'s exact shape — every member term id regardless of its
 *  own or its taxonomy's status, matching what `registry.ts`'s taxonomy `purgeFirst` cascade is
 *  about to delete. */
export interface TaxonomyMemberIdsReadPort {
  listIdsForPurgeAudit(required: { taxonomyId: string }): Promise<string[]>;
}

interface TermPurgePriorState {
  taxonomyId: string;
  name: string | null;
  actorId: string;
}

interface TaxonomyPurgePriorState {
  deletedTermIds: string[];
  actorId: string;
}

/** A purge follow-up pair, structurally identical to `follow-ups.ts`'s `TrashFollowUpHooks`'s
 *  `beforePurge`/`afterPurge` fields (not imported — see the file header). */
export interface PurgeFollowUpHooks {
  beforePurge(required: { workspaceId: string; entityId: string }): Promise<unknown>;
  afterPurge(required: { workspaceId: string; entityId: string; priorState: unknown }): Promise<void>;
}

/**
 * The `term` entry's purge follow-up: one `taxonomy_revisions` row (`op:"delete"`) plus a
 * `taxonomy.term_deleted` event, matching `deleteTerm`'s own writes (`write-service.ts:568-593`).
 *
 * @complexity O(1): one term read, one Trash-row read, one revision insert, one enqueue.
 */
export function createTermPurgeFollowUp(deps: {
  termRepo: TermPurgeAuditReadPort;
  trash: PurgeTrashLookupPort;
  revisions: TaxonomyRevisionWritePort;
  outbox: TaxonomyEventOutboxPort;
  clock: { nowIso(): string };
}, _optional = {}): PurgeFollowUpHooks {
  return {
    async beforePurge({ workspaceId, entityId }): Promise<TermPurgePriorState | null> {
      const term = await deps.termRepo.findForPurgeAudit({ id: entityId });
      if (!term) return null;
      const trashItem = await deps.trash.findByEntity({ workspaceId, entityType: "term", entityId });
      return { taxonomyId: term.taxonomyId, name: term.name, actorId: trashItem?.actorPrincipalId ?? "unknown" };
    },
    async afterPurge({ entityId, priorState }): Promise<void> {
      const prior = priorState as TermPurgePriorState | null;
      // Defensive only: `afterPurge` fires solely on a `"purged"` outcome (`withFollowUps`'s own
      // rule), which means `beforePurge` just found the row a moment earlier inside the same
      // transaction — `prior` is null only if that invariant is ever broken elsewhere.
      if (!prior) return;
      const now = deps.clock.nowIso();
      await deps.revisions.insert({
        taxonomyId: prior.taxonomyId,
        op: "delete",
        previousState: { termId: entityId, name: prior.name },
        actorId: prior.actorId,
        recordedAt: now,
      });
      await deps.outbox.enqueue({
        event: {
          name: "taxonomy.term_deleted",
          termId: entityId,
          taxonomyId: prior.taxonomyId,
          actorId: prior.actorId,
          occurredAt: now,
        },
      });
    },
  };
}

/**
 * The `taxonomy` entry's purge follow-up: one `taxonomy_revisions` row (`op:"delete"`) plus a
 * `taxonomy.deleted` event carrying every member term id the cascade is about to remove with it,
 * matching `deleteTaxonomy`'s own writes (`write-service.ts:653-680`).
 *
 * @complexity O(t) in the taxonomy's member-term count — one id-only scan, one Trash-row read, one
 * revision insert, one enqueue.
 */
export function createTaxonomyPurgeFollowUp(deps: {
  termRepo: TaxonomyMemberIdsReadPort;
  trash: PurgeTrashLookupPort;
  revisions: TaxonomyRevisionWritePort;
  outbox: TaxonomyEventOutboxPort;
  clock: { nowIso(): string };
}, _optional = {}): PurgeFollowUpHooks {
  return {
    async beforePurge({ workspaceId, entityId }): Promise<TaxonomyPurgePriorState> {
      const deletedTermIds = await deps.termRepo.listIdsForPurgeAudit({ taxonomyId: entityId });
      const trashItem = await deps.trash.findByEntity({ workspaceId, entityType: "taxonomy", entityId });
      return { deletedTermIds, actorId: trashItem?.actorPrincipalId ?? "unknown" };
    },
    async afterPurge({ entityId, priorState }): Promise<void> {
      const prior = priorState as TaxonomyPurgePriorState;
      const now = deps.clock.nowIso();
      await deps.revisions.insert({
        taxonomyId: entityId,
        op: "delete",
        previousState: { deletedTermIds: prior.deletedTermIds },
        actorId: prior.actorId,
        recordedAt: now,
      });
      await deps.outbox.enqueue({
        event: {
          name: "taxonomy.deleted",
          taxonomyId: entityId,
          deletedTermIds: prior.deletedTermIds,
          actorId: prior.actorId,
          occurredAt: now,
        },
      });
    },
  };
}
