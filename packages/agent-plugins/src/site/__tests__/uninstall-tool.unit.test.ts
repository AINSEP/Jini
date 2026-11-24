import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { AgentPluginUninstallPreview } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";
import { FileLockTimeoutError } from "@jini-ai/core/contracts/runtime";
import { AgentPluginActivationsBusyError, AgentPluginActivationsUnreadableError, AgentPluginUpdateError } from "../../lifecycle/index.js";
import { runAgentPluginUninstall, type AgentPluginUninstallHost, type AgentPluginUninstallToolDeps } from "../uninstall-tool.js";

/** The host's copy: the engine names no product or host tool in a note, so every one comes from here. */
const copy = { productName: "Acme", uninstallToolName: "acme_uninstall", externalMcpSettingsPath: "Settings → Acme MCP" };
const preview = { pluginId: "notes" } as unknown as AgentPluginUninstallPreview;
const ctx: ToolExecutionContext = {
  executionId: "exec-1", principal: { id: "owner" } as ToolExecutionContext["principal"], run: { id: "run-1" } as ToolExecutionContext["run"],
  input: { pluginId: "notes" }, signal: new AbortController().signal,
};

function hostWith(overrides: Partial<AgentPluginUninstallHost> = {}): { host: AgentPluginUninstallHost; uninstalled: string[] } {
  const uninstalled: string[] = [];
  const host: AgentPluginUninstallHost = {
    previewAgentPluginUninstall: async () => preview,
    uninstallAgentPlugin: async (request) => { uninstalled.push(`host:${request.pluginId}`); return { pluginId: request.pluginId, removedDigests: ["d1"] } as never; },
    // The approval owner confirms at once: these tests cover this branch, not the dialog.
    approvalToolHandler: ({ prepare, run }) => async (approvedCtx, options = {}) => run({ ctx: approvedCtx, prepared: await prepare({ ctx: approvedCtx }, options) }, options),
    notConfirmedResult: () => ({ cancelled: true, note: "declined" }),
    describeApproval: () => ({ toolId: "acme_uninstall", errorCode: "X", title: "t", details: [], confirmLabel: "ok" }),
    copy,
    reportRefusal: () => {},
    ...overrides,
  };
  return { host, uninstalled };
}

function depsWith(host: AgentPluginUninstallHost, extra: Partial<AgentPluginUninstallToolDeps> = {}): AgentPluginUninstallToolDeps {
  return {
    agentPluginLayout: {} as AgentPluginUninstallToolDeps["agentPluginLayout"], workspaceId: "ws-1",
    authorize: async () => ({ allowed: true, reason: "test" }),
    preferences: { locale: async () => "en" }, uninstallHost: host, ...extra,
  };
}

test("a confirmed uninstall runs the host's lifecycle write and names the host's product and settings path", async () => {
  const { host, uninstalled } = hostWith();
  const result = await runAgentPluginUninstall({ routeDeps: depsWith(host), surfaces: {} as never, ctx, pluginId: "notes" }) as { uninstalled: boolean; note: string };
  assert.deepEqual(uninstalled, ["host:notes"]);
  assert.equal(result.uninstalled, true);
  assert.match(result.note, /until Acme restarts/);
  assert.match(result.note, /under Settings → Acme MCP\.$/);
});

test("the deps' own uninstall owner wins over the host default", async () => {
  const { host, uninstalled } = hostWith();
  const own = async (request: { pluginId: string }) => { uninstalled.push(`deps:${request.pluginId}`); return { pluginId: request.pluginId, removedDigests: [] } as never; };
  await runAgentPluginUninstall({ routeDeps: depsWith(host, { uninstallAgentPlugin: own }), surfaces: {} as never, ctx, pluginId: "notes" });
  assert.deepEqual(uninstalled, ["deps:notes"]);
});

test("a busy activation record is a not-removed result whose note names the host's product", async () => {
  const { host, uninstalled } = hostWith({ previewAgentPluginUninstall: async () => { throw new AgentPluginActivationsBusyError({ lockPath: "/x.lock", holder: undefined, lost: false }); } });
  const result = await runAgentPluginUninstall({ routeDeps: depsWith(host), surfaces: {} as never, ctx, pluginId: "notes" }) as { reason: string; note: string };
  assert.equal(result.reason, "activations-busy");
  assert.match(result.note, /another Acme process was writing/);
  assert.deepEqual(uninstalled, []);
});

test("a pending update tells the model to restart the host's product", async () => {
  const { host } = hostWith({ previewAgentPluginUninstall: async () => { throw new AgentPluginUpdateError({ code: "PLUGIN_UPDATE_PENDING", message: "pending" }); } });
  const result = await runAgentPluginUninstall({ routeDeps: depsWith(host), surfaces: {} as never, ctx, pluginId: "notes" }) as { reason: string; note: string };
  assert.equal(result.reason, "update-pending");
  assert.match(result.note, /Tell the user to restart Acme \(recovery runs at start\)/);
});

test("each locked or unreadable refusal goes to the host's reporter with the raw error, never the console", async () => {
  const cases = [
    { reason: "activations-busy", error: new AgentPluginActivationsBusyError({ lockPath: "/x.lock", holder: undefined, lost: false }) },
    { reason: "plugin-busy", error: new FileLockTimeoutError({ lockPath: "/state.lock", holder: undefined, waitedMs: 5 }) },
    { reason: "activations-unreadable", error: new AgentPluginActivationsUnreadableError({ filePath: "/activations.json", reason: "bad json" }) },
  ] as const;
  const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const { reason, error } of cases) {
      const reports: unknown[] = [];
      const { host } = hostWith({ previewAgentPluginUninstall: async () => { throw error; }, reportRefusal: (refusal) => { reports.push(refusal); } });
      const result = await runAgentPluginUninstall({ routeDeps: depsWith(host), surfaces: {} as never, ctx, pluginId: "notes" }) as { reason: string; note: string };
      assert.equal(result.reason, reason);
      assert.deepEqual(reports, [{ pluginId: "notes", reason, error }]);
      // The note stays path-free: the path-bearing message reached only the reporter.
      assert.doesNotMatch(result.note, /\/x\.lock|\/state\.lock|\/activations\.json/);
    }
    assert.equal(consoleWarn.mock.calls.length, 0);
  } finally { consoleWarn.mockRestore(); }
});
