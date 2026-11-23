/**
 * Admin Sites screen write routes: create a site, activate one, and list the bundled agent plugins
 * a new site can be connected to with a pasted access token.
 *
 * `system.read`/`system.write` on `site-registry`, like every sibling system route: Create and
 * Activate are exactly the kind of system-process-affecting write that permission already gates,
 * and the plugin list is a read-only operational snapshot.
 *
 * Create and Activate are thin callers: the logic lives in the host's site-admin feature (the same
 * functions its assistant tools call), injected here. These specs only authorize and map refusals
 * to HTTP statuses. Activate never kills, signals or re-execs a process: no admin API terminates
 * the server on a click; the activation's own restart fields tell the UI what to say.
 */
import { defineJsonRoute, ok, type JsonRouteAuthorize } from '@jini-ai/core/contracts/server';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

const BASE = '/api/admin/v1/workspaces/:workspaceId/system/sites';

/** A refusal the site-admin feature returns: `code` picks the status, every field but `ok` is the
 *  body (extra fields, e.g. a refused token's `pluginId`, are answered as they are). */
export interface SiteAdminRefusal { ok: false; code: string; error?: string }

/** The deployment's site-switch gate: the switcher base, or a refusal answered verbatim. */
export type SiteSwitchBase = { ok: true; switcherBase: string } | SiteAdminRefusal;

/** HTTP status for each refusal code: 403 for the deployment-wide flag; 409 for the per-boot
 *  binding fact, an occupied name and a running site (a binding is a fact about this boot, not
 *  about the caller's permissions, so it is not 403). */
export const SITE_ADMIN_REFUSAL_STATUS: Readonly<Record<string, number>> = {
  SITE_SWITCHING_DISABLED: 403,
  SITE_BINDING_NOT_SWITCHABLE: 409,
  VALIDATION_ERROR: 400,
  SITE_ALREADY_EXISTS: 409,
  SITE_NOT_FOUND: 404,
  SITE_ALREADY_RUNNING: 409,
  AGENT_PLUGIN_TOKEN_INVALID: 400,
  AGENT_PLUGIN_TOKEN_REFUSED: 400,
  AGENT_PLUGIN_TOKEN_UNSUPPORTED: 400,
};

/** The principal fields these routes read: the id, as a created site's actor. */
export interface SitesAdminPrincipal { id: string }

/** What the plugin-list route reads. */
export interface SiteTokenSignInPluginsRouteDeps {
  workspaceId: string;
  listTokenSignInPlugins: (required: { workspaceId: string }) => Promise<unknown> | unknown;
}

/** The create request's fields; anything else in the body is ignored. */
export interface SiteCreateInput { name: string | undefined; adminPassword: unknown; agentPluginTokens: unknown }

/** What the create route reads. `createSite` validates the password and tokens itself (its refusals are mapped here). */
export interface SiteCreateRouteDeps {
  siteSwitchBase: () => SiteSwitchBase;
  createSite: (required: { switcherBase: string; name: string; actorId: string; adminPassword: unknown; agentPluginTokens: unknown })
    => Promise<{ ok: true; site: unknown; agentPluginTokens: unknown } | SiteAdminRefusal>;
}

/** What the activate route reads. */
export interface SiteActivateRouteDeps {
  siteSwitchBase: () => SiteSwitchBase;
  activateSite: (required: { switcherBase: string; name: string; restartNow: boolean }) => Promise<{ ok: true } | SiteAdminRefusal>;
}

/** A refusal as its wire answer. @complexity O(fields). */
function siteAdminRefusal(refusal: SiteAdminRefusal, _optional: Record<string, never> = {}): RouteRefusalError {
  const { ok: _ok, ...body } = refusal;
  return new RouteRefusalError({ status: SITE_ADMIN_REFUSAL_STATUS[refusal.code] ?? 500, body });
}

/** The permission check every route shares; a mount without an authorizer is a wiring bug. @complexity O(1). */
async function authorizeSites({ authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error('sites admin route has no authorizer');
  await authorize({ permission, entityType: 'site-registry' });
}

/** The flag, then the binding — both checked before spending an authorize() call on an operation
 *  this boot cannot fulfil regardless of who is asking. @complexity O(1). */
function switcherBaseOrRefuse({ deps }: { deps: { siteSwitchBase: () => SiteSwitchBase } }, _optional: Record<string, never> = {}): string {
  const gate = deps.siteSwitchBase();
  if (!gate.ok) throw siteAdminRefusal(gate);
  return gate.switcherBase;
}

const field = (body: unknown, key: string): unknown => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined);

/** `GET .../system/sites/token-sign-in-plugins` — bundled plugins a new site's create form can connect now. */
export const siteTokenSignInPluginsRoute = defineJsonRoute<Record<string, never>, { plugins: unknown }, SiteTokenSignInPluginsRouteDeps, SitesAdminPrincipal>({
  method: 'get',
  path: `${BASE}/token-sign-in-plugins`,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeSites({ authorize, permission: 'system.read' });
    return ok({ value: { plugins: await deps.listTokenSignInPlugins({ workspaceId: deps.workspaceId }) } });
  },
});

/** `POST .../system/sites` — create a site under the switcher base. */
export const siteCreateRoute = defineJsonRoute<SiteCreateInput, { site: unknown; agentPluginTokens: unknown }, SiteCreateRouteDeps, SitesAdminPrincipal>({
  method: 'post',
  path: BASE,
  parse: (raw) => {
    const name = field(raw.body, 'name');
    return ok({ value: { name: typeof name === 'string' ? name : undefined, adminPassword: field(raw.body, 'adminPassword'), agentPluginTokens: field(raw.body, 'agentPluginTokens') } });
  },
  handle: async ({ input, deps, authorize, context }) => {
    const switcherBase = switcherBaseOrRefuse({ deps });
    await authorizeSites({ authorize, permission: 'system.write' });
    if (!context) throw new Error('sites admin route has no authenticated principal');
    // The name is checked after authorization, as before: a caller without the permission learns nothing.
    if (input.name === undefined) throw siteAdminRefusal({ ok: false, error: "'name' (string) is required", code: 'VALIDATION_ERROR' });
    const created = await deps.createSite({ switcherBase, name: input.name, actorId: context.id, adminPassword: input.adminPassword, agentPluginTokens: input.agentPluginTokens });
    if (!created.ok) throw siteAdminRefusal(created);
    return ok({ value: { site: created.site, agentPluginTokens: created.agentPluginTokens } });
  },
}, { successStatus: 201 });

/** `POST .../system/sites/:name/activate` — persist the choice; `restartNow: true` asks the dev supervisor to restart onto it. */
export const siteActivateRoute = defineJsonRoute<{ name: string; restartNow: boolean }, unknown, SiteActivateRouteDeps, SitesAdminPrincipal>({
  method: 'post',
  path: `${BASE}/:name/activate`,
  parse: (raw) => ok({ value: { name: String(raw.params.name ?? ''), restartNow: field(raw.body, 'restartNow') === true } }),
  handle: async ({ input, deps, authorize }) => {
    const switcherBase = switcherBaseOrRefuse({ deps });
    await authorizeSites({ authorize, permission: 'system.write' });
    const activated = await deps.activateSite({ switcherBase, name: input.name, restartNow: input.restartNow });
    if (!activated.ok) throw siteAdminRefusal(activated);
    return ok({ value: activated });
  },
});
