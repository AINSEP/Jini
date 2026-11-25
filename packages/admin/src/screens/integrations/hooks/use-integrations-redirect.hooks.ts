import { useEffect } from "react";
import { navigate } from "../../../shell/lib/router.js";

/**
 * @file The side effect behind `IntegrationsRedirect.tsx` — split out so that `.tsx` file carries no
 * logic of its own, the same `<Name>.tsx`/`<Name>.hooks.ts` split every other feature in this admin
 * follows.
 */

/**
 * Sends the browser from the retired `/admin/integrations` index route to its two absorbed tabs'
 * new home, `/admin/addons/integrations` (labelled "Integrations" — see `panels.tsx`'s own comment on the
 * `providers`/`integrations` panels for the full history of why this redirect exists at all).
 *
 * `?tab=webhooks` specifically, not the merged screen's own default (`external-mcp`): a bookmark or
 * agent-remembered link to bare `/admin/integrations` used to open on `DeveloperApi.tsx`'s own
 * default tab, which was Webhooks (see that file's own now-deleted header for why — its default was
 * deliberately NOT the newer MCP Server tab). Redirecting to the merged screen's own first tab
 * instead would silently change which screen an old link lands on; pinning the target tab here keeps
 * that promise regardless of what `Providers.tsx`'s own default is or ever becomes.
 *
 * `replace: true`, not a pushed entry — the redirect should not become its own Back-button stop, or
 * Back from `/admin/addons/integrations` would land on `/admin/integrations` and bounce forward again
 * immediately, the same reasoning `router.ts`'s `redirectLegacyHashUrl` documents for its own
 * `replaceState` call.
 *
 * Also executes the Add-ons migration destinations resolved in `lib/addons-routes.ts` (owner,
 * 2026-10-13), so all retired paths share one redirect effect. The target is a dependency so a
 * route change updates an already-mounted redirect. Omitting it keeps the historic Webhooks default.
 *
 * @param input Destination route path supplied by the migration adapter, or the legacy default; `defaultRoutePath`
 *   is the host's legacy destination for an `undefined` `routePath` (the host owns the route table).
 * @returns Nothing; replaces browser history and notifies route subscribers after render.
 * @complexity O(1) — one fixed navigation call.
 */
export function useIntegrationsRedirect(
  { defaultRoutePath, routePath = defaultRoutePath }: { defaultRoutePath: string | undefined; routePath?: string | undefined },
  _options = {},
): void {
  if (routePath === undefined) throw new Error("integrations redirect has no destination");
  useEffect(() => {
    navigate({ routePath }, { replace: true });
  }, [routePath]);
}
