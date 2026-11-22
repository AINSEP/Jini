import { describe, expect, it } from "vitest";
import { renderLlmsTxt, serializeSitemapXml } from "../sitemap-documents.js";

const entry = (title: string, canonical: string, description?: string) => ({ meta: { title, canonical, ...(description ? { description } : {}) } });

describe("serializeSitemapXml", () => {
  it("serializes an empty urlset without a blank line", () => {
    expect(serializeSitemapXml({ entries: [] })).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`);
  });

  it("writes loc and optional lastmod, escaping XML-special characters", () => {
    expect(serializeSitemapXml({ entries: [
      { loc: "https://x.example/a?b=1&c=2", lastmod: "2026-10-01T00:00:00.000Z" },
      { loc: "https://x.example/it's", lastmod: "" },
      { loc: "https://x.example/<tag>" },
    ] })).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      + `  <url><loc>https://x.example/a?b=1&amp;c=2</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod></url>\n`
      + `  <url><loc>https://x.example/it&apos;s</loc></url>\n`
      + `  <url><loc>https://x.example/&lt;tag&gt;</loc></url>\n</urlset>\n`);
  });
});

describe("renderLlmsTxt", () => {
  it("renders title, summary and links sorted by title, omitting a missing description", () => {
    const text = renderLlmsTxt({ title: "My\n  Site", entries: [
      entry("Zebra", "https://x.example/z", "Last one"),
      entry("Alpha", "https://x.example/a"),
    ] }, { description: "A  site\nabout things" });
    expect(text).toBe("# My Site\n\n> A site about things\n\n## Pages\n\n- [Alpha](https://x.example/a)\n- [Zebra](https://x.example/z): Last one\n");
  });

  it("omits the blockquote without a description and does not mutate its input", () => {
    const entries = [entry("B", "https://x.example/b"), entry("A", "https://x.example/a")];
    expect(renderLlmsTxt({ title: "T", entries })).toBe("# T\n\n## Pages\n\n- [A](https://x.example/a)\n- [B](https://x.example/b)\n");
    expect(entries.map((e) => e.meta.title)).toEqual(["B", "A"]);
    expect(renderLlmsTxt({ title: "T", entries: [] })).toBe("# T\n\n## Pages\n\n");
  });
});
