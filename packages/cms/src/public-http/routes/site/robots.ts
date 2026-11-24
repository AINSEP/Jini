import { buildRobots } from "../../../seo/sitemap.js";
import { textDocument, withServingOrigin, type PublicSeoRawRoute } from "./seo-route-shared.js";

/** The SEO dependencies `buildRobots` reads (settings, origin registry, runtime mode, stored origin). */
export type RobotsSeoDeps = Parameters<typeof buildRobots>[0]["deps"];

/** What the host injects. */
export interface RobotsRouteDeps {
  readonly workspaceId: string;
  /** Resolves once the SEO ports are ready to read. */
  readonly seoReady: Promise<void>;
  /** The `Cache-Control` value of a successful answer. */
  readonly cacheControl: string;
  readonly seoDeps: RobotsSeoDeps;
}

/**
 * `GET /robots.txt` — public, unauthenticated; the `Sitemap:` lines are on the serving origin.
 * @complexity O(r) in the policy's rules and paths.
 */
export const robotsRoute: PublicSeoRawRoute<RobotsRouteDeps> = {
  method: "get",
  path: "/robots.txt",
  requestFacts: true,
  handle: async ({ raw, deps }) => {
    await deps.seoReady;
    const policy = await buildRobots({ deps: withServingOrigin({ raw, seoDeps: deps.seoDeps }), input: { workspaceId: deps.workspaceId } }, {});
    const lines: string[] = [];
    for (const rule of policy.rules) {
      lines.push(`User-agent: ${rule.userAgent}`);
      for (const path of rule.allow ?? []) lines.push(`Allow: ${path}`);
      for (const path of rule.disallow ?? []) lines.push(`Disallow: ${path}`);
      lines.push("");
    }
    for (const url of policy.sitemapUrls) lines.push(`Sitemap: ${url}`);
    return textDocument({ body: lines.join("\n") + (lines.length > 0 ? "\n" : ""), contentType: "text/plain", cacheControl: deps.cacheControl });
  },
};
