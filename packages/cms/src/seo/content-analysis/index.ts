/** Pure SEO / readability scoring of one piece of content and its model-facing summary. Universal, no I/O. */
export * from "./analyze-content.js";
/** Deprecated re-export: import these from `@jini-ai/core/contracts/site/seo-content-analysis`; removed at the next major. */
export type { ContentBlock, HeadingLevel } from "@jini-ai/core/contracts/site/seo-content-analysis";
/** `analyzeContent` bound to the site renderer's slug rule, so TOC anchors match the heading ids it emits. */
export { analyzeContentWithSiteSlug } from "./site-analyze-content.js";
export { summarizeReport } from "./summary.js";
/** Pure TipTap/ProseMirror `bodyJson` -> `ContentBlock[]` conversion; never throws. */
export { tiptapToBlocks } from "./tiptap-blocks.js";
