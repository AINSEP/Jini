import type { AdminPost } from "../../posts/api/posts-api.types.js";
import type { AdminPagePluginEmbed } from "./pages-api.types.js";

/** What the host injects into {@link createPagesApi}. */
export interface PagesApiDeps {
  /** The host's `request`: it owns the base URL, authentication, retries and error decoding, so this client only names paths, methods and bodies. */
  request: <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;
  /** The workspace the paths are scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}

/** The admin API calls of the pages feature, bound to the host's injected collaborators.
 *  @example const pagesApi = createPagesApi({ request, workspaceId }); */
export function createPagesApi({ request, workspaceId }: PagesApiDeps, _optional: Record<string, never> = {}) {
  return {
    listPages: () =>
      request<{ posts: Array<{ post: AdminPost }> }>({ path: `/workspaces/${workspaceId}/pages` }),
    createPage: ({ title }: { title: string }, _optional: Record<string, never> = {}) =>
      request<{ post: AdminPost }>({ path: `/workspaces/${workspaceId}/pages` }, { init: {
        method: "POST",
        body: JSON.stringify({ title }),
      } }),
    // Kind-guarded read: 404s if the id's row is not actually `kind: "page"`. the pages screen uses
    // this rather than `getPost` so the Pages editor can never silently open a Post — Pages and Posts
    // are separate features with separate editors, and the id in the URL is the only thing standing
    // between them.
    getPage: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ post: AdminPost; pluginEmbeds?: readonly AdminPagePluginEmbed[] }>({ path: `/workspaces/${workspaceId}/pages/${encodeURIComponent(id)}` }),
    // SPEC-047 — writes the bespoke-HTML body, and births the html row on first call. A DIFFERENT
    // endpoint from `updatePost` on purpose: the body and the title/slug/status go through two
    // separate server-side write paths.
    //
    // Carry the successful metadata save's version; another save between the requests must conflict.
    updatePageHtml: ({ id, html, expectedVersion }: { id: string; html: string; expectedVersion: number }, _optional: Record<string, never> = {}) =>
      request<{ post: AdminPost }>({ path: `/workspaces/${workspaceId}/pages/${encodeURIComponent(id)}/html` }, { init: {
        method: "PUT",
        body: JSON.stringify({ html, expectedVersion }),
      } }),
    // Soft delete (the host's pages delete route): same trash marker as deletePost, but
    // kind-guarded — 404s if the id's row is not actually kind:"page" (indistinguishable from
    // not-found, matching the rest of the pages/* routes' disclosed asymmetry).
    deletePage: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ post: AdminPost }>({ path: `/workspaces/${workspaceId}/pages/${encodeURIComponent(id)}` }, { init: {
        method: "DELETE",
      } }),
  };
}
