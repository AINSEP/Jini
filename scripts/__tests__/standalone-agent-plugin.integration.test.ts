import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseNpmPackJson } from '../lib/npm-pack-json.js';
import { AGENT_PLUGINS_PACKAGE, agentPluginPackages, agentPluginSubpath, isPublishedAgentPluginFile } from '../lib/agent-plugin-packages.js';
import { assertPluginPackageIsolation } from '../check-plugin-isolation.js';
import { createAgentPluginLayout, createAgentPluginLifecycle } from '../../packages/agent-plugins/src/lifecycle/index.js';
import { ports } from '../../packages/agent-plugins/src/lifecycle/__tests__/test-support.js';
import { forceRemove } from '../../packages/agent-plugins/src/lifecycle/__tests__/fixtures/force-remove.js';
import { installLegacyRevision } from '../../packages/agent-plugins/src/lifecycle/__tests__/fixtures/install-legacy-revision.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const packageRoot = path.join(workspace, 'packages/agent-plugins');
/** Pinned payloads for the two long-lived design plugins; every other row is checked against its own source folder. */
const pinned: Readonly<Record<string, { fileCount: number; skills: string[] }>> = {
  'ui-ux-design': { fileCount: 54, skills: ['frontend-accessibility', 'gstack-design', 'interface-design', 'shadcn-ui', 'ui-ux-design', 'vercel-web-design-guidelines', 'web-compliance'] },
  'slide-design': { fileCount: 9, skills: ['slide-design'] },
};

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...(await files(path.join(root, entry.name))).map(name => `${entry.name}/${name}`));
    else result.push(entry.name);
  }
  return result.sort();
}

/** Skill names a source folder declares (`skills/<name>/SKILL.md`). */
async function sourceSkills(sourceDir: string): Promise<string[]> {
  const names = await fs.readdir(path.join(sourceDir, 'skills')).catch(() => [] as string[]);
  const present = await Promise.all(names.map(name => fs.stat(path.join(sourceDir, 'skills', name, 'SKILL.md')).then(() => name, () => '')));
  return present.filter(Boolean).sort();
}

let root: string;
let installed: string;
let packedFiles: string[];
let resolve: (specifier: string) => string;

// One tarball for every plugin: the real package, packed without lifecycle scripts, installed alone.
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'agent-plugin-subpaths-'));
  const packed = parseNpmPackJson({ stdout: execFileSync('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache'), '--pack-destination', root], {
    cwd: packageRoot, encoding: 'utf8',
  }) });
  packedFiles = (packed.files ?? []).map(file => file.path).sort();
  installed = path.join(root, 'node_modules', AGENT_PLUGINS_PACKAGE);
  await fs.mkdir(installed, { recursive: true });
  execFileSync('tar', ['-xzf', path.join(root, packed.filename), '-C', installed, '--strip-components', '1']);
  resolve = createRequire(path.join(root, 'host.cjs')).resolve;
}, 120_000);
afterAll(async () => { if (root) await forceRemove(root); });

test('the tarball passes the packed isolation gate and carries no test folder', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
  expect(() => assertPluginPackageIsolation({ manifest, packedPaths: packedFiles, pluginIds: [] })).not.toThrow();
  expect(packedFiles.filter(file => file.split('/').includes('__tests__'))).toEqual([]);
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(manifest.scripts[hook]).toBeUndefined();
  expect(Object.keys(manifest.dependencies ?? {}).filter(name => /^@jini-ai\/(?:plugin-|provider-plugins)/.test(name))).toEqual([]);
});

