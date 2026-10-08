import assert from "node:assert/strict";
import { test } from "vitest";

import { FormSlugConflictError } from "../index.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./support/repo-ports.fixture.js";
import { formDefinitionRepoFor, formSubmissionRepoFor } from "./support/repo-ports.fixture.js";
import { eachFormsDialect } from "./support/dialect-matrix.fixture.js";
import type { FormDefinitionRepoPort, FormSubmissionRepoPort } from "./support/repo-ports.fixture.js";
import type { FormDefinitionRecord, FormSubmissionRecord } from "../index.js";

/**
 * @file Shared contract-test suite for `FormDefinitionRepoPort`/`FormSubmissionRepoPort`
 * (C-012, ADR-PIPE-010 rule-of-two). Runs against both `repo.memory.ts` and `repo.sqlite.ts`.
 *
 * The trash-aware-reads block below (Batch B1, owner ruling 2026-09-21) trashes a row through a
 * per-adapter HARNESS SEAM rather than through the port — the port structurally has no method that
 * trashes a row (only `features/trash/adapters/form.ts`'s `hide` does, and that is exercised
 * separately in `features/trash/__tests__/form-adapter.test.ts`). The seam is a raw `UPDATE` for
 * SQLite and the memory adapter's own trash-blind `findAnyById`/`save` for memory — deliberately NOT
 * `FormDefinitionRepoPort` methods, so this file still proves the PORT's contract, not the adapter's.
 */

const NOW = "2026-07-13T00:00:00.000Z";
const WORKSPACE_ID = "ws-1";

