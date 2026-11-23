import { AdminApiError, describeApiError } from "@jini-ai/core/admin-runtime";

import { type Translate, interpolate } from '@jini-ai/core/text';
/**
 * @file The Content analysis card's pure half — everything `ContentAnalysisCard.tsx` shows, decided
 * here so the component is only markup and the hook only fetches and holds state.
 *
 * The card is the admin surface of the `content-analyzer` built-in plugin (AW-7 Tier 2). That plugin
 * writes its analysis into the post's `ext["content-analyzer"]` bag on every save, and the generic
 * `POST /plugins/:pluginId/preview` route runs the same filter over an UNSAVED draft and returns the
 * plugin's patch without saving it. Both carry the full analysis as `report`, a JSON STRING —
 * `ExtPatch` values are scalars only, which is why it is not an object.
 *
 * The report types below MIRROR the plugin's `ContentAnalysisReport` (v1, fixed in
 * the host's plugin brief) rather than importing it: a browser bundle cannot import the host
 * server's internals — same decoupling every host admin wire type follows. The
 * parse is defensive for the same reason: whatever arrives (absent, unparseable, a future `v`, a
 * malformed field) becomes an "analysis unavailable" state, never a crash in the post editor.
 */

export const CONTENT_ANALYZER_PLUGIN_ID = "content-analyzer";

const READABILITY_BANDS = ["very-easy", "easy", "fairly-easy", "standard", "fairly-difficult", "difficult", "very-difficult"] as const;
const CHECK_STATUSES = ["pass", "warn", "fail", "skip"] as const;

export type ReadabilityBand = (typeof READABILITY_BANDS)[number];
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface ContentCheck {
  /** One of the plugin's seven ids today; kept as `string` so a newer plugin's extra check still
   *  renders (under its raw id) instead of failing the whole report. */
  id: string;
  status: CheckStatus;
  params: Record<string, number | string>;
}

export interface TocEntry {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  anchor: string;
}

export interface ContentAnalysisReport {
  v: 1;
  score: number;
  wordCount: number;
  sentenceCount: number;
  readingTimeMinutes: number;
  readability: { fleschReadingEase: number; gradeLevel: number; band: ReadabilityBand };
  toc: TocEntry[];
  checks: ContentCheck[];
}

/** What the card has to show: a report (from the last save, or from an Analyze-now run over the
 *  unsaved draft), nothing yet, or something it could not read. */
export type AnalysisState =
  | { kind: "report"; source: "stored" | "fresh"; report: ContentAnalysisReport }
  | { kind: "missing" }
  | { kind: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isReadability(value: unknown): value is ContentAnalysisReport["readability"] {
  return (
    isRecord(value) &&
    isFiniteNumber(value.fleschReadingEase) &&
    isFiniteNumber(value.gradeLevel) &&
    (READABILITY_BANDS as readonly unknown[]).includes(value.band)
  );
}

function isHeadingLevel({ level }: { level: unknown }, _optional = {}): boolean {
  return Number.isInteger(level) && (level as number) >= 1 && (level as number) <= 6;
}

function isTocEntry(value: unknown): value is TocEntry {
  if (!isRecord(value) || !isHeadingLevel({ level: value.level })) return false;
  return typeof value.text === "string" && typeof value.anchor === "string";
}

function isCheckParams(value: unknown): value is ContentCheck["params"] {
  return isRecord(value) && Object.values(value).every((param) => typeof param === "string" || isFiniteNumber(param));
}

function isCheck(value: unknown): value is ContentCheck {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (CHECK_STATUSES as readonly unknown[]).includes(value.status) &&
    isCheckParams(value.params)
  );
}

function hasReportMetrics(
  { value }: { value: Record<string, unknown> },
  _options: Record<string, never> = {},
): boolean {
  return (
    isFiniteNumber(value.score) &&
    isFiniteNumber(value.wordCount) &&
    isFiniteNumber(value.sentenceCount) &&
    isFiniteNumber(value.readingTimeMinutes)
  );
}

function isArrayOf({ value, isItem }: { value: unknown; isItem: (item: unknown) => boolean }, _optional = {}): boolean {
  return Array.isArray(value) && value.every(isItem);
}

