import { expect, it, vi } from "vitest";
import { buildExtraHead } from "../extra-head.js";
import type { PageHeadHook } from "../../../../../seo/types.js";

it("keeps post canonical precedence and an entry-less page’s own fallback path", async () => {
  const post = { id: "p", workspaceId: "ws", title: "Post", slug: "slug", kind: "post" as const, bodyFormat: "doc" as const, bodyJson: {}, bodyHtml: null, status: "published" as const, updatedAt: "now", version: 1 };
  const seen: unknown[] = [];
  const seoContributor: PageHeadHook = { priority: 0, handle: async context => { seen.push(context); return [{ kind: "link", rel: "canonical", href: context.canonicalUrl, priority: 0 }]; } };
  const resolveOrigin = vi.fn(async () => undefined);
  const required = { workspaceId: "ws", siteTitle: "Site", renderBaseUrl: "https://site.example", postCanonical: async () => "https://canonical.example/explicit", postFallbackPath: () => "/derived", resolveOrigin, seoContributor, pageHeadContributors: [] };
  expect(await buildExtraHead({ ...required, route: "post", post })).toContain('href="https://canonical.example/explicit"');
  expect(await buildExtraHead({ ...required, postCanonical: async () => undefined, route: "post", post })).toContain('href="https://site.example/derived"');
  expect(await buildExtraHead({ ...required, route: "page", post: undefined }, { canonicalFallbackPath: "/marketing" })).toContain('href="https://site.example/marketing"');
  expect(resolveOrigin).not.toHaveBeenCalled();
  expect(seen[0]).toMatchObject({ entry: { id: "p", type: "post", slug: "slug", title: "Post", status: "published", updatedAt: "now", ext: {} } });
  expect(seen[2]).toMatchObject({ route: "page", entry: undefined });
  const continued: PageHeadHook = { priority: 2, handle: async () => [{ kind: "meta", name: "after", content: "continued", priority: 2 }] };
  const html = await buildExtraHead({ ...required, route: "home", post: undefined, pageHeadContributors: [{ priority: 1, handle: async () => { throw new Error("contributor failed"); } }, continued] });
  expect(html).toContain('content="continued"');
});
