import assert from "node:assert/strict";
import { test } from "vitest";

import { createTaxonomyPurgeFollowUp, createTermPurgeFollowUp } from "../taxonomy-trash-follow-ups.js";
import type { TrashFollowUpHooks } from "../../trash/follow-ups.js";
import type { PurgeTrashLookupPort, TaxonomyEventOutboxPort, TaxonomyRevisionWritePort } from "../taxonomy-trash-follow-ups.js";

/**
 * @file Pure unit tests for the purge-only follow-ups (T6 item 5) — every dependency is a fake,
 * same style as `trash-term.test.ts`. Proves the revision + event shapes match `deleteTerm`/
 * `deleteTaxonomy` (`write-service.ts`), that the actor comes from the Trash row's own
 * `actorPrincipalId` (nothing else carries one down to a purge), and that `afterPurge` no-ops when
 * `beforePurge` found nothing (the defensive branch).
 */

const clock = { nowIso: () => "2026-09-21T12:00:00.000Z" };

function recordingRevisions(): TaxonomyRevisionWritePort & { rows: unknown[] } {
  const rows: unknown[] = [];
  return { rows, insert: async (row) => void rows.push(row) };
}

function recordingOutbox(): TaxonomyEventOutboxPort & { events: Record<string, unknown>[] } {
  const events: Record<string, unknown>[] = [];
  return { events, enqueue: async ({ event }) => void events.push(event) };
}

function trashLookup(row: { actorPrincipalId: string } | null, entityType = "term", entityId = "term-1"): PurgeTrashLookupPort {
  return { findByEntity: async required => {
    assert.deepEqual(required, { workspaceId: "ws-1", entityType, entityId });
    return row;
  } };
}

test("term purge follow-up: beforePurge reads the term (trash-blind) and the Trash row's actor, afterPurge writes the revision + event", async () => {
  const revisions = recordingRevisions();
  const outbox = recordingOutbox();
  const hooks = createTermPurgeFollowUp({
    termRepo: { findForPurgeAudit: async id => { assert.equal(id, "term-1"); return { id: "term-1", name: "Red", taxonomyId: "tax-1" }; } },
    trash: trashLookup({ actorPrincipalId: "user-1" }),
    revisions,
    outbox,
    clock,
  });

  const _check: Pick<TrashFollowUpHooks, "beforePurge" | "afterPurge"> = hooks;
  assert.equal(_check, hooks);
  const priorState = await hooks.beforePurge({ workspaceId: "ws-1", entityId: "term-1" });
  await hooks.afterPurge({ workspaceId: "ws-1", entityId: "term-1", priorState });

  assert.deepEqual(revisions.rows, [
    { taxonomyId: "tax-1", op: "delete", previousState: { termId: "term-1", name: "Red" }, actorId: "user-1", recordedAt: "2026-09-21T12:00:00.000Z" },
  ]);
  assert.deepEqual(outbox.events, [
    { name: "taxonomy.term_deleted", termId: "term-1", taxonomyId: "tax-1", actorId: "user-1", occurredAt: "2026-09-21T12:00:00.000Z" },
  ]);
});

test("term purge follow-up: no Trash row found falls back to an 'unknown' actor rather than throwing", async () => {
  const revisions = recordingRevisions();
  const outbox = recordingOutbox();
  const hooks = createTermPurgeFollowUp({
    termRepo: { findForPurgeAudit: async id => { assert.equal(id, "term-1"); return { id: "term-1", name: "Red", taxonomyId: "tax-1" }; } },
    trash: trashLookup(null),
    revisions,
    outbox,
    clock,
  });

  const priorState = await hooks.beforePurge({ workspaceId: "ws-1", entityId: "term-1" });
  await hooks.afterPurge({ workspaceId: "ws-1", entityId: "term-1", priorState });

  assert.equal((revisions.rows[0] as { actorId: string }).actorId, "unknown");
  assert.equal((outbox.events[0] as { actorId: string }).actorId, "unknown");
});

test("term purge follow-up: afterPurge no-ops when beforePurge found nothing (defensive — never reached through withFollowUps)", async () => {
  const revisions = recordingRevisions();
  const outbox = recordingOutbox();
  const hooks = createTermPurgeFollowUp({
    termRepo: { findForPurgeAudit: async id => { assert.equal(id, "does-not-exist"); return null; } },
    trash: trashLookup({ actorPrincipalId: "user-1" }),
    revisions,
    outbox,
    clock,
  });

  const priorState = await hooks.beforePurge({ workspaceId: "ws-1", entityId: "does-not-exist" });
  assert.equal(priorState, null);
  await hooks.afterPurge({ workspaceId: "ws-1", entityId: "does-not-exist", priorState });

  assert.deepEqual(revisions.rows, []);
  assert.deepEqual(outbox.events, []);
});

