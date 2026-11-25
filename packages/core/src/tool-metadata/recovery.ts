import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** recovery registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  // Restore execution completes the human ceremony; it is deliberately not agent-callable.
  "backup_execute_restore": {
    title: 'Restore this site backup',
    summary: 'This replaces current site data with the selected backup.',
    search: {
      keywords: "restore rollback revert recover undo run execute confirm confirmed apply go back to an earlier version snapshot restore point actually do the restore",
    },
    approval: { class: 'restore-over-existing', confirmation: 'plan' },
  },
  "backup_get_capabilities": {
    search: {
      keywords: "backup snapshot restore support capability available",
      queries: [
        "How expensive would restoring from backup be for this site?",
        "What mechanism does our backup system use?",
        "What's the cost class for restore points on this site?",
        "Can you tell me what kind of restore capability we have?",
        "Before I restore anything, what would it cost?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "backup_list_restore_points": {
    search: {
      keywords: "snapshot snapshots backup backups checkpoint restore points list history",
      queries: [
        "What backup points do we have for this site?",
        "Can you list restore points newest first with what triggered them?",
        "How many restore points are there and what's their cost class?",
        "Show me all our site's snapshots.",
        "What restore points can I choose from?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "backup_plan_restore": {
    search: {
      keywords: "restore rollback revert recover undo snapshot backup",
      queries: [
        "If I restore to this point, what would actually change?",
        "Can you preview a restore before I commit to it?",
        "How much data would I lose if I restored to this backup point?",
        "What's the discarded-write window if I roll back to this restore point?",
        "Can you show me what a restore would do without actually doing it?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "recovery_get_status": {
    search: {
      keywords: "backup restore status health check migration in progress warning banner problem",
      queries: [
        "Is there anything wrong with our database recovery state right now?",
        "Is a migration currently stuck or interrupted?",
        "What's our current restore-point cost class?",
        "Is there an operation already in progress I should wait for?",
        "Are we missing a baseline watermark for recovery?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "recovery_resolve_deep_link": {
    search: {
      keywords: "restore point link verify check database timeline deep link envelope",
      queries: [
        "Is this restore-point link still valid, or was it faked?",
        "Can you double check this deep link actually points to a real restore point?",
        "Someone sent me a database timeline link, is it legit?",
        "How do I verify a restore point id from a link instead of trusting it blindly?",
        "Can you re-resolve this link server-side to make sure it's not stale?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
