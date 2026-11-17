import { expect, test } from "vitest";
import { analyzeContent, summarizeReport, type ContentBlock } from "../index.js";

/** A deliberately plain slug rule: the scorer must use whatever the host passes. */
const slugify = ({ text }: { text: string }): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const prose = (words: number): ContentBlock => ({ kind: "text", text: `${Array.from({ length: words }, () => "cat").join(" ")}.` });

test("TOC anchors come from the injected slugify, de-duplicated, empty ones omitted", () => {
  const report = analyzeContent({
    title: "A title that is long enough to pass the check",
    blocks: [{ kind: "heading", level: 2, text: "Getting Started" }, { kind: "heading", level: 2, text: "Getting Started" }, { kind: "heading", level: 2, text: "!!!" }, prose(10)],
    slugify,
  });
  expect(report.toc.map((row) => row.anchor)).toEqual(["getting-started", "getting-started-2"]);
});

test("an empty body scores zero words and the summary says so in English", () => {
  const report = analyzeContent({ title: "Short", blocks: [], slugify });
  expect(report).toMatchObject({ v: 1, wordCount: 0 });
  expect(summarizeReport(report)).toMatch(/^Content score \d+\/100\./);
});
