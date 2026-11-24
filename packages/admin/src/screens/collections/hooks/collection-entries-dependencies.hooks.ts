import type { AdminContentType, AdminEntry } from "../api/collections-api.types.js";
import type { CollectionsApi } from "../api/collections-api.js";
import type { CollectionEntriesPort } from "./collection-entries-port.hooks.js";

/**
 * @file The only place `use-collection-entries.hooks.ts` reaches the host-bound collections API client — see `collection-
 * entries-port.hooks.ts` for why the split exists.
 */

/** The live implementation over the host-injected {@link CollectionsApi}. The host builds it once at
 *  its composition root as a module-level singleton. */
export function createCollectionEntriesPort({ api }: { api: CollectionsApi }, _optional: Record<string, never> = {}): CollectionEntriesPort {
  return {
    listContentTypes: () => api.listContentTypes(),
    listEntries: (options, _optional = {}) => api.listEntries(options),
  };
}

/** Seed state for {@link createFakeCollectionEntriesPort}. */
export interface FakeCollectionEntriesPortOptions {
  types?: AdminContentType[];
  entries?: AdminEntry[];
  /** When set, `listContentTypes()` rejects with this instead of resolving — for
   *  load-failure tests. */
  listContentTypesError?: Error;
  /** When set, `listEntries()` rejects with this instead of resolving — for load-failure
   *  tests. */
  listEntriesError?: Error;
}

/**
 * An in-memory {@link CollectionEntriesPort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`). `listEntries` filters its seeded rows by `options.type`
 * itself, matching the real route's own filtering, so a test can seed entries across several
 * content types and still assert only the requested one comes back.
 */
export function createFakeCollectionEntriesPort(options: FakeCollectionEntriesPortOptions = {}): CollectionEntriesPort {
  const types = options.types ?? [];
  const entries = options.entries ?? [];

  return {
    async listContentTypes() {
      if (options.listContentTypesError) throw options.listContentTypesError;
      return { items: types };
    },
    async listEntries(queryOptions, _optional = {}) {
      if (options.listEntriesError) throw options.listEntriesError;
      return { items: queryOptions.type ? entries.filter((e) => e.type === queryOptions.type) : entries };
    },
  };
}
