import { expect, it, vi } from 'vitest';
import { applyAgentPluginToolRenames } from '../apply-tool-renames.js';
import { endpoint, memoryRepo, row, sealed } from './mcp-fixture.js';

const updatedAt = '2030-02-01T00:00:00.000Z';
const config = { type: 'streamable-http', url: endpoint, renamedTools: { old: 'new', oldWrite: 'newWrite', unused: 'never-granted' } } as const;

it('renames owned grants in place without widening access and does nothing on the next boot', async () => {
  const initial = row({ allowedToolNames: '["read","old","new","oldWrite"]', writeAllowedToolNames: '["oldWrite"]' });
  const { repo } = memoryRepo(initial);
  const deps = {
    workspaceId: 'studio', externalMcpServerRepo: repo, clock: { nowMs: () => Date.parse(updatedAt) }, actor: 'studio:renames',
    listPlugins: async () => [{ pluginId: 'sync', servers: { main: config } }], notifyRosterChanged: vi.fn(async () => {}),
  };
  const log = { info: vi.fn(), warn: vi.fn() };
  await applyAgentPluginToolRenames({ deps, log });
  await applyAgentPluginToolRenames({ deps, log });
  expect(await repo.findByServerId({ workspaceId: 'studio', serverId: 'main' })).toEqual({
    ...initial, allowedToolNames: '["read","new","newWrite"]', writeAllowedToolNames: '["newWrite"]', version: 4,
    writeGrantsUpdatedByPrincipalId: 'studio:renames', writeGrantsUpdatedAt: updatedAt, updatedAt, sealedOAuth: sealed,
  });
  expect(deps.notifyRosterChanged.mock.calls).toEqual([[]]);
  expect(log.warn.mock.calls).toEqual([]);
  expect(log.info.mock.calls).toEqual([["[agent-plugins] 'main': renamed saved tools to follow the 'sync' plugin (old -> new, oldWrite -> newWrite, unused -> never-granted)."]]);
});

it.each([
  { label: 'foreign owner', changes: { provisionedByPluginId: 'unrelated' } },
  { label: 'different endpoint', changes: { url: 'https://changed.example.test/mcp' } },
  { label: 'invalid JSON', changes: { writeAllowedToolNames: 'BROKEN' } },
  { label: 'invalid grant entries', changes: { writeAllowedToolNames: '[2]' } },
])('does not rewrite either grant list for $label', async ({ changes }) => {
  const initial = row({ allowedToolNames: '["old"]', ...changes });
  const { repo } = memoryRepo(initial);
  const notifyRosterChanged = vi.fn(async () => {});
  const log = { info: vi.fn(), warn: vi.fn() };
  await applyAgentPluginToolRenames({
    deps: { workspaceId: 'studio', externalMcpServerRepo: repo, clock: { nowMs: () => 0 }, actor: 'studio:renames',
      listPlugins: async () => [{ pluginId: 'sync', servers: { main: config } }], notifyRosterChanged }, log,
  });
  expect(await repo.findByServerId({ workspaceId: 'studio', serverId: 'main' })).toEqual(initial);
  expect(repo.updateIfVersion.mock.calls).toEqual([]);
  expect(notifyRosterChanged.mock.calls).toEqual([]);
});

it('read-only renames preserve attribution and never create a write grant', async () => {
  const initial = row({ allowedToolNames: '["old"]', writeGrantsUpdatedByPrincipalId: 'operator', writeGrantsUpdatedAt: '2026-03-01T00:00:00.000Z' });
  const { repo } = memoryRepo(initial);
  const notifyRosterChanged = vi.fn(async () => {});
  await applyAgentPluginToolRenames({
    deps: { workspaceId: 'studio', externalMcpServerRepo: repo, clock: { nowMs: () => Date.parse(updatedAt) }, actor: 'studio:renames',
      listPlugins: async () => [{ pluginId: 'sync', servers: { main: config } }], notifyRosterChanged },
    log: { info: vi.fn(), warn: vi.fn() },
  });
  expect(await repo.findByServerId({ workspaceId: 'studio', serverId: 'main' })).toEqual({
    ...initial, allowedToolNames: '["new"]', updatedAt, version: 4,
  });
  expect(notifyRosterChanged.mock.calls).toEqual([[]]);
});
