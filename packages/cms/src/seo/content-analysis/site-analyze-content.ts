/**
 * @file The binding of `analyzeContent` to the site renderer's slug rule (AW-7 Tier 2): TOC anchors
 * use `toSlug`, so transliterated headings match the ids the site renderer emits. TOC links must
 * match the renderer's actual fragment ids; any other slug rule would silently break them.
 */
import { analyzeContent as analyzeWithSlugify, type AnalyzeContentOptional, type AnalyzeContentRequired, type ContentAnalysisReport } from "./analyze-content.js";
import { toSlug } from "../../html/site/slug.js";

/** Scores one piece of content with the renderer's slug rule; see `analyzeContent`. */
export function analyzeContentWithSiteSlug(required: Omit<AnalyzeContentRequired, "slugify">, optional: AnalyzeContentOptional = {}): ContentAnalysisReport {
  return analyzeWithSlugify({ ...required, slugify: toSlug }, optional);
}
