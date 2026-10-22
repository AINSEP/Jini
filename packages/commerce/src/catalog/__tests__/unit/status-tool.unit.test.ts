import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyTool } from "@jini-ai/core";
import { ForbiddenError } from "@jini-ai/cms/core";
import { buildRegistrations } from "../../../tools.js";
const ws = "n07-workspace";
function auth(allow = true) {
  const checks: unknown[] = [];
  return { checks, deps: { workspaceId: ws, authorize: async (request: unknown) => {
    checks.push(request);
    return allow ? { allowed: true, reason: "matched" } : { allowed: false, reason: "insufficient_permission" };
  } } };
}
async function registration(_id: string, deps: Parameters<typeof buildRegistrations>[0]) {
  return buildRegistrations(deps)[0]!;
}
function call(r: ReturnType<typeof buildRegistrations>[number]) {
  return r.handler({ executionId: "n07-exec", principal: { id: "operator" }, run: { id: "n07-run" }, input: {}, signal: new AbortController().signal });
}
test("commerce status tool remains read-only", () => {
  const r = buildRegistrations(auth().deps)[0]!;
  assert.equal(isReadOnlyTool({ descriptor: r.descriptor }), true);
  assert.equal(r.descriptor.id, "commerce_get_status");
  assert.equal(r.descriptor.requiresConfirmation ?? false, false);
});
test("commerce status tool refuses before entering provider code", async () => {
  const a = auth(false);
  const r = buildRegistrations({ ...a.deps, lipay: { listProviders: () => { assert.fail("denied reads must not enter the provider"); } } })[0]!;
  await assert.rejects(call(r), error => {
    assert.ok(error instanceof ForbiddenError);
    assert.equal(error.message, "principal 'operator' is not authorized for 'admin.integrations.manage' (insufficient_permission)");
    return true;
  });
  assert.deepEqual(a.checks, [{ principalId: "operator", permission: "admin.integrations.manage", workspaceId: ws, entityType: "integration" }]);
});
test("commerce status: truthful absence; available runtime only enables provider discovery", async () => {
  const deps = { ...auth().deps } as any;
  const r = await registration("commerce_get_status", deps);
  const result = await call(r) as any;
  assert.deepEqual(Object.keys(result).sort(), ["capabilities", "configuration", "contractVersion", "paymentRuntime", "providers", "workspaceId"]);
  assert.deepEqual(result.paymentRuntime, { status: "unavailable", reason: "No payment runtime is composed for this workspace." });
  assert.deepEqual(result.providers, []);
  deps.lipay = { listProviders: () => [] };
  const available = await call(r) as any;
  assert.deepEqual(available.paymentRuntime, { status: "available", reason: null });
  assert.deepEqual(available.capabilities, { providerDiscovery: "available", checkout: "unavailable", subscriptions: "unavailable", webhookReconciliation: "unavailable", revenue: "unavailable" });
});

