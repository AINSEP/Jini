/**
 * @file The admin Sites wire DTOs (ADR-029): the JSON envelopes the Sites admin routes
 * (`@jini-ai/cms/admin-http/routes/{sites,system}/*`) answer with and an admin client reads.
 * Declared here, once, so the route specs and any client mirror read the same shapes without the
 * client depending on CMS.
 *
 * The routes pass the host's own site records through unchanged (the created site, the token
 * outcome, a plugin row, the chosen home), so each envelope is generic over that content; the
 * defaults (`unknown`) are what the neutral specs know about it.
 */

/** `PUT .../system/sites/home` — the creation home the host stored. */
export interface SitesHomeSetResponse<Home = unknown> {
  readonly home: Home;
}

/** `GET .../system/sites/token-sign-in-plugins` — the bundled plugins a new site can connect with a pasted token. */
export interface SiteTokenSignInPluginsResponse<Plugin = unknown> {
  readonly plugins: readonly Plugin[];
}

/** `POST .../system/sites` (201) — the created site and what happened to the request's access tokens. */
export interface SiteCreateResponse<Site = unknown, AgentPluginTokens = unknown> {
  readonly site: Site;
  readonly agentPluginTokens: AgentPluginTokens;
}
