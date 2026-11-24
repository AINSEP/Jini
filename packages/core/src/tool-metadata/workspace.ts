import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** workspace registration declarations; shared placement rationale lives in the host aggregator. */
export const toolMetadata = {
  "workspace_list": {
    search: { keywords: "workspace list available current site id name slug" },
    approval: { class: 'read', confirmation: 'direct' },
  },

  // --- workspace / settings ------------------------------------------------------------------------------
  "workspace_get": {
    search: {
      keywords: "site name title settings workspace details info about",
      queries: [
        "What's our workspace's name and id?",
        "Can you show me when this workspace was created?",
        "What's our current workspace slug?",
        "I want basic info about our own workspace.",
        "Do we have more than one workspace here?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "workspace_update": {
    search: {
      keywords: "site name title rename change workspace settings brand rename site site name rename my site",
      queries: [
        "Can you rename our workspace?",
        "How do I change the workspace's URL slug?",
        "Will renaming the workspace affect anything else?",
        "Can I update just the name and leave the slug alone?",
        "How do I change our site's workspace name?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // workspace_create and workspace_delete are deliberately UNWIRED (never agent-callable — creating
    // or deleting the single addressable workspace row would orphan or break every other domain's
    // boot-wired workspaceId — see file header). Entries added for consistency, same reasoning as
    // backup_execute_restore above.
  "workspace_create": {
    search: {
      keywords: "workspace site create new add",
    },
  },
  "workspace_delete": {
    search: {
      keywords: "workspace site delete remove destroy get rid of",
    },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
