import { describe, expect, it } from "vitest";
import { createRecoveryAgentToolCatalog } from "../../recovery/agent-tools.js";

const GUIDANCE = "For repository backups, call repo_capabilities then repo_backup_push. Exports live under Settings → Export.";
const SOURCE = "records_read.restore_point";
const EXPECTED = [
  ["backup_list_restore_points", "backup.read", "none"],
  ["backup_get_capabilities", "backup.read", "none"],
  ["backup_plan_restore", "backup.read", "none"],
  ["backup_execute_restore", "backup.restore", "mutates-durable-state"],
  ["backup_create_restore_point", "backup.create", "mutates-durable-state"],
  ["recovery_get_status", "backup.read", "none"],
  ["recovery_resolve_deep_link", "backup.read", "none"],
];

describe("createRecoveryAgentToolCatalog", () => {
  const catalog = createRecoveryAgentToolCatalog({ backupWorkflowGuidance: GUIDANCE, restorePointIdSource: SOURCE });

  it("keeps ids, permissions, side effects and order fixed by the engine", () => {
    expect(catalog.map((t) => [t.name, t.authorization.permission, t.sideEffects])).toEqual(EXPECTED);
    expect(catalog.some((t) => t.name === "backup_confirm_restore")).toBe(false);
    expect(catalog.find((t) => t.name === "backup_execute_restore")?.actorClassRule).toBe("confirmer-must-equal-own-delegatedBy");
  });

  it("names the host-injected backup workflow in backup_get_capabilities", () => {
    expect(catalog.find((t) => t.name === "backup_get_capabilities")?.description).toBe(
      `Reports this site's restore-point cost class and mechanism kind. ${GUIDANCE} Rendered static output commits are a separate publishing workflow.`,
    );
  });

  it("names the host-injected restore point source in both restore schemas", () => {
    for (const name of ["backup_plan_restore", "backup_execute_restore"]) {
      expect(catalog.find((t) => t.name === name)?.inputSchema).toEqual({
        type: "object", additionalProperties: false, required: ["restorePointId"],
        properties: { restorePointId: { type: "string", minLength: 1, description: `A restore point id, as returned by ${SOURCE}.` } },
      });
    }
  });

  it("only the execute tool may mention confirmation", () => {
    expect(catalog.filter((t) => /confirm/i.test(t.description)).map((t) => t.name)).toEqual(["backup_execute_restore"]);
  });
});
