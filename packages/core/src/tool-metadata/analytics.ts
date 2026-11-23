import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** analytics registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "analytics_list_recent_hits": {
    search: {
      keywords: "analytics traffic visitors visits views page views hits who visited popular pages referrers where from recent",
      queries: [
        "Show me recent traffic to my site.",
        "Which pages are getting visits in the recent buffer?",
        "Summarize recent page views by path and referrer.",
        "Where did recent visits come from, including Google search, and what devices were used?",
        "Who visited my site recently? Show anonymous hits, not identities.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
