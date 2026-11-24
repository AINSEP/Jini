import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** web-screenshot registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  // A credential-free page render with no durable effect: classified 'read' like web_fetch_page.
  // FTS unicode61 does not stem, so singular/plural and verb forms are listed separately.
  "web_screenshot_page": {
    search: {
      keywords: "screenshot screenshots screen capture captures snapshot picture image see look looks looking like view visual visually appearance layout design style styling render rendered rendering page pages webpage website websites site url link compare comparison parity side-by-side match matches mobile tablet desktop responsive viewport existing competitor reference import copy",
      queries: [
        "Screenshot a web page.",
        "See how a page looks.",
        "Take a screenshot of this website.",
        "What does this site look like?",
        "What does the website look like on a mobile screen?",
        "How does our site look on desktop?",
        "Compare our page to the original site visually.",
        "Check visual parity with the site we are importing.",
        "Show me the mobile view of this URL.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
