import { describe, expect, it } from "vitest";
import { agentPluginSetEnabledRoute } from "../set-enabled.js";
import {
  BusyTestError, fakeCandidate, HostIncompatibleTestError, LinkedTestError, NotInstalledTestError, NotReadyTestError, PRINCIPAL, raw, recordingAuthorize,
  refusalOf, TEST_COPY, TEST_ERROR_PREDICATES, ToolAccessLoweringTestError, UnreadableTestError, UpdateTestError, WORKSPACE_ID,
} from "./helpers.js";

/** @file PATCH the Agent Plugin switch: validated boolean, installed-id check, enable-only provisioning, the host error ladder. */

function deps(log: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    loadCandidates: async () => { log.push("candidates"); return [fakeCandidate()]; },
    setEnabled: async (input: { pluginId: string; enabled: boolean; actor: string }) => { log.push(["set", input]); return { enabled: input.enabled, warnings: ["w1"] }; },
    provisionMcpServers: async (input: { pluginId: string; principalId: string }) => { log.push(["provision", input]); },
    notifyPluginLowered: async (input: { pluginId: string }) => { log.push(["lowered", input]); },
    isError: TEST_ERROR_PREDICATES,
    copy: TEST_COPY,
    diagnose: (facts: { pluginId: string; refusal: string; causeMessage: string }) => { log.push(["diagnose", facts]); },
    ...overrides,
  };
}
const run = (d: ReturnType<typeof deps>, enabled = true, authorize = recordingAuthorize().authorize) =>
  agentPluginSetEnabledRoute.handle({ input: { pluginId: "acme", enabled }, deps: d, context: PRINCIPAL, authorize });

