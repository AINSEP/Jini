/** Pure SEO / readability scoring of one piece of content and its model-facing summary. Universal, no I/O. */
export * from "./analyze-content.js";
/** Deprecated re-export: import these from `@jini-ai/core/contracts/site/seo-content-analysis`; removed at the next major. */
export type { ContentBlock, HeadingLevel } from "@jini-ai/core/contracts/site/seo-content-analysis";
export { summarizeReport } from "./summary.js";
/** Pure TipTap/ProseMirror `bodyJson` -> `ContentBlock[]` conversion; never throws. */
export { tiptapToBlocks } from "./tiptap-blocks.js";
