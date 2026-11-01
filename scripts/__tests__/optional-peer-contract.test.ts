import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { auditSubpathIsolation, checkSubpathIsolation } from '../check-subpath-isolation.js';
let root: string;
function write(file: string, value: unknown) {
  const target = join(root, file); mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
}
function fixture(extra = {}) {
  write('packages/sample/package.json', { name: '@jini-ai/sample', sideEffects: false,
    exports: { '.': './dist/index.js', './opt-in': './dist/feature.js' },
    peerDependencies: { driver: '*' }, peerDependenciesMeta: { driver: { optional: true } }, ...extra });
  write('packages/sample/src/index.ts', 'export const boot = true;');
  write('packages/sample/src/feature.ts', "export const enable = () => import('driver');");
}
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'optional-peers-')); fixture(); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
it('rejects an unclassified optional peer', () => {
  expect(checkSubpathIsolation({ repoRoot: root })).toContainEqual(expect.objectContaining({ rule: 'SI-optional-peer', reason: expect.stringContaining('unclassified optional peer driver') }));
});
it.each(["import 'driver';", "export * from './feature.js';", "const load = () => createRequire(import.meta.url)('driver');", "require.resolve('driver');"])
('rejects a default path reaching an opt-in peer: %s', source => {
  fixture({ jini: { optionalPeers: { driver: 'opt-in: extra driver — This feature needs driver.' } } });
  write('packages/sample/src/index.ts', source);
  expect(checkSubpathIsolation({ repoRoot: root })).toContainEqual(expect.objectContaining({ rule: 'SI-optional-peer', reason: expect.stringContaining('default path') }));
});
it.each(["import 'driver';", "export * from 'driver';", "export const enable = () => import('driver');"])
('permits a classified peer used exclusively by an opt-in subpath: %s', source => {
  fixture({ jini: { optionalPeers: { driver: 'opt-in: import @jini-ai/sample/opt-in — needs driver.' } } });
  write('packages/sample/src/feature.ts', source);
  expect(checkSubpathIsolation({ repoRoot: root })).toEqual([]);
});
it('checks published packages even without an exports map', () => {
  fixture({ exports: undefined });
  expect(checkSubpathIsolation({ repoRoot: root }).some(v => v.rule === 'SI-optional-peer')).toBe(true);
});
it('never recommends turning required subset dependencies into optional peers', () => {
  fixture({ dependencies: { driver: '*' }, peerDependencies: {}, peerDependenciesMeta: {} });
  expect(checkSubpathIsolation({ repoRoot: root }).filter(v => v.rule === 'SI-dependency')).toEqual([]);
});
it.each(["export const enable = () => import('driver');", "import 'driver'; export const enable = true;"])
('rejects default reachability even with deferred-module metadata: %s', source => {
  const jini = { optionalPeers: { driver: 'opt-in: extra driver — This feature needs driver.' }, optionalPeerModules: { driver: ['src/feature.ts'] } };
  fixture({ jini });
  write('packages/sample/src/index.ts', "export * from './feature.js';");
  write('packages/sample/src/feature.ts', source);
  expect(checkSubpathIsolation({ repoRoot: root })).toContainEqual(expect.objectContaining({ rule: 'SI-optional-peer', reason: expect.stringContaining('default path') }));
});
it('current published package manifests all satisfy the opt-in classification contract', async () => {
  const { sourcePackages } = await import('../lib/package-sources.js');
  const { optionalPeerContractProblems } = await import('../../packages/devops/src/packaging/electron/optional-peers.js');
  const packagesDir = new URL('../../packages/', import.meta.url).pathname;
  const failures = sourcePackages({ packagesDir }).filter(pkg => !pkg.manifest.private)
    .flatMap(pkg => optionalPeerContractProblems({ manifest: pkg.manifest }).map(reason => `${pkg.manifest.name}: ${reason}`));
  expect(failures).toEqual([]);
});
it('making a backend peer required must not disable neutral-driver isolation', async () => {
  const { checkDriverIsolation } = await import('../check-driver-isolation.js');
  fixture({ peerDependencies: { driver: '*' }, peerDependenciesMeta: {}, jini: { neutralEntries: ['src/core'] } });
  write('packages/sample/src/core/index.ts', "import 'driver';");
  expect(await checkDriverIsolation({ repoRoot: root })).toContainEqual(expect.objectContaining({ rule: 'R12-driver-isolation' }));
});
it('required integration peers keep their approved adapter boundary, never the neutral core', async () => {
  const { checkPackageLayers } = await import('../check-package-layers.js');
  write('boundary/packages/user-management/package.json', { name: '@jini-ai/user-management', peerDependencies: { '@jini-ai/admin': '*' } });
  write('boundary/packages/admin/package.json', { name: '@jini-ai/admin', exports: { './core/module': './dist/core/module.js' } });
  write('boundary/packages/user-management/src/admin/roles.ts', "import { X } from '@jini-ai/admin/core/module';");
  expect(checkPackageLayers({ repoRoot: join(root, 'boundary') })).toEqual([]);
  write('boundary/packages/user-management/src/core/leak.ts', "import { X } from '@jini-ai/admin/core/module';");
  expect(checkPackageLayers({ repoRoot: join(root, 'boundary') })).toEqual([expect.objectContaining({ rule: 'L1-layer-edge', file: 'packages/user-management/src/core/leak.ts' })]);
});

