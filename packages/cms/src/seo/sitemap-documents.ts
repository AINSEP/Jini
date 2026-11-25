/**
 * @file Pure text serializers for the two public discovery documents built from the same
 * publish/visibility/indexability evaluator ({@link computeIndexableEntries}): `sitemap.xml` and
 * `llms.txt`. No HTTP, no I/O: a host route fetches the entries and serves the string with its own
 * cache headers and error handling.
 */
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

/** The entry fields `llms.txt` reads: the resolved SEO meta of an indexable entry. */
export interface LlmsTxtEntry {
  readonly meta: Pick<SeoMeta, "title" | "description" | "canonical">;
}

/**
 * The llmstxt.org index: an H1 title, an optional one-line blockquote summary, then a `## Pages`
 * section of `- [title](url): description` links. Sorted by title so the list reads stably rather
 * than in storage order; sorting is display-only and never changes which entries are included. An
 * entry with no description is listed without the trailing `: description`, never a fabricated one.
 *
 * @complexity O(n log n) in `entries.length` (the sort); the render itself is O(n).
 */
export function renderLlmsTxt(
  { entries, title }: { entries: readonly LlmsTxtEntry[]; title: string },
  { description }: { description?: string | undefined } = {},
): string {
  const sorted = [...entries].sort((a, b) => a.meta.title.localeCompare(b.meta.title));
  const lines = [`# ${title.replace(/\s+/g, " ")}`, ""];
  if (description) lines.push(`> ${description.replace(/\s+/g, " ")}`, "");
  lines.push("## Pages", "");
  for (const entry of sorted) {
    const summary = entry.meta.description ? `: ${entry.meta.description}` : "";
    lines.push(`- [${entry.meta.title}](${entry.meta.canonical})${summary}`);
  }
  return `${lines.join("\n")}\n`;
}
