import { createConsoleLogger } from '@jini-ai/core/primitives';
import { afterEach, expect, test, vi } from 'vitest';
import { loadAgentPluginSearchCandidates } from '../../host-tools/search-tool.js';
import { loadInstalledAgentPluginToolSources } from '../../host-tools/skill-tool.js';

afterEach(() => { vi.restoreAllMocks(); });
const BANNED = ['boom', 'SECRETSECRET', 'host-tools-log-safety'];
const secretError = (): Error => new Error('boom api_key=SECRETSECRETSECRETSECRET');
const plugin = { pluginId: 'alpha', packageRoot: '/nonexistent/alpha', archiveDigest: 'd1', skills: [{ name: 's1', skillPath: 'skills/s1/SKILL.md' }] };
function ports(report: ReturnType<typeof createConsoleLogger>) {
  return {
    report,
    layout: { forWorkspace: () => ({ root: '/nonexistent/ws', pluginPackagesDir: () => '/nonexistent/pkgs' }) },
    lifecycle: {
      listInstalledPlugins: async () => [plugin], readBundledAgentPluginDigests: async () => ({}),
      preferBundledAgentPluginDigests: ({ installed }: { installed: unknown }) => installed,
      readInstalledSkillMarkdown: async () => { throw secretError(); },
      readInstalledMcpServerIds: async () => { throw secretError(); },
    },
    activations: { readAgentPluginActivations: async () => ({}), isAgentPluginActive: () => true,
      filterActiveAgentPlugins: ({ items }: { items: unknown }) => items },
  } as never;
}
function printed(spy: { mock: { calls: unknown[][] } }): string { return spy.mock.calls.flat().map(String).join('\n'); }

test('search skips a broken skill and plugin with class-only warnings', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await loadAgentPluginSearchCandidates({ workspaceId: 'ws', ports: ports(createConsoleLogger({ prefix: '[agent-plugins]' })) })).toEqual([]);
  expect(warn.mock.calls.map(call => call.join(' '))).toEqual([
    "[agent-plugins] Plugin skill could not be read; skipped from search. Error",
    "[agent-plugins] Plugin excluded from search. Error",
  ]);
  for (const banned of BANNED) expect(printed(warn)).not.toContain(banned);
});

test('tool sources skip a broken plugin with a class-only warning', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await loadInstalledAgentPluginToolSources({ workspaceId: 'ws', ports: ports(createConsoleLogger({ prefix: '[agent-plugins]' })) })).toEqual([]);
  expect(warn.mock.calls.map(call => call.join(' '))).toEqual(["[agent-plugins] Plugin tool source skipped. Error"]);
  for (const banned of BANNED) expect(printed(warn)).not.toContain(banned);
});
