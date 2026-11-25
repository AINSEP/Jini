/**
 * @file Pure text serializers for the two public discovery documents built from the same
 * publish/visibility/indexability evaluator ({@link computeIndexableEntries}): `sitemap.xml` and
 * `llms.txt`. No HTTP, no I/O: a host route fetches the entries and serves the string with its own
 * cache headers and error handling.
 */
import type { SeoPostRecord } from "./ports.js";
import type { SeoMeta, SitemapEntry } from "./types.js";
import { escapeXml } from "@jini-ai/core/text";

/**
 * The sitemaps.org `urlset` document: one `<url>` per entry with `<loc>` and, when present,
 * `<lastmod>`, both XML-escaped. An empty list is a valid empty `urlset`.
 *
 * @complexity O(n) in `entries.length`.
 */
export function serializeSitemapXml({ entries }: { entries: readonly Pick<SitemapEntry, "loc" | "lastmod">[] }, _optional: Record<string, never> = {}): string {
  const rows = entries.map((entry) => {
    const lastmod = entry.lastmod ? `<lastmod>${escapeXml({ text: entry.lastmod })}</lastmod>` : "";
    return `  <url><loc>${escapeXml({ text: entry.loc })}</loc>${lastmod}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + rows.join("\n")
    + (rows.length > 0 ? "\n" : "")
    + `</urlset>\n`;
}

/**
 * The entry fields `llms.txt` reads: the resolved SEO meta of an indexable entry, plus the post row's
 * `kind` that decides which section it is listed under. An `IndexableEntry` ({@link computeIndexableEntries})
 * satisfies this as-is, so the route hands its entries straight through.
 */
export interface LlmsTxtEntry {
  readonly post: Pick<SeoPostRecord, "kind">;
  readonly meta: Pick<SeoMeta, "title" | "description" | "canonical">;
}

/** `llms.txt` section order and the entry kind each one lists. */
const LLMS_SECTIONS: readonly { readonly heading: string; readonly kind: SeoPostRecord["kind"] }[] = [
  { heading: "Posts", kind: "post" },
  { heading: "Pages", kind: "page" },
];

/**
 * The llmstxt.org index: an H1 title, an optional one-line blockquote summary, then H2-labeled sections
 * (`## Posts`, `## Pages`) of `- [title](url): description` links, each listing only entries of that
 * kind. A section with no entries is omitted rather than printed as a bare heading. Each section is
 * sorted by title so the list reads stably rather than in storage order; sorting is display-only and
 * never changes which entries are included. An entry with no description is listed without the
 * trailing `: description`, never a fabricated one.
 *
 * @complexity O(n log n) in `entries.length` (the per-section sorts); the render itself is O(n).
 */
export function renderLlmsTxt(
  { entries, title }: { entries: readonly LlmsTxtEntry[]; title: string },
  { description }: { description?: string | undefined } = {},
): string {
  // Blocks are blank-line separated, so an omitted section leaves no stray gap and a document with
  // no entries is just its header.
  const blocks = [`# ${title.replace(/\s+/g, " ")}`];
  if (description) blocks.push(`> ${description.replace(/\s+/g, " ")}`);
  for (const { heading, kind } of LLMS_SECTIONS) {
    const section = entries.filter((entry) => entry.post.kind === kind).sort((a, b) => a.meta.title.localeCompare(b.meta.title));
    if (section.length === 0) continue;
    const links = section.map((entry) => `- [${entry.meta.title}](${entry.meta.canonical})${entry.meta.description ? `: ${entry.meta.description}` : ""}`);
    blocks.push(`## ${heading}\n\n${links.join("\n")}`);
  }
  return `${blocks.join("\n\n")}\n`;
}
