import { describe, expect, it } from "vitest";

import type { CollectionsApi } from "../../api/collections-api.js";
import { createCollectionEntriesPort } from "../collection-entries-dependencies.hooks.js";
import { createCollectionEntryEditorPort } from "../collection-entry-editor-dependencies.hooks.js";
import { createCollectionsPort } from "../collections-dependencies.hooks.js";
import { createEditFieldsDialogPort } from "../edit-fields-dialog-dependencies.hooks.js";
import { createNewContentTypeDialogPort } from "../new-content-type-dialog-dependencies.hooks.js";

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
