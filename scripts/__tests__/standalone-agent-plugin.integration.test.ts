import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { assembleAgentPluginPackage } from '../assemble-agent-plugin-package.js';
import { parseNpmPackJson } from '../lib/npm-pack-json.js';
import { agentPluginPackageName, agentPluginPackageRoot, agentPluginPackages } from '../lib/agent-plugin-packages.js';
import { createAgentPluginLayout, createAgentPluginLifecycle } from '../../packages/agent-plugins/src/lifecycle/index.js';
import { ports } from '../../packages/agent-plugins/src/lifecycle/__tests__/test-support.js';
import { forceRemove } from '../../packages/agent-plugins/src/lifecycle/__tests__/fixtures/force-remove.js';
import { installLegacyRevision } from '../../packages/agent-plugins/src/lifecycle/__tests__/fixtures/install-legacy-revision.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
/** Per-row expectations; the rows themselves come from the layout table (INT adds one entry per new row). */
const expectations: Readonly<Record<string, { fileCount: number; skills: string[] }>> = {
  'ui-ux-design': { fileCount: 46, skills: ['frontend-accessibility', 'gstack-design', 'interface-design', 'shadcn-ui', 'ui-ux-design', 'vercel-web-design-guidelines', 'web-compliance'] },
  'slide-design': { fileCount: 9, skills: ['slide-design'] },
};
const plugins = agentPluginPackages.map(row => ({ row, pluginId: row.name, fileCount: -1, skills: [] as string[], ...expectations[row.name] }));

test('every layout row has standalone expectations', () => {
  expect(Object.keys(expectations).sort()).toEqual(agentPluginPackages.map(row => row.name).sort());
});

