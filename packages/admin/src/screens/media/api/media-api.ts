import { BASE, WORKSPACE_ID } from "@jini-ai/admin/shell/lib/admin-http/config";
import { querySuffix } from "@jini-ai/core/admin-runtime";
import type { AdminMedia, MediaGridOrder, MediaGridPage, MediaGridTab } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { MediaProviderOption } from "@jini-ai/core";
import type { MediaProviderCredentials } from "../../../react/kit-media-providers.js";
import type { MediaProviderFields } from "@jini-ai/ui/core";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";

/**
 * One media-generation vendor's stored credentials, keyed by ENGINE-CANONICAL provider id (`grok`,
 * `nanobanana`, …) — see `features/media/media-provider-catalog.ts` for why the spelling matters.
 *
 * Structurally `@jini-ai/ui`'s `MediaProviderCredentials` and mirrors
 * the host server's `MediaProviderCredentialView`. `apiKey`
 * is send-only: the operator types one and it goes up, but no response ever carries it back — a
 * stored key comes back as `apiKeyConfigured`/`apiKeyTail` instead.
 */
export interface AdminMediaProviderCredentials extends MediaProviderCredentials {
  apiKeyHint?: CredentialTokenHint | null;
}

export type AdminMediaProviderMap = Record<string, AdminMediaProviderCredentials>;

/** The host's authenticated admin request — it owns the base URL, authentication, retries and error
 *  decoding, so this client only names paths, methods and bodies. */
export type MediaRequestFn = <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;

/** What the host injects into {@link createMediaApi}. */
export interface MediaApiDeps {
  /** The host's authenticated admin request. */
  request: MediaRequestFn;
  /** Builds the host's public-site URL for a path (the public `/m/` route lives on the site origin,
   *  not the admin API origin, so the admin cannot derive it itself). */
  siteUrl: (required: { path: string }) => string;
}

/** One provider's own credentials row — the only target a provider write may name. */
function mediaProviderPath({ providerId }: { providerId: string }, _optional: Record<string, never> = {}): string {
  return `/workspaces/${WORKSPACE_ID}/media/providers/${encodeURIComponent(providerId)}`;
}

/**
 * The media-provider credential calls: one read of the markers map and one write per provider. There
 * is deliberately no whole-map write — a map sent from one window omits a key another window saved
 * since, and omission deleted it. Split out of {@link createMediaApi} so each stays short.
 */
function createMediaProviderCalls({ request }: Pick<MediaApiDeps, "request">, _optional: Record<string, never> = {}) {
  return {
    /** The workspace's media-generation vendor credentials, as markers only — never key material.
     *  Bare map, not a `{ data }` envelope, matching `MediaProvidersPort.fetchMediaProviders`. */
    getMediaProviders: () =>
      request<AdminMediaProviderMap>({ path: `/workspaces/${WORKSPACE_ID}/media/providers` }),
    /** The host's live, configurable provider cards (one per public provider, aliases merged), projected
     *  from the registry generation uses. Vendor names, base URLs and model ids only — never keys. */
    getMediaProviderCatalog: () =>
      request<{ providers: MediaProviderOption[] }>({ path: `/workspaces/${WORKSPACE_ID}/media/providers/catalog` }),
    /** Merges ONE provider's editable fields into its stored credentials; no other provider is named,
     *  so another window's saved key cannot be undone. An omitted `apiKey` keeps the stored key. Resolves
     *  the authoritative markers map. Replaces the whole-map PUT, whose omissions deleted. */
    patchMediaProvider: ({ providerId, fields }: { providerId: string; fields: MediaProviderFields }, _o: Record<string, never> = {}) =>
      request<AdminMediaProviderMap>({ path: mediaProviderPath({ providerId }) }, { init: {
        method: "PATCH",
        body: JSON.stringify(fields),
      } }),
    /** Deletes exactly one provider's stored credentials — deletion is only ever this named request,
     *  never inferred from a provider missing in a map. Resolves the authoritative markers map. */
    removeMediaProvider: ({ providerId }: { providerId: string }, _o: Record<string, never> = {}) =>
      request<AdminMediaProviderMap>({ path: mediaProviderPath({ providerId }) }, { init: { method: "DELETE" } }),
  };
}

/** The paged library read, split out of {@link createMediaApi} so each stays short. */
function createMediaGridCalls({ request }: Pick<MediaApiDeps, "request">, _optional: Record<string, never> = {}) {
  return {
    /** One bounded page of a tab in the server's order, or one exact asset (`itemId`, no cursor), with workspace-wide
     *  counts. Never reads the whole library; `cursor` is the previous page's opaque `nextCursor`. */
    listMediaGrid: (
      view: { tab: MediaGridTab; orderBy: MediaGridOrder },
      page: { limit?: number; cursor?: string; itemId?: string } = {},
    ) => {
      const query = new URLSearchParams({ tab: view.tab, orderBy: view.orderBy });
      if (page.limit !== undefined) query.set("limit", String(page.limit));
      if (page.cursor !== undefined) query.set("cursor", page.cursor);
      if (page.itemId !== undefined) query.set("itemId", page.itemId);
      return request<MediaGridPage>({ path: `/workspaces/${WORKSPACE_ID}/media/grid${querySuffix({ query: query.toString() })}` });
    },
  };
}

/** The admin API calls of the media feature, bound to the host's injected collaborators.
 *  @example const mediaApi = createMediaApi({ request, siteUrl }); */
