import { querySuffix } from "@jini-ai/core/admin-runtime";
import type { AdminContentType, AdminEntry, ContentTypeFieldDef, ContentTypeLifecycleOp } from "./collections-api.types.js";

/** The host's authenticated admin request — it owns the base URL, authentication, retries and
 *  error decoding, so this client only names paths, methods and bodies. */
export type CollectionsRequestFn = <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;

/** The admin API calls of the collections feature, bound to the host's injected collaborators.
 *  @example const collectionsApi = createCollectionsApi({ request }); */
export function createCollectionsApi({ request }: { request: CollectionsRequestFn }, _optional: Record<string, never> = {}) {
  return {
    // Collections (ADR-022/ADR-043) — content-types registry + entries. `/api/admin/v1/*`, not the
    // `/workspaces/{id}/*` shape most other admin clients use — these routes take workspace from the
    // authed principal's session server-side, matching the database and recovery clients.
    listContentTypes: () => request<{ items: AdminContentType[] }>({ path: "/content-types" }),
    createContentType: (input: { key: string; label: string; fields: ContentTypeFieldDef[] }) =>
      request<{ contentType: AdminContentType }>({ path: "/content-types" }, { init: {
        method: "POST",
        body: JSON.stringify(input),
      } }),
    updateContentTypeFields: (
      { key, fields, expectedVersion }: { key: string; fields: ContentTypeFieldDef[]; expectedVersion: number },
      _options: Record<string, never> = {}
    ) =>
      request<{ contentType: AdminContentType }>({ path: `/content-types/${encodeURIComponent(key)}/fields` }, { init: {
        method: "PUT",
        body: JSON.stringify({ fields, expectedVersion }),
      } }),
    contentTypeLifecycle: (
      {
        key,
        op,
        expectedVersion,
      }: { key: string; op: ContentTypeLifecycleOp; expectedVersion: number },
      _options: Record<string, never> = {}
    ) =>
      request<{ contentType: AdminContentType }>({ path: `/content-types/${encodeURIComponent(key)}/lifecycle` }, { init: {
        method: "POST",
        body: JSON.stringify({ op, expectedVersion }),
      } }),
    listEntries: (options: { type?: string } = {}) =>
      request<{ items: AdminEntry[] }>({ path: `/entries${querySuffix({ query: options.type ? "type=" + encodeURIComponent(options.type) : "" })}` }),
    createEntry: (
      input: { type: string; slug: string; title: string },
      options: { fieldsJson?: unknown; bodyJson?: unknown } = {}
    ) =>
      request<{ entry: AdminEntry }>({ path: "/entries" }, { init: { method: "POST", body: JSON.stringify({ ...input, ...options }) } }),
    updateEntry: (
      { id, expectedVersion }: { id: string; expectedVersion: number },
      // `bodyJson` was missing here, which made the rich-text half of an entry
      // edit untypeable — see `CollectionEntryEditor`'s save. `createEntry` above
      // has always accepted it, and `updatePost` does too.
      options: { title?: string; fieldsJson?: unknown; bodyJson?: unknown } = {}
    ) =>
      request<{ entry: AdminEntry }>({ path: `/entries/${encodeURIComponent(id)}` }, { init: {
        method: "PUT",
        body: JSON.stringify({ expectedVersion, ...options }),
      } }),
    entryLifecycle: (
      { id, op, expectedVersion }: { id: string; op: "publish" | "unpublish"; expectedVersion: number },
      _options: Record<string, never> = {}
    ) =>
      request<{ entry: AdminEntry }>({ path: `/entries/${encodeURIComponent(id)}/lifecycle` }, { init: {
        method: "POST",
        body: JSON.stringify({ op, expectedVersion }),
      } }),
  };
}

/** The collections API client {@link createCollectionsApi} builds. */
export type CollectionsApi = ReturnType<typeof createCollectionsApi>;
