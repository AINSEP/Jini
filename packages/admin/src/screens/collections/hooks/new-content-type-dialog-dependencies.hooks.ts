import type { AdminContentType, ContentTypeFieldDef } from "../api/collections-api.types.js";
import type { CollectionsApi } from "../api/collections-api.js";
import type { NewContentTypeDialogPort } from "./new-content-type-dialog-port.hooks.js";

/**
 * @file The only place `use-new-content-type-dialog.hooks.ts` reaches the host-bound collections API client — see
 * `new-content-type-dialog-port.hooks.ts` for why the split exists.
 */

/** The live implementation over the host-injected {@link CollectionsApi}. The host builds it once at
 *  its composition root as a module-level singleton. */
export function createNewContentTypeDialogPort({ api }: { api: CollectionsApi }, _optional: Record<string, never> = {}): NewContentTypeDialogPort {
  return {
    createContentType: (input, _optional = {}) => api.createContentType(input),
  };
}

/** Seed state for {@link createFakeNewContentTypeDialogPort}. */
export interface FakeNewContentTypeDialogPortOptions {
  createdContentType?: AdminContentType;
  /** When set, `createContentType()` rejects with this instead of resolving — for
   *  submit-failure tests. */
  createError?: Error;
}

const FAKE_CONTENT_TYPE: AdminContentType = {
  workspaceId: "fake-ws",
  key: "fake",
  label: "Fake",
  fields: [],
  status: "active",
  version: 1,
};

/**
 * An in-memory {@link NewContentTypeDialogPort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`). Records the last write for assertions.
 */
export function createFakeNewContentTypeDialogPort(
  options: FakeNewContentTypeDialogPortOptions = {}
): NewContentTypeDialogPort & {
  /** The most recent `createContentType` call's input, or `null` before the first call. */
  lastCreate: { key: string; label: string; fields: ContentTypeFieldDef[] } | null;
} {
  const state = { lastCreate: null as { key: string; label: string; fields: ContentTypeFieldDef[] } | null };

  return {
    get lastCreate() {
      return state.lastCreate;
    },
    async createContentType(input, _optional = {}) {
      state.lastCreate = input;
      if (options.createError) throw options.createError;
      return { contentType: options.createdContentType ?? FAKE_CONTENT_TYPE };
    },
  };
}
