import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolGapReadPort, ToolGapsToolDeps } from "../contracts/site/assistant-host-ports.js";
import type { BootModuleResult, ModuleLifecycleStatus } from "../contracts/site/lifecycle-boot-lifecycle.js";
import type { SiteServeStatus, SiteStatusPort } from "../contracts/site/recovery-reconcile-interrupted-migration.js";
import type { SandboxRenderResult } from "../contracts/site/sandbox-node-worker.js";

/**
 * @file Type fixture for the contracts copied into core by K4-seam-23. `pnpm typecheck` compiles
 * this file, so renaming or retyping a field these fixtures set fails here. The runtime asserts
 * only check each fixture keeps the values it was built with.
 */

const toolGaps: ToolGapReadPort = { list: async () => [] };
const deps: ToolGapsToolDeps = { ownerPrincipalId: Promise.resolve("owner"), workspaceId: "w1", toolGaps };
const disabled: ModuleLifecycleStatus = { status: "disabled", reasonCode: "OFF", remediationHint: "enable it" };
const result: BootModuleResult = { name: "search", owner: "host", criticality: "optional", lifecycle: disabled };
const rendered: SandboxRenderResult = { ok: true, html: "<p>hi</p>" };
const refused: SandboxRenderResult = { ok: false, error: "timeout" };
const statuses = new Map<string, SiteServeStatus>();
const siteStatus: SiteStatusPort = {
  get: async (siteId) => statuses.get(siteId) ?? "SERVING",
  set: async (siteId, status) => { statuses.set(siteId, status); },
};

test("K4-seam-23 contracts keep the fields their fixtures set", async () => {
  assert.equal(deps.workspaceId, "w1");
  assert.equal(await deps.ownerPrincipalId, "owner");
  assert.deepEqual(await deps.toolGaps?.list({ workspaceId: "w1", principalId: "p1" }), []);
  assert.equal(result.criticality, "optional");
  assert.equal(result.lifecycle.status, "disabled");
  assert.equal(rendered.ok && rendered.html, "<p>hi</p>");
  assert.equal(!refused.ok && refused.error, "timeout");
  await siteStatus.set("s1", "BLOCKED_PENDING_RECOVERY");
  assert.equal(await siteStatus.get("s1"), "BLOCKED_PENDING_RECOVERY");
  assert.equal(await siteStatus.get("s2"), "SERVING");
});