describe.each(plugins)('standalone $pluginId package', ({ row, pluginId, fileCount, skills }) => {
  const packageRoot = path.join(workspace, agentPluginPackageRoot(row));
  const packageName = agentPluginPackageName(row);
  const skillPath = `skills/${pluginId}/SKILL.md`;
  let root: string;
  let sourceDir: string;
  let packedFiles: string[];

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'standalone-agent-plugin-'));
    const distribution = path.join(root, 'distribution');
    await assembleAgentPluginPackage({ packageRoot, sourceDir: path.join(workspace, row.sourceDir) }, { outputRoot: distribution });
    for (const name of ['package.json', 'README.md', 'LICENSE', 'NOTICE']) await fs.copyFile(path.join(packageRoot, name), path.join(distribution, name));
    const packed = parseNpmPackJson({ stdout: execFileSync('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache')], {
      cwd: distribution, encoding: 'utf8',
    }) });
    packedFiles = (packed.files ?? []).map(file => file.path).sort();
    const installed = path.join(root, 'node_modules', packageName);
    await fs.mkdir(installed, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(distribution, packed.filename), '-C', installed, '--strip-components', '1']);
    const resolve = createRequire(path.join(root, 'host.cjs')).resolve;
    sourceDir = path.dirname(resolve(`${packageName}/plugin.json`));
  }, 60_000);
  afterAll(async () => { if (root) await forceRemove(root); });

  function host(required: { name: string }) {
    const layout = createAgentPluginLayout({ root: path.join(root, required.name) });
    const api = createAgentPluginLifecycle({ ...ports, layout, seededEnabledPluginIds: new Set([pluginId]), retiredBundledPlugins: new Map() });
    return { layout, api, workspaceId: 'workspace-a', workspaceRoot: layout.forWorkspace({ workspaceId: 'workspace-a' }).root };
  }

  test('the tarball contains only its own payload and provenance, with no plugin dependency or install hook', async () => {
    const api = host({ name: 'contents' }).api;
    const packed = await api.packAgentPluginDirectory({ sourceDir });
    expect(packedFiles).toEqual(['LICENSE', 'NOTICE', 'README.md', 'package.json', ...packed.files.map(name => `${pluginId}/${name}`)].sort());
    expect(packed.files).toHaveLength(fileCount);
    const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) expect(manifest[field]).toBeUndefined();
    expect(Object.keys(manifest.devDependencies)).toEqual(['tsx']);
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(manifest.scripts[hook]).toBeUndefined();
    expect(await fs.readdir(path.join(root, 'node_modules/@jini-ai'))).toEqual([packageName.slice('@jini-ai/'.length)]);
  });

  test('real seeding installs readable skills deterministically and repeat boots preserve operator disablement', async () => {
    const { layout, api, workspaceId, workspaceRoot } = host({ name: 'seeding' });
    const packed = await api.packAgentPluginDirectory({ sourceDir });
    expect(await api.packAgentPluginDirectory({ sourceDir })).toEqual(packed);
    const input = { layout, workspaceId, sourceRoot: path.dirname(sourceDir) };
    const first = await api.seedBundledAgentPlugins(input);
    expect(first.outcomes).toEqual([{ pluginId, status: 'seeded', archiveDigest: packed.sha256, activationRecorded: true }]);
    expect(first.ledgerFailure).toBeUndefined();
    const [installed] = await api.listInstalledPlugins({ workspaceRoot });
    expect(installed!.archiveDigest).toBe(packed.sha256);
    expect(installed!.skills.map(skill => skill.name).sort()).toEqual(skills);
    expect(await api.readInstalledSkillMarkdown({ packageRoot: installed!.packageRoot, skillPath }))
      .toBe(await fs.readFile(path.join(sourceDir, skillPath), 'utf8'));
    expect(await api.readInstalledMcpServerIds({ packageRoot: installed!.packageRoot })).toEqual([]);
    await api.setAgentPluginActivation({ workspaceRoot, pluginId, enabled: false, actor: 'operator' });
    const repeated = await api.seedBundledAgentPlugins(input);
    expect(repeated.outcomes).toEqual([{ pluginId, status: 'seeded', archiveDigest: packed.sha256, activationRecorded: false }]);
    expect((await api.listInstalledPlugins({ workspaceRoot })).map(plugin => plugin.packageRoot)).toEqual([installed!.packageRoot]);
    expect(await api.resolveAgentPluginActivation({ workspaceRoot, pluginId })).toEqual({ verdict: 'inactive' });
    expect(await api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout: layout.forWorkspace({ workspaceId }) }))
      .toEqual({ ok: false, reason: `Agent Plugin '${pluginId}' is installed in this workspace but is not enabled — it ships with the host and stays inactive until an operator turns it on. Enable it before pinning it to a run.` });
    expect(await api.listInstalledPlugins({ workspaceRoot: layout.forWorkspace({ workspaceId: 'workspace-b' }).root })).toEqual([]);
  });

  test('the seeded digest selects the independent package over a retained legacy revision', async () => {
    const { layout, api, workspaceId, workspaceRoot } = host({ name: 'digest-selection' });
    const legacySource = path.join(root, 'legacy-source');
    await fs.cp(sourceDir, legacySource, { recursive: true });
    await fs.writeFile(path.join(legacySource, skillPath), '# Legacy design guidance');
    const legacy = await api.packAgentPluginDirectory({ sourceDir: legacySource });
    await api.installAgentPlugin({ layout, workspaceId, archive: legacy.bytes, expectedSha256: legacy.sha256, archiveReader: api.createBundledSourceArchiveReader({}) });
    // Current installs prune superseded revisions; this fixture models an older retained store.
    const report = await installLegacyRevision({ packagesDir: layout.forWorkspace({ workspaceId }).pluginPackagesDir({ pluginId }),
      install: () => api.seedBundledAgentPlugins({ layout, workspaceId, sourceRoot: path.dirname(sourceDir) }),
    });
    const selected = await api.packAgentPluginDirectory({ sourceDir });
    expect(report.outcomes).toEqual([{ pluginId, status: 'seeded', archiveDigest: selected.sha256, activationRecorded: true }]);
    const installed = await api.listInstalledPlugins({ workspaceRoot });
    expect(installed.map(plugin => plugin.archiveDigest).sort()).toEqual([legacy.sha256, selected.sha256].sort());
    const bundled = await api.readBundledAgentPluginDigests({ workspaceRoot });
    expect([...bundled]).toEqual([[pluginId, selected.sha256]]);
    expect(api.preferBundledAgentPluginDigests({ installed, bundled }).map(plugin => plugin.archiveDigest)).toEqual([selected.sha256]);
    const resolved = await api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout: layout.forWorkspace({ workspaceId }) });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(resolved.promptPrefix).toContain(await fs.readFile(path.join(sourceDir, skillPath), 'utf8'));
    expect(resolved.promptPrefix).not.toContain('# Legacy design guidance');
    // Removing only the ledger removes the authority to choose between the same two revisions.
    await fs.unlink(path.join(workspaceRoot, 'bundled-digests.json'));
    expect(await api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout: layout.forWorkspace({ workspaceId }) }))
      .toEqual({ ok: false, reason: `Agent Plugin '${pluginId}' matches 2 installed packages (digests: ${[legacy.sha256, selected.sha256].sort().join(', ')}) — refusing to guess which one to use` });
  });

  test('packing the lifecycle library publishes no design assets or design export', async () => {
    const lifecycleRoot = path.join(workspace, 'packages/agent-plugins');
    const packed = parseNpmPackJson({ stdout: execFileSync('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache'), '--pack-destination', root], {
      cwd: lifecycleRoot, encoding: 'utf8',
    }) });
    expect(packed.files!.some(file => file.path.startsWith(`${pluginId}/`))).toBe(false);
    const manifest = JSON.parse(await fs.readFile(path.join(lifecycleRoot, 'package.json'), 'utf8'));
    expect(manifest.files).not.toContain(pluginId);
    expect(Object.hasOwn(manifest.exports, `./${pluginId}/*`)).toBe(false);
    expect(Object.hasOwn(manifest.jini.entries, `./${pluginId}/*`)).toBe(false);
  }, 60_000);
});
