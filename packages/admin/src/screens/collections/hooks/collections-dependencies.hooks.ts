import type { AdminContentType } from "../api/collections-api.types.js";
import type { CollectionsApi } from "../api/collections-api.js";
import type { CollectionsPort } from "./collections-port.hooks.js";

/**
 * @file The only place `use-collections.hooks.ts` reaches the host-bound collections API client — see `collections-
 * port.hooks.ts` for why the split exists.
 */

/** The live implementation over the host-injected {@link CollectionsApi}. The host builds it once at
 *  its composition root as a module-level singleton. */
export function createCollectionsPort({ api }: { api: CollectionsApi }, _optional: Record<string, never> = {}): CollectionsPort {
  return {
    listContentTypes: () => api.listContentTypes(),
    contentTypeLifecycle: (input, _optional = {}) => api.contentTypeLifecycle(input),
  };
}

/** Seed state for {@link createFakeCollectionsPort}. */
/** The status each lifecycle op leaves a content type in. */
const LIFECYCLE_NEXT_STATUS = { reactivate: "active", deprecate: "deprecated", tombstone: "tombstone" } as const;

export interface FakeCollectionsPortOptions {
  types?: AdminContentType[];
  /** When set, `contentTypeLifecycle()` rejects with this instead of resolving — for
   *  action-failure tests. */
  lifecycleError?: Error;
}

/**
 * An in-memory {@link CollectionsPort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`). `contentTypeLifecycle` mutates the fake's own store in
 * place, matching the real route's read-your-writes shape (a subsequent `listContentTypes()` sees
 * the update) so a test can drive `load()`'s re-fetch the same way `runLifecycle` does in
 * production.
 */
export function createFakeCollectionsPort(options: FakeCollectionsPortOptions = {}): CollectionsPort & {
  /** Every content type currently in the fake's store, in list order. */
  readonly types: AdminContentType[];
} {
  const types = [...(options.types ?? [])];

  return {
    types,
    async listContentTypes() {
      return { items: [...types] };
    },
    async contentTypeLifecycle({ key, op, expectedVersion }, _optional = {}) {
      if (options.lifecycleError) throw options.lifecycleError;
      const index = types.findIndex((t) => t.key === key);
      if (index < 0) throw new Error(`fake content type not found: ${key}`);
      const nextStatus = LIFECYCLE_NEXT_STATUS[op];
      const updated: AdminContentType = { ...types[index], status: nextStatus, version: expectedVersion + 1 };
      types[index] = updated;
      return { contentType: updated };
    },
  };
}
