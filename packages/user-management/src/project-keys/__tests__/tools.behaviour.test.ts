import { expect, test, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { DevRestartPort } from "@jini-ai/core/contracts/site/dev-supervisor-dev-restart";
import { toolMetadata } from "@jini-ai/core/tool-metadata/custom-credentials";
import { buildProjectKeyRegistrations, createProjectKeysCatalog, projectKeysRisk } from "../tools.js";
import type { ProjectKeysPort } from "../service.js";

const ctx: ToolExecutionContext = { executionId: "execution", principal: { id: "human" }, run: { id: "run" }, signal: new AbortController().signal, input: {} };
const copy = { unavailable: "keys unavailable", noArguments: "no arguments", revokeInput: "revoke only", ungranted: "ungranted", restartTitle: "Restart?", restartWarning: "It will blink.", restartLabel: "Restart now", restartUnavailable: "no supervisor", restartUnconfirmed: "not confirmed", restartAccepted: "restart accepted" };
type Approval = Parameters<Parameters<typeof buildProjectKeyRegistrations>[0]["host"]["approvalToolHandler"]>;

function build({ keys, restart = null }: { keys?: ProjectKeysPort; restart?: DevRestartPort | null }) {
  const approvals: Approval[] = [];
  const authorize = vi.fn(async (_input: { ctx: ToolExecutionContext; permission: string }) => undefined);
  const loadCards = vi.fn(async () => []);
  const registrations = buildProjectKeyRegistrations({ ...(keys ? { keys } : {}), authorize, loadCards, restart,
    surfaces: { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } },
    host: { metadata: toolMetadata, catalog: createProjectKeysCatalog({ readPermission: "read", restartPermission: "restart", descriptions: { list: "L", use: "U", restart: "R" } }),
      catalogModule: "host/catalog", readPermission: "read", restartPermission: "restart", restartReason: "provider-settings-live-apply",
      approvalToolHandler: (...args: Approval) => { approvals.push(args); return async () => "card"; }, copy } });
  const handler = (id: string) => { const found = registrations.find(row => row.descriptor.id === id); if (!found) throw new Error(`missing ${id}`); return found.handler; };
  const approval = () => { const first = approvals[0]; if (!first) throw new Error("no approval"); return first; };
  return { handler, approval, authorize, loadCards };
}
const port = (over: Partial<ProjectKeysPort> = {}): ProjectKeysPort => ({ list: vi.fn(), listChoices: vi.fn(), permissionFor: vi.fn().mockResolvedValue("kind-write"), savedResult: vi.fn(),
  listGranted: vi.fn().mockResolvedValue([{ keyId: "k1", name: "K", kind: "vendor", usedBy: ["Other"], usedByThisSite: true }]),
  use: vi.fn().mockResolvedValue({ keyId: "k1", usedByThisSite: false, usedBy: ["Other"], appliesAt: "now", message: "revoked" }), ...over });

test("the catalog declares the three tools with their permissions and the revoke-only input", () => {
  const catalog = createProjectKeysCatalog({ readPermission: "read", restartPermission: "restart", descriptions: { list: "L", use: "U", restart: "R" } });
  expect(catalog.map(tool => [tool.name, tool.description, tool.authorization?.permission, tool.sideEffects])).toEqual([
    ["project_keys_list", "L", "read", "none"], ["project_key_use", "U", "resolved-per-kind", "mutates-durable-state"], ["site_restart", "R", "restart", "mutates-durable-state"]]);
  expect(catalog[1]?.inputSchema).toMatchObject({ required: ["keyId", "use"], properties: { use: { const: false } } });
  expect([...projectKeysRisk]).toEqual(catalog.map(tool => [tool.name, tool.sideEffects]));
});

test("project_keys_list authorizes the read permission and lists granted keys with the loaded cards", async () => {
  const keys = port();
  const { handler, authorize, loadCards } = build({ keys });
  expect(await handler("project_keys_list")({ ...ctx, input: undefined })).toEqual({ keys: await keys.listGranted({}) });
  expect(authorize).toHaveBeenCalledWith({ ctx: { ...ctx, input: undefined }, permission: "read" });
  expect(loadCards).toHaveBeenCalledTimes(1);
  expect(keys.listGranted).toHaveBeenCalledWith({ cards: [] });
  await expect(handler("project_keys_list")({ ...ctx, input: { extra: 1 } })).rejects.toThrow("no arguments");
  expect(authorize).toHaveBeenCalledTimes(1);
});

