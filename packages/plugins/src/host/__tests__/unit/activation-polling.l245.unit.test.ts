// Moved from the host composition tests with the polling module; assertions unchanged (node:assert under vitest).
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { PluginActivationRecord } from "@jini-ai/core/contracts/site/plugins-host";
import { reconcilePluginActivationsOnce, type PluginActivationPollDeps } from "../../activation-polling.js";

function row(required: { id: string; version?: string; enabled?: boolean; workspaceId?: string }, _optional: Record<string, never> = {}): PluginActivationRecord {
  return { pluginId: required.id, version: required.version ?? "2", enabled: required.enabled ?? true,
    workspaceId: required.workspaceId ?? "site", updatedAt: "2026-10-20T00:00:00Z" };
}

test("L245: reconciliation filters rows, retains attachment order, reloads changed or unknown versions and detaches stale IDs", async () => {
  const calls: string[] = [];
  const attached = new Set(["same", "changed", "unknown", "disabled", "foreign", "removed"]);
  const deps: PluginActivationPollDeps = {
    workspaceId: "site",
    pluginActivationRepo: { listAll: async () => [row({ id: "same" }), row({ id: "changed" }), row({ id: "unknown" }),
      row({ id: "new" }), row({ id: "disabled", enabled: false }), row({ id: "foreign", workspaceId: "elsewhere" })] },
    pluginLoadedVersion: ({ id }) => { calls.push(`version:${id}`); return new Map([["same", "2"], ["changed", "1"]]).get(id); },
    onPluginEnabled: async id => { calls.push(`enable:${id}`); },
    onPluginDisabled: id => { calls.push(`disable:${id}`); },
  };
  await reconcilePluginActivationsOnce({ deps, attachedIds: attached });
  assert.deepEqual(calls, ["version:same", "version:changed", "enable:changed", "version:unknown", "enable:unknown",
    "version:new", "enable:new", "disable:disabled", "disable:foreign", "disable:removed"]);
  assert.deepEqual([...attached], ["same", "changed", "unknown", "new"]);
});

test("L245: without a version reader attached IDs stay loaded; duplicate rows attach once", async () => {
  const calls: string[] = [];
  const attached = new Set(["attached"]);
  const deps: PluginActivationPollDeps = {
    workspaceId: "site", pluginActivationRepo: { listAll: async () => [row({ id: "attached" }), row({ id: "new", version: "1" }), row({ id: "new" })] },
    onPluginEnabled: async id => { calls.push(id); }, onPluginDisabled: () => assert.fail("nothing stale"),
  };
  await reconcilePluginActivationsOnce({ deps, attachedIds: attached });
  assert.deepEqual(calls, ["new"]);
  assert.deepEqual([...attached], ["attached", "new"]);
});

test("L245: duplicate enabled rows use the last version and ignore a later disabled row", async () => {
  const calls: string[] = [];
  await reconcilePluginActivationsOnce({ deps: {
    workspaceId: "site", pluginActivationRepo: { listAll: async () => [row({ id: "plugin", version: "1" }),
      row({ id: "plugin", version: "2" }), row({ id: "plugin", version: "3", enabled: false })] },
    pluginLoadedVersion: () => "2", onPluginEnabled: async id => { calls.push(id); },
    onPluginDisabled: () => assert.fail("the enabled row remains authoritative"),
  }, attachedIds: new Set(["plugin"]) });
  assert.deepEqual(calls, []);
});

test("L245: Error and non-Error attach failures are logged, preserve existing IDs, and allow later attaches and detaches", async ({ onTestFinished }) => {
  const warnings: unknown[][] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { warnings.push(args); });
  onTestFinished(() => warn.mockRestore());
  const attached = new Set(["broken", "stale"]);
  const calls: string[] = [];
  await reconcilePluginActivationsOnce({ deps: {
    workspaceId: "site", pluginActivationRepo: { listAll: async () => [row({ id: "broken" }), row({ id: "string-error" }), row({ id: "good" })] },
    pluginLoadedVersion: () => "1",
    onPluginEnabled: async id => {
      calls.push(id);
      if (id === "broken") throw new Error("missing package");
      if (id === "string-error") throw "not installed";
    },
    onPluginDisabled: id => { calls.push(`disable:${id}`); },
  }, attachedIds: attached });
  assert.deepEqual(warnings, [["[plugin-runtime] plugin activation poll failed to attach 'broken': missing package"],
    ["[plugin-runtime] plugin activation poll failed to attach 'string-error': not installed"]]);
  assert.deepEqual(calls, ["broken", "string-error", "good", "disable:stale"]);
  assert.deepEqual([...attached], ["broken", "good"]);
});

test("L245: repository and detach failures propagate without deleting the failed attachment", async () => {
  const failure = new Error("read failed");
  const attached = new Set(["stale"]);
  const deps: PluginActivationPollDeps = {
    workspaceId: "site", pluginActivationRepo: { listAll: async () => { throw failure; } },
    onPluginEnabled: async () => assert.fail("no attach"), onPluginDisabled: () => { throw failure; },
  };
  await assert.rejects(reconcilePluginActivationsOnce({ deps, attachedIds: attached }), error => error === failure);
  deps.pluginActivationRepo.listAll = async () => [];
  await assert.rejects(reconcilePluginActivationsOnce({ deps, attachedIds: attached }), error => error === failure);
  assert.deepEqual([...attached], ["stale"]);
});
