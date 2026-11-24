import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** server-logs registration declarations; shared placement rationale is in ./index.ts.
 * Now: that rationale lives in the host aggregator. */
export const toolMetadata = {
  "system_read_server_logs": {
    search: {
      keywords: "server errors logs console crash crashed exception stack trace warnings what went wrong failed broken debug terminal output 500",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
