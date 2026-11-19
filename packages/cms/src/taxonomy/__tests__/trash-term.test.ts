import assert from "node:assert/strict";
import { test } from "vitest";

import { trashTaxonomy, trashTerm } from "../trash-term.js";
import type { RemoveTaxonomyFn, RemoveTermFn, TaxonomyTrashReadPort, TermTrashReadPort } from "../trash-term.js";

/**
 * @file Pure unit tests for `trashTerm`/`trashTaxonomy` (T6 commit 2) — every dependency is a
 * fake, same style as `features/forms/__tests__/delete-submission.test.ts` (the precedent this
 * file's shape follows). Proves the two thin read-then-`remove` flows without a database: a
 * missing/already-trashed row (the read port already filters `hiddenWithParent`, see
 * `repo.sqlite.ts`) is `not-found`; the registry's `term` display (`{title: name, subtitle:
 * taxonomy name}`) and `taxonomy` display (`{title: name}`) reach `remove` unchanged; every
 * `remove` outcome (`ok`, `not-found`, `version-changed`, and — term only — `blocked`) passes
 * straight through.
 */

const clock = { nowIso: () => "2026-09-21T00:00:00.000Z" };
const actor = { principalId: "user-1" };

function termReadPort(row: { id: string; name: string; taxonomyName: string; version: number } | null): TermTrashReadPort {
  return { findForTrash: async (id) => { assert.equal(id, "term-1"); return row && row.id === id ? row : null; } };
}

function taxonomyReadPort(row: { id: string; name: string; version: number } | null): TaxonomyTrashReadPort {
  return { findForTrash: async (id) => { assert.equal(id, "tax-1"); return row && row.id === id ? row : null; } };
}

test("trashTerm: a missing/already-trashed term (read port returns null) is not-found, remove is never called", async () => {
  let called = false;
  const remove: RemoveTermFn = async () => {
    called = true;
    return { ok: true, version: 1 };
  };
  const result = await trashTerm(
    { workspaceId: "ws-1", termId: "term-1", actor, termRepo: termReadPort(null), remove, clock }
  );
  assert.deepEqual(result, { ok: false, reason: "not-found" });
  assert.equal(called, false);
});

test("trashTerm: calls remove with the registry's term display (title=name, subtitle=taxonomy name) and the read version", async () => {
  let seen: Parameters<RemoveTermFn>[0] | undefined;
  const remove: RemoveTermFn = async (required) => {
    seen = required;
    return { ok: true, version: 2 };
  };
  const result = await trashTerm(
    { workspaceId: "ws-1", termId: "term-1", actor, termRepo: termReadPort({ id: "term-1", name: "Red", taxonomyName: "Colors", version: 1 }), remove, clock }
  );
  assert.deepEqual(result, { ok: true, version: 2 });
  assert.deepEqual(seen, {
    workspaceId: "ws-1",
    id: "term-1",
    display: { title: "Red", subtitle: "Colors" },
    at: "2026-09-21T00:00:00.000Z",
    expectedVersion: 1,
    actor,
  });
});

test("trashTerm: a 'blocked' remove outcome (TERM_HAS_CHILDREN) passes through unchanged", async () => {
  const remove: RemoveTermFn = async () => ({ ok: false, reason: "blocked", code: "TERM_HAS_CHILDREN", count: 2 });
  const result = await trashTerm(
    { workspaceId: "ws-1", termId: "term-1", actor, termRepo: termReadPort({ id: "term-1", name: "Parent", taxonomyName: "Colors", version: 1 }), remove, clock }
  );
  assert.deepEqual(result, { ok: false, reason: "blocked", code: "TERM_HAS_CHILDREN", count: 2 });
});

test("trashTerm: a 'version-changed' remove outcome passes through unchanged", async () => {
  const remove: RemoveTermFn = async () => ({ ok: false, reason: "version-changed" });
  const result = await trashTerm(
    { workspaceId: "ws-1", termId: "term-1", actor, termRepo: termReadPort({ id: "term-1", name: "Red", taxonomyName: "Colors", version: 1 }), remove, clock }
  );
  assert.deepEqual(result, { ok: false, reason: "version-changed" });
});

test("trashTaxonomy: a missing/already-trashed taxonomy is not-found, remove is never called", async () => {
  let called = false;
  const remove: RemoveTaxonomyFn = async () => {
    called = true;
    return { ok: true, version: 1 };
  };
  const result = await trashTaxonomy(
    { workspaceId: "ws-1", taxonomyId: "tax-1", actor, taxonomyRepo: taxonomyReadPort(null), remove, clock }
  );
  assert.deepEqual(result, { ok: false, reason: "not-found" });
  assert.equal(called, false);
});

test("trashTaxonomy: calls remove with the registry's taxonomy display ({title: name}, no subtitle) and the read version", async () => {
  let seen: Parameters<RemoveTaxonomyFn>[0] | undefined;
  const remove: RemoveTaxonomyFn = async (required) => {
    seen = required;
    return { ok: true, version: 3 };
  };
  const result = await trashTaxonomy(
    { workspaceId: "ws-1", taxonomyId: "tax-1", actor, taxonomyRepo: taxonomyReadPort({ id: "tax-1", name: "Colors", version: 2 }), remove, clock }
  );
  assert.deepEqual(result, { ok: true, version: 3 });
  assert.deepEqual(seen, {
    workspaceId: "ws-1",
    id: "tax-1",
    display: { title: "Colors" },
    at: "2026-09-21T00:00:00.000Z",
    expectedVersion: 2,
    actor,
  });
});

for (const reason of ["not-found", "version-changed"] as const) {
  test(`trashTaxonomy: ${reason} from remove passes through unchanged`, async () => {
    const outcome = { ok: false, reason } as const;
    const result = await trashTaxonomy({ workspaceId: "ws-1", taxonomyId: "tax-1", actor, taxonomyRepo: taxonomyReadPort({ id: "tax-1", name: "Colors", version: 2 }), clock, remove: async () => outcome });
    assert.deepEqual(result, outcome);
  });
}
