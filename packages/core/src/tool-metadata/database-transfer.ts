import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** database-transfer registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  // --- database ------------------------------------------------------------------------------------
  "database_transfer_plan": {
    search: {
      keywords: "transfer move copy migrate export my data database sqlite to postgres postgresql another database server",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "database_transfer_run": {
    title: 'Transfer this database',
    summary: 'This transfers the selected database and may replace data at the destination.',
    search: {
      keywords: "transfer move copy migrate export data database postgres postgresql confirm copy run",
    },
    approval: { class: 'restore-over-existing', confirmation: 'plan' },
  },
  "database_transfer_set_destination": {
    search: {
      keywords: "transfer copy destination database address connection string postgres postgresql hosted database where to copy",
    },
    approval: { class: 'edit', confirmation: 'direct', input: 'human-form' },
    mcpUi: { secretField: { secret: true } },
  },
  "database_transfer_status": {
    search: {
      keywords: "transfer copy status last copy when copied database postgres postgresql",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
