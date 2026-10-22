import assert from "node:assert/strict";
import { test } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { EntryFieldValidationError } from "../errors.js";
import { InMemoryEntryRepo } from "../repo.memory.js";
import { buildEntriesRegistrations } from "../tool-registrations.js";
import type { EntryRecord, OwningContentType } from "../types.js";
import { createEntry, importEntry, updateEntry } from "../write-service.js";

/** Schema-on-error carries ALL field definitions and the owning namespace, through both the
 * service Result and the model-facing ToolInputError, without exposing submitted field values. */
const NOW = "2026-10-17T00:00:00.000Z";
const contentType: OwningContentType = {
  workspaceId: "ws", key: "recipe", status: "active", owner: "recipes",
  fields: [
    { name: "summary", kind: "text", required: true, queryable: false },
    { name: "notes", kind: "text", required: false, queryable: true },
  ],
};
const expectedSchema = { type: "recipe", owner: "recipes", fields: contentType.fields };
const invalidFields = { ext: { recipes: { unexpected: "private-submitted-value" } } };
const seed: EntryRecord = {
  id: "entry", workspaceId: "ws", type: "recipe", slug: "recipe", title: "Recipe", status: "draft",
  fieldsJson: { ext: { recipes: { summary: "Saved" } } }, bodyJson: null, publishedAt: null,
  createdAt: NOW, updatedAt: NOW, version: 1,
};

for (const operation of ["create", "update", "import"] as const) {
  test(`${operation} returns the complete entity schema on invalid fields without persisting`, async () => {
    const entryRepo = new InMemoryEntryRepo();
    if (operation === "update") await entryRepo.save(seed);
    let events = 0;
    const deps = {
      entryRepo, contentTypeRepo: { findByKey: async () => contentType },
      clock: { nowMs: () => Date.parse(NOW) }, ids: { newId: () => "created" },
      authorize: async () => ({ allowed: true, reason: "matched" }),
      outbox: { enqueue: async () => { events++; } },
    };
    const input = { actorId: "actor", workspaceId: "ws", type: "recipe", slug: "new", title: "New", fieldsJson: invalidFields };
    let result;
    if (operation === "create") result = await createEntry({ deps, input });
    else if (operation === "update") result = await updateEntry({ deps, input: { ...input, id: "entry", expectedVersion: 1 } });
    else result = await importEntry({ deps, input: { ...input, id: "imported", status: "draft", publishedAt: null, expectedVersion: undefined } });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("invalid fields were accepted");
    assert.ok(result.error instanceof EntryFieldValidationError);
    assert.deepEqual(result.error.entitySchema, expectedSchema);
    assert.ok(result.error.message.includes(JSON.stringify(expectedSchema)));
    assert.equal(result.error.message.includes("private-submitted-value"), false);
    assert.equal(events, 0);
    assert.deepEqual(await entryRepo.listByWorkspace({ workspaceId: "ws" }), operation === "update" ? [seed] : []);
  });
}

test("entry tools retain the full entity schema when the shared kit decorates a shape error", async () => {
  const registrations = buildEntriesRegistrations({
    workspaceId: "ws", entryRepo: new InMemoryEntryRepo(), contentTypeRepo: { findByKey: async () => contentType },
    clock: { nowMs: () => Date.parse(NOW) }, idGen: { newId: () => "id" },
    authorize: async () => ({ allowed: true, reason: "matched" }),
    outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
  });
  const tool = registrations.find(tool => tool.descriptor.id === "collections_entry_create");
  assert.ok(tool);
  await assert.rejects(() => tool.handler({
    executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, signal: new AbortController().signal,
    input: { type: "recipe", slug: "new", title: "New", fieldsJson: invalidFields },
  }), (error: unknown) => {
    assert.ok(error instanceof ToolInputError);
    assert.ok(error.message.includes(JSON.stringify(expectedSchema)));
    assert.match(error.message, /Schema for 'collections_entry_create'/);
    return true;
  });
});
