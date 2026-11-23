/** Authenticated CMS lifecycle routes. Deployment/binding gates precede all filesystem/process effects. */
import { defineJsonRoute, ok, type JsonRouteAuthorize, type JsonRouteSpec } from '@jini-ai/core/contracts/server';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

/** The site-switch gate: the switcher base, or a refusal answered verbatim (403 when switching is off, else 409). */
export type SiteSwitchGate = { ok: true; switcherBase: string } | { ok: false; code: string };

/** The local-site supervisor operations these routes drive. */
export interface LocalSiteLifecyclePort {
  start(required: { name: string }): Promise<unknown>;
  stop(required: { name: string }): Promise<unknown>;
  withStoppedSite<T>(required: { name: string; task: () => Promise<T> }): Promise<T>;
}

/** The site-folder Trash operations, all relative to the switcher base. */
export interface LocalSiteTrashPort {
  trash(required: { base: string; name: string }): unknown;
  restore(required: { base: string; id: string }): void;
  remove(required: { base: string; id: string; checked: boolean; confirmed: boolean }): void;
}

/** What the lifecycle routes read; workspace and authorization come from the host ports. */
export interface LocalSiteLifecycleRouteDeps {
  /** The deployment's site-switch gate, evaluated per request before authorization. */
  siteSwitchBase: () => SiteSwitchGate;
  /** Absent when this deployment has no local site host (answered 409 after authorizing). */
  localSiteSupervisor?: LocalSiteLifecyclePort | undefined;
  siteTrash: LocalSiteTrashPort;
  /** The site name a Trash entry id belongs to, so its site is stopped while the entry moves. */
  siteTrashName: (required: { id: string }) => string;
  /** The code of the site layer's typed lifecycle error, or `undefined` for any other value. */
  localSiteErrorCode: (error: unknown) => string | undefined;
  afterTrash?: ((required: { base: string; name: string }) => void) | undefined;
}

/** The fields of the authenticated principal this route's host ports read. */
export interface LocalSitePrincipal { id: string }

/** Route params and the two confirmation flags; every route reads a subset. */
export interface LocalSiteLifecycleInput { name: string; id: string; checked: boolean; confirmed: boolean }

const STATUS: Record<string, number> = { VALIDATION_ERROR: 400, SITE_CONFIRM_REQUIRED: 400,
  SITE_NOT_FOUND: 404, SITE_SERVING: 409, SITE_RUNNING: 409, SITE_RUNNING_ELSEWHERE: 409, SITE_LIMIT: 409,
  SITE_ALREADY_EXISTS: 409, SITE_PATH_UNSAFE: 409, SITE_STOP_FAILED: 409 };
const PREFIX = '/api/admin/v1/workspaces/:workspaceId/system/sites';

type LifecycleAction = (required: { input: LocalSiteLifecycleInput; base: string; supervisor: LocalSiteLifecyclePort; deps: LocalSiteLifecycleRouteDeps }) => Promise<unknown>;
type LifecycleRoute = JsonRouteSpec<LocalSiteLifecycleInput, unknown, LocalSiteLifecycleRouteDeps, LocalSitePrincipal>;

/** A typed site error as its wire refusal. Never serialize an effect's raw error: child/connection errors can contain credentials. */
function siteRefusal({ code }: { code: string }, _optional: Record<string, never> = {}): RouteRefusalError {
  return new RouteRefusalError({ status: STATUS[code] ?? 500, body: { code, error: code } });
}

/** Typed site errors become their refusal; anything else (including other refusals) is rethrown unchanged. */
function lifecycleFailure({ error, deps }: { error: unknown; deps: LocalSiteLifecycleRouteDeps }, _optional: Record<string, never> = {}): unknown {
  if (error instanceof RouteRefusalError) return error;
  const code = deps.localSiteErrorCode(error);
  return code === undefined ? error : siteRefusal({ code });
}

