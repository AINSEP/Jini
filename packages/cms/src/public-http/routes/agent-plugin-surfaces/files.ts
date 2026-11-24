import type { RateLimiter, RouteInputContext } from "@jini-ai/core/contracts/server";

/**
 * @file `AGENT_PLUGIN_SURFACE_FILE` — `GET <prefix>/:pluginId/:surfaceId/<path>`:
 * the static files of one plugin-owned admin surface, which the admin page renders in an
 * `<iframe sandbox="allow-scripts">`.
 *
 * Why PUBLIC (not behind `requireAdminSession`): the frame runs in an opaque origin, so its module
 * scripts are cross-origin CORS fetches that carry no cookie; an authenticated route would break
 * every surface. What makes that safe: only surfaces Jini's loader admitted (active plugin, the
 * build's own shipped digest) are served; only the surface's declared `entry` and `files` are read,
 * through the lifecycle's contained read (symlinks resolved, nothing outside the package root);
 * every response carries Jini's isolation headers (strict CSP with `sandbox allow-scripts` and
 * `frame-ancestors 'self'`, `nosniff`, `no-referrer`). Surface files are plugin code that ships in
 * the build, never secrets: start data reaches the frame only through the authenticated bootstrap.
 *
 * Request ids and the path are only compared with declared values, never joined into a path here.
 * The existing http-kit limiter charges each client IP before any contribution load or file read.
 *
 * Server-neutral raw spec (K1 §9.3): the host injects the limiter, the admitted-surface lookup and the
 * contained file read, and resolves the client address (`requestFacts`) under its own proxy-trust policy.
 * `bufferedReply` keeps the hand-written route's `res.send` wire: `Content-Length`, the host's weak ETag
 * and a bodiless 304 for a fresh GET/HEAD.
 */

/** One surface file read: the body and its isolation headers, or a refusal (not declared). */
export type AdminSurfaceFileRead = { readonly ok: true; readonly body: string; readonly headers: Readonly<Record<string, string>> } | { readonly ok: false };

/** What the host injects. `Surface` is the host's admitted-surface record, passed back to `readSurfaceFile` untouched. */
export interface AdminSurfaceFilesRouteDeps<Surface> {
  /** Charged once per request with the client address, before any lookup. */
  readonly limiter: Pick<RateLimiter, "check">;
  /** The one admitted surface with these ids, or `undefined`. Ids are compared, never joined into a path. */
  readonly findSurface: (required: { readonly pluginId: string; readonly surfaceId: string }) => Promise<Surface | undefined>;
  /** One declared file of that surface, through the host's contained read. */
  readonly readSurfaceFile: (required: { readonly surface: Surface; readonly path: string }) => Promise<AdminSurfaceFileRead>;
}

/** The server-neutral raw route (K1 §9.3), structurally an http-kit `RawRouteSpec`. */
export interface AdminSurfaceFilesRoute<Surface> {
  readonly method: "get";
  readonly path: string;
  readonly requestFacts: true;
  readonly bufferedReply: true;
  handle(required: { readonly raw: RouteInputContext; readonly deps: AdminSurfaceFilesRouteDeps<Surface> }, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

const REFUSAL_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "text/plain; charset=utf-8" };

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: REFUSAL_HEADERS });
}

/**
 * The `Content-Type` Express wrote for a text body (`res.send(string)` sets the utf-8 charset): no type means
 * `text/html`, and any other charset parameter is replaced.
 * @complexity O(n) in the header length.
 */
function utf8ContentType(type: string | null): string {
  const bare = (type ?? "text/html").replace(/;\s*charset=[^;]*/i, "");
  return `${bare}; charset=utf-8`;
}

/** Limit, find, read: every refusal is the plain 404 except the limiter's own 429. */
async function answer<Surface>({ raw, deps }: { readonly raw: RouteInputContext; readonly deps: AdminSurfaceFilesRouteDeps<Surface> }): Promise<Response> {
  const key = raw.facts?.clientAddress;
  // A mount without the host's client address is a wiring bug: fail closed, before any plugin I/O.
  if (key === undefined) return notFound();
  const limit = await deps.limiter.check({ key });
  if (!limit.allowed) return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), ...REFUSAL_HEADERS } });
  // No param fallbacks: Express sets both named params of a matched route, and the `*` tail as a
  // string ("" for an empty tail), pinned in the routes integration test.
  const surface = await deps.findSurface({ pluginId: String(raw.params.pluginId), surfaceId: String(raw.params.surfaceId) });
  const file = surface ? await deps.readSurfaceFile({ surface, path: String(raw.params[0]) }) : undefined;
  if (!file?.ok) return notFound();
  const headers = new Headers(file.headers);
  headers.set("content-type", utf8ContentType(headers.get("content-type")));
  return new Response(file.body, { status: 200, headers });
}

/**
 * The public surface-files route under the host's `pathPrefix`; denied calls do no plugin I/O.
 * @complexity O(p + s) admitted plugin/surface scan per allowed request (the host's lookup); limiter state is window-bounded.
 */
export function createAdminSurfaceFilesRoute<Surface>(required: { readonly pathPrefix: string }, _optional: Record<string, never> = {}): AdminSurfaceFilesRoute<Surface> {
  return {
    method: "get",
    path: `${required.pathPrefix}/:pluginId/:surfaceId/*`,
    requestFacts: true,
    bufferedReply: true,
    async handle({ raw, deps }) {
      try {
        return await answer({ raw, deps });
      } catch {
        // A containment refusal or read fault names server paths; never echoed.
        return notFound();
      }
    },
  };
}
