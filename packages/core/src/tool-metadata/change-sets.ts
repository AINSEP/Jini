import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** change-sets registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  // Undo for post/page edits and deletes (F7b option A, S6).
  "change_sets_list": {
    search: {
      keywords: "change set history recent edits undo list revert log",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "change_sets_revert": {
    title: 'Restore the previous content',
    summary: 'This replaces the current content with the selected earlier version.',
    search: {
      keywords: "change set undo revert restore rollback previous version post page edit",
    },
    approval: { class: 'restore-over-existing', confirmation: 'policy' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
