import { defaultDbMessages, type DbMessages } from "../core/messages.js";

/**
 * @file Site wording for the `@jini-ai/db/tools` database tools. The package defaults speak of "the
 * source"; a host that serves one site has its tools say "this site", and their descriptions are the
 * bytes the host's descriptor snapshot pins from the pre-extraction catalog. The transfer tools' copy
 * lives in `site-transfer-messages.ts`. Specification references (requirement or decision ids) are
 * not part of this profile: a host that cites its own documents in this copy overrides those fields.
 */
export const SITE_DATABASE_MESSAGES: DbMessages = {
  ...defaultDbMessages,
  restorePointUnavailable: "no restore-point mechanism is available for this site; the in-product migrate is refused with no attestation override",
  restorePointCostAck: "Explicit cost acknowledgment. Required (must be true) only when this site's restore-point cost class is 'expensive'; ignored when 'cheap'. The call is refused with no override at all when cost class is 'unavailable' (no attestation override).",
  databaseHealth: "Reports a summary of this site's database health (connectivity, disk headroom, pending-migration/interrupted-migration state).",
  databaseSchemaState: "Reports this site's schema drift status (in-sync/ahead/diverged/behind) between its persisted schema snapshot and the runtime's current schema.",
  databasePendingMigrations: "Lists migrations pending against this site that have not yet been applied.",
  databaseRestorePoints: "Lists every restore point recorded for this site, newest first, with its trigger, cost class, and capture time.",
  databasePlanMigrate: "Previews what forward-migrating this site's schema would do — cost class and a plan hash — without applying anything.",
  databaseExecuteMigrate: "Moves this site's database forward to the current schema. Shows the user a confirm dialog first and only runs if they " +
    "confirm. A restore point is taken first. Call database_plan_migrate_forward first to see the cost class.",
  databaseCreateRestorePoint: "Mints a new restore point for this site independent of any migration, subject to the site's cost-acknowledgment rule.",
  databaseRestoreGuidance: "Returns a deep-link routing envelope pointing at the Recovery surface for restoring this site to an earlier snapshot. Never itself a restore lever.",
};
