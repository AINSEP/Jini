/**
 * @file Real-install harness for the tool contribution tests: installs fixture packages through the
 * lifecycle's own install, digest and activation owners, loads them through the real trust gate, and
 * attaches the projection to a real core ToolRegistry. Capabilities are typed fakes; no network.
 */
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createToolRegistry } from '@jini-ai/core';
import { attachPluginContributionTools, buildPluginContributionToolRegistrations, createPluginContributionRegistry, pluginToolIdFor, type PluginToolContributionPorts } from '@jini-ai/plugins/host';
import { createPluginContributionLoader } from '../../contribution-loader.js';
import type { AgentPluginArchiveEntry } from '../../install.js';
import {
  findTrustedPluginPackages, importContainedModule, installAgentPlugin, readTrustedPluginFile,
  recordBundledAgentPluginDigests, resolveAgentPluginLayout, setAgentPluginActivation,
} from '../../__tests__/test-support.js';
import { forceRemove } from '../../__tests__/fixtures/force-remove.js';
import { createIssuedTokenMemories, type AgentPluginToolCapabilities, type AgentPluginToolCapabilitiesPort } from '../capabilities.js';
import { defineAgentPluginToolContribution } from '../definition.js';
import { createAgentPluginToolProjection } from '../projection.js';

export const WORKSPACE_ID = 'workspace-tools';
/** Host-chosen name: Jini never fixes a product filename. */
export const TOOLS_FILENAME = 'host-agent-tools.json';
/** Built at runtime so no credential-shaped literal is committed. */
export const FAKE_TOKEN = ['tok', 'en', '-', 'x'.repeat(24)].join('');

function fileEntry(entryPath: string, content: string): AgentPluginArchiveEntry {
  const bytes = Buffer.from(content, 'utf8');
  return { kind: 'file', entryPath, declaredSize: bytes.byteLength, executable: false, async *openReadStream() { yield bytes; } };
}

/** Installs one package; `bundled: false` records a different digest (a tampered or operator copy). */
export async function installPlugin(
  required: { workspaceRoot: string; pluginId: string; files: Readonly<Record<string, string>> },
  optional: { enabled?: boolean; bundled?: boolean } = {},
): Promise<void> {
  const entries = [
    fileEntry('plugin.json', JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: required.pluginId, version: '1.0.0' })),
    ...Object.entries(required.files).map(([name, body]) => fileEntry(name, body)),
  ];
  const archive = new Uint8Array(Buffer.from(`${required.pluginId}:${JSON.stringify(required.files)}`));
  const installed = await installAgentPlugin({
    archive, expectedSha256: createHash('sha256').update(archive).digest('hex'),
    archiveReader: { async *entries() { yield* entries; } }, layout: resolveAgentPluginLayout(), workspaceId: WORKSPACE_ID,
  });
  const archiveDigest = optional.bundled === false ? 'f'.repeat(64) : installed.archiveDigest;
  await recordBundledAgentPluginDigests({ workspaceRoot: required.workspaceRoot, seeded: [{ pluginId: required.pluginId, archiveDigest }] });
  await setAgentPluginActivation({ workspaceRoot: required.workspaceRoot, pluginId: required.pluginId, enabled: optional.enabled ?? true, actor: 'test' }, { origin: 'bundled' });
}

/** A temp plugin root for one test; always removed. */
export async function withWorkspace<T>(fn: (workspaceRoot: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-plugin-tools-'));
  const previous = process.env.PLUGIN_ROOT;
  process.env.PLUGIN_ROOT = dir;
  try { return await fn(resolveAgentPluginLayout().forWorkspace({ workspaceId: WORKSPACE_ID }).root); } finally {
    if (previous === undefined) delete process.env.PLUGIN_ROOT; else process.env.PLUGIN_ROOT = previous;
    await forceRemove(dir);
  }
}

export interface FakeCapabilityLog { tokenRequests: string[]; requests: { url: string; headers: Record<string, string>; body?: string }[] }

/** Typed fake host capabilities; the HTTP fake never touches the network. */
export function fakeCapabilities(log: FakeCapabilityLog): AgentPluginToolCapabilities {
  return {
    connections: { getAccessToken: async ({ connectionRef }) => { log.tokenRequests.push(connectionRef); return FAKE_TOKEN; } },
    http: { fetch: async ({ url }, options = {}) => {
      log.requests.push({ url, headers: { ...options.headers }, ...(options.body === undefined ? {} : { body: options.body }) });
      return new Response('{"ok":true}', { status: 200 });
    } },
    limiter: { check: async () => ({ allowed: true }) },
    artifacts: { write: async ({ name }) => ({ artifactRef: `artifact:${name}` }) },
    state: { get: async () => null },
  };
}

/** Loader + projection + real ToolRegistry, wired the way a host composes them. `capabilities`
 *  replaces the default fakes (a slice that shares one host store with the plugin's surfaces). */
export function createHarness(optional: { readonly capabilities?: AgentPluginToolCapabilitiesPort } = {}) {
  const log: FakeCapabilityLog = { tokenRequests: [], requests: [] };
  const loader = createPluginContributionLoader({
    findPackages: query => findTrustedPluginPackages(query),
    readFile: ({ plugin, filename }) => readTrustedPluginFile(plugin, filename),
    importModule: ({ plugin, modulePath }) => importContainedModule(plugin, modulePath),
  });
  const definition = defineAgentPluginToolContribution({ filename: TOOLS_FILENAME });
  const contributions = createPluginContributionRegistry({});
  const tools = createToolRegistry({});
  const enabled = new Set<string>();
  const ports: PluginToolContributionPorts = { contributions, isEnabled: async ({ pluginId }) => enabled.has(pluginId),
    resolveAuth: async ({ principalId }) => ({ access: 'member', workspaceId: WORKSPACE_ID, principalId }), metadata: { approval: { class: 'edit', confirmation: 'direct' } } };
  attachPluginContributionTools({ ...ports, registry: tools });
  const projection = createAgentPluginToolProjection({ issuedTokens: createIssuedTokenMemories(), registry: contributions, toolIdFor: pluginToolIdFor, capabilities: optional.capabilities ?? (() => fakeCapabilities(log)) });
  /** Loads from the installed packages and projects; returns every refusal line. */
  async function refresh(): Promise<readonly string[]> {
    const load = await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition }, { orderByPluginId: true });
    enabled.clear();
    for (const item of load.items) enabled.add(item.pluginId);
    return projection.sync({ loaded: load.items, refusals: load.refusals }).refusals;
  }
  /** Authorizes a call through the contract's own registration (policy, then handler); rejects on deny. */
  async function authorize(toolId: string, input: unknown, signal: AbortSignal = new AbortController().signal): Promise<() => Promise<unknown>> {
    const principal = { id: 'member-1' };
    const run = { id: 'run-1' };
    const registration = buildPluginContributionToolRegistrations(ports).find(candidate => candidate.descriptor.id === toolId);
    if (!registration) throw new Error(`unknown ${toolId}`);
    if (await registration.policy.authorize({ principal, run, input, tool: registration.descriptor }) !== 'allow') throw new Error(`denied ${toolId}`);
    return () => registration.handler({ executionId: 'exec-1', principal, run, input, signal });
  }
  const invoke = async (toolId: string, input: unknown) => (await authorize(toolId, input))();
  return { log, tools, contributions, projection, enabled, refresh, authorize, invoke };
}

/** One tool declaration in the contribution file. */
export function toolsFile(tools: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ schemaVersion: 1, tools });
}
