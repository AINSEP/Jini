import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { createAgentPluginConnectDeps, resolveAgentPluginConnectRedirectUri } from "../host-deps.js";
import { resolveInstalledAgentPlugin } from "../installed-plugin.js";
import { runAgentPluginConnect } from "../connect-tool.js";

describe("connect host dependencies", () => {
  it("keeps the MCP getter unread when connect permission is denied", async () => {
    const readMcp = vi.fn(() => { throw new Error("MCP read before permission"); });
    const projectMcp = vi.fn();
    const bind = createAgentPluginConnectDeps({ host: { permissions: { connect: "connect" }, entityType: "plugin" } as Parameters<typeof createAgentPluginConnectDeps>[0]["host"], isPluginEnabled: vi.fn(), resolveInstalledPlugin: vi.fn(), projectMcp });
    const routeDeps = bind({ workspaceId: "ws", authorize: async () => ({ allowed: false, reason: "denied" }), get mcp() { return readMcp(); } } as unknown as Parameters<typeof bind>[0]);
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

describe('redirect resolution', () => {
  it.each([
    { configuredOrigin: ' https://public.example:8443/ignored?x=1 ', derivedOrigin: 'http://internal.example', expected: 'https://public.example:8443/oauth/callback/a%2Fb%20%3F' },
    { configuredOrigin: 'http://localhost:8090/ignored', derivedOrigin: undefined, expected: 'http://localhost:8090/oauth/callback/a%2Fb%20%3F' },
    { configuredOrigin: 'file:///tmp/site', derivedOrigin: 'https://derived.example', expected: 'https://derived.example/oauth/callback/a%2Fb%20%3F' },
    { configuredOrigin: 'not a URL', derivedOrigin: 'https://derived.example', expected: 'https://derived.example/oauth/callback/a%2Fb%20%3F' },
    { configuredOrigin: ' ', derivedOrigin: '', expected: undefined },
  ])('uses the validated origin for $configuredOrigin and encodes the whole server id', ({ expected, ...origins }) => {
    expect(resolveAgentPluginConnectRedirectUri({ ...origins, callbackPath: '/oauth/callback', serverId: 'a/b ?' })).toBe(expected);
  });
});

it('uses lazy route overrides and shares the first projected MCP binding', async () => {
  const requiredDefaults = vi.fn(async () => false);
  const defaultInstalled = vi.fn(async () => null);
  const raw = { repo: {} };
  const projected = { ...raw, projections: {} } as unknown as ReturnType<Parameters<typeof createAgentPluginConnectDeps>[0]['projectMcp']>;
  const projectMcp = vi.fn(() => projected);
  const host = { toolId: 'studio_connect' } as Parameters<typeof createAgentPluginConnectDeps>[0]['host'];
  const bind = createAgentPluginConnectDeps({ host, isPluginEnabled: requiredDefaults, resolveInstalledPlugin: defaultInstalled, projectMcp });
  const actualInstalled = { servers: {} };
  const isPluginEnabled = vi.fn(async () => true);
  const resolveInstalledPlugin = vi.fn(async () => actualInstalled);
  const getMcp = vi.fn(() => raw);
  const bound = bind({ workspaceId: 'studio', isPluginEnabled, resolveInstalledPlugin, get mcp() { return getMcp(); } } as unknown as Parameters<typeof bind>[0]);
  expect(getMcp.mock.calls).toEqual([]);
  expect(await bound.isPluginEnabled('sync')).toBe(true);
  expect(await bound.resolveInstalledPlugin('sync')).toBe(actualInstalled);
  expect(isPluginEnabled.mock.calls).toEqual([['sync']]);
  expect(resolveInstalledPlugin.mock.calls).toEqual([['sync']]);
  expect(requiredDefaults.mock.calls).toEqual([]);
  expect(defaultInstalled.mock.calls).toEqual([]);
  expect(bound.mcp).toBe(projected);
  expect(bound.mcp).toBe(projected);
  expect(projectMcp.mock.calls).toEqual([[raw]]);
  expect(getMcp.mock.calls).toEqual([[]]);
});

it('falls back to host workspace defaults when the route supplies no overrides', async () => {
  const isPluginEnabled = vi.fn(async () => true);
  const resolveInstalledPlugin = vi.fn(async () => ({ servers: {} }));
  const bind = createAgentPluginConnectDeps({
    host: {} as Parameters<typeof createAgentPluginConnectDeps>[0]['host'],
    isPluginEnabled, resolveInstalledPlugin, projectMcp: () => { throw new Error('unexpected MCP access'); },
  });
  const agentPluginLayout = { forWorkspace: vi.fn(({ workspaceId }: { workspaceId: string }) => ({ root: `/workspaces/${workspaceId}` })) };
  const bound = bind({ workspaceId: 'studio', agentPluginLayout } as unknown as Parameters<typeof bind>[0]);
  expect(await bound.isPluginEnabled('sync')).toBe(true);
  expect(await bound.resolveInstalledPlugin('sync')).toEqual({ servers: {} });
  expect(agentPluginLayout.forWorkspace.mock.calls).toEqual([[{ workspaceId: 'studio' }]]);
  expect(isPluginEnabled.mock.calls).toEqual([[{ workspaceRoot: '/workspaces/studio', pluginId: 'sync' }]]);
  expect(resolveInstalledPlugin.mock.calls).toEqual([[{ workspaceId: 'studio', pluginId: 'sync', agentPluginLayout }]]);
});

it('returns null for a missing installed plugin and still loads servers when optional card metadata is invalid', async () => {
  const readInstalledMcpServers = vi.fn(async () => ({ main: { type: 'stdio', command: 'fixture' } }));
  const readTrustedPluginFile = vi.fn(async () => 'null');
  const common = { workspaceId: 'studio', agentPluginLayout: { forWorkspace: () => ({ root: '/studio' }) },
    parseCredentialCards: () => ({ ok: false, reason: 'invalid metadata' }),
    lifecycle: { listInstalledPlugins: async () => [], readBundledAgentPluginDigests: async () => new Map(),
      preferBundledAgentPluginDigests: () => [{ pluginId: 'sync', packageRoot: '/bundled/sync' }],
      readTrustedPluginFile, readInstalledMcpServers },
  };
  const resolve = (pluginId: string) => resolveInstalledAgentPlugin({ ...common, pluginId } as unknown as Parameters<typeof resolveInstalledAgentPlugin>[0]);
  expect(await resolve('missing')).toBeNull();
  expect(readTrustedPluginFile.mock.calls).toEqual([]);
  expect(await resolve('sync')).toEqual({ servers: { main: { type: 'stdio', command: 'fixture' } }, credentialCards: [] });
  expect(readInstalledMcpServers.mock.calls).toEqual([[{ packageRoot: '/bundled/sync' }]]);
  expect(readTrustedPluginFile.mock.calls).toEqual([[{ filename: 'plugin.json', plugin: { pluginId: 'sync', packageRoot: '/bundled/sync' } }]]);
});