export function createMediaApi({ request, siteUrl }: MediaApiDeps, _optional: Record<string, never> = {}) {
  const mediaOriginalUrl = ({ id }: { id: string }, _o: Record<string, never> = {}) => `${BASE}/workspaces/${WORKSPACE_ID}/media/${encodeURIComponent(id)}/original`;
  return {
    listMedia: () => request<{ media: AdminMedia[] }>({ path: `/workspaces/${WORKSPACE_ID}/media` }),
    ...createMediaProviderCalls({ request }),
    ...createMediaGridCalls({ request }),
    /** Byte-serving URL for an asset's original file (MSG-05) — authenticated, same-origin, so a
     *  plain `<img src>`/`<video src>` sends the session cookie automatically with no `crossorigin`
     *  attribute needed. Not wrapped in `request()` like the rest of this file's methods: callers
     *  want the URL string itself to hand to a DOM element, not a parsed JSON response. `Content-Type`
     *  is sniffed server-side from magic bytes (falls back to `application/octet-stream`, and a
     *  sniffed HTML/SVG is deliberately served as a non-rendering attachment) — see `Media.tsx`'s
     *  `MediaPreview` for how the client discovers which element type an asset actually needs. */
    mediaOriginalUrl,
    /** The image a public post shows as its cover: the `/m/` route's core `public` rendition (WebP,
     *  uncropped, generated once and cached server-side — the host server's media bootstrap).
     *  The Edit post cover slot shows this one so it matches the published page (owner 2026-10-11:
     *  it showed the `og` 1200 × 630 share crop squeezed into a 220px band; the public page shows the
     *  whole image). A browser that opened the post already has it cached. `v1` because that bootstrap
     *  is find-or-create and never mints a second version; callers still fall back to
     *  {@link mediaOriginalUrl} when this fails to load (no `sharp`, a gated asset, a newer version). */
    mediaPreviewRenditionUrl: ({ id }: { id: string }, _optional: Record<string, never> = {}) => siteUrl({ path: `/m/${encodeURIComponent(id)}/public.v1/image.jpg` }),
    /** The asset's real, server-sniffed `Content-Type`, read from a `HEAD` of {@link mediaOriginalUrl}
     *  (no body transferred) — the same value the public renderer dispatches `<img>` vs `<video>` on.
     *  Resolves `""` when the route answers non-2xx or sends no header. */
    mediaContentType: async ({ id }: { id: string }, { fetch: fetchPort = fetch }: { fetch?: typeof fetch } = {}): Promise<string> => {
      const res = await fetchPort(mediaOriginalUrl({ id }), {
        method: "HEAD",
        credentials: "same-origin",
      });
      return res.ok ? (res.headers.get("content-type") ?? "") : "";
    },
    importMediaFromUrl: (
      input: { url: string },
      options: { filename?: string; alt?: string; caption?: string; credit?: string } = {}
    ) =>
      request<{ media: AdminMedia }>({ path: `/workspaces/${WORKSPACE_ID}/media/import-url` }, { init: {
        method: "POST",
        body: JSON.stringify({ ...input, ...options }),
      } }),
    uploadMedia: (
      input: { filename: string; contentType: string; dataBase64: string },
      options: { alt?: string; caption?: string; credit?: string } = {}
    ) =>
      request<{ media: AdminMedia }>({ path: `/workspaces/${WORKSPACE_ID}/media` }, { init: {
        method: "POST",
        body: JSON.stringify({ ...input, ...options }),
      } }),
    updateMedia: (
      { id }: { id: string },
      options: {
        title?: string;
        slug?: string;
        alt?: string;
        caption?: string;
        credit?: string;
        width?: number | null;
        height?: number | null;
        cssClass?: string | null;
        htmlAttributes?: string | null;
      } = {}
    ) =>
      request<{ media: AdminMedia }>({ path: `/workspaces/${WORKSPACE_ID}/media/${encodeURIComponent(id)}` }, { init: {
        method: "PATCH",
        body: JSON.stringify(options),
      } }),
    trashMedia: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ media: AdminMedia }>({ path: `/workspaces/${WORKSPACE_ID}/media/${encodeURIComponent(id)}/trash` }, { init: {
        method: "POST",
      } }),
    deleteMedia: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ purged: boolean }>({ path: `/workspaces/${WORKSPACE_ID}/media/${encodeURIComponent(id)}` }, { init: {
        method: "DELETE",
      } }),
    /** Library documents (`kind=document`): private, active only, never in media pickers. */
    listDocuments: () => request<{ media: AdminMedia[] }>({ path: `/workspaces/${WORKSPACE_ID}/media?kind=document` }),
    /** The server takes the document type from the filename's extension and checks the bytes. */
    uploadDocument: (input: { filename: string; dataBase64: string }) =>
      request<{ media: AdminMedia }>({ path: `/workspaces/${WORKSPACE_ID}/media` }, { init: {
        method: "POST",
        body: JSON.stringify({ ...input, kind: "document" }),
      } }),
    /** A Markdown/text/CSV/JSON document's UTF-8 source, 64 KiB per page (`nextOffset` continues it). */
    readDocumentText: ({ id }: { id: string }, options: { offset?: number } = {}) =>
      request<{ id: string; text: string; offset: number; nextOffset: number | null; totalBytes: number; truncated: boolean }>(
        { path: `/workspaces/${WORKSPACE_ID}/media/${encodeURIComponent(id)}/text${querySuffix({ query: options.offset ? "offset=" + options.offset : "" })}` },
      ),
  };
}
