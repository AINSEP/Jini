import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRecoveryAgentToolCatalog } from "../../recovery/agent-tools.js";

/**
 * @file Characterization pin for the recovery agent-tool catalog: names, permissions, side effects,
 * the destructive tool's actor-class rule and every input schema are deep-compared against a snapshot
 * recorded from the unsplit implementation.
 */
const recorded = JSON.parse(readFileSync(new URL("./fixtures/recovery-catalog.json", import.meta.url), "utf8")) as unknown;
const FIXTURE_SECRET = "sk-fixture-secret-0001";
const args = { backupWorkflowGuidance: "For repository backups, call repo_capabilities then repo_backup_push.", restorePointIdSource: "records_read.restore_point" };
const catalog = createRecoveryAgentToolCatalog(args, { resolveDeepLinkCitation: "SPEC-123" });

describe("createRecoveryAgentToolCatalog pin", () => {
  it("matches the recorded catalog, schemas included", () => {
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(recorded);
  });

  it("keeps the restore lever gated: only the destructive tool has the confirmer rule and a write permission", () => {
    expect(catalog.filter((tool) => tool.actorClassRule !== undefined).map((tool) => [tool.name, tool.actorClassRule])).toEqual([
      ["backup_execute_restore", "confirmer-must-equal-own-delegatedBy"],
    ]);
    expect(catalog.filter((tool) => tool.authorization.permission !== "backup.read").map((tool) => [tool.name, tool.authorization.permission])).toEqual([
      ["backup_execute_restore", "backup.restore"],
      ["backup_create_restore_point", "backup.create"],
    ]);
    expect(catalog.filter((tool) => tool.sideEffects === "none").every((tool) => tool.authorization.permission === "backup.read")).toBe(true);
  });

  it("cites the host specification id only when one is passed", () => {
    const deepLink = (citation?: string) => createRecoveryAgentToolCatalog(args, citation === undefined ? {} : { resolveDeepLinkCitation: citation })
      .find((tool) => tool.name === "recovery_resolve_deep_link")!.description;
    expect(deepLink("SPEC-123")).toContain("deep-link envelope server-side (SPEC-123): looks up");
    expect(deepLink()).toContain("deep-link envelope server-side: looks up");
  });

  it("never emits a credential value or a secret-bearing input property", () => {
    const secretCatalog = createRecoveryAgentToolCatalog({ ...args, restorePointIdSource: "records_read.restore_point" });
    expect(JSON.stringify(secretCatalog)).not.toContain(FIXTURE_SECRET);
    expect(JSON.stringify(catalog)).not.toMatch(/"(password|secret|token|apiKey|accessToken)"/i);
  });
});
