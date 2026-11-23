import assert from "node:assert/strict";
import { test } from "vitest";

import type { DuplicateResourceHandler, DuplicateResourceHandlerContributor } from "../contracts/site/assistant-tool-contributions.js";
import type { FrontendSessionOwner, ToolAccessChange } from "../contracts/site/daemon.js";
import type { DataModuleDecl } from "../contracts/site/db-data-modules.js";
import type { PluginActivationRecord, PluginConflict, ProviderWriteResult } from "../contracts/site/plugins-host.js";

/**
 * @file Type fixture for the host-neutral contracts copied into core by K4-seam-10. `pnpm typecheck`
 * compiles this file, so renaming or retyping a field these fixtures set fails here. The runtime
 * asserts only check each fixture keeps the values it was built with.
 */

const owner: FrontendSessionOwner = { workspaceId: "w1", principalId: "p1", tabId: "t1" };
const change: ToolAccessChange = { agentIds: ["a1"], serverIds: ["s1"], pluginIds: ["x1"] };
const decl: DataModuleDecl = {
  pluginId: "demo",
  pluginTier: "tier-2",
  provenance: { sourceUrl: "builtin://demo", publisher: "host" },
  tables: [{ name: "rows", columns: [{ name: "id", type: "TEXT", primaryKey: true }], indexes: [{ name: "byid", columns: ["id"], unique: true }] }],
};
const activation: PluginActivationRecord = { pluginId: "demo", workspaceId: "w1", version: "1.0.0", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z" };
const conflict: PluginConflict = { kind: "tool", key: "k", heldBy: "other", heldByName: "Other", heldKey: "k2" };
const written: ProviderWriteResult = { keyId: "key1", store: "site", usedByThisSite: true, usedBy: [] };
const handler: DuplicateResourceHandler = { permission: "content.write", duplicate: async ({ id }) => ({ id }) };
const contributor: DuplicateResourceHandlerContributor<{ readonly tag: string }> = { resource: "post", build: () => handler };

test("K4-seam-10 contracts keep the fields their fixtures set", async () => {
  assert.equal(owner.tabId, "t1");
  assert.deepEqual(change.pluginIds, ["x1"]);
  assert.equal(decl.tables[0]?.columns[0]?.type, "TEXT");
  assert.equal(activation.enabled, true);
  assert.equal(conflict.heldByName, "Other");
  assert.equal(written.keyId, "key1");
  const built = contributor.build({ tag: "deps" });
  assert.equal(built.permission, "content.write");
  assert.deepEqual(await built.duplicate({ principalId: "p1", id: "e1", overrides: {} }), { id: "e1" });
});
