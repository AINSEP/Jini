import { describe, expect, it } from "vitest";

import { AdminApiError } from "@jini-ai/core/admin-runtime";
import {
  CONTENT_ANALYZER_PLUGIN_ID,
  buildContentAnalysisView,
  contentAnalysisCopyKeys,
  currentAnalysis,
  describeAnalysisError,
  isContentAnalysisHidden,
  parseContentAnalysisReport,
  previewAnalysis,
  previewRequestBody,
  storedAnalysis,
  type AnalysisState,
} from "../rules.js";
import { VALID_REPORT, VALID_REPORT_JSON, reportJson } from "./content-analysis-fixtures.js";

/**
 * @file `content-analysis/rules.ts` — the Content analysis card's pure half: the defensive report
 * parse, stored-vs-fresh selection inputs, the view model the card renders, and error copy.
 */

const identity = (key: string) => key;
/** Marks every lookup, so a test can see the template went through `t` before interpolation. */
const marked = (key: string) => `<${key}>`;

describe("parseContentAnalysisReport", () => {
  it("parses a valid v1 report string", () => {
    expect(parseContentAnalysisReport({ raw: VALID_REPORT_JSON })).toEqual(VALID_REPORT);
  });

  it.each([
    "v", "score", "wordCount", "sentenceCount", "readingTimeMinutes", "readability", "toc", "checks",
  ])("rejects a report missing its required %s field", (field) => {
    expect(parseContentAnalysisReport({ raw: reportJson({ [field]: undefined }) })).toBeNull();
  });

  describe.each(["score", "wordCount", "sentenceCount", "readingTimeMinutes"])("%s metric", (field) => {
    it.each([null, true, "12", {}, []])("rejects the non-numeric value %j", (value) => {
      expect(parseContentAnalysisReport({ raw: reportJson({ [field]: value }) })).toBeNull();
    });

    it.each(["1e400", "-1e400"])("rejects a JSON number that overflows to %s", (literal) => {
      const raw = reportJson({ [field]: "overflow" }).replace('"overflow"', literal);
      expect(parseContentAnalysisReport({ raw })).toBeNull();
    });

    it.each([0, -1, 1.5, Number.MAX_VALUE])("preserves the finite value %s without range checks", (value) => {
      const report = { ...VALID_REPORT, [field]: value };
      expect(parseContentAnalysisReport({ raw: JSON.stringify(report) })).toEqual(report);
    });
  });

  it("accepts empty collections and preserves extra report fields", () => {
    const report = { ...VALID_REPORT, toc: [], checks: [], futureField: { enabled: true } };
    expect(parseContentAnalysisReport({ raw: JSON.stringify(report) })).toEqual(report);
  });

  it.each([
    ["a non-string", 42],
    ["undefined", undefined],
    ["unparseable JSON", "{not json"],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["an unknown version", reportJson({ v: 2 })],
    ["a missing score", reportJson({ score: undefined })],
    ["a non-finite word count", reportJson({ wordCount: "many" })],
    ["a non-numeric sentence count", reportJson({ sentenceCount: null })],
    ["a non-numeric reading time", reportJson({ readingTimeMinutes: "3" })],
    ["a non-object readability", reportJson({ readability: 5 })],
    ["a non-numeric reading ease", reportJson({ readability: { fleschReadingEase: "x", gradeLevel: 1, band: "easy" } })],
    ["a non-numeric grade", reportJson({ readability: { fleschReadingEase: 1, gradeLevel: "x", band: "easy" } })],
    ["an unknown band", reportJson({ readability: { fleschReadingEase: 1, gradeLevel: 1, band: "weird" } })],
    ["a non-array toc", reportJson({ toc: {} })],
    ["a toc entry that is not an object", reportJson({ toc: [null] })],
    ["a toc level below 1", reportJson({ toc: [{ level: 0, text: "a", anchor: "a" }] })],
    ["a toc level above 6", reportJson({ toc: [{ level: 7, text: "a", anchor: "a" }] })],
    ["a fractional toc level", reportJson({ toc: [{ level: 2.5, text: "a", anchor: "a" }] })],
    ["a non-string toc text", reportJson({ toc: [{ level: 2, text: 3, anchor: "a" }] })],
    ["a non-string toc anchor", reportJson({ toc: [{ level: 2, text: "a", anchor: null }] })],
    ["a non-array checks", reportJson({ checks: "all good" })],
    ["a check that is not an object", reportJson({ checks: [7] })],
    ["a check with a non-string id", reportJson({ checks: [{ id: 1, status: "pass", params: {} }] })],
    ["a check with an unknown status", reportJson({ checks: [{ id: "single-h1", status: "maybe", params: {} }] })],
    ["a check with non-object params", reportJson({ checks: [{ id: "single-h1", status: "pass", params: [] }] })],
    ["a check with null params", reportJson({ checks: [{ id: "single-h1", status: "pass", params: null }] })],
    ["a check param that is a boolean", reportJson({ checks: [{ id: "single-h1", status: "pass", params: { h1: true } }] })],
  ])("returns null for %s", (_label, raw) => {
    expect(parseContentAnalysisReport({ raw })).toBeNull();
  });

  it("keeps a check whose id this admin does not know (a newer plugin's extra check)", () => {
    const report = parseContentAnalysisReport({ raw: reportJson({ checks: [{ id: "future-check", status: "warn", params: { n: 1 } }] }) });
    expect(report?.checks).toEqual([{ id: "future-check", status: "warn", params: { n: 1 } }]);
  });
});

