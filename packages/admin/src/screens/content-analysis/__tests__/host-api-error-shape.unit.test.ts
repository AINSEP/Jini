import { describe, expect, it } from "vitest";
import { buildContentAnalysisView, describeAnalysisError, isContentAnalysisHidden, parseContentAnalysisReport, storedAnalysis } from "../rules.js";
import { VALID_REPORT, reportJson } from "./content-analysis-fixtures.js";

/** The host's transport error, restated structurally: an `Error` with a numeric HTTP `status` and an
 *  optional canonical `code`. Pins the moved rules' structural read (the host class is not importable here). */
function hostError(message: string, status: unknown, code?: string): Error {
  return Object.assign(new Error(message), { status }, code === undefined ? {} : { code });
}
const t = (key: string) => key;

describe("content-analysis rules read the host API error structurally", () => {
  it("maps a status-carrying error's refusal code to the card copy", () => {
    expect(describeAnalysisError({ error: hostError("x", 409, "PLUGIN_NOT_ENABLED"), t })).toBe("The Content Analyzer plugin is not enabled.");
    expect(isContentAnalysisHidden({ data: undefined, error: hostError("gone", 404, "PLUGIN_NOT_FOUND") })).toBe(true);
  });

  it("ignores a code on an error without a numeric status (not a transport error)", () => {
    expect(describeAnalysisError({ error: hostError("boom", "404", "PLUGIN_NOT_ENABLED"), t })).toBe("boom");
    expect(isContentAnalysisHidden({ data: undefined, error: Object.assign(new Error("x"), { code: "PLUGIN_NOT_FOUND" }) })).toBe(false);
  });

  it("falls back to the error's own message, then the card fallback", () => {
    expect(describeAnalysisError({ error: hostError("server said no", 500), t })).toBe("server said no");
    expect(describeAnalysisError({ error: hostError("", 500), t })).toBe("Analysis failed.");
    expect(describeAnalysisError({ error: "nope", t })).toBe("Analysis failed.");
  });
});

it("treats truncated report JSON as unavailable instead of throwing into the editor", () => {
  const incomplete = '{"v":1,"score":84,';
  expect(parseContentAnalysisReport({ raw: incomplete })).toBeNull();
  expect(storedAnalysis({ ext: { "content-analyzer": { report: incomplete } } })).toEqual({ kind: "invalid" });
  expect(storedAnalysis({ ext: {} })).toEqual({ kind: "missing" });
});

it.each([
  { field: "version", patch: { v: 2 } },
  { field: "score", patch: { score: "84" } },
  { field: "word count", patch: { wordCount: null } },
  { field: "sentence count", patch: { sentenceCount: [] } },
  { field: "reading time", patch: { readingTimeMinutes: true } },
  { field: "readability band", patch: { readability: { ...VALID_REPORT.readability, band: "unsupported-band" } } },
  { field: "heading level below range", patch: { toc: [{ ...VALID_REPORT.toc[0], level: 0 }, ...VALID_REPORT.toc] } },
  { field: "heading level above range", patch: { toc: [...VALID_REPORT.toc, { ...VALID_REPORT.toc[0], level: 7 }] } },
  { field: "fractional heading level", patch: { toc: [{ ...VALID_REPORT.toc[0], level: 2.5 }] } },
  { field: "a non-string anchor", patch: { toc: [{ ...VALID_REPORT.toc[0], anchor: 9 }] } },
  { field: "an unfamiliar check status", patch: { checks: [...VALID_REPORT.checks, { id: "new-check", status: "caution", params: {} }] } },
  { field: "nested check parameter", patch: { checks: [{ id: "new-check", status: "pass", params: { nested: { level: 2 } } }] } },
])("rejects a v1 report with invalid $field", ({ patch }) => {
  expect(parseContentAnalysisReport({ raw: reportJson(patch) })).toBeNull();
});

it("names a new check by ID and distinguishes an image-free post from a post whose images all have alt text", () => {
  const report = parseContentAnalysisReport({ raw: reportJson({ checks: [
    { id: "new-plugin-check", status: "warn", params: { score: 12 } },
    { id: "image-alt", status: "pass", params: { images: 0 } },
    { id: "image-alt", status: "pass", params: { images: 3 } },
  ] }) })!;
  const view = buildContentAnalysisView({ state: { kind: "report", source: "fresh", report }, t });
  expect(view.report?.checks.map(({ title, statusLabel, message }) => ({ title, statusLabel, message }))).toEqual([
    { title: "new-plugin-check", statusLabel: "Warning", message: "" },
    { title: "Image alt text", statusLabel: "Pass", message: "No images to check." },
    { title: "Image alt text", statusLabel: "Pass", message: "All 3 images have alt text." },
  ]);
});
