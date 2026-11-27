// @vitest-environment jsdom
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "../../../../__tests__/fetch-query-support.js";

import type { AdminContentType, AdminEntry } from "../../api/collections-api.types.js";
import type { CollectionsHostKit } from "../../collections-host-kit.js";
import { createDraftRowIdCounter } from "../../rules.js";
import { createFakeCollectionEntriesPort } from "../collection-entries-dependencies.hooks.js";
import { createFakeCollectionsPort } from "../collections-dependencies.hooks.js";
import { createFakeEditFieldsDialogPort } from "../edit-fields-dialog-dependencies.hooks.js";
import { createFakeNewContentTypeDialogPort } from "../new-content-type-dialog-dependencies.hooks.js";
import { useCollectionEntries } from "../use-collection-entries.hooks.js";
import { useCollections } from "../use-collections.hooks.js";
import { useEditFieldsDialog } from "../use-edit-fields-dialog.hooks.js";
import { useNewContentTypeDialog } from "../use-new-content-type-dialog.hooks.js";

class VersionConflict extends Error {
  readonly status = 409;
}
function hostKit(): CollectionsHostKit {
  return {
    translate: ({ locale, key }) => `${locale}:${key}`,
    isApiError: (e): e is VersionConflict => e instanceof VersionConflict,
    describeApiError: ({ fallback }) => `described(${fallback})`,
    isVersionConflict: ({ error }) => error instanceof VersionConflict,
    embedMarkerSnippet: ({ type, key, value }) => `marker(${type},${key},${value})`,
    nextDraftRowId: createDraftRowIdCounter(),
  };
}

