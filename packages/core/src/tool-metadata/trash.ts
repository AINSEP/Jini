import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** trash registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "trash_item": {
    search: {
      keywords: "delete remove get rid of menu menus submission submissions form entry entries spam navigation nav header footer delete menu remove menu delete menus remove menus",
      queries: [
        "How do I delete a navigation menu from the footer?",
        "Can you remove the old menu in the header?",
        "I want to delete a menu by moving it to the Trash so I can restore it later.",
      ],
    },
    approval: { class: 'trash', confirmation: 'policy' },
  },
  "trash_list_items": {
    search: {
      keywords: "whats what's trash bin recycle deleted items recently deleted show list empty trash permanently delete purge",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "trash_restore_item": {
    search: {
      keywords: "recover undelete restore deleted bring back get back undo delete removed page post image",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
