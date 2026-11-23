import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** content-duplication registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  // Resource nouns (form/page/post) let requests such as "copy that form" find this generic verb.
  "content_duplicate": {
    search: {
      keywords: "copy duplicate clone replicate reuse make a copy of this page make a copy of this post " +
        "copy this form duplicate a form copy a page copy a post copy this image copy a media asset " +
        "duplicate an image reuse this picture same image different alt text " +
        "same content new name new title starting point template based on existing existing page existing post existing form existing media",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
