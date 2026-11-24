/** Admin Sites card previews: which running sites can be captured, and the image route.
 * The capture policy lives in the host's site-preview service; this module only names the targets and
 * answers the stored bytes.
 *
 * Server-neutral raw spec (K1 §9.3): the host injects the preview reader and its stored media type, and
 * mounts the spec behind its admin ports (workspace 404, session principal, `system.read` authorization,
 * the redacted 500). `bufferedReply` keeps the hand-written route's `res.send(buffer)` wire:
 * `Content-Length`, the host's weak ETag and a bodiless 304 for a fresh GET/HEAD.
 *
 * Node entry: {@link servingAddressOf} reads the request's Node socket and this process's pid. */
import type { JsonRouteAuthorize, RouteInputContext } from '@jini-ai/core/contracts/server';

const PREFIX = '/api/admin/v1/workspaces/:workspaceId/system/sites';

/** The fields of a local-site supervisor entry (`LocalSiteState`) a capture target needs. */
export interface PreviewableLocalSite {
  name: string;
  status: string;
  pid: number | null;
  adminUrl: string | null;
}

/** One site the host's preview service may capture. Structurally the host service's own target type. */
export interface SitePreviewTarget {
  name: string;
  /** The site's PUBLIC root, always a loopback URL this server built — never caller-supplied. */
  url: string;
  /** Changes on every restart (a pid), so a new run gets one fresh capture. */
  lifecycle: string;
}

/**
 * Capture targets for every site with a live address: each RUNNING local site at its own public
 * root (derived from the supervisor's loopback `adminUrl`), plus the site this process serves at
 * the scheme and port this request actually arrived on — the socket's, not a forwarded header's,
 * so a proxy in front (Vite's dev proxy) cannot point the capture anywhere else.
 * @complexity O(n) in the local-site count.
 */
export function sitePreviewTargets(
  { servingName, localSites }: { servingName: string; localSites: readonly PreviewableLocalSite[] },
  { serving }: { serving?: { scheme: 'http' | 'https'; port: number; pid: number } } = {},
): SitePreviewTarget[] {
  const targets: SitePreviewTarget[] = [];
  if (serving) targets.push({ name: servingName, url: `${serving.scheme}://localhost:${serving.port}/`, lifecycle: `serving:${serving.pid}` });
  for (const site of localSites) {
    if (site.status !== 'running' || site.adminUrl === null || site.pid === null || site.name === servingName) continue;
    targets.push({ name: site.name, url: new URL('/', site.adminUrl).href, lifecycle: `pid:${site.pid}` });
  }
  return targets;
}

/** The fields of a Node request socket {@link servingAddressOf} reads (a TLS socket sets `encrypted`). */
export interface ServingSocketRequest { socket?: { localPort?: number; encrypted?: boolean } }

/** This server's own listening scheme and port, from the request's socket; `undefined` without one.
 * @complexity O(1). */
export function servingAddressOf({ req }: { req: ServingSocketRequest }, { pid = process.pid }: { pid?: number } = {}) {
  const socket = req.socket;
  if (!socket?.localPort) return undefined;
  return { scheme: socket.encrypted ? 'https' as const : 'http' as const, port: socket.localPort, pid };
}

/** What the preview route reads; workspace and authorization come from the host ports. */
export interface SitePreviewRouteDeps {
  /** The stored capture for a site, or `null`. Absent on a host without previews: every site is the 404. */
  sitePreviews?: { read(required: { name: string }): Uint8Array | null } | undefined;
  /** The media type the host's preview store writes (`Content-Type` of every 200). */
  previewContentType: string;
}

/** The fields of the authenticated principal this route's host ports read. */
export interface SitePreviewPrincipal { id: string }

/** The server-neutral raw route (K1 §9.3), structurally an http-kit `RawRouteSpec`. */
export interface SitePreviewRawRoute<Deps extends SitePreviewRouteDeps = SitePreviewRouteDeps> {
  readonly method: 'get';
  readonly path: string;
  readonly bufferedReply: true;
  handle(
    required: { readonly raw: RouteInputContext; readonly deps: Deps; readonly context: SitePreviewPrincipal | undefined; readonly authorize: JsonRouteAuthorize },
    optional: { readonly signal: AbortSignal },
  ): Promise<Response>;
}

/** The 404 body exactly as `res.status(404).json(...)` serialized it. */
const NOT_FOUND_BODY = JSON.stringify({ code: 'SITE_PREVIEW_NOT_FOUND', error: 'no preview' });

/**
 * `GET .../system/sites/:name/preview` — the stored capture, or 404. The admin requests it as
 * `?v=<version>` from the listing's `previewVersions`, so the bytes behind one URL never change and
 * the browser may keep them indefinitely; a new capture is a new URL.
 * @complexity O(n) in the image size (one file read).
 */
export const sitePreviewRoute: SitePreviewRawRoute = {
  method: 'get',
  path: `${PREFIX}/:name/preview`,
  bufferedReply: true,
  async handle({ raw, deps, authorize }) {
    await authorize({ permission: 'system.read', entityType: 'site-registry' });
    const bytes = deps.sitePreviews?.read({ name: String(raw.params.name ?? '') }) ?? null;
    if (bytes === null) return new Response(NOT_FOUND_BODY, { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': deps.previewContentType,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
};
