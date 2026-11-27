// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "../../../../__tests__/fetch-query-support.js";
import { useInvalidate } from "../../../../react/kit.js";
import { slugRedirectPath } from "../../../../shell/lib/slug-redirect-path.js";

import type { AdminContentType, AdminEntry } from "../../api/collections-api.types.js";
import type { CollectionsHostKit } from "../../collections-host-kit.js";
import { createDraftRowIdCounter } from "../../rules.js";
import { createFakeCollectionEntryEditorPort } from "../collection-entry-editor-dependencies.hooks.js";
import { useCollectionEntryEditor, type CollectionEntryEditorDependencies } from "../use-collection-entry-editor.hooks.js";

class Conflict extends Error {
  readonly status = 409;
}
const type: AdminContentType = {
  key: "recipe", workspaceId: "w1", label: "Recipe", fields: [], status: "active", version: 2,
};
const before = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Stored" }] }] };
const after = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Working copy" }] }] };
const row: AdminEntry = {
  id: "a1234abc-c123-4cde-8a99-0123456789ab", workspaceId: "w1", type: "recipe", slug: "waffles", title: "Waffles",
  status: "draft", bodyJson: before, fieldsJson: { ext: { site: { servings: 3 } } }, publishedAt: null,
  createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-02T00:00:00.000Z", version: 4,
};

function setup(options: {
  initialId?: string | null;
  routeType?: string;
  editorReady?: boolean;
  seed?: NonNullable<Parameters<typeof createFakeCollectionEntryEditorPort>[0]>;
  lifecycleGate?: Promise<void>;
} = {}) {
  const port = createFakeCollectionEntryEditorPort({ types: [type], entries: [row], ...options.seed });
  const listContentTypes = vi.fn(port.listContentTypes);
  const listEntries = vi.fn(port.listEntries);
  const updateEntry = vi.fn(port.updateEntry);
  const createEntry = vi.fn(port.createEntry);
  const entryLifecycle = vi.fn<typeof port.entryLifecycle>(async input => {
    await options.lifecycleGate;
    return port.entryLifecycle(input);
  });
  const kit: CollectionsHostKit = {
    translate: ({ locale, key }) => `${locale}:${key}`,
    isApiError: (e): e is Conflict => e instanceof Conflict,
    describeApiError: ({ fallback }) => `described(${fallback})`,
    isVersionConflict: ({ error }) => error instanceof Conflict,
    embedMarkerSnippet: ({ value }) => value,
    nextDraftRowId: createDraftRowIdCounter(),
  };
  const editor = { getJSON: () => after, commands: { setContent: vi.fn<(content: string) => void>() } };
  const navigate = vi.fn();
  const useBodyEditor = vi.fn(({ ariaLabel }: { ariaLabel: string }) => (ariaLabel === "label:Content" ? editor : null));
  const deps: CollectionEntryEditorDependencies = {
    port: { listContentTypes, listEntries, updateEntry, createEntry, entryLifecycle },
    navigate, locale: "fr", t: ({ key }) => `label:${key}`, kit, slugRedirectPath, useBodyEditor,
    entryLifecycleFailureMessage: ({ locale, op }) => `${locale}:could not ${op}`,
    versionConflictMessage: "Reload before editing",
  };
  const hook = renderHook(({ entryId, editorReady }) => ({
    controller: useCollectionEntryEditor({
      ...deps, props: { contentTypeKey: options.routeType ?? "recipe", entryId },
      useBodyEditor: required => editorReady ? useBodyEditor(required) : null,
    }),
    invalidate: useInvalidate(),
  }), { initialProps: { entryId: options.initialId === undefined ? row.slug : options.initialId, editorReady: options.editorReady ?? true } });
  return { ...hook, port, editor, navigate, useBodyEditor, listContentTypes, listEntries, updateEntry, createEntry, entryLifecycle };
}