describe("agentPluginSetEnabledRoute", () => {
  it("keeps the method and path and parses the id (with its `?? \"\"` fallback) and a real boolean", () => {
    expect(agentPluginSetEnabledRoute.method).toBe("patch");
    expect(agentPluginSetEnabledRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId");
    expect(agentPluginSetEnabledRoute.successStatus).toBeUndefined();
    expect(agentPluginSetEnabledRoute.maxBodyBytes).toBeUndefined();
    expect(agentPluginSetEnabledRoute.parse(raw({ pluginId: "acme" }, { enabled: false }))).toEqual({ ok: true, value: { pluginId: "acme", enabled: false } });
    expect(agentPluginSetEnabledRoute.parse(raw({}, { enabled: true }))).toEqual({ ok: true, value: { pluginId: "", enabled: true } });
  });

  it.each([["omitted", {}], ["a string", { enabled: "false" }], ["a number", { enabled: 0 }], ["no body", undefined]])("refuses `enabled` %s with the flat 400", async (_name, body) => {
    expect(await refusalOf(() => agentPluginSetEnabledRoute.parse(raw({ pluginId: "acme" }, body)))).toEqual({
      status: 400, body: { error: "'enabled' must be a boolean", code: "VALIDATION_ERROR" },
    });
  });

  it("authorizes admin.plugins.enable on that agent-plugin, then writes with the principal as actor and provisions on enable", async () => {
    const log: unknown[] = [];
    const { authorize, calls } = recordingAuthorize();
    const result = await run(deps(log), true, authorize);
    expect(calls).toEqual([{ permission: "admin.plugins.enable", entityType: "agent-plugin", entityId: "acme" }]);
    expect(log).toEqual(["candidates", ["set", { pluginId: "acme", enabled: true, actor: PRINCIPAL.id }], ["provision", { pluginId: "acme", principalId: PRINCIPAL.id }]]);
    expect(result).toEqual({ ok: true, value: { warnings: ["w1"], agentPlugin: {
      pluginId: "acme", id: "acme@1", provides: ["cap:a"], displayName: "Acme", summary: null, version: "1.0.0", description: null, keywords: ["k"], enabled: true,
      origin: "installed", hostOk: true, missingRequires: [], requiredBy: [], archiveDigest: "sha256:x", skills: [{ name: "s" }], mcpServerIds: ["m"],
    } } });
  });

  it("on disable announces the lowered plugin instead of provisioning; `enabled` and warnings come from the write", async () => {
    const log: unknown[] = [];
    const result = await run(deps(log, { setEnabled: async () => ({ enabled: false }) }), false);
    expect(log).toEqual(["candidates", ["lowered", { pluginId: "acme" }]]);
    expect(result.ok && result.value).toMatchObject({ warnings: [], agentPlugin: { enabled: false } });
  });

  it("refuses an id that is not installed with 404 and writes nothing", async () => {
    const log: unknown[] = [];
    expect(await refusalOf(() => agentPluginSetEnabledRoute.handle({ input: { pluginId: "ghost", enabled: true }, deps: deps(log), context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({
      status: 404, body: { error: "agent plugin 'ghost' is not installed in this workspace", code: "AGENT_PLUGIN_NOT_FOUND" },
    });
    expect(log).toEqual(["candidates"]);
  });

  it("reads and writes nothing when authorization refuses", async () => {
    const log: unknown[] = [];
    await expect(run(deps(log), true, recordingAuthorize(["admin.plugins.enable"]).authorize)).rejects.toThrow("denied admin.plugins.enable");
    expect(log).toEqual([]);
  });

  const LADDER: [string, Error, { status: number; body: unknown }, "activationsUnreadable" | "activationsBusy" | null][] = [
    ["tool-access lowering", new ToolAccessLoweringTestError("lowering", "TOOL_ACCESS_LOWERING"), { status: 503, body: { error: "lowering", code: "TOOL_ACCESS_LOWERING" } }, null],
    ["host incompatible", new HostIncompatibleTestError("not this host", "PLUGIN_HOST_INCOMPATIBLE"), { status: 409, body: { code: "PLUGIN_HOST_INCOMPATIBLE", error: "not this host" } }, null],
    ["update pending", new UpdateTestError("pending", "PLUGIN_UPDATE_PENDING"), { status: 409, body: { code: "PLUGIN_UPDATE_PENDING", error: "pending" } }, null],
    ["not ready", new NotReadyTestError("soon", "AGENT_PLUGIN_NOT_READY"), { status: 409, body: { code: "AGENT_PLUGIN_NOT_READY", error: "soon" } }, null],
    ["linked", new LinkedTestError("follows acme", "AGENT_PLUGIN_LINKED", "provider"), { status: 409, body: { code: "AGENT_PLUGIN_LINKED", error: "follows acme", providerPluginId: "provider" } }, null],
    ["not installed (raced)", new NotInstalledTestError("gone"), { status: 404, body: { error: "gone", code: "AGENT_PLUGIN_NOT_FOUND" } }, null],
    ["activations unreadable", new UnreadableTestError("/srv/activations.json: bad"), { status: 409, body: { error: TEST_COPY.activationsUnreadable, code: "AGENT_PLUGIN_ACTIVATIONS_UNREADABLE" } }, "activationsUnreadable"],
    ["activations busy", new BusyTestError("/srv/lock held"), { status: 409, body: { error: TEST_COPY.activationsBusy, code: "AGENT_PLUGIN_ACTIVATIONS_BUSY" } }, "activationsBusy"],
  ];
  // The route reports structured facts only; the log label and message wording are the host's.
  it.each(LADDER)("maps %s to its exact refusal, reporting only the host-fault cause's facts", async (_name, error, expected, refusal) => {
    const log: unknown[] = [];
    expect(await refusalOf(() => run(deps(log, { setEnabled: async () => { throw error; } })))).toEqual(expected);
    const reports = log.filter((entry) => Array.isArray(entry) && entry[0] === "diagnose");
    expect(reports).toEqual(refusal ? [["diagnose", { pluginId: "acme", refusal, causeMessage: error.message }]] : []);
  });

  it("rethrows an unmapped failure unchanged, so the host's error port answers the 500", async () => {
    await expect(run(deps([], { setEnabled: async () => { throw new Error("activation service unavailable"); } }))).rejects.toThrow("activation service unavailable");
    await expect(run(deps([], { notifyPluginLowered: async () => { throw new Error("roster down"); } }), false)).rejects.toThrow("roster down");
  });

  it("fails closed without an authorizer or an authenticated principal", async () => {
    await expect(agentPluginSetEnabledRoute.handle({ input: { pluginId: "acme", enabled: true }, deps: deps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(agentPluginSetEnabledRoute.handle({ input: { pluginId: "acme", enabled: true }, deps: deps(), context: undefined, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});

it("keeps actual display metadata when toggling one plugin and fills only missing fields", async () => {
  const candidate = fakeCandidate({ displayName: undefined, version: undefined, summary: "Team events", description: "Read calendars" });
  const result = await run(deps([], { loadCandidates: async () => [fakeCandidate({ pluginId: "other" }), candidate] }));
  expect(result).toMatchObject({ ok: true, value: { agentPlugin: {
    pluginId: "acme", enabled: true, displayName: null, version: null, summary: "Team events", description: "Read calendars",
  } } });
});
