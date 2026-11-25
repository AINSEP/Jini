import { expect, test, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { toolMetadata } from "@jini-ai/core/tool-metadata/custom-credentials";
import { buildProjectKeyRegistrations, createProjectKeysCatalog } from "../tools.js";
import type { ProjectKeysPort } from "../service.js";

const ctx: ToolExecutionContext = { executionId: "execution", principal: { id: "human" }, run: { id: "run" }, signal: new AbortController().signal, input: {} };

test("ungranted key cannot be revoked or disclosed", async () => {
  const keys: ProjectKeysPort = { list: vi.fn(), listChoices: vi.fn(), listGranted: vi.fn().mockResolvedValue([]), permissionFor: vi.fn(), use: vi.fn(), savedResult: vi.fn() };
  const authorize = vi.fn();
  const host = {
    metadata: toolMetadata, catalog: createProjectKeysCatalog({ readPermission: "read", restartPermission: "restart", descriptions: { list: "list", use: "use", restart: "restart" } }),
    catalogModule: "host/catalog", readPermission: "read", restartPermission: "restart", restartReason: "provider-settings-live-apply" as const,
    approvalToolHandler: vi.fn(() => async () => undefined),
    copy: { unavailable: "unavailable", noArguments: "no arguments", revokeInput: "revoke", ungranted: "ungranted", restartTitle: "restart", restartWarning: "warning", restartLabel: "restart", restartUnavailable: "unavailable", restartUnconfirmed: "unconfirmed", restartAccepted: "accepted" },
  };
  const registrations = buildProjectKeyRegistrations({ keys, authorize, loadCards: async () => [], surfaces: { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } }, restart: null, host });
  const revoke = registrations.find(row => row.descriptor.id === "project_key_use");
  if (!revoke) throw new Error("missing revoke");
  await expect(revoke.handler({ ...ctx, input: { keyId: "private", use: false } })).rejects.toThrow("ungranted");
  expect(keys.permissionFor).not.toHaveBeenCalled();
  expect(keys.use).not.toHaveBeenCalled();
  expect(keys.list).not.toHaveBeenCalled();
});

test("use:true is refused before authorize and never reaches keys.use", async () => {
  const keys: ProjectKeysPort = { list: vi.fn(), listChoices: vi.fn(), listGranted: vi.fn(), permissionFor: vi.fn(), use: vi.fn(), savedResult: vi.fn() };
  const authorize = vi.fn();
  const registrations = buildProjectKeyRegistrations({ keys, authorize, loadCards: async () => [], surfaces: { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } }, restart: null,
    host: { metadata: toolMetadata, catalog: createProjectKeysCatalog({ readPermission: "read", restartPermission: "restart", descriptions: { list: "list", use: "use", restart: "restart" } }), catalogModule: "host/catalog", readPermission: "read", restartPermission: "restart", restartReason: "provider-settings-live-apply", approvalToolHandler: vi.fn(() => async () => undefined),
      copy: { unavailable: "unavailable", noArguments: "no arguments", revokeInput: "revoke", ungranted: "ungranted", restartTitle: "restart", restartWarning: "warning", restartLabel: "restart", restartUnavailable: "unavailable", restartUnconfirmed: "unconfirmed", restartAccepted: "accepted" } },
  });
  const revoke = registrations.find(row => row.descriptor.id === "project_key_use");
  if (!revoke) throw new Error("missing revoke");
  await expect(revoke.handler({ ...ctx, input: { keyId: "key", use: true } })).rejects.toThrow("revoke");
  expect(authorize).not.toHaveBeenCalled();
  expect(keys.use).not.toHaveBeenCalled();
});

test("the per-kind permission is checked after the granted lookup", async () => {
  const calls: string[] = [];
  const keys: ProjectKeysPort = { list: vi.fn(), listChoices: vi.fn(), listGranted: async () => { calls.push("granted"); return [{ keyId: "key", name: "key", kind: "vendor", usedBy: [], usedByThisSite: true }]; }, permissionFor: async () => { calls.push("kind"); return "kind-write"; }, use: vi.fn(), savedResult: vi.fn() };
  const authorize = vi.fn(async ({ permission }: { permission: string }) => { calls.push(permission); if (permission === "kind-write") throw new Error("denied"); });
  const registrations = buildProjectKeyRegistrations({ keys, authorize, loadCards: async () => [], surfaces: { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } }, restart: null,
    host: { metadata: toolMetadata, catalog: createProjectKeysCatalog({ readPermission: "read", restartPermission: "restart", descriptions: { list: "list", use: "use", restart: "restart" } }), catalogModule: "host/catalog", readPermission: "read", restartPermission: "restart", restartReason: "provider-settings-live-apply", approvalToolHandler: vi.fn(() => async () => undefined),
      copy: { unavailable: "unavailable", noArguments: "no arguments", revokeInput: "revoke", ungranted: "ungranted", restartTitle: "restart", restartWarning: "warning", restartLabel: "restart", restartUnavailable: "unavailable", restartUnconfirmed: "unconfirmed", restartAccepted: "accepted" } },
  });
  const revoke = registrations.find(row => row.descriptor.id === "project_key_use");
  if (!revoke) throw new Error("missing revoke");
  await expect(revoke.handler({ ...ctx, input: { keyId: "key", use: false } })).rejects.toThrow("denied");
  expect(calls).toEqual(["read", "granted", "kind", "kind-write"]);
  expect(keys.use).not.toHaveBeenCalled();
});