function isReport(value: unknown): value is ContentAnalysisReport {
  if (!isRecord(value) || value.v !== 1) return false;
  if (!hasReportMetrics({ value }) || !isReadability(value.readability)) return false;
  return isArrayOf({ value: value.toc, isItem: isTocEntry }) && isArrayOf({ value: value.checks, isItem: isCheck });
}

/** The `report` field's JSON string as a v1 report, or `null` for anything else. */
export function parseContentAnalysisReport({ raw }: { raw: unknown }, _optional = {}): ContentAnalysisReport | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isReport(parsed) ? parsed : null;
}

/** The analysis stored on the post by its last save. No `report` field at all is "not analyzed
 *  yet" (a post saved before the plugin was enabled), distinct from one that will not parse. */
export function storedAnalysis({ ext }: { ext: Record<string, Record<string, unknown>> | undefined }, _optional = {}): AnalysisState {
  const raw = ext?.[CONTENT_ANALYZER_PLUGIN_ID]?.report;
  if (raw === undefined) return { kind: "missing" };
  const report = parseContentAnalysisReport({ raw });
  return report ? { kind: "report", source: "stored", report } : { kind: "invalid" };
}

/** The analysis an Analyze-now preview returned. The plugin ran, so a missing report is a broken
 *  reply ("unavailable"), not "not analyzed yet". */
export function previewAnalysis(fields: Record<string, unknown>): AnalysisState {
  const report = parseContentAnalysisReport({ raw: fields.report });
  return report ? { kind: "report", source: "fresh", report } : { kind: "invalid" };
}

/** An Analyze-now result, tagged with the post id and version it was run against. */
export interface FreshAnalysis {
  postId: string;
  version: number;
  state: AnalysisState;
}

/** Which analysis the card shows: an Analyze-now result while it still belongs to the post as
 *  loaded, else the stored one. A save bumps `version` and brings back the plugin's freshly stored
 *  `ext`, so the stored analysis wins again from that moment — including over a preview that was
 *  still in flight when the save landed (it is tagged with the older version). */
export function currentAnalysis(
  { post, fresh }: { post: { id: string; version: number; ext?: Record<string, Record<string, unknown>> }; fresh: FreshAnalysis | null },
  _optional = {},
): AnalysisState {
  if (fresh && fresh.postId === post.id && fresh.version === post.version) return fresh.state;
  return storedAnalysis({ ext: post.ext });
}

/** Whether the card hides, from the plugin's preview-status read — the card's only gate. Hidden
 *  while loading, when the plugin is off, and when it is not installed (`PLUGIN_NOT_FOUND`). Any
 *  other failed read (refused, offline) SHOWS the card so it can carry the error: hiding it would
 *  look exactly like "plugin disabled". @complexity O(1). */
export function isContentAnalysisHidden(status: { data: { enabled: boolean } | undefined; error: unknown }): boolean {
  if (status.data) return !status.data.enabled;
  if (!status.error) return true;
  return status.error instanceof AdminApiError && status.error.code === "PLUGIN_NOT_FOUND";
}

export interface PluginPreviewRequest {
  postId?: string;
  title: string;
  slug?: string;
  bodyJson: Record<string, unknown>;
  metaDescription?: string;
}

const EMPTY_DOC: Record<string, unknown> = { type: "doc", content: [] };

/** The preview route's body for the editor's current, unsaved title and body. `bodyJson` is `null`
 *  until TipTap mounts; the route requires an object, so an empty doc stands in. */
export function previewRequestBody(input: { postId: string; title: string; bodyJson: unknown }): PluginPreviewRequest {
  return { postId: input.postId, title: input.title, bodyJson: isRecord(input.bodyJson) ? input.bodyJson : EMPTY_DOC };
}

// ---- copy ---------------------------------------------------------------------------------------
// Every string below is an English dictionary key (`content-analysis-i18n.ts`), translated through
// the injected `t` and only then interpolated, so each locale owns its own word order.

const LEADS = {
  stored: "From the last save.",
  fresh: "From your current draft, including unsaved changes.",
  missing: "Not analyzed yet. Save, or click Analyze now.",
  invalid: "Analysis unavailable.",
} as const;

