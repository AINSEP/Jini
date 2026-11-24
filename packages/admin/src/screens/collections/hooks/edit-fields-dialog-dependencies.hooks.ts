import type { AdminContentType, ContentTypeFieldDef } from "../api/collections-api.types.js";
import type { CollectionsApi } from "../api/collections-api.js";
import type { EditFieldsDialogPort } from "./edit-fields-dialog-port.hooks.js";

/**
 * @file The only place `use-edit-fields-dialog.hooks.ts` reaches the host-bound collections API client — see
 * `edit-fields-dialog-port.hooks.ts` for why the split exists.
 */

/** The live implementation over the host-injected {@link CollectionsApi}. The host builds it once at
 *  its composition root as a module-level singleton. */
export function createEditFieldsDialogPort({ api }: { api: CollectionsApi }, _optional: Record<string, never> = {}): EditFieldsDialogPort {
  return {
    updateContentTypeFields: (input, _optional = {}) => api.updateContentTypeFields(input),
  };
}

/** Seed state for {@link createFakeEditFieldsDialogPort}. */
export interface FakeEditFieldsDialogPortOptions {
  /** Returned by `updateContentTypeFields()` on success — defaults to a minimal stand-in
   *  `AdminContentType`; most tests only care that `submit()` resolves and calls `onSaved`. */
  updatedContentType?: AdminContentType;
  /** When set, `updateContentTypeFields()` rejects with this instead of resolving — for
   *  submit-failure tests. */
  updateError?: Error;
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
 * An in-memory {@link EditFieldsDialogPort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`). Records the last write for assertions.
 */
export function createFakeEditFieldsDialogPort(options: FakeEditFieldsDialogPortOptions = {}): EditFieldsDialogPort & {
  /** The most recent `updateContentTypeFields` call's input, or `null` before the first call. */
  lastUpdate: { key: string; fields: ContentTypeFieldDef[]; expectedVersion: number } | null;
} {
  const state = { lastUpdate: null as { key: string; fields: ContentTypeFieldDef[]; expectedVersion: number } | null };

  return {
    get lastUpdate() {
      return state.lastUpdate;
    },
    async updateContentTypeFields(input, _optional = {}) {
      state.lastUpdate = input;
      if (options.updateError) throw options.updateError;
      return { contentType: options.updatedContentType ?? FAKE_CONTENT_TYPE };
    },
  };
}
