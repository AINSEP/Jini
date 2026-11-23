import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** database registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  // --- backup / recovery -------------------------------------------------------------------
  "backup_create_restore_point": {
    search: {
      keywords: "snapshot snapshots backup backups checkpoint save point restore safety before break",
      queries: [
        "Can you create a manual backup point right now?",
        "I want a new restore point outside of any migration.",
        "Does creating a backup point require me to acknowledge a cost first?",
        "Can you snapshot the database state as it is now?",
        "How do I make a fresh restore point on demand?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // Deliberately UNWIRED (never agent-callable — see file headers); entries added for consistency,
    // same reasoning as backup_execute_restore above.
  "database_execute_migrate_forward": {
    title: 'Apply database changes',
    summary: 'This applies the planned database changes and may permanently change stored data.',
    search: {
      keywords: "database migration migrate run execute apply confirm confirmed upgrade schema forward proceed go ahead",
    },
    approval: { class: 'delete', confirmation: 'plan' },
  },
  "database_get_health": {
    search: {
      keywords: "database health healthy status ok working check diagnose",
      queries: [
        "Is the database okay right now?",
        "Are we running low on disk space for the database?",
        "Is there a stuck or pending migration I should worry about?",
        "Can you check if the database is connected and healthy?",
        "Is anything wrong with the database at the moment?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "database_get_schema_state": {
    search: {
      keywords: "database schema tables structure state",
      queries: [
        "Is our database schema out of sync with what it should be?",
        "Has the database schema drifted from the expected version?",
        "Is the database ahead or behind on schema changes?",
        "Can you check if our schema matches the saved snapshot?",
        "Do we need to run a migration to fix schema drift?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "database_list_pending_migrations": {
    search: {
      keywords: "database migration migrations pending upgrade schema",
      queries: [
        "Are there any database migrations waiting to be applied?",
        "What updates haven't been run on the database yet?",
        "Can you show me the migrations that are queued but not done?",
        "Is there pending schema work I need to apply?",
        "What migrations are outstanding right now?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "database_list_restore_points": {
    search: {
      keywords: "backup snapshot history available recovery points",
      queries: [
        "Which database restore points are available?",
        "When was the last database backup point taken?",
        "Can you list all the snapshots I could roll back to?",
        "List database restore points with their triggers.",
        "Show me the database recovery points available.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "database_plan_migrate_forward": {
    search: {
      keywords: "database migration migrate upgrade schema preview plan dry run what would happen before",
      queries: [
        "What would happen if I ran the pending migrations right now?",
        "Can you preview the migration before actually running it?",
        "How much would it cost to migrate the schema forward?",
        "I want to see the plan for a forward migration without applying it.",
        "Can you dry-run the schema migration first?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "database_query_timeline": {
    search: {
      keywords: "database history log timeline events audit trail what happened ledger",
      queries: [
        "What's the history of migrations and restores on our database?",
        "Can you show me a timeline of everything that's happened to the database?",
        "Was there an interrupted migration recently?",
        "I want to see the past database snapshots in order.",
        "What database events happened most recently?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "database_get_restore_guidance": {
    search: {
      keywords: "database restore recover rollback revert snapshot earlier version how do i where do i go recovery guidance link help",
    },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
