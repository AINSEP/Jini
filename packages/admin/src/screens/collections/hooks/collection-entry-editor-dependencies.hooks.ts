import type { AdminContentType, AdminEntry } from "../api/collections-api.types.js";
import type { CollectionsApi } from "../api/collections-api.js";
import type { CollectionEntryEditorPort } from "./collection-entry-editor-port.hooks.js";

/**
 * @file The only place `use-collection-entry-editor.hooks.ts` reaches the host-bound collections API client — see
 * `collection-entry-editor-port.hooks.ts` for why the split exists.
 */

/** The live implementation over the host-injected {@link CollectionsApi}. The host builds it once at
 *  its composition root as a module-level singleton. */
export function createCollectionEntryEditorPort({ api }: { api: CollectionsApi }, _optional: Record<string, never> = {}): CollectionEntryEditorPort {
  return {
    listContentTypes: () => api.listContentTypes(),
    listEntries: (options, _optional = {}) => api.listEntries(options),
    updateEntry: ({ target, patch }, _optional = {}) => api.updateEntry(target, patch),
    createEntry: ({ input, options }, _optional = {}) => api.createEntry(input, options),
    entryLifecycle: (input, _optional = {}) => api.entryLifecycle(input),
  };
}

/** Its one caller (`createEntry` below) always assigns the next id, so `id` is required rather
 *  than defaulted (the old `?? "fake-entry-1"` default could never apply). */
function fakeEntry(overrides: Partial<AdminEntry> & { id: string }): AdminEntry {
  return {
    workspaceId: "fake-ws",
    type: "recipe",
    slug: "untitled",
    status: "draft",
    title: "Untitled",
    bodyJson: null,
    fieldsJson: { ext: { site: {} } },
    publishedAt: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    version: 1,
    ...overrides,
  };
}

/** Seed state for {@link createFakeCollectionEntryEditorPort}. */
export interface FakeCollectionEntryEditorPortOptions {
  types?: AdminContentType[];
  entries?: AdminEntry[];
  /** When set, `listContentTypes()` rejects with this instead of resolving — for
   *  load-failure tests. */
  listContentTypesError?: Error;
  /** When set, `updateEntry()`/`createEntry()` rejects with this instead of resolving — for
   *  save-failure tests. */
  saveError?: Error;
  /** When set, `entryLifecycle()` rejects with this instead of resolving — for
   *  lifecycle-failure tests. */
  lifecycleError?: Error;
}

/**
 * An in-memory {@link CollectionEntryEditorPort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`).
 */
export function createFakeCollectionEntryEditorPort(
  options: FakeCollectionEntryEditorPortOptions = {}
): CollectionEntryEditorPort & {
  /** Every entry currently in the fake's store, in list order. */
  readonly entries: AdminEntry[];
} {
  const types = options.types ?? [];
  const entries = [...(options.entries ?? [])];

  return {
    entries,
    async listContentTypes() {
      if (options.listContentTypesError) throw options.listContentTypesError;
      return { items: types };
    },
    async listEntries(queryOptions, _optional = {}) {
      return { items: queryOptions.type ? entries.filter((e) => e.type === queryOptions.type) : entries };
    },
    async updateEntry({ target: { id, expectedVersion }, patch }, _optional = {}) {
      if (options.saveError) throw options.saveError;
      const index = entries.findIndex((e) => e.id === id);
      if (index < 0) throw new Error(`fake entry not found: ${id}`);
      const updated = { ...entries[index], ...patch, version: expectedVersion + 1 } as AdminEntry;
      entries[index] = updated;
      return { entry: updated };
    },
    async createEntry({ input, options: createOptions }, _optional = {}) {
      if (options.saveError) throw options.saveError;
      const created = fakeEntry({
        id: `fake-entry-${entries.length + 1}`,
        type: input.type,
        slug: input.slug,
        title: input.title,
        ...createOptions,
      });
      entries.push(created);
      return { entry: created };
    },
    async entryLifecycle({ id, op, expectedVersion }, _optional = {}) {
      if (options.lifecycleError) throw options.lifecycleError;
      const index = entries.findIndex((e) => e.id === id);
      if (index < 0) throw new Error(`fake entry not found: ${id}`);
      const updated: AdminEntry = {
        ...entries[index],
        status: op === "publish" ? "published" : "unpublished",
        version: expectedVersion + 1,
      };
      entries[index] = updated;
      return { entry: updated };
    },
  };
}
