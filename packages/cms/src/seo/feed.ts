import type { UUID } from "@jini-ai/core/primitives";
import { escapeXml } from "./xml-escape.js";
import { resolveWorkspaceOrigin, toAbsoluteUrl } from "./absolute-url.js";
import { deriveExcerpt } from "./seo.js";
import { computeIndexableEntries, type SeoSitemapDeps } from "./sitemap.js";

/**
 * @file The site's RSS 2.0 feed (`GET /feed.xml`), built like `sitemap.xml`: from
 * {@link computeIndexableEntries}, the one publish/visibility/`noindex` filter every public SEO
 * document shares, so a draft, trashed or members-only post can never leak here either. Only blog
 * posts (`kind: "post"`) are items; pages are not news.
 *
 * Links are absolute: feed readers resolve nothing against the site. They come from
 * `meta.canonical`, which is absolute once the workspace has a verified origin and degrades to a
 * root-relative path without one (the same disclosed fallback the sitemap has). A static export
 * writes this file without its base-path rewrite (`site-exporter.ts`).
 *
 * Hand-written rather than the `feed` package: one format, about sixty lines, no dependency.
 */

/** How many of the newest posts the feed carries. */
export const FEED_ITEM_LIMIT = 20;
export const FEED_PATH = "/feed.xml";

export interface FeedItem {
  readonly title: string;
  readonly link: string;
  /** ISO timestamp. The post's go-live time (`publishAt`) when it has one, else `updatedAt` — posts
   *  carry no separate published-at column (`postDisplayDateIso`, owner decision 2026-10-05). */
  readonly publishedAt: string;
  readonly description: string | undefined;
}

export interface Feed {
  readonly siteTitle: string;
  readonly siteLink: string;
  readonly feedUrl: string;
  readonly items: readonly FeedItem[];
}

/**
 * The newest {@link FEED_ITEM_LIMIT} published, publicly visible, indexable posts, newest first.
 * @complexity O(n log n) in the workspace's post count (the sort), after
 *   {@link computeIndexableEntries}' own O(n) pass.
 */
export async function buildFeed(required: { deps: SeoSitemapDeps; input: { workspaceId: UUID; siteTitle: string } }, _optional: Record<string, never> = {}): Promise<Feed> {
  const { deps, input } = required;
  const entries = await computeIndexableEntries({ deps, input: { workspaceId: input.workspaceId } });
  const items = entries
    .filter(({ post }) => post.kind === "post")
    .sort((a, b) => (a.post.updatedAt < b.post.updatedAt ? 1 : a.post.updatedAt > b.post.updatedAt ? -1 : 0))
    .slice(0, FEED_ITEM_LIMIT)
    .map(({ post, meta }) => ({ title: post.title, link: meta.canonical, publishedAt: deps.liveness.postDisplayDateIso({ post }), description: deriveExcerpt({ post, postRepo: deps.postRepo }) }));
  const origin = await resolveWorkspaceOrigin({ originRegistry: deps.originRegistry, workspaceId: input.workspaceId, runtimeMode: deps.runtimeMode });
  return { siteTitle: input.siteTitle, siteLink: toAbsoluteUrl({ origin, path: "/" }), feedUrl: toAbsoluteUrl({ origin, path: FEED_PATH }), items };
}

function renderItem(item: FeedItem): string {
  const description = item.description === undefined ? "" : `      <description>${escapeXml({ text: item.description })}</description>\n`;
  return (
    `    <item>\n` +
    `      <title>${escapeXml({ text: item.title })}</title>\n` +
    `      <link>${escapeXml({ text: item.link })}</link>\n` +
    `      <guid isPermaLink="true">${escapeXml({ text: item.link })}</guid>\n` +
    `      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>\n` +
    description +
    `    </item>\n`
  );
}

/** Serializes a {@link Feed} as RSS 2.0 XML. @complexity O(total text length). */
export function renderRssXml(required: { feed: Feed }, _optional: Record<string, never> = {}): string {
  const { feed } = required;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `  <channel>\n` +
    `    <title>${escapeXml({ text: feed.siteTitle })}</title>\n` +
    `    <link>${escapeXml({ text: feed.siteLink })}</link>\n` +
    `    <description>${escapeXml({ text: feed.siteTitle })}</description>\n` +
    `    <atom:link href="${escapeXml({ text: feed.feedUrl })}" rel="self" type="application/rss+xml"/>\n` +
    feed.items.map(renderItem).join("") +
    `  </channel>\n` +
    `</rss>\n`
  );
}
