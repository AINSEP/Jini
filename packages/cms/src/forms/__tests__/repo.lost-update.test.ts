import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { InMemoryFormDefinitionRepo } from "../repo.memory.js";
import { createFormAuthoring } from "../html/authoring-adapter.js";
import { formDefinitionRepoFor } from "../sql/index.js";
import { updateFormDefinition } from "../write-service.js";
import type { FormDefinitionRepoPort } from "../ports.js";
import type { FormDefinitionRecord } from "../types.js";
import { executeCommand } from "../../core/index.js";
import { InMemoryChangeSetRepo } from "./change-set.fixture.js";
import { describeEachDialect } from "./support/dialect-matrix.fixture.js";
import { tables } from "./support/forms-tables.fixture.js";

const WS = "workspace";
const TIME = "2026-11-13T00:00:00.000Z";

function definition(overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id: "form", workspaceId: WS, name: "Contact", slug: "contact", fields: [],
    notify: { enabled: false, recipients: [] }, status: "active", createdAt: TIME, updatedAt: TIME,
    version: 1, ...overrides,
  };
}

function cases(make: () => FormDefinitionRepoPort): void {
  test("a stale editor is refused and the first editor's change survives", async () => {
    const repo = make();
    await repo.create(definition());
    await repo.update(definition({ name: "First", version: 2 }), { expectedVersion: 1 });
    await assert.rejects(repo.update(definition({ name: "Second", version: 2 }), { expectedVersion: 1 }), (error: unknown) => {
      assert.ok(error instanceof RecordVersionConflictError);
      assert.equal(error.expectedVersion, 1);
      assert.equal(error.currentVersion, 2);
      return true;
    });
    const stored = await repo.findById({ workspaceId: WS, id: "form" });
    assert.equal(stored?.name, "First");
    assert.equal(stored?.version, 2);
  });

  test("a conditional update cannot create a missing definition", async () => {
    const repo = make();
    await assert.rejects(repo.update(definition({ version: 2 }), { expectedVersion: 1 }), (error: unknown) =>
      error instanceof RecordVersionConflictError && error.currentVersion === null);
    assert.equal(await repo.findById({ workspaceId: WS, id: "form" }), null);
  });

  test("simultaneous saves with the same basis have exactly one winner", async () => {
    const repo = make();
    await repo.create(definition());
    const results = await Promise.allSettled([
      repo.update(definition({ name: "First", version: 2 }), { expectedVersion: 1 }),
      repo.update(definition({ name: "Second", version: 2 }), { expectedVersion: 1 }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof RecordVersionConflictError);
  });
}

describeEachDialect("form definition lost updates", {
  tables: ["form_submissions", "form_definitions"],
  make: (kernel) => formDefinitionRepoFor({ kernel, tables }),
}, (make) => cases(make));

describe("form definition lost updates — memory", () => cases(() => new InMemoryFormDefinitionRepo()));

test("authored edits carry the editor's version through the service and repository decorator", async () => {
  const repo = new InMemoryFormDefinitionRepo();
  await repo.create(definition());
  let next = 0;
  const deps = {
    repo, executeCommand, changeSets: new InMemoryChangeSetRepo(),
    clock: { nowIso: () => TIME, nowMs: () => Date.parse(TIME) },
    idGen: { newId: () => `id-${++next}` },
    authorize: async () => ({ allowed: true, reason: "ok" }),
    permission: "forms.manage", reservedSlugs: new Set<string>(),
  };
  const authoring = createFormAuthoring({ permission: "pages.edit_html" });
  const input = { workspaceId: WS, formId: "form", actor: { id: "editor", kind: "user" as const } };
  const first = await updateFormDefinition({ deps, input: { ...input, patch: { name: "First", mode: "builder" } } }, { authoring, expectedVersion: 1 });
  assert.equal(first.definition.version, 2);
  await assert.rejects(updateFormDefinition({ deps, input: { ...input, patch: { name: "Second", mode: "builder" } } }, { authoring, expectedVersion: 1 }),
    (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === 2);
  assert.equal((await repo.findById({ workspaceId: WS, id: "form" }))?.name, "First");
});
