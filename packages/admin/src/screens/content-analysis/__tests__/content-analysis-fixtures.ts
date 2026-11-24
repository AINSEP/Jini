/**
 * @file Shared fixtures for the Content analysis card's suites: a valid `ContentAnalysisReport` (the
 * AW-7 Tier-2 brief's fixed v1 contract) and its JSON-string form, the way the plugin stores it in
 * `ext["content-analyzer"].report`.
 */

export const VALID_REPORT = {
  v: 1,
  score: 84,
  wordCount: 420,
  sentenceCount: 21,
  readingTimeMinutes: 3,
  readability: { fleschReadingEase: 64.2, gradeLevel: 8.1, band: "standard" },
  toc: [
    { level: 2, text: "Intro", anchor: "intro" },
    { level: 3, text: "Details", anchor: "details" },
  ],
  checks: [
    { id: "title-length", status: "pass", params: { length: 42, min: 30, max: 60 } },
    { id: "meta-description-length", status: "skip", params: {} },
    { id: "image-alt", status: "fail", params: { images: 3, missing: 1 } },
    { id: "heading-order", status: "warn", params: { from: 2, to: 4, heading: "Deep dive" } },
    { id: "single-h1", status: "pass", params: { h1: 0 } },
    { id: "content-length", status: "pass", params: { words: 420, min: 300 } },
    { id: "subheadings", status: "pass", params: { words: 420 } },
  ],
};

export const VALID_REPORT_JSON = JSON.stringify(VALID_REPORT);

/** The same report with every field overridden by `patch` (shallow), as a JSON string. */
export function reportJson(patch: Record<string, unknown>): string {
  return JSON.stringify({ ...VALID_REPORT, ...patch });
}
