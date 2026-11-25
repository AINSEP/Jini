import type { ManifestActiveTheme, ManifestRoute, ManifestSkip, RouteManifest } from "./ports.js";

type Empty = Record<string, never>;

export interface RouteManifestSources {
  readThemeAndPosts: () => Promise<{
    theme: { kind: "absent" } | { kind: "deliberately-off" } | {
      kind: "selected"; identity: ManifestActiveTheme; tier: string; pages: readonly string[];
    };
    posts: readonly { slug: string; title: string; kind: string; overridesThemePage?: boolean | undefined }[];
  }>;
  listProducts: () => Promise<readonly { slug: string; title: string }[]>;
  listActiveRedirects: () => Promise<readonly { matchType: string; fromPattern: string; toTarget: string; statusCode: number }[]>;
}

export interface RouteManifestPolicy {
  initialRoutes: readonly ManifestRoute[];
  initialSkips: readonly ManifestSkip[];
  probeBase: string;
  probeSuffix: () => string;
  postPath: (required: { slug: string }) => string;
  productPaths: { list: string; detail: (required: { slug: string }) => string };
  isStandaloneThemePage: (required: { pageId: string }) => boolean;
  skipCopy: {
    absent: string;
    deliberatelyOff: string;
    nonExactRedirect: (required: { matchType: string; fromPattern: string; toTarget: string }) => string;
  };
}

/**
 * Picks a request path guaranteed not to collide with any route already in the manifest, so the
 * 404 probe (below) cannot accidentally hit real content. Collision is vanishingly unlikely for the
 * base slug alone (a genuine post/page would need that exact, deliberately-unusual title-shaped
 * slug), but a random suffix costs nothing and turns "vanishingly unlikely" into "cannot happen"
 * without the caller needing to reason about the odds.
 *
 * @complexity O(n) in the number of already-claimed paths for the (typical) zero-collision case;
 *   each retry is another O(n) membership check against the same fixed set, bounded in practice by
 *   collision probability rather than by any loop guard — a `Set` lookup is O(1) amortized, so this
 *   is not a hot path even for a large route count.
 */
function chooseNotFoundProbePath(claimedPaths: ReadonlySet<string>, policy: RouteManifestPolicy): string {
  let candidate = `/${policy.probeBase}`;
  while (claimedPaths.has(candidate)) {
    candidate = `/${policy.probeBase}-${policy.probeSuffix()}`;
  }
  return candidate;
}

/**
 * Enumerates a static theme's own pages as routes, skipping `index`/`404` (handled elsewhere) and
 * template shells (see file header), and skipping any page whose slug a post has claimed (per the
 * same `overridesThemePage` tri-state the live resolver uses). Non-static themes contribute none.
 */
function buildThemePageRoutes(
  theme: Extract<Awaited<ReturnType<RouteManifestSources["readThemeAndPosts"]>>["theme"], { kind: "selected" }>,
  postBySlug: ReadonlyMap<string, Awaited<ReturnType<RouteManifestSources["readThemeAndPosts"]>>["posts"][number]>,
  policy: RouteManifestPolicy
): { routes: ManifestRoute[]; shadowedSlugs: ReadonlySet<string> } {
  const routes: ManifestRoute[] = [];
  const shadowedSlugs = new Set<string>();
  if (theme.tier !== "static") return { routes, shadowedSlugs };

  for (const pageId of theme.pages) {
    // `index`/`404`/template-shell exclusion, shared with the live `GET /:slug` resolver rather
    // than respelled here — see `isStandaloneThemePage`'s own doc (`features/theme/theme.ts`).
    if (!policy.isStandaloneThemePage({ pageId })) continue;

    const collidingPost = postBySlug.get(pageId);
    // An overriding post is added by the post loop instead.
    if (!collidingPost || collidingPost.overridesThemePage === false) {
      routes.push({ path: `/${pageId}`, kind: "theme-page", label: pageId });
      shadowedSlugs.add(pageId);
    }
  }
  return { routes, shadowedSlugs };
}

/** Every published post/page not shadowed by a theme-owned static page at the same slug. */
function buildPostRoutes(posts: Awaited<ReturnType<RouteManifestSources["readThemeAndPosts"]>>["posts"], shadowedSlugs: ReadonlySet<string>, policy: RouteManifestPolicy): ManifestRoute[] {
  const routes: ManifestRoute[] = [];
  for (const post of posts) {
    if (shadowedSlugs.has(post.slug)) continue;
    routes.push({ path: policy.postPath({ slug: post.slug }), kind: post.kind === "page" ? "page" : "post", label: post.title });
  }
  return routes;
}

/**
 * Resolves theme + post routes together (the post loop needs the theme's shadowed-slug set). When
 * there is no theme to render with, records the `no-theme` skip and returns no routes/`activeTheme`
 * — a real, reportable state rather than a crash (see file header).
 *
 * TWO states share that skip `reason`, with deliberately different `detail` text. `undefined` means
 * discovery found no valid theme: something is broken and the operator should reinstall one.
 * `"deliberate"` means the operator turned the theme off themselves — nothing is broken and there
 * is nothing to fix, so telling them "no valid theme discovered" would be simply false. The
 * `reason` is kept identical so every existing consumer of the skip list is unaffected; only the
 * human-readable sentence distinguishes them.
 */
