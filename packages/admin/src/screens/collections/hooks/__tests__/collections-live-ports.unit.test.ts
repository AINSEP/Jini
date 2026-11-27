import { describe, expect, it } from "vitest";

import type { AdminContentType } from "../../api/collections-api.types.js";
import type { CollectionsApi } from "../../api/collections-api.js";
import { createCollectionEntriesPort } from "../collection-entries-dependencies.hooks.js";
import { createCollectionEntryEditorPort, createFakeCollectionEntryEditorPort } from "../collection-entry-editor-dependencies.hooks.js";
import { createCollectionsPort, createFakeCollectionsPort } from "../collections-dependencies.hooks.js";
import { createEditFieldsDialogPort, createFakeEditFieldsDialogPort } from "../edit-fields-dialog-dependencies.hooks.js";
import { createNewContentTypeDialogPort, createFakeNewContentTypeDialogPort } from "../new-content-type-dialog-dependencies.hooks.js";

/**
 * @file Pins the LIVE collections `create*Port` bindings: each port method forwards to the
 * host-injected {@link CollectionsApi} with exactly the arguments it was given. Screen and hook
 * tests use the `createFake*Port` doubles, so these bindings are otherwise unexercised.
 */

function recordingApi(calls: unknown[][]): CollectionsApi {
  return new Proxy({}, {
    get: (_target, name) => async (...args: unknown[]) => { calls.push([String(name), ...args]); return { name: String(name) }; },
  }) as CollectionsApi;
}

describe("collections live ports", () => {
  it("createCollectionsPort forwards list + content-type lifecycle", async () => {
    const calls: unknown[][] = [];
    const port = createCollectionsPort({ api: recordingApi(calls) });
    await port.listContentTypes();
    await port.contentTypeLifecycle({ key: "recipe", op: "deprecate", expectedVersion: 2 });
    expect(calls).toEqual([["listContentTypes"], ["contentTypeLifecycle", { key: "recipe", op: "deprecate", expectedVersion: 2 }]]);
  });

  it("createCollectionEntriesPort forwards list calls with the query options", async () => {
    const calls: unknown[][] = [];
    const port = createCollectionEntriesPort({ api: recordingApi(calls) });
    await port.listContentTypes();
    await port.listEntries({ type: "recipe" });
    expect(calls).toEqual([["listContentTypes"], ["listEntries", { type: "recipe" }]]);
  });

  it("createCollectionEntryEditorPort unpacks object args into the api's positional calls", async () => {
    const calls: unknown[][] = [];
    const port = createCollectionEntryEditorPort({ api: recordingApi(calls) });
    await port.listContentTypes();
    await port.listEntries({ type: "faq" });
    await port.updateEntry({ target: { id: "e1", expectedVersion: 5 }, patch: { title: "T" } });
    await port.createEntry({ input: { type: "faq", slug: "q", title: "Q" }, options: { fieldsJson: { a: 1 } } });
    await port.entryLifecycle({ id: "e2", op: "publish", expectedVersion: 1 });
    expect(calls).toEqual([
      ["listContentTypes"],
      ["listEntries", { type: "faq" }],
      ["updateEntry", { id: "e1", expectedVersion: 5 }, { title: "T" }],
      ["createEntry", { type: "faq", slug: "q", title: "Q" }, { fieldsJson: { a: 1 } }],
      ["entryLifecycle", { id: "e2", op: "publish", expectedVersion: 1 }],
    ]);
  });

  it("createEditFieldsDialogPort and createNewContentTypeDialogPort forward their single call", async () => {
    const calls: unknown[][] = [];
    const api = recordingApi(calls);
    const fields = createEditFieldsDialogPort({ api });
    const create = createNewContentTypeDialogPort({ api });
    await expect(fields.updateContentTypeFields({ key: "k", fields: [], expectedVersion: 3 })).resolves.toEqual({ name: "updateContentTypeFields" });
    await create.createContentType({ key: "k2", label: "K2", fields: [] });
    expect(calls).toEqual([
      ["updateContentTypeFields", { key: "k", fields: [], expectedVersion: 3 }],
      ["createContentType", { key: "k2", label: "K2", fields: [] }],
    ]);
  });
});

describe("collections in-memory port contracts", () => {
  it("reflects reactivation and tombstone on readback and rejects lifecycle changes to an absent type", async () => {
    const port = createFakeCollectionsPort({ types: [{ ...seed, status: "deprecated" }] });
    await expect(port.contentTypeLifecycle({ key: "kit", op: "reactivate", expectedVersion: 7 })).resolves.toEqual({
      contentType: { ...seed, status: "active", version: 8 },
    });
    await port.contentTypeLifecycle({ key: "kit", op: "tombstone", expectedVersion: 8 });
    await expect(port.contentTypeLifecycle({ key: "absent", op: "deprecate", expectedVersion: 1 })).rejects.toThrow("fake content type not found: absent");
    await expect(port.listContentTypes()).resolves.toEqual({ items: [{ ...seed, status: "tombstone", version: 9 }] });
  });

  it("returns seeded create and edit responses and records distinct inputs on a subsequent call", async () => {
    const updated = { ...seed, version: 8 };
    const fields = createFakeEditFieldsDialogPort({ updatedContentType: updated });
    const create = createFakeNewContentTypeDialogPort({ createdContentType: seed });
    const update = { key: "kit", fields: [], expectedVersion: 7 };
    expect(fields.lastUpdate).toBeNull();
    expect(create.lastCreate).toBeNull();
    await expect(fields.updateContentTypeFields(update)).resolves.toEqual({ contentType: updated });
    await expect(create.createContentType({ key: "kit", label: "Toolkit", fields: [] })).resolves.toEqual({ contentType: seed });
    await fields.updateContentTypeFields({ ...update, expectedVersion: 8 });
    await create.createContentType({ key: "faq", label: "FAQ", fields: [] });
    expect(fields.lastUpdate).toEqual({ ...update, expectedVersion: 8 });
    expect(create.lastCreate).toEqual({ key: "faq", label: "FAQ", fields: [] });
  });

  it("rejects absent entries for both writes without creating a substitute", async () => {
    const port = createFakeCollectionEntryEditorPort();
    await expect(port.updateEntry({ target: { id: "missing", expectedVersion: 3 }, patch: { title: "Do not insert" } }))
      .rejects.toThrow("fake entry not found: missing");
    await expect(port.entryLifecycle({ id: "other", expectedVersion: 7, op: "publish" }))
      .rejects.toThrow("fake entry not found: other");
    await expect(port.listEntries({})).resolves.toEqual({ items: [] });
  });
});

const seed: AdminContentType = { workspaceId: "w1", key: "kit", label: "Toolkit", fields: [], version: 7, status: "active" };