it.each([
  ['db', 'better-sqlite3'], ['db', 'pg'], ['db', '@electric-sql/pglite'], ['daemon', 'node-pty'],
  ['capability-providers', 'ws'], ['user-management', 'argon2'], ['cms', 'sharp'],
  ['cms', 'jsdom'], ['ui', '@excalidraw/excalidraw'], ['ui', 'grapesjs'],
  ['ui', 'lexical'], ['ui', 'shiki'], ['sandbox', '@e2b/code-interpreter'],
  // Host frameworks used only by opt-in subpaths or types must not be auto-installed by npm/pnpm.
  ['cms', 'express'], ['commerce', 'express'], ['commerce', 'react'],
  ['admin', 'react'], ['chat', 'react'], ['user-management', 'react'], ['vibecoding', 'react'],
])('keeps %s → %s an explicitly classified opt-in peer', async (directory, dependency) => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL(`../../packages/${directory}/package.json`, import.meta.url), 'utf8'));
  expect(manifest.peerDependenciesMeta?.[dependency]?.optional).toBe(true);
  expect(manifest.jini.optionalPeers[dependency]).toMatch(/^opt-in: .+ — .+could not load .+/);
  expect(manifest.dependencies?.[dependency]).toBeUndefined();
});
it.each([['daemon', 'smol-toml'], ['cms', 'mammoth'], ['cms', 'unpdf'],
  ['agent-runtime', '@jini-ai/integrations'],
  ['agent-runtime', '@jini-ai/platform'],
  ['mcp', '@modelcontextprotocol/sdk'], ['mcp', '@cfworker/json-schema'],
])('keeps default-path %s → %s a production dependency', async (directory, dependency) => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL(`../../packages/${directory}/package.json`, import.meta.url), 'utf8'));
  expect(manifest.dependencies[dependency]).toBeTruthy();
  expect(manifest.peerDependencies?.[dependency]).toBeUndefined();
});
it.each(['smol-toml', 'mammoth'])('rejects demoting default library %s even with a valid classification', dependency => {
  fixture({ peerDependencies: { [dependency]: '*' }, peerDependenciesMeta: { [dependency]: { optional: true } },
    jini: { optionalPeers: { [dependency]: `opt-in: parser — Parser could not load ${dependency}. Check its installation.` } } });
  write('packages/sample/src/index.ts', `export const load = () => import('${dependency}');`);
  expect(checkSubpathIsolation({ repoRoot: root })).toContainEqual(expect.objectContaining({
    rule: 'SI-optional-peer', reason: expect.stringContaining(`reaches optional peer ${dependency}`),
  }));
});

