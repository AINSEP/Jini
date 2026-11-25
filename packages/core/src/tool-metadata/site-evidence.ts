import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** site-evidence registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {

  "site_collect_page_evidence": {
    search: {
      keywords: "evidence audit check compliance verify rendered really does prove tracking consent",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
