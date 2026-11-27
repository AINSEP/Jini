import { expect, test } from "vitest";
import { analyzeContent, countSyllables, summarizeReport, type ContentBlock } from "../index.js";

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

test.each([
  ["HOPe!", 1],
  ["table", 2],
  ["123", 1],
] as const)("estimates syllables in %s as %i", (word, syllables) => {
  expect(countSyllables({ word })).toBe(syllables);
});

test("summary reports the first skipped heading level, missing image alt, and short prose", () => {
  const report = analyzeContent({
    title: " ",
    blocks: [
      { kind: "heading", level: 1, text: "Redundant title" },
      { kind: "heading", level: 2, text: "Preparation" },
      { kind: "heading", level: 4, text: "First jump" },
      { kind: "heading", level: 6, text: "Later jump" },
      { kind: "image", alt: "Workbench" },
      { kind: "image", alt: " " },
      { kind: "text", text: "Cat." },
    ],
    slugify,
  }, { metaDescription: "Too short" });
  expect(report.checks.find(({ id }) => id === "heading-order")).toEqual({
    id: "heading-order", status: "warn", params: { from: 2, to: 4, heading: "First jump" },
  });
  expect(summarizeReport(report)).toBe(
    "Content score 28/100. 1 word (1 min read). Readability: very easy (Flesch 100, grade 0). " +
    "To improve: Add a title. The meta description is 9 characters; aim for 50-160. " +
    '1 of 2 images is missing alt text; describe each image in its alt text. The heading "First jump" jumps from H2 to H4; do not skip heading levels. ' +
    "The body has 1 H1 heading; the title is already the page H1, so use H2 or lower. The body has only 1 word; aim for at least 300. " +
    "Table of contents: 4 headings.",
  );
});

test("summary distinguishes a long unsectioned body from one that passes every check", () => {
  const title = "How to prepare a safe and tidy workbench";
  const metaDescription = "A practical description with enough detail for a search preview.";
  const body = { title, blocks: [prose(300)], slugify };
  const unsectioned = analyzeContent(body, { metaDescription });
  expect(unsectioned.checks.find(({ id }) => id === "subheadings")).toEqual({
    id: "subheadings", status: "warn", params: { words: 300 },
  });
  expect(summarizeReport(unsectioned)).toContain("To improve: 300 words with no subheadings; add H2 sections to break up the text.");
  const sectioned = analyzeContent({
    ...body, blocks: [{ kind: "heading", level: 2, text: "Preparation" }, ...body.blocks],
  }, { metaDescription });
  expect(sectioned.score).toBe(100);
  expect(summarizeReport(sectioned)).toContain("All checks pass. Table of contents: 1 heading.");
});

test("a missing description and empty body are described without a readability grade", () => {
  const report = analyzeContent({ title: "How to prepare a safe and tidy workbench", blocks: [], slugify }, { metaDescription: "   " });
  expect(summarizeReport(report)).toBe(
    "Content score 80/100. 0 words (0 min read). Readability: not measured (no body text). " +
    "To improve: No meta description was given, so its length was not checked. There is no body text yet; aim for at least 300 words. " +
    "Table of contents: no headings.",
  );
});

test("title and description status changes only at their inclusive Unicode code-point limits", () => {
  const titleCases = [[29, "warn"], [30, "pass"], [60, "pass"], [61, "warn"], [70, "warn"], [71, "fail"]] as const;
  for (const [length, status] of titleCases) {
    const result = analyzeContent({ title: ` ${"🌱".repeat(length)} `, blocks: [], slugify });
    expect(result.checks.find(({ id }) => id === "title-length")).toEqual({
      id: "title-length", status, params: { length, min: 30, max: 60 },
    });
  }
  const metaCases = [[49, "warn"], [50, "pass"], [160, "pass"], [161, "warn"]] as const;
  for (const [length, status] of metaCases) {
    const result = analyzeContent({ title: "How to prepare a safe and tidy workbench", blocks: [], slugify }, { metaDescription: "🌱".repeat(length) });
    expect(result.checks.find(({ id }) => id === "meta-description-length")).toEqual({
      id: "meta-description-length", status, params: { length, min: 50, max: 160 },
    });
  }
});

test("image advice counts both absent and blank alt fields without counting descriptive siblings", () => {
  const result = analyzeContent({
    title: "How to prepare a safe and tidy workbench",
    blocks: [{ kind: "image", alt: " " }, { kind: "image", alt: "Tools on a bench" }, { kind: "image", alt: null }, prose(2)],
    slugify,
  });
  expect(result.checks.find(({ id }) => id === "image-alt")).toEqual({
    id: "image-alt", status: "fail", params: { images: 3, missing: 2 },
  });
  expect(summarizeReport(result)).toContain("2 of 3 images are missing alt text; describe each image in its alt text.");
});
