import { defineJsonRoute, isSameOriginBrowserWrite, ok, routeReply, type JsonRouteAuthorize, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { agentPluginActorId, pluginIdParam, type AgentPluginRoutePrincipal } from "./shared.js";

/**
 * @file Admin routes for plugin-owned admin surfaces (`@jini-ai/agent-plugins/admin-surfaces`):
 *
 * - `AGENT_PLUGIN_SURFACES` `GET  .../agent-plugins/:pluginId/surfaces` — the admitted surfaces of
 *   one plugin (id, title, frame `src`, declared actions for the host page's early refusal), for the
 *   details modal's tabs. `admin.plugins.read`.
 * - `AGENT_PLUGIN_SURFACE_BOOTSTRAP` `POST .../surfaces/:surfaceId/bootstrap` — the short-lived,
 *   never-cached start data the host page passes into the frame's `init`. `admin.plugins.enable`.
 * - `AGENT_PLUGIN_SURFACE_ACTION` `POST .../surfaces/:surfaceId/actions` — runs one declared action
 *   through Jini's dispatcher (which re-checks the declaration and schemas, because this route can be
 *   called directly). `admin.plugins.enable`.
 *
 * Why the two POSTs need more than the session: bootstrap data may carry a short-lived access token
 * and actions run host handlers, so both refuse API-key credentials (a surface is a browser UI) and
 * cross-origin requests (`isSameOriginBrowserWrite`) BEFORE authorization or any lookup. The surface files
 * themselves are served by the public route in Jini cms `public-http/routes/agent-plugin-surfaces/files`,
 * because a sandboxed frame's module-script fetches carry no cookie.
 *
 * Ids from the URL are only compared against admitted surfaces, never joined into a path. Errors
 * never echo handler text; the dispatcher already maps throws to surface-safe failures. An action
 * that started a sign-in also returns `hostSignIns`: the authorization links the host itself issued
 * during that request, which the host page offers to open, because the
 * sandboxed frame cannot and must never choose a URL for the host page to open.
 *
 * Gate order (host mount): the write preflight ({@link adminSurfaceWritePreflight}) answers first,
 * then the host's session-credential 403, then the workspace 404, then authorization — so these
 * specs only authorize, look the surface up and answer. `@jini-ai/agent-plugins` depends on this
 * package, so its dispatcher, bootstrap envelope and headers reach these specs as injected functions.
 */

// Route params need no fallback: Express sets every named param of a matched route to a non-empty
// string (an empty segment never matches), and `requireAdminSession` always runs a JSON body parser
// before these handlers, so `req.body` is at least `{}` (both pinned in the routes integration test).
const WRITE_PERMISSION = "admin.plugins.enable";
const SURFACE_PATH = "/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/surfaces";

/** The fields of an admitted surface these routes read (`@jini-ai/agent-plugins`' `LoadedAdminSurface`). */
export interface AdminSurfaceRouteSurface {
  readonly plugin: { readonly pluginId: string };
  readonly descriptor: { readonly id: string; readonly title: string; readonly entry: string; readonly actions: readonly unknown[]; readonly linkOrigins?: readonly string[] };
}

/** Who is asking, passed to every handler and bootstrap provider; the host already authorized it. */
export interface AdminSurfaceRouteContext { readonly workspaceId: string; readonly principalId: string; readonly pluginId: string; readonly surfaceId: string }

/** The list read: the admitted surfaces and the public file URL a frame loads. */
export interface AdminSurfaceListRouteDeps<S extends AdminSurfaceRouteSurface> {
  workspaceId: string;
  listSurfaces: (required: { workspaceId: string }) => Promise<readonly S[]>;
  surfaceFileUrl: (required: { pluginId: string; surfaceId: string; path: string }) => string;
}

/** Both writes resolve the URL's surface among the admitted ones. */
export interface AdminSurfaceWriteRouteDeps<S extends AdminSurfaceRouteSurface> {
  workspaceId: string;
  findSurface: (required: { workspaceId: string; pluginId: string; surfaceId: string }) => Promise<S | undefined>;
}

/** The bootstrap write: the host's start data, wrapped in the package's envelope and headers. */
export interface AdminSurfaceBootstrapRouteDeps<S extends AdminSurfaceRouteSurface> extends AdminSurfaceWriteRouteDeps<S> {
  bootstrapData: (required: { context: AdminSurfaceRouteContext }) => Promise<unknown>;
  createBootstrap: (required: { surfaceId: string; data: unknown; nowMs: number }) => unknown;
  bootstrapHeaders: () => Readonly<Record<string, string>>;
  nowMs: () => number;
}

/** The action write: the package's dispatcher over the host's handlers, wrapped in the host's sign-in collector. */
export interface AdminSurfaceActionRouteDeps<S extends AdminSurfaceRouteSurface, O> extends AdminSurfaceWriteRouteDeps<S> {
  /** `createAdminSurfaceActionDispatcher` over the host's handlers for `surface`, with the host's handler-error sink. */
  dispatcherFor: (required: { surface: S }) => { dispatch: (required: { action: string; payload: unknown; context: AdminSurfaceRouteContext }) => Promise<O> };
  /** Runs the dispatch and adds only the sign-in links the host issued during it. */
  withSignIns: (required: { run: () => Promise<O> }) => Promise<unknown>;
}

/** The ids both writes parse; the action write also carries its body (checked after the 404). */
interface SurfaceInput { readonly pluginId: string; readonly surfaceId: string; readonly body: unknown }

/** The `:pluginId`/`:surfaceId` segments and the body. @complexity O(1). */
function surfaceInput({ raw }: { raw: { params: Record<string, string | undefined>; body: unknown } }, _optional: Record<string, never> = {}): SurfaceInput {
  return { pluginId: pluginIdParam({ params: raw.params }), surfaceId: String(raw.params.surfaceId ?? ""), body: raw.body };
}

/** Authorize, then resolve the URL's surface or refuse 404. @complexity O(s) admitted surfaces. */
async function admittedSurface<S extends AdminSurfaceRouteSurface>(
  { input, deps, authorize, permission }: { input: SurfaceInput; deps: AdminSurfaceWriteRouteDeps<S>; authorize: JsonRouteAuthorize | undefined; permission: string },
  _optional: Record<string, never> = {},
): Promise<S> {
  if (!authorize) throw new Error("agent-plugins admin route has no authorizer");
  await authorize({ permission });
  const surface = await deps.findSurface({ workspaceId: deps.workspaceId, pluginId: input.pluginId, surfaceId: input.surfaceId });
  if (!surface) rejectRoute({ status: 404, error: "admin surface was not found", code: "ADMIN_SURFACE_NOT_FOUND" });
  return surface;
}

function contextFor({ workspaceId, context, surface }: { workspaceId: string; context: AgentPluginRoutePrincipal | undefined; surface: AdminSurfaceRouteSurface }, _optional = {}): AdminSurfaceRouteContext {
  return { workspaceId, principalId: agentPluginActorId({ context }), pluginId: surface.plugin.pluginId, surfaceId: surface.descriptor.id };
}

/** The write preflight's own refusal (host copy); its status and body are written as-is. */
export interface AdminSurfaceWriteRefusal { readonly status: number; readonly body: unknown }

/** The CSRF gate for the two writes, as a host mount preflight evaluated before every other gate.
 * Why on top of the `SameSite=Strict` session cookie: these two routes hand a surface short-lived
 * credentials and run host handlers on its behalf, so a request must also prove it came from this
 * admin origin's own scripts. A browser always sends `Origin` on a cross-origin or POST fetch, and
 * a sandboxed frame's requests carry `Origin: null`, which never matches: the frame must go through
 * the host page, never straight to these routes. Fetch metadata, when the browser sends it, must
 * agree. This is browser protection, not proof against a client that forges every header; such a
 * client still needs the session cookie.
 * @complexity O(1) per request. */
export function adminSurfaceWritePreflight(
  { refusal }: { refusal: AdminSurfaceWriteRefusal },
  _optional: Record<string, never> = {},
): { readonly readHeaders: readonly string[]; readonly check: (required: { headers: Readonly<Record<string, string>> }) => AdminSurfaceWriteRefusal | undefined } {
  return {
    readHeaders: ["origin", "host", "sec-fetch-site"],
    check: ({ headers }) => isSameOriginBrowserWrite({ origin: headers.origin, host: headers.host, fetchSite: headers["sec-fetch-site"] }) ? undefined : refusal,
  };
}

/** One listed surface: its ids, title, frame `src`, declared actions and link origins. */
export interface AdminSurfaceListItem { id: string; title: string; src: string; actions: readonly unknown[]; linkOrigins: readonly string[] }

/** The three surface specs over the host's surface type `S` and dispatch outcome `O`.
 * @complexity O(1); per request as each spec's handler. */
export function defineAdminSurfaceRoutes<S extends AdminSurfaceRouteSurface, O>(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  /** `GET …/surfaces`: one plugin's admitted surfaces (no write gates; a machine credential may read). */
  const list = defineJsonRoute<{ pluginId: string }, { pluginId: string; surfaces: AdminSurfaceListItem[] }, AdminSurfaceListRouteDeps<S>, AgentPluginRoutePrincipal>({
    method: "get",
    path: SURFACE_PATH,
    parse: (raw) => ok({ value: { pluginId: pluginIdParam({ params: raw.params }) } }),
    handle: async ({ input: { pluginId }, deps, authorize }) => {
      if (!authorize) throw new Error("agent-plugins admin route has no authorizer");
      await authorize({ permission: "admin.plugins.read" });
      const surfaces = (await deps.listSurfaces({ workspaceId: deps.workspaceId })).filter((surface) => surface.plugin.pluginId === pluginId);
      return ok({ value: { pluginId, surfaces: surfaces.map(({ descriptor }) => ({ id: descriptor.id, title: descriptor.title, src: deps.surfaceFileUrl({ pluginId, surfaceId: descriptor.id, path: descriptor.entry }), actions: descriptor.actions, linkOrigins: descriptor.linkOrigins ?? [] })) } });
    },
  });

  /** `POST …/:surfaceId/bootstrap`: the never-cached start envelope. */
  const bootstrap = defineJsonRoute<SurfaceInput, RouteReply<unknown>, AdminSurfaceBootstrapRouteDeps<S>, AgentPluginRoutePrincipal>({
    method: "post",
    path: `${SURFACE_PATH}/:surfaceId/bootstrap`,
    parse: (raw) => ok({ value: surfaceInput({ raw }) }),
    handle: async ({ input, deps, context, authorize }) => {
      const surface = await admittedSurface({ input, deps, authorize, permission: WRITE_PERMISSION });
      const data = await deps.bootstrapData({ context: contextFor({ workspaceId: deps.workspaceId, context, surface }) });
      const body = deps.createBootstrap({ surfaceId: surface.descriptor.id, data, nowMs: deps.nowMs() });
      return ok({ value: routeReply({ status: 200, body, headers: deps.bootstrapHeaders() }) });
    },
  });

  /** `POST …/:surfaceId/actions`: one declared action through the dispatcher. */
  const action = defineJsonRoute<SurfaceInput, RouteReply<unknown>, AdminSurfaceActionRouteDeps<S, O>, AgentPluginRoutePrincipal>({
    method: "post",
    path: `${SURFACE_PATH}/:surfaceId/actions`,
    parse: (raw) => ok({ value: surfaceInput({ raw }) }),
    handle: async ({ input, deps, context, authorize }) => {
      const surface = await admittedSurface({ input, deps, authorize, permission: WRITE_PERMISSION });
      const body = input.body as { action?: unknown; payload?: unknown };
      if (typeof body.action !== "string") rejectRoute({ status: 400, error: "the request must name an action", code: "INVALID_REQUEST" });
      const dispatcher = deps.dispatcherFor({ surface });
      const { action: name, payload } = body as { action: string; payload?: unknown };
      const outcome = await deps.withSignIns({ run: () => dispatcher.dispatch({ action: name, payload, context: contextFor({ workspaceId: deps.workspaceId, context, surface }) }) });
      return ok({ value: routeReply({ status: 200, body: outcome, headers: { "Cache-Control": "no-store" } }) });
    },
  });

  return { list, bootstrap, action };
}