describe("collection entry editor", () => {
  it("waits for the body editor, then seeds a saved entry and replaces its old ID link", async () => {
    const h = setup({ initialId: row.id, editorReady: false });
    await waitFor(() => expect(h.result.current.controller.contentType).toEqual(type));
    expect(h.result.current.controller.entry).toBeNull();
    expect(h.editor.commands.setContent).not.toHaveBeenCalled();
    await act(async () => { await h.result.current.controller.save(); });
    expect(h.createEntry).not.toHaveBeenCalled();

    h.rerender({ entryId: row.id, editorReady: true });
    await waitFor(() => expect(h.result.current.controller.entry).toEqual(row));
    expect(h.useBodyEditor).toHaveBeenCalledWith({ ariaLabel: "label:Content" });
    expect(h.listEntries.mock.calls).toEqual([[{ type: "recipe" }]]);
    expect(h.editor.commands.setContent.mock.calls).toEqual([[before]]);
    expect(h.result.current.controller).toMatchObject({ title: "Waffles", slug: "waffles", extFields: { servings: 3 } });
    expect(h.navigate.mock.calls).toEqual([["/collections/recipe/waffles", { replace: true }]]);
  });

  it("preserves unsaved title on a same-route refetch and clears the editor on a different identity", async () => {
    const second = { ...row, id: "e2", slug: "pancakes", title: "Pancakes", bodyJson: null, fieldsJson: null };
    const types = [type];
    const h = setup({ seed: { types, entries: [second, row] } });
    await waitFor(() => expect(h.result.current.controller.title).toBe("Waffles"));
    act(() => h.result.current.controller.setTitle("Unsaved waffles"));
    types[0] = { ...type, label: "Refreshed recipe type" };
    act(() => h.result.current.invalidate({ key: ["content-types"] }));
    await waitFor(() => expect(h.result.current.controller.contentType?.label).toBe("Refreshed recipe type"));
    expect(h.result.current.controller.title).toBe("Unsaved waffles");
    expect(h.editor.commands.setContent.mock.calls).toEqual([[before]]);
    expect(h.navigate).not.toHaveBeenCalled();

    h.rerender({ entryId: "pancakes", editorReady: true });
    await waitFor(() => expect(h.result.current.controller.entry).toEqual(second));
    expect(h.result.current.controller).toMatchObject({ title: "Pancakes", slug: "pancakes", extFields: {} });
    expect(h.editor.commands.setContent.mock.calls).toEqual([[before], [""]]);

    h.rerender({ entryId: "no-such-entry", editorReady: true });
    await waitFor(() => expect(h.result.current.controller.entry).toBeNull());
    expect(h.result.current.controller).toMatchObject({ title: "", slug: "", extFields: {} });
    expect(h.editor.commands.setContent.mock.calls).toEqual([[before], [""], [""]]);
  });

  it("prefers an exact ID over another row's matching slug even when the slug appears first", async () => {
    const alias = { ...row, id: "different-entry", slug: row.id, title: "Not the bookmarked entry" };
    const h = setup({ initialId: row.id, seed: { entries: [alias, row] } });
    await waitFor(() => expect(h.result.current.controller.entry?.id).toBe("a1234abc-c123-4cde-8a99-0123456789ab"));
    expect(h.result.current.controller.title).toBe("Waffles");
    expect(h.navigate.mock.calls).toEqual([["/collections/recipe/waffles", { replace: true }]]);
  });

  it("creates, reads back, and navigates to a new entry using its trimmed slug", async () => {
    const h = setup({ initialId: null });
    await waitFor(() => expect(h.result.current.controller.contentType).toEqual(type));
    expect(h.listEntries).not.toHaveBeenCalled();
    await act(async () => { await h.result.current.controller.toggleLifecycle({ op: "publish" }); });
    expect(h.entryLifecycle).not.toHaveBeenCalled();
    act(() => {
      h.result.current.controller.setTitle("Sweet bread");
      h.result.current.controller.setSlug("  sweet-bread  ");
      h.result.current.controller.setExtFields({ servings: 8 });
    });
    await act(async () => { await h.result.current.controller.save(); });
    expect(h.createEntry.mock.calls).toEqual([[{
      input: { type: "recipe", slug: "sweet-bread", title: "Sweet bread" },
      options: { bodyJson: after, fieldsJson: { ext: { site: { servings: 8 } } } },
    }]]);
    expect(h.navigate.mock.calls).toEqual([["/collections/recipe/sweet-bread"]]);
    expect(h.result.current.controller.message).toBe("Created · version 1");
    const { items } = await h.port.listEntries({ type: "recipe" });
    expect(items.find(item => item.slug === "sweet-bread")).toMatchObject({
      id: "fake-entry-2", title: "Sweet bread", version: 1, status: "draft", bodyJson: after, fieldsJson: { ext: { site: { servings: 8 } } },
    });
  });

  it("blocks save and publish until every invalid JSON field is fixed, then persists the working copy", async () => {
    const h = setup();
    await waitFor(() => expect(h.result.current.controller.entry).toEqual(row));
    act(() => {
      h.result.current.controller.setTitle("Improved waffles");
      h.result.current.controller.setExtFields({ servings: 5 });
      h.result.current.controller.setFieldValidity("first", false);
      h.result.current.controller.setFieldValidity("second", false);
      h.result.current.controller.setFieldValidity("first", false);
    });
    await act(async () => { await h.result.current.controller.save(); });
    expect(h.result.current.controller.error).toBe("fr:Fix the invalid JSON before saving.");
    act(() => h.result.current.controller.setFieldValidity("first", true));
    await act(async () => { await h.result.current.controller.toggleLifecycle({ op: "publish" }); });
    expect(h.result.current.controller.error).toBe("fr:Fix the invalid JSON before saving.");
    expect(h.updateEntry).not.toHaveBeenCalled();
    expect(h.entryLifecycle).not.toHaveBeenCalled();

    act(() => h.result.current.controller.setFieldValidity("second", true));
    await act(async () => { await h.result.current.controller.save(); });
    expect(h.updateEntry.mock.calls).toEqual([[{
      target: { id: row.id, expectedVersion: 4 },
      patch: { title: "Improved waffles", bodyJson: after, fieldsJson: { ext: { site: { servings: 5 } } } },
    }]]);
    const { items } = await h.port.listEntries({});
    expect(items.find(item => item.id === row.id)).toMatchObject({ title: "Improved waffles", bodyJson: after, version: 5, status: "draft" });
    expect(h.result.current.controller).toMatchObject({ message: "Saved · version 5", error: null });
  });

  it("publishes only the freshly saved working copy and unpublishes without re-saving it", async () => {
    let release!: () => void;
    const lifecycleGate = new Promise<void>(resolve => { release = resolve; });
    const h = setup({ lifecycleGate });
    await waitFor(() => expect(h.result.current.controller.entry).toEqual(row));
    act(() => h.result.current.controller.setTitle("Ready waffles"));
    let publish!: Promise<void>;
    act(() => { publish = h.result.current.controller.toggleLifecycle({ op: "publish" }); });
    try {
      await waitFor(() => expect(h.entryLifecycle.mock.calls).toEqual([[{ id: row.id, op: "publish", expectedVersion: 5 }]]));
      await waitFor(() => expect(h.result.current.controller).toMatchObject({ busy: true, saving: false }));
      const { items } = await h.port.listEntries({});
      expect(items.find(item => item.id === row.id)).toMatchObject({
        title: "Ready waffles", bodyJson: after, status: "draft", version: 5,
      });
    } finally {
      await act(async () => { release(); await publish; });
    }
    expect(h.result.current.controller).toMatchObject({
      entry: { status: "published", version: 6 }, message: "Entry published · version 6",
    });
    await act(async () => { await h.result.current.controller.toggleLifecycle({ op: "unpublish" }); });
    expect(h.entryLifecycle.mock.calls).toEqual([
      [{ id: row.id, op: "publish", expectedVersion: 5 }], [{ id: row.id, op: "unpublish", expectedVersion: 6 }],
    ]);
    expect(h.updateEntry).toHaveBeenCalledTimes(1);
    const { items } = await h.port.listEntries({});
    expect(items.find(item => item.id === row.id)).toMatchObject({ title: "Ready waffles", status: "unpublished", version: 7 });
    expect(h.result.current.controller.message).toBe("Entry unpublished · version 7");
  });

  it("never issues publish when the prerequisite save loses its version check", async () => {
    const h = setup({ seed: { saveError: new Conflict("private conflict detail") } });
    await waitFor(() => expect(h.result.current.controller.entry).toEqual(row));
    await act(async () => { await h.result.current.controller.toggleLifecycle({ op: "publish" }); });
    await waitFor(() => expect(h.result.current.controller.error).toBe("fr:Reload before editing"));
    expect(h.entryLifecycle).not.toHaveBeenCalled();
    expect(h.result.current.controller.message).toBeNull();
    await expect(h.port.listEntries({})).resolves.toEqual({ items: [row] });
  });

  it.each(["publish", "unpublish"] as const)("shows the requested %s failure without claiming a transition", async (op) => {
    const h = setup({ seed: { lifecycleError: new Error("lifecycle rejected") } });
    await waitFor(() => expect(h.result.current.controller.entry).toEqual(row));
    await act(async () => { await h.result.current.controller.toggleLifecycle({ op }); });
    await waitFor(() => expect(h.result.current.controller.error).toBe(`described(fr:could not ${op})`));
    expect(h.result.current.controller.message).toBeNull();
    const { items } = await h.port.listEntries({});
    expect(items.find(item => item.id === row.id)).toMatchObject({ status: "draft", version: op === "publish" ? 5 : 4 });
  });

  it("shows the create error without navigating or storing a failed draft", async () => {
    const h = setup({ initialId: null, seed: { saveError: new Error("slug refused") } });
    await waitFor(() => expect(h.result.current.controller.contentType).toEqual(type));
    act(() => {
      h.result.current.controller.setTitle("Rejected draft");
      h.result.current.controller.setSlug("rejected");
    });
    await act(async () => { await h.result.current.controller.save(); });
    await waitFor(() => expect(h.result.current.controller.error).toBe("described(fr:save failed)"));
    expect(h.result.current.controller.title).toBe("Rejected draft");
    expect(h.navigate).not.toHaveBeenCalled();
    await expect(h.port.listEntries({})).resolves.toEqual({ items: [row] });
  });

  it("blocks a write when the type is absent and describes a refused registry read separately", async () => {
    const unknown = setup({ routeType: "missing", initialId: null });
    await waitFor(() => expect(unknown.result.current.controller.contentType).toBeNull());
    await act(async () => { await unknown.result.current.controller.save(); });
    expect(unknown.createEntry).not.toHaveBeenCalled();
    const refused = setup({ seed: { listContentTypesError: new Error("registry refused") } });
    await waitFor(() => expect(refused.result.current.controller.loadError).toBe("described(fr:failed to load entry)"));
    expect(refused.result.current.controller.entry).toBeNull();
  });
});