function makeDefinition(overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id: "def-1",
    workspaceId: WORKSPACE_ID,
    name: "Contact",
    slug: "contact",
    fields: [{ id: "name", label: "Name", type: "text", required: true }],
    notify: { enabled: false, recipients: [] },
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function makeSubmission(overrides: Partial<FormSubmissionRecord> = {}): FormSubmissionRecord {
  return {
    id: "sub-1",
    workspaceId: WORKSPACE_ID,
    formDefinitionId: "def-1",
    data: { name: "Ada" },
    sourceIp: "127.0.0.1",
    submittedAt: NOW,
    ...overrides,
  };
}

/** A per-adapter seam that trashes a row WITHOUT going through the port (see file header). */
interface DefinitionHarness {
  repo: FormDefinitionRepoPort;
  trashRow: (id: string) => Promise<void>;
}

function runDefinitionContractSuite(adapterName: string, makeHarness: () => DefinitionHarness) {
  const makeRepo = () => makeHarness().repo;

  test(`[${adapterName}] create + findById round-trips`, async () => {
    const repo = makeRepo();
    await repo.create(makeDefinition());
    const found = await repo.findById({ workspaceId: WORKSPACE_ID, id: "def-1" });
    assert.equal(found?.slug, "contact");
  });

  test(`[${adapterName}] findBySlug returns null for an unknown slug`, async () => {
    const repo = makeRepo();
    const found = await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "nope" });
    assert.equal(found, null);
  });

  test(`[${adapterName}] create rejects a duplicate slug in the same workspace with FormSlugConflictError (behavior.spec.md §6.1)`, async () => {
    const repo = makeRepo();
    await repo.create(makeDefinition());
    await assert.rejects(
      () => repo.create(makeDefinition({ id: "def-2" })),
      FormSlugConflictError
    );
  });

  test(`[${adapterName}] create allows the same slug in a different workspace`, async () => {
    const repo = makeRepo();
    await repo.create(makeDefinition());
    await repo.create(makeDefinition({ id: "def-2", workspaceId: "ws-2" }));
    const found = await repo.findBySlug({ workspaceId: "ws-2", slug: "contact" });
    assert.equal(found?.id, "def-2");
  });

  test(`[${adapterName}] list returns only the requested workspace's definitions`, async () => {
    const repo = makeRepo();
    await repo.create(makeDefinition());
    await repo.create(makeDefinition({ id: "def-2", workspaceId: "ws-2", slug: "other" }));
    const list = await repo.list({ workspaceId: WORKSPACE_ID });
    assert.equal(list.length, 1);
    assert.ok(list[0]);
    assert.equal(list[0].id, "def-1");
  });

  test(`[${adapterName}] update persists a status change without changing the id`, async () => {
    const repo = makeRepo();
    await repo.create(makeDefinition());
    const created = await repo.findById({ workspaceId: WORKSPACE_ID, id: "def-1" });
    await repo.update({ ...created!, status: "disabled" });
    const found = await repo.findById({ workspaceId: WORKSPACE_ID, id: "def-1" });
    assert.equal(found?.status, "disabled");
  });

  test(`[${adapterName}] FormDefinitionRepoPort exposes no delete method — a definition is removed only by a Trash purge`, () => {
    const repo = makeRepo();
    assert.equal((repo as unknown as { delete?: unknown }).delete, undefined);
  });

  // -------------------------------------------------------------------------
  // Trash-aware reads (Batch B1, owner ruling 2026-09-21) — see file header for the harness seam.
  // -------------------------------------------------------------------------

  test(`[${adapterName}] findById/findBySlug/list hide a trashed row`, async () => {
    const { repo, trashRow } = makeHarness();
    await repo.create(makeDefinition());
    await trashRow("def-1");

    assert.equal(await repo.findById({ workspaceId: WORKSPACE_ID, id: "def-1" }), null);
    assert.equal(await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "contact" }), null);
    assert.deepEqual(await repo.list({ workspaceId: WORKSPACE_ID }), []);
  });

  test(`[${adapterName}] isSlugTaken is true for a trashed slug (trash-blind, unlike find*)`, async () => {
    const { repo, trashRow } = makeHarness();
    await repo.create(makeDefinition());
    await trashRow("def-1");

    assert.equal(await repo.isSlugTaken({ workspaceId: WORKSPACE_ID, slug: "contact" }), true);
    assert.equal(await repo.isSlugTaken({ workspaceId: WORKSPACE_ID, slug: "nope" }), false);
  });

  test(`[${adapterName}] create with a slug in the Trash rejects with FormSlugConflictError naming the Trash`, async () => {
    const { repo, trashRow } = makeHarness();
    await repo.create(makeDefinition());
    await trashRow("def-1");

    await assert.rejects(() => repo.create(makeDefinition({ id: "def-2" })), (err: unknown) => {
      assert.ok(err instanceof FormSlugConflictError);
      assert.match(err.message, /Trash/);
      return true;
    });
  });

  test(`[${adapterName}] update() of a stale (now-trashed) record never revives it`, async () => {
    const { repo, trashRow } = makeHarness();
    await repo.create(makeDefinition());
    // The caller's own in-hand copy, taken BEFORE the row was trashed out from under it.
    const staleCopy = makeDefinition();
    await trashRow("def-1");

    await repo.update({ ...staleCopy, status: "disabled" });
    assert.equal(
      await repo.findById({ workspaceId: WORKSPACE_ID, id: "def-1" }),
      null,
      "update() must not clear deleted_at — the row must still read as trashed"
    );
  });
}

/**
 * `makeRepos` returns a fresh `{ submissionRepo, definitionRepo }` pair sharing one storage
 * instance and pre-seeds a parent `form_definitions` row (id `def-1`) — required by the SQLite
 * adapter's real FK (`form_submissions.form_definition_id`); a no-op precondition for the
 * in-memory adapter, which has no such constraint.
 */