function resolveThemeAndPostRoutes(
  { theme, posts, skipped, policy }: {
    theme: Awaited<ReturnType<RouteManifestSources["readThemeAndPosts"]>>["theme"];
    posts: Awaited<ReturnType<RouteManifestSources["readThemeAndPosts"]>>["posts"];
    skipped: ManifestSkip[];
    policy: RouteManifestPolicy;
  },
  _optional = {}
): { activeTheme?: RouteManifest["activeTheme"]; routes: ManifestRoute[] } {
  if (theme.kind !== "selected") {
    skipped.push({
      reason: "no-theme",
      detail:
        theme.kind === "deliberately-off"
          ? policy.skipCopy.deliberatelyOff
          : policy.skipCopy.absent,
    });
    return { routes: [] };
  }

  const activeTheme: RouteManifest["activeTheme"] = theme.identity;
  const postBySlug = new Map(posts.map((post) => [post.slug, post]));
  const { routes: themeRoutes, shadowedSlugs } = buildThemePageRoutes(theme, postBySlug, policy);
  return { activeTheme, routes: [...themeRoutes, ...buildPostRoutes(posts, shadowedSlugs, policy)] };
}

/** The product grid + one detail route per storefront product — omitted entirely when there are none. */
function buildProductRoutes(products: Awaited<ReturnType<RouteManifestSources["listProducts"]>>, policy: RouteManifestPolicy): ManifestRoute[] {
  if (products.length === 0) return [];
  const routes: ManifestRoute[] = [{ path: policy.productPaths.list, kind: "product-list", label: "products" }];
  for (const product of products) {
    routes.push({ path: policy.productPaths.detail({ slug: product.slug }), kind: "product", label: product.title });
  }
  return routes;
}

/** `exact` redirect rules become routes; every other match type is recorded in `skipped` (see file header). */
function buildRedirectRoutes({ redirectRules, skipped, policy }: { redirectRules: Awaited<ReturnType<RouteManifestSources["listActiveRedirects"]>>; skipped: ManifestSkip[]; policy: RouteManifestPolicy }, _optional = {}): ManifestRoute[] {
  const routes: ManifestRoute[] = [];
  for (const rule of redirectRules) {
    if (rule.matchType !== "exact") {
      skipped.push({
        reason: "non-exact-redirect",
        detail: policy.skipCopy.nonExactRedirect(rule),
      });
      continue;
    }
    routes.push({
      path: rule.fromPattern,
      kind: "redirect",
      label: rule.fromPattern,
      redirectTarget: rule.toTarget,
      redirectStatusCode: rule.statusCode,
    });
  }
  return routes;
}

export async function buildRouteManifest(
  { sources, policy }: { sources: RouteManifestSources; policy: RouteManifestPolicy },
  _optional: Empty = {},
): Promise<RouteManifest> {
  const routes: ManifestRoute[] = [...policy.initialRoutes];
  const skipped: ManifestSkip[] = [...policy.initialSkips];
  const { theme, posts } = await sources.readThemeAndPosts();
  const { activeTheme, routes: themeAndPostRoutes } = resolveThemeAndPostRoutes({ theme, posts, skipped, policy });
  // Content-owned homepage (SPEC-0XX): a `kind: "page"` row may claim the reserved "/" slug and
  // `buildPostRoutes` above already resolves its path through the same `postPublicPath` the live
  // `GET /` handler uses, so it can appear in `themeAndPostRoutes` at path "/" too. The seeded
  // `{ path: "/", kind: "home" }` entry above is what the live site serves ONLY when no such page
  // exists — replace it with the real page's route instead of pushing a second, duplicate "/" entry,
  // the same "post wins over what the manifest would otherwise show at this path" shape
  // `buildThemePageRoutes`'s own `shadowedSlugs` already applies for a theme-owned static page.
  const homePageRouteIndex = themeAndPostRoutes.findIndex((route) => route.path === "/");
  if (homePageRouteIndex !== -1) {
    const [homePageRoute] = themeAndPostRoutes.splice(homePageRouteIndex, 1);
    if (homePageRoute) routes[0] = homePageRoute;
  }
  routes.push(...themeAndPostRoutes);

  const products = await sources.listProducts();
  routes.push(...buildProductRoutes(products, policy));

  const redirectRules = await sources.listActiveRedirects();
  routes.push(...buildRedirectRoutes({ redirectRules, skipped, policy }));

  const claimedPaths = new Set(routes.map((route) => route.path));
  routes.push({ path: chooseNotFoundProbePath(claimedPaths, policy), kind: "not-found", label: "404" });

  return { routes, skipped, ...(activeTheme === undefined ? {} : { activeTheme }) };
}
