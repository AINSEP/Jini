/**
 * @file `content-analyzer`'s executable entry module — what the Tier-2 worker imports (AW-7 Tier 2).
 *
 * Purpose:
 * Attaches one `content.entry.beforeSave` filter that scores the entry's title + TipTap body and
 * returns the 6-field `ext.content-analyzer.*` patch (keys un-prefixed, exactly like word-count's
 * `{ count }`; the host namespaces them).
 *
 * Architectural role:
 * This is exactly what a third party would ship as `server/index.mjs`: it imports ONLY the host plugin SDK
 * and its own pure sibling modules — never the host internals — because it runs inside a worker on the
 * far side of the plugin ABI (ADR-024 §3/§4) and the server process never imports it
 * (`./index.ts`'s `importModule` refuses). Everything crossing that boundary is structured-clone
 * plain data, which is WHY `report` is a JSON string: `ExtPatch` values are scalars only.
 */
import { definePlugin, HOOK_CONTENT_ENTRY_BEFORE_SAVE } from "@jini-ai/plugin-sdk";
import type { ContentEntryDraft, ExtPatch, HookContext } from "@jini-ai/core/contracts/plugin-sdk";

import { analyzeContentWithSiteSlug, summarizeReport, tiptapToBlocks } from "@jini-ai/cms/seo/content-analysis";

type ContentAnalyzerDraft = Readonly<ContentEntryDraft & { title: string; bodyJson: unknown; metaDescription?: unknown }>;
type ContentAnalyzerPlugin = { definition: { setup(sdk: { addFilter(name: string, filter: (entry: ContentAnalyzerDraft, ctx: HookContext) => ExtPatch | Promise<ExtPatch>): void }): void } };

/**
 * Read the host's optional meta description. Missing descriptions still skip the length check;
 * the plugin must not invent an override when the host has none.
 *
 * @param entry - The read-only draft the filter received.
 * @returns The meta description when the draft carries one as a string, else `undefined`.
 */
export function readMetaDescription({ entry }: { entry: ContentAnalyzerDraft }, _optional = {}): string | undefined {
  const { metaDescription } = entry;
  return typeof metaDescription === "string" ? metaDescription : undefined;
}

/**
 * Scores one entry draft into the plugin's `ext` patch.
 *
 * @param entry - The read-only draft (`title`, `bodyJson`, optional `metaDescription`).
 * @returns `{ score, wordCount, readingTimeMinutes, readability, summary, report }`.
 * @complexity O(size of bodyJson).
 */
export function buildContentAnalyzerPatch({ entry, analysis }: { entry: ContentAnalyzerDraft; analysis: {
  analyzeContentWithSiteSlug: typeof analyzeContentWithSiteSlug; tiptapToBlocks: typeof tiptapToBlocks; summarizeReport: typeof summarizeReport;
} }, _optional = {}): ExtPatch {
  const metaDescription = readMetaDescription({ entry });
  const report = analysis.analyzeContentWithSiteSlug(
    { title: entry.title, blocks: analysis.tiptapToBlocks({ bodyJson: entry.bodyJson }) },
    metaDescription === undefined ? {} : { metaDescription },
  );
  return {
    score: report.score,
    wordCount: report.wordCount,
    readingTimeMinutes: report.readingTimeMinutes,
    readability: report.readability.fleschReadingEase,
    summary: analysis.summarizeReport(report),
    report: JSON.stringify(report),
  };
}

const plugin: ContentAnalyzerPlugin = definePlugin({
  setup(sdk) {
    sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, async (entry) => buildContentAnalyzerPatch({ entry, analysis: { analyzeContentWithSiteSlug, tiptapToBlocks, summarizeReport } }));
  },
});

export default plugin;