const field = { name: "quantity", kind: "integer", required: true, queryable: false } as const;
const recipe: AdminContentType = { workspaceId: "w1", key: "recipe", label: "Recipe", fields: [field], version: 6, status: "active" };
const entry: AdminEntry = {
  id: "r1", workspaceId: "w1", type: "recipe", slug: "waffles", title: "Waffles",
  status: "draft", bodyJson: null, fieldsJson: {}, publishedAt: null,
  createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-02T00:00:00.000Z", version: 3,
};
const t = ({ key }: { key: string }) => key;
const deps = () => ({ locale: "fr", kit: hostKit(), t });
const form = () => ({ preventDefault: vi.fn() }) as unknown as FormEvent;
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("collections workflow", () => {
  it("filters entries by the route type and distinguishes an unknown type from an empty collection", async () => {
    const port = createFakeCollectionEntriesPort({
      types: [{ ...recipe, key: "faq", label: "FAQ" }, recipe],
      entries: [{ ...entry, id: "f1", type: "faq", slug: "shipping" }, entry],
    });
    const wiring = deps();
    const { result, rerender } = renderHook(
      ({ contentTypeKey }) => useCollectionEntries({ contentTypeKey, port, ...wiring }),
      { initialProps: { contentTypeKey: "recipe" } },
    );
    await waitFor(() => expect(result.current.contentType).toEqual(recipe));
    expect(result.current.entries).toEqual([entry]);
    expect(result.current.error).toBeNull();

    rerender({ contentTypeKey: "discarded" });
    await waitFor(() => expect(result.current.contentType).toBeNull());
    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBeNull();
    await expect(port.listEntries({})).resolves.toEqual({ items: [
      { ...entry, id: "f1", type: "faq", slug: "shipping" }, entry,
    ] });
  });

  it.each(["listContentTypesError", "listEntriesError"] as const)("surfaces a failed %s read without treating it as an empty list", async (key) => {
    const port = createFakeCollectionEntriesPort({ types: [recipe], entries: [entry], [key]: new Error("backend unavailable") });
    const wiring = deps();
    const { result } = renderHook(() => useCollectionEntries({ contentTypeKey: "recipe", port, ...wiring }));
    await waitFor(() => expect(result.current.error).toBe("described(fr:failed to load entries)"));
    expect(result.current.contentType).toBeUndefined();
    expect(result.current.entries).toBeNull();
  });

  it("reloads the committed lifecycle transition using the selected type and its loaded version", async () => {
    const port = createFakeCollectionsPort({ types: [recipe, { ...recipe, key: "faq", label: "FAQ" }] });
    const contentTypeLifecycle = vi.fn(port.contentTypeLifecycle);
    const wiring = deps();
    const { result } = renderHook(() => useCollections({
      ...wiring, port: { ...port, contentTypeLifecycle }, lifecycleFailureMessage: ({ op, label }) => `${op}:${label}`,
    }));
    await waitFor(() => expect(result.current.types?.map(({ key }) => key)).toEqual(["recipe", "faq"]));
    await act(async () => { await result.current.runLifecycle(recipe, "deprecate"); });
    expect(contentTypeLifecycle.mock.calls).toEqual([[{ key: "recipe", op: "deprecate", expectedVersion: 6 }]]);
    await waitFor(() => expect(result.current.types?.find(({ key }) => key === "recipe")).toMatchObject({ status: "deprecated", version: 7 }));
    expect(result.current.types?.find(({ key }) => key === "faq")).toMatchObject({ status: "active", version: 6 });
    expect(result.current.actionError).toBeNull();
  });

  it("attributes a failed reactivation to the last attempted operation without changing the collection", async () => {
    const deprecated = { ...recipe, status: "deprecated" as const };
    const port = createFakeCollectionsPort({ types: [deprecated], lifecycleError: new Error("write refused") });
    const wiring = deps();
    const { result } = renderHook(() => useCollections({
      ...wiring, port, lifecycleFailureMessage: ({ locale, op, label }) => `${locale}:${op}:${label}`,
    }));
    await waitFor(() => expect(result.current.types).toEqual([deprecated]));
    await act(async () => { await result.current.runLifecycle(deprecated, "reactivate"); });
    expect(result.current.actionError).toBe("described(fr:reactivate:Recipe)");
    await expect(port.listContentTypes()).resolves.toEqual({ items: [deprecated] });
  });

  it("offers manual clipboard fallback, then clears it and expires the correct copied indicator after recovery", async () => {
    const port = createFakeCollectionsPort({ types: [recipe] });
    const wiring = deps();
    const { result } = renderHook(() => useCollections({ ...wiring, port, lifecycleFailureMessage: () => "failed" }));
    await waitFor(() => expect(result.current.types).toEqual([recipe]));
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new Error("clipboard blocked")).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.useFakeTimers();
    try {
      await act(async () => { await result.current.copyEmbedCode(recipe); });
      expect(result.current.copyFallback).toEqual({ key: "recipe", snippet: "marker(collection,id,recipe)" });
      expect(result.current.copiedKey).toBeNull();

      await act(async () => { await result.current.copyEmbedCode({ ...recipe, key: "faq" }); });
      expect(writeText.mock.calls).toEqual([["marker(collection,id,recipe)"], ["marker(collection,id,faq)"]]);
      expect(result.current.copyFallback).toBeNull();
      expect(result.current.copiedKey).toBe("faq");
      act(() => vi.advanceTimersByTime(1499));
      expect(result.current.copiedKey).toBe("faq");
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.copiedKey).toBeNull();
    } finally {
      vi.useRealTimers();
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });
});