it('feature load messages match the owning manifest classifications', async () => {
  const { readFileSync } = await import('node:fs');
  const { loadOptionalPeer } = await import('../../packages/core/src/optional-peer.js');
  const { default: ts } = await import('typescript');
  const sites = [
    'capability-providers/src/adapters/ws/index.ts', 'cms/src/media/image-transformer.sharp.ts',
    'cms/src/media/document-ingress.ts', 'cms/src/media/sanitize-svg.ts',
    'daemon/src/terminal.adapter.ts', 'daemon/src/store/event-log/sqlite-kernel.ts',
    'integrations/src/media-providers/sqlite-driver.adapter.ts', 'platform/src/asset-cache.adapter.ts',
    'ui/src/renderers/shiki.ts', 'user-management/src/server/hasher.ts', 'mcp/src/federation/adapter.http.ts',
  ];
  for (const file of sites) {
    const manifest = JSON.parse(readFileSync(new URL(`../../packages/${file.split('/')[0]}/package.json`, import.meta.url), 'utf8'));
    const source = readFileSync(new URL(`../../packages/${file}`, import.meta.url), 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: import('typescript').Node): void {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'loadOptionalPeer') {
        const input = node.arguments[0] as import('typescript').ObjectLiteralExpression;
        const fields = Object.fromEntries(input.properties.filter(ts.isPropertyAssignment).map(field => [field.name.getText(tree), field.initializer.getText(tree).slice(1, -1)]));
        let message = '';
        try { loadOptionalPeer({ feature: fields.feature!, dependency: fields.dependency!, load: () => { throw new Error('absent'); } }); }
        catch (error) { message = (error as Error).message; }
        const classification = manifest.jini.optionalPeers?.[fields.dependency!];
        // 8ff9f6a57: manifests own the feature/dependency headline; core owns the cause-specific advice
        // after it (pinned per cause in packages/core/src/__tests__/optional-peer.test.ts).
        const headline = `${fields.feature} could not load ${fields.dependency}.`;
        expect(message.slice(0, headline.length + 1), file).toBe(`${headline} `);
        if (classification) expect(classification, file).toContain(` — ${headline} `);
        else expect(manifest.dependencies?.[fields.dependency!], file).toBeTruthy();
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
});

it('agent-runtime default source entry never reaches an opt-in peer', async () => {
  const { cpSync, readFileSync } = await import('node:fs');
  const packageDirectory = new URL('../../packages/agent-runtime/', import.meta.url);
  rmSync(join(root, 'packages/sample'), { recursive: true, force: true });
  write('packages/agent-runtime/package.json', JSON.parse(readFileSync(new URL('package.json', packageDirectory), 'utf8')));
  cpSync(new URL('src/', packageDirectory), join(root, 'packages/agent-runtime/src'), { recursive: true });
  const failures = checkSubpathIsolation({ repoRoot: root }).filter(finding => finding.rule === 'SI-optional-peer');
  expect(failures).toEqual([]);
});

it('all real default entries keep runtime libraries required and classify opt-in subpaths', async () => {
  const repoRoot = new URL('../../', import.meta.url).pathname;
  const { sourcePackages } = await import('../lib/package-sources.js');
  const audit = auditSubpathIsolation({ repoRoot });
  const daemonEntries = audit.closures.filter(closure => closure.package === '@jini-ai/daemon');
  expect(daemonEntries.find(closure => closure.subpath === '.')!.dependencies).not.toContain('node-pty');
  expect(daemonEntries.find(closure => closure.subpath === './terminal')?.dependencies).toContain('node-pty');
  expect(audit.findings.filter(finding => finding.package === '@jini-ai/daemon')).toEqual([]);
  const failures = audit.findings.filter(finding => finding.rule === 'SI-optional-peer');
  expect(failures).toEqual([]);
  const missingSubpaths = sourcePackages({ packagesDir: join(repoRoot, 'packages') }).flatMap(pkg => {
    const classifications = (pkg.manifest as { jini?: { optionalPeers?: Record<string, string> } }).jini?.optionalPeers ?? {};
    return Object.keys(classifications).flatMap(peer => {
      const subpaths = audit.closures.filter(closure => closure.package === pkg.manifest.name
        && closure.subpath !== '.' && closure.dependencies.includes(peer)).map(closure => pkg.manifest.name + closure.subpath.slice(1));
      if (!subpaths.length || subpaths.some(subpath => classifications[peer]!.includes(`import ${subpath} —`))) return [];
      return [{ package: pkg.manifest.name, peer, subpaths }];
    });
  });
  expect(missingSubpaths).toEqual([]);
}, 120000);

// Cross-package defaults count too: UI loads UI kit's React bindings; server loads daemon HTTP.
it.each([['ui', 'react'], ['ui', 'react-dom'], ['daemon', 'express'], ['server', 'express'],
  ['ui-kit', 'react'], ['ui-kit', 'react-dom']])
('keeps default-entry host framework %s → %s required', async (directory, dependency) => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL(`../../packages/${directory}/package.json`, import.meta.url), 'utf8'));
  expect(manifest.peerDependencies[dependency]).toBeTruthy();
  expect(manifest.peerDependenciesMeta?.[dependency]?.optional).not.toBe(true);
  expect(manifest.jini.optionalPeers?.[dependency]).toBeUndefined();
  expect(manifest.dependencies?.[dependency]).toBeUndefined();
});

it.each([['core', 'express'], ['http-kit', 'express'], ['ui-kit', 'vue'], ['vibecoding', 'react-dom']])
('removes %s → %s when no runtime entry loads it', async (directory, dependency) => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL(`../../packages/${directory}/package.json`, import.meta.url), 'utf8'));
  expect(manifest.peerDependencies?.[dependency]).toBeUndefined();
  expect(manifest.peerDependenciesMeta?.[dependency]).toBeUndefined();
  expect(manifest.jini.optionalPeers?.[dependency]).toBeUndefined();
});