test("tools refuse with the unavailable copy when no project keys port exists", async () => {
  const { handler } = build({});
  await expect(handler("project_keys_list")(ctx)).rejects.toThrow("keys unavailable");
  await expect(handler("project_key_use")({ ...ctx, input: { keyId: "k1", use: false } })).rejects.toThrow("keys unavailable");
});

test("project_key_use rejects every malformed input before authorizing", async () => {
  const keys = port();
  const { handler, authorize } = build({ keys });
  for (const input of [{ keyId: "k1", use: false, extra: 1 }, { keyId: 5, use: false }, { keyId: "", use: false }, { keyId: "k1" }]) {
    await expect(handler("project_key_use")({ ...ctx, input })).rejects.toThrow("revoke only");
  }
  expect(authorize).not.toHaveBeenCalled();
});

test("project_key_use revokes a granted key and hides which other sites use it", async () => {
  const keys = port();
  const { handler, authorize } = build({ keys });
  expect(await handler("project_key_use")({ ...ctx, input: { keyId: "k1", use: false } })).toEqual({ keyId: "k1", usedByThisSite: false, usedBy: [], appliesAt: "now", message: "revoked" });
  expect(keys.permissionFor).toHaveBeenCalledWith({ keyId: "k1" });
  expect(authorize.mock.calls.map(([input]) => input.permission)).toEqual(["read", "kind-write"]);
  expect(keys.use).toHaveBeenCalledWith({ keyId: "k1", use: false });
});

test("project_key_use stops before revoking when the call was aborted", async () => {
  const keys = port();
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(build({ keys }).handler("project_key_use")({ ...ctx, signal: controller.signal, input: { keyId: "k1", use: false } })).rejects.toThrow("cancelled");
  expect(keys.use).not.toHaveBeenCalled();
});

test("site_restart prepares with the restart permission and describes a confirm card", async () => {
  const restart: DevRestartPort = { requestRestart: vi.fn() };
  const { approval, authorize } = build({ keys: port(), restart });
  const [required, optional] = approval();
  expect(await required.prepare({ ctx })).toEqual({ restart });
  expect(authorize).toHaveBeenCalledWith({ ctx, permission: "restart" });
  await expect(required.prepare({ ctx: { ...ctx, input: { now: true } } })).rejects.toThrow("no arguments");
  expect(required.describe({ ctx, prepared: { restart } })).toEqual({ toolId: "site_restart", errorCode: "SITE_RESTART", title: "Restart?", warning: "It will blink.", details: [], confirmLabel: "Restart now" });
  expect(optional.ask({ prepared: { restart } })).toBe(true);
  expect(optional.ask({ prepared: { restart: null } })).toBe(false);
  expect(optional.declined({ reason: "owner said no" })).toEqual({ restarted: false, reason: "owner said no" });
});

test("site_restart run maps every supervisor decision to its result", async () => {
  const { approval, authorize } = build({ keys: port() });
  const [{ run }] = approval();
  const executionOptions = {};
  expect(await run({ ctx, prepared: { restart: null }, executionOptions })).toEqual({ restarted: false, message: "no supervisor" });
  expect(authorize).not.toHaveBeenCalled();
  const requestRestart = vi.fn();
  const restart: DevRestartPort = { requestRestart };
  requestRestart.mockResolvedValueOnce(undefined);
  expect(await run({ ctx, prepared: { restart }, executionOptions })).toEqual({ restarted: false, reason: "not confirmed" });
  requestRestart.mockResolvedValueOnce({ accepted: false, reason: "site override pinned" });
  expect(await run({ ctx, prepared: { restart }, executionOptions })).toEqual({ restarted: false, reason: "site override pinned" });
  requestRestart.mockResolvedValueOnce({ accepted: true });
  expect(await run({ ctx, prepared: { restart }, executionOptions })).toEqual({ restartRequested: true, message: "restart accepted" });
  expect(requestRestart).toHaveBeenCalledWith({ reason: "provider-settings-live-apply" }, { awaitAcceptance: true });
  expect(authorize).toHaveBeenCalledTimes(3);
  expect(authorize).toHaveBeenCalledWith({ ctx, permission: "restart" });
});

test("site_restart run re-checks abort before restarting", async () => {
  const { approval } = build({ keys: port() });
  const [{ run }] = approval();
  const requestRestart = vi.fn();
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(run({ ctx: { ...ctx, signal: controller.signal }, prepared: { restart: { requestRestart } }, executionOptions: {} })).rejects.toThrow("cancelled");
  expect(requestRestart).not.toHaveBeenCalled();
});
