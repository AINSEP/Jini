/**
 * @file `content-analyzer`'s executable plugin factory (AW-7 Tier 2).
 *
 * Purpose:
 * Attaches one before-save filter that scores the entry's title + TipTap body and returns the
 * 6-field `ext.content-analyzer.*` patch (keys un-prefixed, exactly like word-count's `{ count }`;
 * the host namespaces them).
 *
 * Architectural role:
 * Same shape as word-count's `createWordCountPlugin`: the host injects its own `definePlugin` and
 * `beforeSaveHook`, so this module names no plugin SDK module and no hook string. The host's worker
 * entry (outside the engine) imports its SDK, calls this factory and default-exports the result;
 * this module imports only its pure sibling scorer, so it stays loadable inside that worker.
 * Everything crossing the worker boundary is structured-clone plain data, which is WHY `report` is
 * a JSON string: `ExtPatch` values are scalars only.
 */
import type { ContentEntryDraft, DefinedPlugin, ExtPatch } from "@jini-ai/core/contracts/plugin-sdk";

import { analyzeContentWithSiteSlug, summarizeReport, tiptapToBlocks } from "@jini-ai/cms/seo/content-analysis";

type ContentAnalyzerDraft = Readonly<ContentEntryDraft & { title: string; bodyJson: unknown; metaDescription?: unknown }>;

/** The host-owned SDK seam: its `definePlugin` ABI wrapper and the before-save hook id it fires. */
export interface ContentAnalyzerPluginBinding {
  readonly definePlugin: (required: DefinedPlugin["definition"], optional?: Record<string, never>) => DefinedPlugin;
  readonly beforeSaveHook: string;
}

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

/**
 * Narrows the hook's opaque draft to the fields the scorer reads. A draft without a string title
 * scores as untitled instead of failing the save filter.
 *
 * @param entry - The before-save payload the host delivered.
 * @returns The draft with `title` always a string.
 */
export function readAnalyzerDraft({ entry }: { entry: Readonly<ContentEntryDraft> }, _optional = {}): ContentAnalyzerDraft {
  const fields = entry as Readonly<ContentEntryDraft & { title?: unknown; bodyJson?: unknown }>;
  return { ...entry, title: typeof fields.title === "string" ? fields.title : "", bodyJson: fields.bodyJson };
}

/**
 * Builds the content-analyzer plugin against the host's SDK binding (word-count pattern).
 *
 * @param definePlugin - The host's plugin ABI wrapper.
 * @param beforeSaveHook - The host's before-save hook id; the filter registers on exactly this name.
 * @returns The defined plugin the host's worker entry default-exports.
 */
export function createContentAnalyzerPlugin({ definePlugin, beforeSaveHook }: ContentAnalyzerPluginBinding, _optional = {}): DefinedPlugin {
  return definePlugin({
    setup(sdk) {
      sdk.addFilter(beforeSaveHook, async (entry) => buildContentAnalyzerPatch({
        entry: readAnalyzerDraft({ entry }), analysis: { analyzeContentWithSiteSlug, tiptapToBlocks, summarizeReport },
      }));
    },
  });
}
