/**
 * @file Moved-panel URL adapter. A host that moves panels under a new section (its own URL
 * migration) keeps Jini matching stable panel IDs; this adapter translates only the moved URLs.
 * The host owns the policy (section name, destinations, legacy defaults) and passes it in; legacy
 * redirects are resolved here and executed by the host's own redirect component.
 */

/** The host's URL migration table. Jini holds no host paths; every entry is supplied here. */
export interface AddonsRoutePolicy {
  /** First path segment of the current (moved) URLs. */
  readonly section: string;
  /** Stable panel ID → current destination path (`/<section>/...`). */
  readonly panelPaths: Readonly<Record<string, string>>;
  /** Legacy `/<legacySection>/<id>` detail URLs now live under `panelPaths[panelId]/<id>`. */
  readonly detail?: { readonly legacySection: string; readonly panelId: string };
  /** Legacy panel ID → where its links now go, plus the `tab` a bare legacy link keeps as its former
   *  default (used when that panel's own `panelPaths` entry carries a query and cannot take another). */
  readonly legacyDefaults?: Readonly<Record<string, { readonly path: string; readonly tab: string }>>;
}

export interface AddonsRouteResolution {
  /** Stable-ID path for Jini's matcher; never written to browser history. */
  readonly matchPath: string;
  /** Canonical destination for a legacy URL, absent on current or unrelated routes. */
  readonly redirectPath?: string;
}

/**
 * Resolves moved URLs without changing unrelated sections or query bytes.
 * Bare legacy links keep their former default tab (`policy.legacyDefaults`); explicit tabs survive.
 * @param input Base-agnostic route path, including its query string, and the host's policy.
 * @returns Matcher path and, for a legacy URL, replacement destination. No side effects/errors.
 * @example resolveAddonsRoute({ routePath: "/providers?tab=webhooks", policy })
 * @complexity O(n) time and space in URL length plus the policy's panel count.
 */
export function resolveAddonsRoute(
  { routePath, policy }: { readonly routePath: string; readonly policy: AddonsRoutePolicy },
  _options = {},
): AddonsRouteResolution {
  // `String#split` always yields at least one element (Jini compiles with noUncheckedIndexedAccess).
  const pathname = routePath.split("?", 1)[0]!;
  const parts = pathname.split("/").filter(Boolean);
  const route = { parts, query: routePath.slice(pathname.length), policy };

  if (parts[0] === policy.section) return { matchPath: stablePanelPath(route) ?? routePath };
  const redirectPath = legacyRedirectPath(route);
  return redirectPath ? { matchPath: routePath, redirectPath } : { matchPath: routePath };
}

interface SplitRoute {
  /** Non-empty pathname segments, so trailing and doubled slashes do not matter. */
  readonly parts: readonly string[];
  /** Raw query bytes including the leading `?`, or "" when the URL has none. */
  readonly query: string;
  readonly policy: AddonsRoutePolicy;
}

/** The detail base path split into segments, or undefined when the policy has no detail rule. */
function detailBaseParts({ policy }: { policy: AddonsRoutePolicy }, _options = {}): string[] | undefined {
  const base = policy.detail && policy.panelPaths[policy.detail.panelId];
  return base === undefined ? undefined : base.split("/").filter(Boolean);
}

/**
 * Maps a current `/<section>/...` URL back to the stable panel path Jini's matcher knows.
 * @param route Split `/<section>/...` route.
 * @returns Stable-ID matcher path, or undefined for an unknown moved URL.
 * @complexity O(n) in URL length plus the policy's panel count.
 */
function stablePanelPath({ parts, query, policy }: SplitRoute): string | undefined {
  const base = detailBaseParts({ policy });
  if (policy.detail && base && parts.length === base.length + 1 && base.every((part, index) => parts[index] === part)) {
    return `/${policy.detail.legacySection}/${parts[base.length]}${query}`;
  }
  const path = `/${parts.join("/")}`;
  const panel = Object.entries(policy.panelPaths).find(([, destination]) => destination === path);
  return panel && `/${panel[0]}${query}`;
}

/**
 * Resolves the canonical destination for a legacy (pre-move) URL.
 * @param route Split non-moved route.
 * @returns Replacement destination, or undefined for current or unrelated routes.
 * @complexity O(n) in URL length.
 */
function legacyRedirectPath({ parts, query, policy }: SplitRoute): string | undefined {
  const [section = ""] = parts;
  const { detail, panelPaths, legacyDefaults = {} } = policy;
  if (detail && parts.length === 2 && section === detail.legacySection) {
    const base = panelPaths[detail.panelId];
    return base === undefined ? undefined : `${base}/${parts[1]}${query}`;
  }
  // `hasOwn` keeps prototype names such as `/constructor` from resolving to a destination.
  if (parts.length !== 1 || !Object.hasOwn(panelPaths, section)) return undefined;
  const legacyDefault = Object.hasOwn(legacyDefaults, section) ? legacyDefaults[section] : undefined;
  if (legacyDefault) return `${legacyDefault.path}${withDefaultTab({ query, tab: legacyDefault.tab })}`;
  return `${panelPaths[section]}${query}`;
}

/** Bare legacy links keep their former default tab; explicit tabs survive. */
function withDefaultTab({ query, tab }: { query: string; tab: string }, _options = {}): string {
  if (new URLSearchParams(query).has("tab")) return query;
  return `${query}${query ? "&" : "?"}tab=${tab}`;
}