function runSubmissionContractSuite(
  adapterName: string,
  makeRepos: () => {
    submissionRepo: FormSubmissionRepoPort;
    definitionRepo: FormDefinitionRepoPort;
    /** Marks a submission trashed the way the Trash's own adapter does — outside the port. */
    trashRow: (id: string) => Promise<void>;
  }
) {
  async function makeSeededRepo(): Promise<FormSubmissionRepoPort> {
    const { submissionRepo, definitionRepo } = makeRepos();
    await definitionRepo.create(makeDefinition());
    return submissionRepo;
  }

  test(`[${adapterName}] create + findById round-trips submission data`, async () => {
    const repo = await makeSeededRepo();
    await repo.create(makeSubmission());
    const found = await repo.findById({ workspaceId: WORKSPACE_ID, id: "sub-1" });
    assert.deepEqual(found?.data, { name: "Ada" });
  });

  test(`[${adapterName}] listByDefinition returns newest-first`, async () => {
    const repo = await makeSeededRepo();
    await repo.create(makeSubmission({ id: "sub-1", submittedAt: "2026-07-13T00:00:00.000Z" }));
    await repo.create(makeSubmission({ id: "sub-2", submittedAt: "2026-07-13T00:01:00.000Z" }));
    const page = await repo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
    assert.deepEqual(page.items.map((i) => i.id), ["sub-2", "sub-1"]);
    assert.equal(page.nextCursor, null);
  });

  test(`[${adapterName}] listByDefinition paginates via cursor`, async () => {
    const repo = await makeSeededRepo();
    await repo.create(makeSubmission({ id: "sub-1", submittedAt: "2026-07-13T00:00:00.000Z" }));
    await repo.create(makeSubmission({ id: "sub-2", submittedAt: "2026-07-13T00:01:00.000Z" }));
    await repo.create(makeSubmission({ id: "sub-3", submittedAt: "2026-07-13T00:02:00.000Z" }));

    const firstPage = await repo.listByDefinition({
      workspaceId: WORKSPACE_ID,
      formDefinitionId: "def-1",
      limit: 2,
    });
    assert.deepEqual(firstPage.items.map((i) => i.id), ["sub-3", "sub-2"]);
    assert.ok(firstPage.nextCursor);

    const secondPage = await repo.listByDefinition({
      workspaceId: WORKSPACE_ID,
      formDefinitionId: "def-1",
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    assert.deepEqual(secondPage.items.map((i) => i.id), ["sub-1"]);
    assert.equal(secondPage.nextCursor, null);
  });

  test(`[${adapterName}] listByDefinition returns an empty page for a definition with no submissions (EC-08)`, async () => {
    const { submissionRepo } = makeRepos();
    const page = await submissionRepo.listByDefinition({
      workspaceId: WORKSPACE_ID,
      formDefinitionId: "def-none",
      limit: 10,
    });
    assert.deepEqual(page.items, []);
    assert.equal(page.nextCursor, null);
  });

  test(`[${adapterName}] a trashed submission is hidden from findById and listByDefinition`, async () => {
    const { submissionRepo: repo, definitionRepo, trashRow } = makeRepos();
    await definitionRepo.create(makeDefinition());
    await repo.create(makeSubmission({ id: "sub-1", submittedAt: "2026-07-13T00:00:00.000Z" }));
    await repo.create(makeSubmission({ id: "sub-2", submittedAt: "2026-07-13T00:01:00.000Z" }));
    await trashRow("sub-1");

    assert.equal(await repo.findById({ workspaceId: WORKSPACE_ID, id: "sub-1" }), null);
    const page = await repo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
    assert.deepEqual(page.items.map((i) => i.id), ["sub-2"]);
  });

  test(`[${adapterName}] a submission from another workspace is isolated`, async () => {
    const repo = await makeSeededRepo();
    await repo.create(makeSubmission());
    const found = await repo.findById({ workspaceId: "ws-other", id: "sub-1" });
    assert.equal(found, null);
  });
}

runDefinitionContractSuite("InMemoryFormDefinitionRepo", () => {
  const repo = new InMemoryFormDefinitionRepo();
  return {
    repo,
    // The memory adapter's own trash-blind seam (see file header) — NOT a port method.
    trashRow: async (id: string) => {
      const existing = await repo.findAnyById({ workspaceId: WORKSPACE_ID, id });
      if (existing) await repo.save({ ...existing, deletedAt: NOW });
    },
  };
});
runSubmissionContractSuite("InMemoryFormSubmissionRepo", () => {
  const submissionRepo = new InMemoryFormSubmissionRepo();
  return {
    submissionRepo,
    definitionRepo: new InMemoryFormDefinitionRepo(),
    trashRow: async (id: string) => {
      const existing = await submissionRepo.findAnyById({ workspaceId: WORKSPACE_ID, id });
      if (existing) await submissionRepo.save({ ...existing, deletedAt: NOW });
    },
  };
});

for (const each of eachFormsDialect()) {
  runDefinitionContractSuite(`SqlFormDefinitionRepo [${each.name}]`, () => {
    const kernel = each.make();
    return {
      repo: formDefinitionRepoFor(kernel),
      // A raw UPDATE (see file header) — NOT a port method; the real Trash flip is
      // `features/trash/adapters/form.ts`'s `hide`, exercised in its own test file.
      trashRow: async (id: string) => {
        await kernel.run(db => db.updateTable("form_definitions").set({ deleted_at: NOW }).where("id", "=", id).execute());
      },
    };
  });
  runSubmissionContractSuite(`SqlFormSubmissionRepo [${each.name}]`, () => {
    const kernel = each.make();
    return {
      submissionRepo: formSubmissionRepoFor(kernel),
      definitionRepo: formDefinitionRepoFor(kernel),
      trashRow: async (id: string) => {
        await kernel.run(db => db.updateTable("form_submissions").set({ deleted_at: NOW }).where("id", "=", id).execute());
      },
    };
  });
}


test("memory Trash seams remove only the scoped definition and its submissions, including hidden submissions", async () => {
  const definitions = new InMemoryFormDefinitionRepo();
  const submissions = new InMemoryFormSubmissionRepo();
  await definitions.create(makeDefinition());
  await definitions.create(makeDefinition({ id: "def-2", slug: "other" }));
  await definitions.create(makeDefinition({ id: "def-foreign", workspaceId: "ws-2" }));
  await submissions.create(makeSubmission());
  await submissions.create(makeSubmission({ id: "sub-hidden" }));
  await submissions.create(makeSubmission({ id: "sub-sibling", formDefinitionId: "def-2" }));
  await submissions.create(makeSubmission({ id: "sub-foreign", workspaceId: "ws-2" }));
  const hidden = await submissions.findAnyById({ workspaceId: WORKSPACE_ID, id: "sub-hidden" });
  assert.ok(hidden);
  await submissions.save({ ...hidden, deletedAt: NOW });
  const definition = await definitions.findAnyById({ workspaceId: WORKSPACE_ID, id: "def-1" });
  assert.ok(definition);
  await definitions.save({ ...definition, deletedAt: NOW });
  await definitions.hardDelete({ workspaceId: "wrong", id: "def-1" });
  await submissions.hardDelete({ workspaceId: "wrong", id: "sub-hidden" });
  await submissions.deleteAllForDefinition({ workspaceId: "wrong", formDefinitionId: "def-1" });
  assert.ok(await definitions.findAnyById({ workspaceId: WORKSPACE_ID, id: "def-1" }));
  assert.ok(await submissions.findAnyById({ workspaceId: WORKSPACE_ID, id: "sub-1" }));
  assert.ok(await submissions.findAnyById({ workspaceId: WORKSPACE_ID, id: "sub-hidden" }));
  await submissions.deleteAllForDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1" });
  await definitions.hardDelete({ workspaceId: WORKSPACE_ID, id: "def-1" });
  assert.equal(await definitions.findAnyById({ workspaceId: WORKSPACE_ID, id: "def-1" }), null);
  for (const id of ["sub-1", "sub-hidden"]) assert.equal(await submissions.findAnyById({ workspaceId: WORKSPACE_ID, id }), null);
  assert.ok(await definitions.findById({ workspaceId: WORKSPACE_ID, id: "def-2" }));
  assert.ok(await definitions.findById({ workspaceId: "ws-2", id: "def-foreign" }));
  assert.deepEqual(await submissions.findById({ workspaceId: WORKSPACE_ID, id: "sub-sibling" }), makeSubmission({ id: "sub-sibling", formDefinitionId: "def-2" }));
  assert.deepEqual(await submissions.findById({ workspaceId: "ws-2", id: "sub-foreign" }), makeSubmission({ id: "sub-foreign", workspaceId: "ws-2" }));
  await submissions.hardDelete({ workspaceId: WORKSPACE_ID, id: "sub-sibling" });
  assert.equal(await submissions.findAnyById({ workspaceId: WORKSPACE_ID, id: "sub-sibling" }), null);
  assert.ok(await submissions.findById({ workspaceId: "ws-2", id: "sub-foreign" }));
});