describe("storedAnalysis", () => {
  it("is missing when the post carries no ext at all", () => {
    expect(storedAnalysis({ ext: undefined })).toEqual({ kind: "missing" });
  });

  it("is missing when no content-analyzer bag is present", () => {
    expect(storedAnalysis({ ext: { "word-count": { words: 3 } } })).toEqual({ kind: "missing" });
  });

  it("is missing when the bag has no report field", () => {
    expect(storedAnalysis({ ext: { [CONTENT_ANALYZER_PLUGIN_ID]: { score: 80 } } })).toEqual({ kind: "missing" });
  });

  it("is invalid when the stored report does not parse", () => {
    expect(storedAnalysis({ ext: { [CONTENT_ANALYZER_PLUGIN_ID]: { report: "{bad" } } })).toEqual({ kind: "invalid" });
  });

  it("is the stored report when it parses", () => {
    expect(storedAnalysis({ ext: { [CONTENT_ANALYZER_PLUGIN_ID]: { report: VALID_REPORT_JSON } } })).toEqual({
      kind: "report",
      source: "stored",
      report: VALID_REPORT,
    });
  });
});

describe("previewAnalysis", () => {
  it("is the fresh report when the preview's report field parses", () => {
    expect(previewAnalysis({ report: VALID_REPORT_JSON, score: 84 })).toEqual({ kind: "report", source: "fresh", report: VALID_REPORT });
  });

  it("is invalid (never missing) when the preview returned no usable report", () => {
    expect(previewAnalysis({ score: 84 })).toEqual({ kind: "invalid" });
    expect(previewAnalysis({ report: "nope" })).toEqual({ kind: "invalid" });
  });
});

describe("currentAnalysis", () => {
  const ext = { [CONTENT_ANALYZER_PLUGIN_ID]: { report: VALID_REPORT_JSON } };
  const freshState: AnalysisState = { kind: "invalid" };

  it("shows the stored analysis when nothing was analyzed on demand", () => {
    expect(currentAnalysis({ post: { id: "p1", version: 3, ext }, fresh: null })).toMatchObject({ kind: "report", source: "stored" });
  });

  it("shows the Analyze-now result while it belongs to the post as loaded", () => {
    expect(currentAnalysis({ post: { id: "p1", version: 3, ext }, fresh: { postId: "p1", version: 3, state: freshState } })).toBe(freshState);
  });

  it("drops back to the stored analysis once a save moved the version on", () => {
    expect(currentAnalysis({ post: { id: "p1", version: 4, ext }, fresh: { postId: "p1", version: 3, state: freshState } })).toMatchObject({ source: "stored" });
  });

  it("never shows another post's Analyze-now result", () => {
    expect(currentAnalysis({ post: { id: "p2", version: 3 }, fresh: { postId: "p1", version: 3, state: freshState } })).toEqual({ kind: "missing" });
  });
});

describe("isContentAnalysisHidden", () => {
  it("hides while the status read is loading, and when the plugin is off or not installed", () => {
    expect(isContentAnalysisHidden({ data: undefined, error: null })).toBe(true);
    expect(isContentAnalysisHidden({ data: { enabled: false }, error: null })).toBe(true);
    expect(isContentAnalysisHidden({ data: undefined, error: new AdminApiError({ message: "plugin was not found", status: 404 }, { code: "PLUGIN_NOT_FOUND" }) })).toBe(true);
  });

  it("shows when the plugin is enabled", () => {
    expect(isContentAnalysisHidden({ data: { enabled: true }, error: null })).toBe(false);
  });

  it("shows (to carry the error) when the status read was refused or failed — never a silent 'off'", () => {
    expect(isContentAnalysisHidden({ data: undefined, error: new AdminApiError({ message: "forbidden", status: 403 }, { code: "FORBIDDEN" }) })).toBe(false);
    expect(isContentAnalysisHidden({ data: undefined, error: new Error("offline") })).toBe(false);
  });
});