const BAND_LABELS: Record<ReadabilityBand, string> = {
  "very-easy": "Very easy",
  easy: "Easy",
  "fairly-easy": "Fairly easy",
  standard: "Standard",
  "fairly-difficult": "Fairly difficult",
  difficult: "Difficult",
  "very-difficult": "Very difficult",
};

/** Status is always shown as text plus an icon, never by colour alone; `tone` is a
 *  `jini-status-*` pill class; the host stylesheet paints it. */
const STATUS_META: Record<CheckStatus, { label: string; tone: string; icon: string }> = {
  pass: { label: "Pass", tone: "jini-status-ok", icon: "✓" },
  warn: { label: "Warning", tone: "jini-status-warning", icon: "!" },
  fail: { label: "Fail", tone: "jini-status-error", icon: "✕" },
  skip: { label: "Skipped", tone: "jini-status-neutral", icon: "–" },
};

const CHECK_TITLES: Record<string, string> = {
  "title-length": "Title length",
  "meta-description-length": "Meta description",
  "image-alt": "Image alt text",
  "heading-order": "Heading order",
  "single-h1": "Single H1",
  "content-length": "Content length",
  subheadings: "Subheadings",
};

const TITLE_OUT_OF_RANGE = "Title is {length} characters; aim for {min}–{max}.";
const CONTENT_SHORT = "{words} words; aim for at least {min}.";

/** Per check id and status, the sentence that explains it. A combination with no entry (a newer
 *  plugin's check, or a status the plugin never gives that check) shows the status label only. */
const CHECK_MESSAGES: Record<string, Partial<Record<CheckStatus, string>>> = {
  "title-length": { pass: "Title length is good: {length} characters.", warn: TITLE_OUT_OF_RANGE, fail: TITLE_OUT_OF_RANGE },
  "meta-description-length": {
    pass: "Meta description length is good: {length} characters.",
    warn: "Meta description is {length} characters; aim for {min}–{max}.",
    skip: "No meta description is set.",
  },
  "image-alt": { pass: "All {images} images have alt text.", fail: "{missing} of {images} images are missing alt text." },
  "heading-order": { pass: "Headings follow a logical order.", warn: "Heading “{heading}” jumps from H{from} to H{to}." },
  "single-h1": {
    pass: "The body has no extra H1; the title is the page’s H1.",
    warn: "The body has {h1} H1 headings; the title is already the H1, so use H2 instead.",
  },
  "content-length": { pass: "{words} words — a solid length.", warn: CONTENT_SHORT, fail: "The content is empty." },
  subheadings: { pass: "Subheadings break up the content.", warn: "{words} words with no subheadings; add H2–H6 headings." },
};

const NO_IMAGES = "No images to check.";

const STATS_COPY = {
  score: "Score",
  outOf100: "out of 100",
  words: "Words",
  sentences: "Sentences: {count}",
  readingTime: "Reading time",
  minutes: "{minutes} min",
  estimated: "Estimated",
  readability: "Readability",
  bandGrade: "{band} · grade {grade}",
} as const;

const ERROR_COPY = {
  notEnabled: "The Content Analyzer plugin is not enabled.",
  notFound: "The Content Analyzer plugin is not installed.",
  hookFailed: "The analyzer could not process this content.",
  fallback: "Analysis failed.",
} as const;

/** Strings `ContentAnalysisCard.tsx` passes to `t` directly (the rest come from the tables above). */
export const CARD_COPY = ["Content analysis", "Analyze now", "Analyzing…", "Table of contents", "No headings yet.", "Checks"] as const;

/** Every English key this feature can look up — what the i18n suite holds each locale to. */
export function contentAnalysisCopyKeys(): string[] {
  const messages = Object.values(CHECK_MESSAGES).flatMap((byStatus) => Object.values(byStatus));
  return [
    ...new Set([
      ...Object.values(LEADS),
      ...Object.values(BAND_LABELS),
      ...Object.values(STATUS_META).map((meta) => meta.label),
      ...Object.values(CHECK_TITLES),
      ...messages,
      NO_IMAGES,
      ...Object.values(STATS_COPY),
      ...Object.values(ERROR_COPY),
      ...CARD_COPY,
    ]),
  ];
}

