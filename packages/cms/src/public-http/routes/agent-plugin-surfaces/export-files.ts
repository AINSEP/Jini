import type { RateLimiter, RouteInputContext } from "@jini-ai/core/contracts/server";
import type { AgentPluginExport } from "@jini-ai/core/contracts/site/agent-plugins-manifest";

/**
 * @file `PLUGIN_EXPORT_FILE` — `GET <prefix>/:pluginId/:component/<path>`: the public declarative export
 * assets (stylesheet, PNG/SVG artwork, declared package scripts) a plugin's page exports reference.
 * Templates and undeclared files are never served.
 *
 * Server-neutral raw spec (K1 §9.3): the host injects the limiter and the export catalog (the enabled
 * packages and the contained asset read) and resolves the client address (`requestFacts`) under its own
 * proxy-trust policy. `bufferedReply` keeps the hand-written route's `res.send` wire: `Content-Length`, the
 * host's weak ETag and a bodiless 304 for a fresh GET/HEAD.
 */

/** One catalog entry: the plugin that owns the exports, whether it is enabled, and its declared exports. */
export interface PluginExportOwner<Plugin extends { readonly pluginId: string } = { readonly pluginId: string }> {
  readonly enabled: boolean;
  readonly plugin: Plugin;
  readonly exports: Readonly<Record<string, AgentPluginExport>>;
}

/** What the host injects. `Owner.plugin` is passed back to `readAsset` untouched. */
export interface PluginExportFilesRouteDeps<Owner extends PluginExportOwner = PluginExportOwner> {
  readonly workspaceId: string;
  /** Charged once per request with the client address, before any catalog I/O. */
  readonly limiter: Pick<RateLimiter, "check">;
  readonly source: {
    /** Every package that declares exports, enabled or not. */
    readonly list: (required: { readonly workspaceId: string }) => Promise<readonly Owner[]>;
    /** One declared file through the host's contained read. */
    readonly readAsset: (required: { readonly plugin: Owner["plugin"]; readonly filename: string }) => Promise<string | Uint8Array>;
  };
}

/** The server-neutral raw route (K1 §9.3), structurally an http-kit `RawRouteSpec`. */
export interface PluginExportFilesRoute<Owner extends PluginExportOwner = PluginExportOwner> {
  readonly method: "get";
  readonly path: string;
  readonly requestFacts: true;
  readonly bufferedReply: true;
  handle(required: { readonly raw: RouteInputContext; readonly deps: PluginExportFilesRouteDeps<Owner> }, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

/** The only public export file kinds: stylesheet, PNG/SVG artwork and declared scripts. */
const EXPORT_FILE_TYPES: Readonly<Record<string, string>> = { ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".js": "text/javascript; charset=utf-8" };

/** Fixed refusal never exposes containment errors or local package paths. */
function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * The `Content-Type` Express wrote for a text body (`res.send(string)` replaces any charset with utf-8).
 * @complexity O(n) in the header length.
 */
function utf8ContentType(type: string): string {
  return `${type.replace(/;\s*charset=[^;]*/i, "")}; charset=utf-8`;
}

/** The content type for a path this export declares as a servable package file; undefined refuses it.
 * @complexity O(e + a) over the export's declared scripts and assets.
 */
function servedFileType({ entry, path }: { readonly entry: AgentPluginExport; readonly path: string }, _options = {}): string | undefined {
  // A remote script is declared by URL and loaded from its own host; only package files are served here.
  const scripts = (entry.scripts ?? []).filter((script) => !script.startsWith("https://"));
  const declared = [entry.styles, ...Object.values(entry.assets ?? {}), ...scripts];
  const type = EXPORT_FILE_TYPES[path.slice(path.lastIndexOf(".")).toLowerCase()];
  // An unknown extension (e.g. a declared .html) is refused, never served under an image type.
  // JavaScript is served only from `scripts`; a .js path declared under assets is still refused.
  if (!type || !declared.includes(path) || (type.startsWith("text/javascript") && !scripts.includes(path))) return undefined;
  return type;
}

/** Match URL ids/path against declarations before any file read; no URL path is joined to disk.
 * @complexity O(p + e + a) catalog, export and declared asset scans, then one contained read.
 */
async function resolveFile<Owner extends PluginExportOwner>(
  { deps, pluginId, component, path }: { readonly deps: PluginExportFilesRouteDeps<Owner>; readonly pluginId: string; readonly component: string; readonly path: string },
  _options = {},
): Promise<{ readonly body: string | Uint8Array; readonly type: string } | undefined> {
  const packages = await deps.source.list({ workspaceId: deps.workspaceId });
  const owners = packages.filter((item) => item.enabled && item.plugin.pluginId === pluginId);
  const owner = owners.length === 1 ? owners[0] : undefined;
  const entry = owner && Object.entries(owner.exports).find(([name]) => name === component)?.[1];
  const type = entry ? servedFileType({ entry, path }) : undefined;
  if (!owner || !type) return undefined;
  return { body: await deps.source.readAsset({ plugin: owner.plugin, filename: path }), type };
}

/** Limit, resolve, read: every refusal is the plain 404 except the limiter's own 429. */
async function answer<Owner extends PluginExportOwner>({ raw, deps }: { readonly raw: RouteInputContext; readonly deps: PluginExportFilesRouteDeps<Owner> }): Promise<Response> {
  const key = raw.facts?.clientAddress;
  // A mount without the host's client address is a wiring bug: fail closed, before any plugin I/O.
  if (key === undefined) return notFound();
  const limit = await deps.limiter.check({ key });
  // No content type on the refusal: Express's `res.send(string)` defaulted it to html text.
  if (!limit.allowed) return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" } });
  const file = await resolveFile({ deps, pluginId: String(raw.params.pluginId), component: String(raw.params.component), path: String(raw.params[0]) });
  if (!file) return notFound();
  const text = typeof file.body === "string";
  return new Response(file.body as BodyInit, { status: 200, headers: {
    "Content-Type": text ? utf8ContentType(file.type) : file.type, "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer", "Cache-Control": "public, max-age=60" } });
}

/**
 * Rate-limit before catalog I/O. SVG is an inert image even when navigated to directly.
 * @complexity One catalog scan and one declared file read per allowed request.
 */
export function createPluginExportFilesRoute<Owner extends PluginExportOwner = PluginExportOwner>(required: { readonly pathPrefix: string }, _optional: Record<string, never> = {}): PluginExportFilesRoute<Owner> {
  return {
    method: "get",
    path: `${required.pathPrefix}/:pluginId/:component/*`,
    requestFacts: true,
    bufferedReply: true,
    async handle({ raw, deps }) {
      try {
        return await answer({ raw, deps });
      } catch {
        // A containment refusal, catalog or limiter fault names server paths; never echoed.
        return notFound();
      }
    },
  };
}