describe("previewRequestBody", () => {
  it("sends the editor's current title and object body, plus the post id", () => {
    const doc = { type: "doc", content: [] };
    expect(previewRequestBody({ postId: "p1", title: "Hello", bodyJson: doc })).toEqual({ postId: "p1", title: "Hello", bodyJson: doc });
  });

  it.each([
    ["null (TipTap not mounted yet)", null],
    ["an array", []],
  ])("substitutes an empty doc for %s", (_label, bodyJson) => {
    expect(previewRequestBody({ postId: "p1", title: "", bodyJson }).bodyJson).toEqual({ type: "doc", content: [] });
  });
});

describe("buildContentAnalysisView", () => {
  const stored: AnalysisState = { kind: "report", source: "stored", report: parseContentAnalysisReport({ raw: VALID_REPORT_JSON })! };

  it("leads with where the analysis came from", () => {
    expect(buildContentAnalysisView({ state: stored, t: identity }).lead).toBe("From the last save.");
    expect(buildContentAnalysisView({ state: { ...stored, source: "fresh" } as AnalysisState, t: identity }).lead).toBe(
      "From your current draft, including unsaved changes."
    );
    expect(buildContentAnalysisView({ state: { kind: "missing" }, t: identity })).toEqual({
      lead: "Not analyzed yet. Save, or click Analyze now.",
      report: null,
    });
    expect(buildContentAnalysisView({ state: { kind: "invalid" }, t: identity })).toEqual({ lead: "Analysis unavailable.", report: null });
  });

  it("builds the four stats with translated, interpolated copy", () => {
    const view = buildContentAnalysisView({ state: stored, t: marked });
    expect(view.report?.stats).toEqual([
      { key: "score", label: "<Score>", value: "84", meta: "<out of 100>" },
      { key: "words", label: "<Words>", value: "420", meta: "<Sentences: {count}>".replace("{count}", "21") },
      { key: "reading-time", label: "<Reading time>", value: "<{minutes} min>".replace("{minutes}", "3"), meta: "<Estimated>" },
      {
        key: "readability",
        label: "<Readability>",
        value: "64.2",
        meta: "<{band} · grade {grade}>".replace("{band}", "<Standard>").replace("{grade}", "8.1"),
      },
    ]);
  });

  it("labels every readability band", () => {
    const bands = ["very-easy", "easy", "fairly-easy", "standard", "fairly-difficult", "difficult", "very-difficult"] as const;
    const labels = bands.map((band) => {
      const report = { ...stored.report!, readability: { ...stored.report!.readability, band } };
      return buildContentAnalysisView({ state: { kind: "report", source: "stored", report }, t: identity }).report!.stats[3]!.meta;
    });
    expect(labels).toEqual([
      "Very easy · grade 8.1",
      "Easy · grade 8.1",
      "Fairly easy · grade 8.1",
      "Standard · grade 8.1",
      "Fairly difficult · grade 8.1",
      "Difficult · grade 8.1",
      "Very difficult · grade 8.1",
    ]);
  });

  it("builds the table of contents with a level label and an indent relative to the shallowest heading", () => {
    const view = buildContentAnalysisView({ state: stored, t: identity });
    expect(view.report?.toc).toEqual([
      { key: "0-intro", text: "Intro", levelLabel: "H2", indentRem: 0 },
      { key: "1-details", text: "Details", levelLabel: "H3", indentRem: 1 },
    ]);
    const empty = buildContentAnalysisView({ state: { kind: "report", source: "stored", report: { ...stored.report!, toc: [] } }, t: identity });
    expect(empty.report?.toc).toEqual([]);
  });

  it("builds every check with a status label, tone, icon and interpolated message", () => {
    const view = buildContentAnalysisView({ state: stored, t: identity });
    expect(view.report?.checks).toEqual([
      { key: "0-title-length", title: "Title length", status: "pass", statusLabel: "Pass", tone: "status-ok", icon: "✓", message: "Title length is good: 42 characters." },
      { key: "1-meta-description-length", title: "Meta description", status: "skip", statusLabel: "Skipped", tone: "status-neutral", icon: "–", message: "No meta description is set." },
      { key: "2-image-alt", title: "Image alt text", status: "fail", statusLabel: "Fail", tone: "status-error", icon: "✕", message: "1 of 3 images are missing alt text." },
      { key: "3-heading-order", title: "Heading order", status: "warn", statusLabel: "Warning", tone: "status-warning", icon: "!", message: "Heading “Deep dive” jumps from H2 to H4." },
      { key: "4-single-h1", title: "Single H1", status: "pass", statusLabel: "Pass", tone: "status-ok", icon: "✓", message: "The body has no extra H1; the title is the page’s H1." },
      { key: "5-content-length", title: "Content length", status: "pass", statusLabel: "Pass", tone: "status-ok", icon: "✓", message: "420 words — a solid length." },
      { key: "6-subheadings", title: "Subheadings", status: "pass", statusLabel: "Pass", tone: "status-ok", icon: "✓", message: "Subheadings break up the content." },
    ]);
  });

  it.each([
    ["title-length", "warn", { length: 12, min: 30, max: 60 }, "Title is 12 characters; aim for 30–60."],
    ["title-length", "fail", { length: 0, min: 30, max: 60 }, "Title is 0 characters; aim for 30–60."],
    ["meta-description-length", "pass", { length: 120, min: 50, max: 160 }, "Meta description length is good: 120 characters."],
    ["meta-description-length", "warn", { length: 20, min: 50, max: 160 }, "Meta description is 20 characters; aim for 50–160."],
    ["image-alt", "pass", { images: 0, missing: 0 }, "No images to check."],
    ["image-alt", "pass", { images: 2, missing: 0 }, "All 2 images have alt text."],
    ["heading-order", "pass", {}, "Headings follow a logical order."],
    ["single-h1", "warn", { h1: 2 }, "The body has 2 H1 headings; the title is already the H1, so use H2 instead."],
    ["content-length", "warn", { words: 120, min: 300 }, "120 words; aim for at least 300."],
    ["content-length", "fail", { words: 0, min: 300 }, "The content is empty."],
    ["subheadings", "warn", { words: 450 }, "450 words with no subheadings; add H2–H6 headings."],
  ])("%s %s reads as its own sentence", (id, status, params, message) => {
    const report = { ...stored.report!, checks: [{ id, status, params }] } as never;
    expect(buildContentAnalysisView({ state: { kind: "report", source: "stored", report }, t: identity }).report!.checks[0]!.message).toBe(message);
  });

  it("falls back to the raw id and no message for a check or status combination it has no copy for", () => {
    const report = {
      ...stored.report!,
      checks: [
        { id: "future-check", status: "warn", params: {} },
        { id: "single-h1", status: "fail", params: {} },
      ],
    } as never;
    const checks = buildContentAnalysisView({ state: { kind: "report", source: "stored", report }, t: identity }).report!.checks;
    expect(checks[0]).toMatchObject({ title: "future-check", message: "" });
    expect(checks[1]).toMatchObject({ title: "Single H1", statusLabel: "Fail", message: "" });
  });

  it("translates a check's template before interpolating its params", () => {
    const view = buildContentAnalysisView({ state: stored, t: marked });
    expect(view.report!.checks[0]!.message).toBe("<Title length is good: 42 characters.>");
  });
});

describe("describeAnalysisError", () => {
  it.each([
    ["PLUGIN_NOT_ENABLED", "The Content Analyzer plugin is not enabled."],
    ["PLUGIN_NOT_FOUND", "The Content Analyzer plugin is not installed."],
    ["PLUGIN_HOOK_FAILED", "The analyzer could not process this content."],
  ])("maps %s to its own copy", (code, message) => {
    expect(describeAnalysisError({ error: new AdminApiError({ message: "server words", status: 409 }, { code }), t: identity })).toBe(message);
  });

  it("falls back to the shared API error copy for any other failure", () => {
    expect(describeAnalysisError({ error: new AdminApiError({ message: "bad body", status: 400 }, { code: "VALIDATION" }), t: identity })).toBe("bad body");
    expect(describeAnalysisError({ error: new AdminApiError({ message: "", status: 500 }), t: identity })).toBe("Analysis failed.");
    expect(describeAnalysisError({ error: "boom", t: marked })).toBe("<Analysis failed.>");
  });
});

describe("contentAnalysisCopyKeys", () => {
  it("lists every English key the card can ask its dictionary for, once each", () => {
    const keys = contentAnalysisCopyKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["Content analysis", "Analyze now", "Title length", "Very difficult", "No images to check."]));
  });
});