test("taxonomy purge follow-up: beforePurge reads every member term id regardless of status, afterPurge writes the revision + event", async () => {
  const revisions = recordingRevisions();
  const outbox = recordingOutbox();
  const hooks = createTaxonomyPurgeFollowUp({
    termRepo: { listIdsForPurgeAudit: async id => { assert.equal(id, "tax-1"); return ["term-1", "term-2"]; } },
    trash: trashLookup({ actorPrincipalId: "user-1" }, "taxonomy", "tax-1"),
    revisions,
    outbox,
    clock,
  });

  const priorState = await hooks.beforePurge({ workspaceId: "ws-1", entityId: "tax-1" });
  await hooks.afterPurge({ workspaceId: "ws-1", entityId: "tax-1", priorState });

  assert.deepEqual(revisions.rows, [
    { taxonomyId: "tax-1", op: "delete", previousState: { deletedTermIds: ["term-1", "term-2"] }, actorId: "user-1", recordedAt: "2026-09-21T12:00:00.000Z" },
  ]);
  assert.deepEqual(outbox.events, [
    { name: "taxonomy.deleted", taxonomyId: "tax-1", deletedTermIds: ["term-1", "term-2"], actorId: "user-1", occurredAt: "2026-09-21T12:00:00.000Z" },
  ]);
});

test("taxonomy purge follow-up: an empty (member-less) taxonomy still writes a revision + event with an empty deletedTermIds", async () => {
  const revisions = recordingRevisions();
  const outbox = recordingOutbox();
  const hooks = createTaxonomyPurgeFollowUp({
    termRepo: { listIdsForPurgeAudit: async id => { assert.equal(id, "tax-1"); return []; } },
    trash: trashLookup({ actorPrincipalId: "user-1" }, "taxonomy", "tax-1"),
    revisions,
    outbox,
    clock,
  });

  const priorState = await hooks.beforePurge({ workspaceId: "ws-1", entityId: "tax-1" });
  await hooks.afterPurge({ workspaceId: "ws-1", entityId: "tax-1", priorState });

  assert.deepEqual((revisions.rows[0] as { previousState: unknown }).previousState, { deletedTermIds: [] });
  assert.deepEqual((outbox.events[0] as { deletedTermIds: unknown }).deletedTermIds, []);
});

test("taxonomy purge follow-up: no Trash row found falls back to an 'unknown' actor in both the revision and the event", async () => {
  const revisions = recordingRevisions();
  const outbox = recordingOutbox();
  const hooks = createTaxonomyPurgeFollowUp({
    termRepo: { listIdsForPurgeAudit: async id => { assert.equal(id, "tax-1"); return ["term-1"]; } },
    trash: trashLookup(null, "taxonomy", "tax-1"),
    revisions,
    outbox,
    clock,
  });

  const priorState = await hooks.beforePurge({ workspaceId: "ws-1", entityId: "tax-1" });
  await hooks.afterPurge({ workspaceId: "ws-1", entityId: "tax-1", priorState });

  assert.deepEqual(priorState, { deletedTermIds: ["term-1"], actorId: "unknown" });
  assert.equal((revisions.rows[0] as { actorId: unknown }).actorId, "unknown");
  assert.equal(outbox.events[0]?.actorId, "unknown");
});

test('purge captures actor and member IDs before removal, then emits one shared timestamp', async () => {
  let removed = false;
  let ticks = 0;
  const seen: unknown[] = [];
  const hooks = createTaxonomyPurgeFollowUp({
    termRepo: { listIdsForPurgeAudit: async () => { assert.equal(removed, false); return ['one', 'two']; } },
    trash: { findByEntity: async () => { assert.equal(removed, false); return { actorPrincipalId: 'captured' }; } },
    revisions: { insert: async row => { seen.push(['revision', row]); } },
    outbox: { enqueue: async ({ event }) => { seen.push(['event', event]); } },
    clock: { nowIso: () => `time-${++ticks}` },
  });
  const priorState = await hooks.beforePurge({ workspaceId: 'ws', entityId: 'taxonomy' });
  removed = true;
  await hooks.afterPurge({ workspaceId: 'ws', entityId: 'taxonomy', priorState });
  assert.equal(ticks, 1);
  assert.deepEqual(seen, [
    ['revision', { taxonomyId: 'taxonomy', op: 'delete', previousState: { deletedTermIds: ['one', 'two'] }, actorId: 'captured', recordedAt: 'time-1' }],
    ['event', { name: 'taxonomy.deleted', taxonomyId: 'taxonomy', deletedTermIds: ['one', 'two'], actorId: 'captured', occurredAt: 'time-1' }],
  ]);
});

test('term purge uses captured term and actor after removal and one timestamp for both writes', async () => {
  let removed = false;
  let ticks = 0;
  const revisions = recordingRevisions();
  const outbox = recordingOutbox();
  const hooks = createTermPurgeFollowUp({
    termRepo: { findForPurgeAudit: async () => { assert.equal(removed, false); return { id: 'term', taxonomyId: 'taxonomy', name: 'Captured' }; } },
    trash: { findByEntity: async () => { assert.equal(removed, false); return { actorPrincipalId: 'captured' }; } },
    revisions, outbox, clock: { nowIso: () => `time-${++ticks}` },
  });
  const priorState = await hooks.beforePurge({ workspaceId: 'ws', entityId: 'term' });
  removed = true;
  await hooks.afterPurge({ workspaceId: 'ws', entityId: 'term', priorState });
  assert.equal(ticks, 1);
  assert.deepEqual(revisions.rows, [{ taxonomyId: 'taxonomy', op: 'delete', previousState: { termId: 'term', name: 'Captured' }, actorId: 'captured', recordedAt: 'time-1' }]);
  assert.deepEqual(outbox.events, [{ name: 'taxonomy.term_deleted', termId: 'term', taxonomyId: 'taxonomy', actorId: 'captured', occurredAt: 'time-1' }]);
});