describe("collection schema drafts", () => {
  it("keeps an edit dialog open during a versioned field save, then allows dismissal again", async () => {
    const gate = deferred();
    const fake = createFakeEditFieldsDialogPort();
    const props = { contentType: recipe, onSaved: vi.fn(), onCancel: vi.fn() };
    const kit = hostKit();
    const { result } = renderHook(() => useEditFieldsDialog({ props, kit, port: {
      async updateContentTypeFields(input) {
        await gate.promise;
        return fake.updateContentTypeFields(input);
      },
    } }));
    expect(result.current.fields).toEqual([{ ...field, _rowId: 1 }]);
    act(() => result.current.addField());
    act(() => result.current.updateField({ rowId: 2, patch: { name: "allergens", kind: "json", queryable: true } }));
    act(() => result.current.removeField({ rowId: 1 }));
    const event = form();
    let saved!: Promise<void>;
    act(() => { saved = Promise.resolve(result.current.submit(event)); });
    await waitFor(() => expect(result.current.saving).toBe(true));
    act(() => result.current.cancel());
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
    await act(async () => { gate.release(); await saved; });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(fake.lastUpdate).toEqual({
      key: "recipe", expectedVersion: 6,
      fields: [{ name: "allergens", kind: "json", required: false, queryable: true }],
    });
    expect(props.onSaved).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
    act(() => result.current.cancel());
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("rejects a fieldless edit locally and shows the refresh instruction for a stale write after correction", async () => {
    const port = createFakeEditFieldsDialogPort({ updateError: new VersionConflict("stale") });
    const props = { contentType: recipe, onSaved: vi.fn(), onCancel: vi.fn() };
    const kit = hostKit();
    const { result } = renderHook(() => useEditFieldsDialog({ props, port, kit }, { t: key => `edit:${key}` }));
    act(() => result.current.removeField({ rowId: 1 }));
    await act(async () => { await result.current.submit(form()); });
    expect(result.current.error).toBe("edit:At least one field is required.");
    expect(port.lastUpdate).toBeNull();

    act(() => result.current.addField());
    act(() => result.current.updateField({ rowId: 2, patch: { name: "revised" } }));
    await act(async () => { await result.current.submit(form()); });
    await waitFor(() => expect(result.current.error).toBe("This content type changed since you loaded it, refresh and try again."));
    expect(port.lastUpdate).toEqual({ key: "recipe", expectedVersion: 6, fields: [
      { name: "revised", kind: "text", required: false, queryable: false },
    ] });
    expect(props.onSaved).not.toHaveBeenCalled();
    act(() => result.current.cancel());
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("creates a collection with a trimmed identity and blocks cancellation only while its write is pending", async () => {
    const gate = deferred();
    const fake = createFakeNewContentTypeDialogPort();
    const props = { onCreated: vi.fn(), onCancel: vi.fn() };
    const wiring = deps();
    const { result } = renderHook(() => useNewContentTypeDialog({ props, ...wiring, port: {
      async createContentType(input) {
        await gate.promise;
        return fake.createContentType(input);
      },
    } }));
    act(() => {
      result.current.setKey("  recipe  ");
      result.current.setLabel("  Recipe  ");
      result.current.addField();
    });
    act(() => {
      result.current.updateField({ rowId: 2, patch: { name: "quantity", kind: "integer", required: true } });
      result.current.removeField({ rowId: 1 });
    });

    let created!: Promise<void>;
    act(() => { created = Promise.resolve(result.current.submit(form())); });
    await waitFor(() => expect(result.current.saving).toBe(true));
    act(() => result.current.cancel());
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onCreated).not.toHaveBeenCalled();
    await act(async () => { gate.release(); await created; });
    expect(fake.lastCreate).toEqual({ key: "recipe", label: "Recipe", fields: [field] });
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
    expect(props.onCreated).toHaveBeenCalledTimes(1);
    act(() => result.current.cancel());
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps a refused new draft editable and describes the create failure in the operator locale", async () => {
    const port = createFakeNewContentTypeDialogPort({ createError: new Error("duplicate key") });
    const props = { onCreated: vi.fn(), onCancel: vi.fn() };
    const wiring = deps();
    const { result } = renderHook(() => useNewContentTypeDialog({ props, port, ...wiring }));
    act(() => {
      result.current.setKey("recipe");
      result.current.setLabel("Recipe");
      result.current.updateField({ rowId: 1, patch: { name: "notes" } });
    });
    await act(async () => { await result.current.submit(form()); });
    expect(port.lastCreate).toEqual({ key: "recipe", label: "Recipe", fields: [
      { name: "notes", kind: "text", required: false, queryable: false },
    ] });
    await waitFor(() => expect(result.current.error).toBe("described(fr:Failed to create content type)"));
    expect(result.current.fields[0]?.name).toBe("notes");
    expect(props.onCreated).not.toHaveBeenCalled();
  });
});
