import { buildHeadElements, type GetEntryMetaDeps, type PageHeadHook } from "../index.js";
import { hasAuthoredOgImage, withCoverReadDeps } from "../cover-image.js";

/**
 * @file SEO's host PageHeadHook (ADR-PIPE-008 Decision, C-003). Ordered descriptor production
 * lives in Jini/packages/cms/src/seo/page-head.ts. Bound per render to its own SEO
 * dependencies, then passed to the core-owned fold; never imported directly by render.ts.
 */

/** Default contributor-level priority (irrelevant with a single v1 contributor; kept explicit for future ones). */
const DEFAULT_CONTRIBUTOR_PRIORITY = 100;

/** Bind the host's contributor priority to Jini's pure head producer.
 * The reserved root slug identifies the content-owned home across template, generic, and bare
 * renders. Only an explicit workspace title counts, never the setting default/display fallback.
 * @example createSeoPageHeadHook({ deps: seoDeps, rootSlug, siteTitle }, {})
 * @complexity O(1) wiring; entry rendering adds O(n + a) shared cover selection/media reads.
 */
export function createSeoPageHeadHook(
  required: {
    deps: GetEntryMetaDeps;
    rootSlug: string;
    siteTitle: (required: { workspaceId: string }, optional?: Record<string, never>) => Promise<string | undefined>;
  },
  optional: { priority?: number } = {},
): PageHeadHook {
  return {
    priority: optional.priority ?? DEFAULT_CONTRIBUTOR_PRIORITY,
    handle: async (ctx) => {
      if (!ctx.entry) return buildHeadElements({ ...required, ctx }, {});
      const { deps, cover, rawPost } = await withCoverReadDeps({ deps: required.deps, workspaceId: ctx.workspaceId, entryId: ctx.entry.id });
      const elements = await buildHeadElements({ ...required, deps, ctx }, {});
      const ogImage = elements.find((element) => element.kind === "og" && element.property === "og:image");
      if (ogImage?.kind !== "og") return elements;
      // The owner permits an external body URL for OG only; it is not a schema image fallback.
      // A stored override equal to that URL is still authored and stays authoritative.
      if (cover?.url === ogImage.content && !hasAuthoredOgImage({ rawPost })) return elements;
      // JSON-LD's entry image is the evaluator's final OG choice, including explicit overrides.
      return elements.map((element) => element.kind === "jsonld" && element.data["@type"] !== "BreadcrumbList"
        ? { ...element, data: { ...element.data, image: ogImage.content } }
        : element);
    },
  };
}
