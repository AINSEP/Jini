import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { createAgentPluginConnectDeps } from "../host-deps.js";
import { resolveInstalledAgentPlugin } from "../installed-plugin.js";
import { runAgentPluginConnect } from "../connect-tool.js";

describe("connect host dependencies", () => {
  it("keeps the MCP getter unread when connect permission is denied", async () => {
    const readMcp = vi.fn(() => { throw new Error("MCP read before permission"); });
    const projectMcp = vi.fn();
    const bind = createAgentPluginConnectDeps({ host: { permissions: { connect: "connect" }, entityType: "plugin" } as Parameters<typeof createAgentPluginConnectDeps>[0]["host"], isPluginEnabled: vi.fn(), resolveInstalledPlugin: vi.fn(), projectMcp });
    const routeDeps = bind({ workspaceId: "ws", authorize: async () => ({ allowed: false, reason: "denied" }), get mcp() { return readMcp(); } } as Parameters<typeof bind>[0]);
    const ctx = { principal: { id: "owner" }, run: { id: "run" }, input: {}, signal: new AbortController().signal } as ToolExecutionContext;
    await expect(runAgentPluginConnect({ routeDeps, surfaces: {}, ctx, pluginId: "synthetic" })).rejects.toThrow();
    expect(readMcp).not.toHaveBeenCalled();
    expect(projectMcp).not.toHaveBeenCalled();
  });

  it("uses the injected legacy credential-card reader after bundled preference", async () => {
    const events: string[] = [];
    const parseCredentialCards = vi.fn(() => { events.push("parse legacy"); return { ok: true as const, descriptors: [] }; });
    const input = { workspaceId: "ws", pluginId: "legacy", agentPluginLayout: { forWorkspace: () => ({ root: "/workspace" }) }, parseCredentialCards,
      lifecycle: { listInstalledPlugins: async () => [], readBundledAgentPluginDigests: async () => new Map(), preferBundledAgentPluginDigests: () => { events.push("prefer bundled"); return [{ pluginId: "legacy", packageRoot: "/bundled" }]; }, readTrustedPluginFile: async () => { events.push("read identity"); return '{"extensions":{"legacy":{"id":"legacy"}}}'; }, readInstalledMcpServers: async () => ({}) } } as unknown as Parameters<typeof resolveInstalledAgentPlugin>[0];
    expect(await resolveInstalledAgentPlugin(input)).toEqual({ servers: {}, credentialCards: [] });
    expect(events).toEqual(["prefer bundled", "read identity", "parse legacy"]);
    expect(parseCredentialCards).toHaveBeenCalledWith({ raw: '{"extensions":{"legacy":{"id":"legacy"}}}' });
  });
});