export interface AnalysisStat {
  key: string;
  label: string;
  value: string;
  meta: string;
}

export interface AnalysisTocItem {
  key: string;
  text: string;
  levelLabel: string;
  /** Indent relative to the shallowest heading in the list, so an H2-only post is not pushed in. */
  indentRem: number;
}

export interface AnalysisCheckItem {
  key: string;
  title: string;
  status: CheckStatus;
  statusLabel: string;
  tone: string;
  icon: string;
  message: string;
}

export interface ContentAnalysisView {
  lead: string;
  report: { stats: AnalysisStat[]; toc: AnalysisTocItem[]; checks: AnalysisCheckItem[] } | null;
}

function checkMessage(check: ContentCheck, t: Translate): string {
  const template = check.id === "image-alt" && check.status === "pass" && check.params.images === 0 ? NO_IMAGES : CHECK_MESSAGES[check.id]?.[check.status];
  return template ? interpolate({ template: t(template), vars: check.params }) : "";
}

function buildStats(report: ContentAnalysisReport, t: Translate): AnalysisStat[] {
  const { fleschReadingEase, gradeLevel, band } = report.readability;
  return [
    { key: "score", label: t(STATS_COPY.score), value: String(report.score), meta: t(STATS_COPY.outOf100) },
    { key: "words", label: t(STATS_COPY.words), value: String(report.wordCount), meta: interpolate({ template: t(STATS_COPY.sentences), vars: { count: report.sentenceCount } }) },
    {
      key: "reading-time",
      label: t(STATS_COPY.readingTime),
      value: interpolate({ template: t(STATS_COPY.minutes), vars: { minutes: report.readingTimeMinutes } }),
      meta: t(STATS_COPY.estimated),
    },
    {
      key: "readability",
      label: t(STATS_COPY.readability),
      value: String(fleschReadingEase),
      meta: interpolate({ template: t(STATS_COPY.bandGrade), vars: { band: t(BAND_LABELS[band]), grade: gradeLevel } }),
    },
  ];
}

function buildToc({ toc }: { toc: TocEntry[] }, _optional = {}): AnalysisTocItem[] {
  const shallowest = Math.min(...toc.map((entry) => entry.level));
  return toc.map((entry, index) => ({
    key: `${index}-${entry.anchor}`,
    text: entry.text,
    levelLabel: `H${entry.level}`,
    indentRem: entry.level - shallowest,
  }));
}

function buildChecks({ checks, t }: { checks: ContentCheck[]; t: Translate }, _optional = {}): AnalysisCheckItem[] {
  return checks.map((check, index) => {
    const meta = STATUS_META[check.status];
    const title = CHECK_TITLES[check.id];
    return {
      key: `${index}-${check.id}`,
      title: title ? t(title) : check.id,
      status: check.status,
      statusLabel: t(meta.label),
      tone: meta.tone,
      icon: meta.icon,
      message: checkMessage(check, t),
    };
  });
}

/** Everything the card renders for one analysis state, already translated. */
export function buildContentAnalysisView({ state, t }: { state: AnalysisState; t: Translate }, _optional: Record<string, never> = {}): ContentAnalysisView {
  if (state.kind !== "report") return { lead: t(LEADS[state.kind]), report: null };
  const { report } = state;
  return {
    lead: t(LEADS[state.source]),
    report: { stats: buildStats(report, t), toc: buildToc({ toc: report.toc }), checks: buildChecks({ checks: report.checks, t }) },
  };
}

/** Operator copy for a failed Analyze-now — the preview route's own refusal codes first, then the
 *  app's shared fallback chain. */
export function describeAnalysisError({ error, t }: { error: unknown; t: Translate }, _optional = {}): string {
  if (error instanceof AdminApiError) {
    if (error.code === "PLUGIN_NOT_ENABLED") return t(ERROR_COPY.notEnabled);
    if (error.code === "PLUGIN_NOT_FOUND") return t(ERROR_COPY.notFound);
    if (error.code === "PLUGIN_HOOK_FAILED") return t(ERROR_COPY.hookFailed);
  }
  return describeApiError({ e: error, fallback: t(ERROR_COPY.fallback) });
}