describe.each(agentPluginPackages.map(row => ({ row, pluginId: row.name })))('subpath $pluginId', ({ row, pluginId }) => {
  const specifier = agentPluginSubpath(row);
  const sourceDir = path.join(workspace, row.sourceDir);
  let stagedDir: string;

  beforeAll(async () => {
    // A host stages only the selected folder beneath its bundled-source root (seeding scans that root).
    stagedDir = path.join(root, `stage-${pluginId}`, pluginId);
    await fs.cp(path.dirname(resolve(specifier)), stagedDir, { recursive: true });
  });

  function host(required: { name: string }) {
    const layout = createAgentPluginLayout({ root: path.join(root, `${pluginId}-${required.name}`) });
    const api = createAgentPluginLifecycle({ ...ports, layout, seededEnabledPluginIds: new Set([pluginId]), retiredBundledPlugins: new Map() });
    return { layout, api, workspaceId: 'workspace-a', workspaceRoot: layout.forWorkspace({ workspaceId: 'workspace-a' }).root };
  }

  test('resolves to its own folder, which holds exactly its published source files', async () => {
    expect(await fs.realpath(resolve(specifier))).toBe(await fs.realpath(path.join(installed, pluginId, 'plugin.json')));
    expect(await fs.realpath(resolve(`${specifier}/plugin.json`))).toBe(await fs.realpath(path.join(installed, pluginId, 'plugin.json')));
    const published = (await files(sourceDir)).filter(name => isPublishedAgentPluginFile({ path: name }));
    expect(packedFiles.filter(file => file.startsWith(`${pluginId}/`))).toEqual(published.map(name => `${pluginId}/${name}`));
    expect(await files(path.join(installed, pluginId))).toEqual(published);
    const api = host({ name: 'contents' }).api;
    const archive = await api.packAgentPluginDirectory({ sourceDir: stagedDir });
    if (pinned[pluginId]) expect(archive.files).toHaveLength(pinned[pluginId]!.fileCount);
  });

  test('real seeding of the staged folder installs only this plugin with readable skills; repeat boots keep operator disablement', async () => {
    const { layout, api, workspaceId, workspaceRoot } = host({ name: 'seeding' });
    const packed = await api.packAgentPluginDirectory({ sourceDir: stagedDir });
    expect(await api.packAgentPluginDirectory({ sourceDir: stagedDir })).toEqual(packed);
    const input = { layout, workspaceId, sourceRoot: path.dirname(stagedDir) };
    const first = await api.seedBundledAgentPlugins(input);
    expect(first.outcomes).toEqual([{ pluginId, status: 'seeded', archiveDigest: packed.sha256, activationRecorded: true }]);
    expect(first.ledgerFailure).toBeUndefined();
    const [installedPlugin, ...others] = await api.listInstalledPlugins({ workspaceRoot });
    expect(others).toEqual([]);
    expect(installedPlugin!.archiveDigest).toBe(packed.sha256);
    expect(installedPlugin!.skills.map(skill => skill.name).sort()).toEqual(pinned[pluginId]?.skills ?? await sourceSkills(sourceDir));
    for (const skill of installedPlugin!.skills) {
      const skillPath = `skills/${skill.name}/SKILL.md`;
      expect(await api.readInstalledSkillMarkdown({ packageRoot: installedPlugin!.packageRoot, skillPath }))
        .toBe(await fs.readFile(path.join(sourceDir, skillPath), 'utf8'));
    }
    await api.setAgentPluginActivation({ workspaceRoot, pluginId, enabled: false, actor: 'operator' });
    const repeated = await api.seedBundledAgentPlugins(input);
    expect(repeated.outcomes).toEqual([{ pluginId, status: 'seeded', archiveDigest: packed.sha256, activationRecorded: false }]);
    expect(await api.resolveAgentPluginActivation({ workspaceRoot, pluginId })).toEqual({ verdict: 'inactive' });
    expect(await api.listInstalledPlugins({ workspaceRoot: layout.forWorkspace({ workspaceId: 'workspace-b' }).root })).toEqual([]);
  });

  // Digest selection is lifecycle behaviour, not per-plugin: the two design plugins cover it.
  test.runIf(pluginId in pinned)('the seeded digest selects the subpath payload over a retained legacy revision', async () => {
    const { layout, api, workspaceId, workspaceRoot } = host({ name: 'digest-selection' });
    const skillPath = `skills/${pluginId}/SKILL.md`;
    const legacySource = path.join(root, `legacy-${pluginId}`);
    await fs.cp(stagedDir, legacySource, { recursive: true });
    await fs.writeFile(path.join(legacySource, skillPath), '# Legacy design guidance');
    const legacy = await api.packAgentPluginDirectory({ sourceDir: legacySource });
    await api.installAgentPlugin({ layout, workspaceId, archive: legacy.bytes, expectedSha256: legacy.sha256, archiveReader: api.createBundledSourceArchiveReader({}) });
    // Current installs prune superseded revisions; this fixture models an older retained store.
    const report = await installLegacyRevision({ packagesDir: layout.forWorkspace({ workspaceId }).pluginPackagesDir({ pluginId }),
      install: () => api.seedBundledAgentPlugins({ layout, workspaceId, sourceRoot: path.dirname(stagedDir) }),
    });
    const selected = await api.packAgentPluginDirectory({ sourceDir: stagedDir });
    expect(report.outcomes).toEqual([{ pluginId, status: 'seeded', archiveDigest: selected.sha256, activationRecorded: true }]);
    const installedPlugins = await api.listInstalledPlugins({ workspaceRoot });
    expect(installedPlugins.map(plugin => plugin.archiveDigest).sort()).toEqual([legacy.sha256, selected.sha256].sort());
    const bundled = await api.readBundledAgentPluginDigests({ workspaceRoot });
    expect([...bundled]).toEqual([[pluginId, selected.sha256]]);
    expect(api.preferBundledAgentPluginDigests({ installed: installedPlugins, bundled }).map(plugin => plugin.archiveDigest)).toEqual([selected.sha256]);
    const resolved = await api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout: layout.forWorkspace({ workspaceId }) });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(resolved.promptPrefix).toContain(await fs.readFile(path.join(sourceDir, skillPath), 'utf8'));
    expect(resolved.promptPrefix).not.toContain('# Legacy design guidance');
  });
});
