import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** site-search registration declarations; shared placement rationale is in the host aggregator.
 * The two writes are `plan`: their own handler asks the human (`server/runtime/composition/site-search-tools.ts`),
 * so the session gate must not ask a second time, and the click must be admitted on the MCP-UI route.
 * `publish`: a reindex or switch writes every public document to a provider that may be a hosted vendor. */
export const toolMetadata = {
  search_query: {
    search: {
      keywords: "search find site content posts pages full text query results lookup",
      queries: ["Search my site for posts about pricing.", "Which pages mention our refund policy?", "Find published content matching a phrase."],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  search_status: {
    search: {
      keywords: "search index status health provider indexed pending failed backend builtin",
      queries: ["Is site search working?", "Which search provider does my site use?", "How many documents are indexed?"],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  search_reindex: {
    title: 'Rebuild the search index',
    summary: 'This sends site content to the configured search provider to rebuild its index.',
    search: { keywords: "search reindex rebuild refresh index full backfill" },
    approval: { class: 'publish', confirmation: 'plan' },
  },
  search_set_provider: {
    title: 'Change the search provider',
    summary: 'This changes the search service and may send site content to that service.',
    search: { keywords: "search provider switch change backend builtin engine" },
    approval: { class: 'publish', confirmation: 'plan' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
