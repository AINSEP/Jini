import { describe, expect, it } from "vitest";
import { renderLlmsTxt, serializeSitemapXml } from "../sitemap-documents.js";

const entry = (title: string, canonical: string, description?: string, kind: "post" | "page" = "page") =>
  ({ post: { kind }, meta: { title, canonical, ...(description ? { description } : {}) } });

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
  });

  it("lists posts under ## Posts and pages under ## Pages, each section sorted by title", () => {
    const text = renderLlmsTxt({ title: "T", entries: [
      entry("Zeta page", "https://x.example/zp", undefined, "page"),
      entry("Beta post", "https://x.example/bp", "About beta", "post"),
      entry("Alpha page", "https://x.example/ap", undefined, "page"),
      entry("Alpha post", "https://x.example/alp", undefined, "post"),
    ] });
    expect(text).toBe("# T\n\n## Posts\n\n- [Alpha post](https://x.example/alp)\n- [Beta post](https://x.example/bp): About beta\n\n"
      + "## Pages\n\n- [Alpha page](https://x.example/ap)\n- [Zeta page](https://x.example/zp)\n");
  });

  it("omits an empty section instead of printing a bare heading", () => {
    const onlyPosts = renderLlmsTxt({ title: "T", entries: [entry("P", "https://x.example/p", undefined, "post")] });
    expect(onlyPosts).toBe("# T\n\n## Posts\n\n- [P](https://x.example/p)\n");
    expect(onlyPosts).not.toMatch(/^## Pages$/m);
    const onlyPages = renderLlmsTxt({ title: "T", entries: [entry("Q", "https://x.example/q")] });
    expect(onlyPages).toBe("# T\n\n## Pages\n\n- [Q](https://x.example/q)\n");
    expect(onlyPages).not.toMatch(/^## Posts$/m);
    expect(renderLlmsTxt({ title: "T", entries: [] })).toBe("# T\n");
  });
});
