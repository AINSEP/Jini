/**
 * @file `analyzeContentWithSiteSlug`: the scorer bound to the site renderer's own slug rule (AW-7
 * Tier 2). TOC links must match the fragment ids the renderer actually emits, so a transliterated
 * heading has to anchor the way `toSlug` does — an ASCII-only rule would drop the accented letters.
 */
import { expect, test } from "vitest";

import { analyzeContentWithSiteSlug } from "../index.js";

const title = "A title that is long enough to pass the check";

test("accented headings get transliterated anchors that match the renderer", () => {
  const report = analyzeContentWithSiteSlug({ title, blocks: [{ kind: "heading", level: 2, text: "Café Münster" }] });
  expect(report.toc).toEqual([{ level: 2, text: "Café Münster", anchor: "cafe-muenster" }]);
});

test("repeated headings get de-duplicated anchors", () => {
  const report = analyzeContentWithSiteSlug({
    title,
    blocks: [{ kind: "heading", level: 2, text: "Getting Started" }, { kind: "heading", level: 3, text: "Getting Started" }],
  });
  expect(report.toc.map((row) => row.anchor)).toEqual(["getting-started", "getting-started-2"]);
});

test("the optional meta description still reaches its check", () => {
  const without = analyzeContentWithSiteSlug({ title, blocks: [] });
  const withMeta = analyzeContentWithSiteSlug({ title, blocks: [] }, { metaDescription: "Short." });
  expect(without.checks.find((check) => check.id === "meta-description-length")?.status).toBe("skip");
  expect(withMeta.checks.find((check) => check.id === "meta-description-length")).toMatchObject({ status: "warn", params: { length: 6 } });
});
