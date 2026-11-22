/**
 * @file The host's Add-ons URL migration (owner decision, 2026-10-13).
 * Jini still matches stable panel IDs; this adapter translates only the host's moved URLs.
 * Legacy redirects are resolved here and executed by the existing IntegrationsRedirect.
 */
export const ADDONS_PANEL_PATHS: Readonly<Record<string, string>> = {
  plugins: "/addons/plugins",
  "agent-plugins": "/addons/agent-plugins",
  skills: "/addons/skills",
  providers: "/addons/integrations",
  integrations: "/addons/integrations?tab=webhooks",
};

export interface AddonsRouteResolution {
  /** Stable-ID path for Jini's matcher; never written to browser history. */
  readonly matchPath: string;
  /** Canonical destination for a legacy URL, absent on current or unrelated routes. */
  readonly redirectPath?: string;
}

/**
 * Resolves moved Add-ons URLs without changing unrelated sections or query bytes.
 * Bare legacy Integrations links keep their former Webhooks default; explicit tabs survive.
 * @param input Base-agnostic route path, including its query string.
 * @returns Matcher path and, for a legacy URL, replacement destination. No side effects/errors.
 * @example resolveAddonsRoute({ routePath: "/providers?tab=webhooks" })
 * @complexity O(n) time and space in URL length; the Add-ons table has five fixed entries.
 */
export function resolveAddonsRoute({ routePath }: { readonly routePath: string }): AddonsRouteResolution {
  // `String#split` always yields at least one element (Jini compiles with noUncheckedIndexedAccess).
  const pathname = routePath.split("?", 1)[0]!;
  const parts = pathname.split("/").filter(Boolean);
  const route = { parts, query: routePath.slice(pathname.length) };

  if (parts[0] === "addons") return { matchPath: stablePanelPath(route) ?? routePath };
  const redirectPath = legacyRedirectPath(route);
  return redirectPath ? { matchPath: routePath, redirectPath } : { matchPath: routePath };
}

interface SplitRoute {
  /** Non-empty pathname segments, so trailing and doubled slashes do not matter. */
  readonly parts: readonly string[];
  /** Raw query bytes including the leading `?`, or "" when the URL has none. */
  readonly query: string;
}

/**
 * Maps a current `/addons/...` URL back to the stable panel path Jini's matcher knows.
 * @param route Split `/addons/...` route.
 * @returns Stable-ID matcher path, or undefined for an unknown Add-ons URL.
 * @complexity O(n) in URL length; the Add-ons table has five fixed entries.
 */
function stablePanelPath({ parts, query }: SplitRoute): string | undefined {
  if (parts.length === 3 && parts[1] === "integrations") return `/integrations/${parts[2]}${query}`;
  const path = `/${parts.join("/")}`;
  const panel = Object.entries(ADDONS_PANEL_PATHS).find(([, destination]) => destination === path);
  return panel && `/${panel[0]}${query}`;
}

/**
 * Resolves the canonical Add-ons destination for a legacy (pre-move) URL.
 * @param route Split non-Add-ons route.
 * @returns Replacement destination, or undefined for current or unrelated routes.
 * @complexity O(n) in URL length.
 */
function legacyRedirectPath({ parts, query }: SplitRoute): string | undefined {
  const [section = ""] = parts;
  if (parts.length === 2 && section === "integrations") return `${ADDONS_PANEL_PATHS.providers}/${parts[1]}${query}`;
  // `hasOwn` keeps prototype names such as `/constructor` from resolving to a destination.
  if (parts.length !== 1 || !Object.hasOwn(ADDONS_PANEL_PATHS, section)) return undefined;
  if (section === "integrations") return `${ADDONS_PANEL_PATHS.providers}${withDefaultWebhooksTab({ query })}`;
  return `${ADDONS_PANEL_PATHS[section]}${query}`;
}

/** Bare legacy Integrations links keep their former Webhooks default; explicit tabs survive. */
function withDefaultWebhooksTab({ query }: { query: string }, _options = {}): string {
  if (new URLSearchParams(query).has("tab")) return query;
  return `${query}${query ? "&" : "?"}tab=webhooks`;
}