/** Gate → authorize → host → action; the action's nullish result answers `{ ok: true }`. @complexity O(1) plus the action. */
async function runLifecycle(
  { input, deps, authorize, action }: { input: LocalSiteLifecycleInput; deps: LocalSiteLifecycleRouteDeps; authorize: JsonRouteAuthorize | undefined; action: LifecycleAction },
  _optional: Record<string, never> = {},
): Promise<unknown> {
  const gate = deps.siteSwitchBase();
  if (!gate.ok) throw new RouteRefusalError({ status: gate.code === 'SITE_SWITCHING_DISABLED' ? 403 : 409, body: gate });
  try {
    if (!authorize) throw new Error('local site lifecycle route has no authorizer');
    await authorize({ permission: 'system.write', entityType: 'site-registry' });
    if (!deps.localSiteSupervisor) throw new RouteRefusalError({ status: 409, body: { code: 'SITE_HOST_UNAVAILABLE', error: 'local site host is unavailable' } });
    const result = await action({ input, base: gate.switcherBase, supervisor: deps.localSiteSupervisor, deps });
    return result ?? { ok: true };
  } catch (error) {
    throw lifecycleFailure({ error, deps });
  }
}

const flag = (body: unknown, key: 'checked' | 'confirmed'): boolean =>
  typeof body === 'object' && body !== null && (body as Record<string, unknown>)[key] === true;

/** One lifecycle `POST` spec: a total parse (gates run in the handler, before any validation). */
function lifecycleRoute({ path, action }: { path: string; action: LifecycleAction }, _optional: Record<string, never> = {}): LifecycleRoute {
  return defineJsonRoute<LocalSiteLifecycleInput, unknown, LocalSiteLifecycleRouteDeps, LocalSitePrincipal>({
    method: 'post',
    path,
    parse: (raw) => ok({ value: { name: String(raw.params.name ?? ''), id: String(raw.params.id ?? ''), checked: flag(raw.body, 'checked'), confirmed: flag(raw.body, 'confirmed') } }),
    handle: async ({ input, deps, authorize }) => ok({ value: await runLifecycle({ input, deps, authorize, action }) }),
  });
}

export const localSiteStartRoute = lifecycleRoute({ path: `${PREFIX}/:name/start`, action: ({ input, supervisor }) => supervisor.start({ name: input.name }) });
export const localSiteStopRoute = lifecycleRoute({ path: `${PREFIX}/:name/stop`, action: ({ input, supervisor }) => supervisor.stop({ name: input.name }) });
export const localSiteTrashRoute = lifecycleRoute({ path: `${PREFIX}/:name/trash`, action: async ({ input, base, supervisor, deps }) => {
  if (!input.confirmed) throw siteRefusal({ code: 'SITE_CONFIRM_REQUIRED' });
  const name = input.name;
  return supervisor.withStoppedSite({ name, task: async () => {
    const site = deps.siteTrash.trash({ base, name });
    deps.afterTrash?.({ base, name });
    return { site };
  } });
} });
export const localSiteTrashRestoreRoute = lifecycleRoute({ path: `${PREFIX}/trash/:id/restore`, action: async ({ input, base, supervisor, deps }) => {
  const id = input.id;
  return supervisor.withStoppedSite({ name: deps.siteTrashName({ id }), task: async () => { deps.siteTrash.restore({ base, id }); } });
} });
export const localSiteTrashDeleteRoute = lifecycleRoute({ path: `${PREFIX}/trash/:id/delete`, action: async ({ input, base, supervisor, deps }) => {
  if (!input.checked || !input.confirmed) throw siteRefusal({ code: 'SITE_CONFIRM_REQUIRED' });
  const id = input.id;
  return supervisor.withStoppedSite({ name: deps.siteTrashName({ id }), task: async () => {
    deps.siteTrash.remove({ base, id, checked: input.checked, confirmed: input.confirmed });
  } });
} });

/** Every lifecycle route, in the order the host registers them. Register only handlers; host lifetime belongs to the serving composition. */
export const localSiteLifecycleRoutes: readonly LifecycleRoute[] = [
  localSiteStartRoute, localSiteStopRoute, localSiteTrashRoute, localSiteTrashRestoreRoute, localSiteTrashDeleteRoute,
];
