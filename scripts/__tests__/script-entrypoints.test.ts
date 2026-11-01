import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const temporary: string[] = [];
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'jini-script-entry-'));
  temporary.push(root);
  const alias = path.join(root, 'linked-workspace');
  symlinkSync(realpathSync(workspace), alias, 'dir');
  return { root, alias };
}

function run(script: string, args: string[] = []) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: workspace, encoding: 'utf8', timeout: 60_000,
  });
}

/** Run the real CLI source with tiny check fixtures, so entrypoint tests never scan the checkout. */
function guardFixture(root: string): string {
  const scripts = path.join(root, 'scripts');
  mkdirSync(path.join(scripts, 'lib'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  copyFileSync(path.join(workspace, 'scripts/check-guard-drift.ts'), path.join(scripts, 'check-guard-drift.ts'));
  const helper = path.join(workspace, 'scripts/lib/is-main-module.ts');
  if (existsSync(helper)) copyFileSync(helper, path.join(scripts, 'lib/is-main-module.ts'));
  const checks = {
    'check-agentic-dom-purity': 'checkAgenticDomPurity', 'check-chatpane-public-surface': 'checkChatPanePublicSurface',
    'check-driver-isolation': 'checkDriverIsolation', 'check-hardwiring': 'checkHardwiring',
    'check-engine-boundaries': 'checkEngineBoundaries', 'check-extensionless-imports': 'checkExtensionlessImports',
    'check-model-fallback-freshness': 'checkModelFallbackFreshness', 'check-protocol-purity': 'checkProtocolPurity',
    'check-package-layers': 'checkPackageLayers', 'check-plugin-packages': 'checkPluginPackages',
    'check-subpath-isolation': 'checkSubpathIsolation', 'lib/source-neutrality': 'checkSourceNeutrality',
    'lib/publish-hygiene-self-test': 'runPublishHygieneSelfTest', 'lib/self-test': 'runGuardSelfTest',
  };
  for (const [module, name] of Object.entries(checks)) writeFileSync(path.join(scripts, module + '.ts'), `export const ${name} = () => [];`);
  writeFileSync(path.join(scripts, 'lib/walk-imports.ts'), `export const REPO_ROOT = ${JSON.stringify(root)};`);
  writeFileSync(path.join(scripts, 'guard-baseline.json'), '{"violations":[]}');
  return scripts;
}

for (const entry of ['canonical', 'symlink'] as const) {
  test(`patch canary applies a real patch and refuses missing arguments through a ${entry} entry`, () => {
    const { root, alias } = fixture();
    const script = path.join(entry === 'symlink' ? alias : realpathSync(workspace), 'scripts/patch-canary.ts');
    const repo = path.join(root, 'target');
    const target = path.join(repo, 'foundry/integrations/open-design/daemon/probe.txt');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'before\n');
    const patch = path.join(root, 'change.patch');
    writeFileSync(patch, 'diff --git a/apps/daemon/probe.txt b/apps/daemon/probe.txt\n--- a/apps/daemon/probe.txt\n+++ b/apps/daemon/probe.txt\n@@ -1 +1 @@\n-before\n+after\n');
    const applied = run(script, ['--patch', patch, '--repo', repo]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stdout).toContain('PATCH_CANARY_OK');
    expect(readFileSync(target, 'utf8')).toBe('after\n');
    const refused = run(script);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Usage:');
  });

  test(`guard drift actually reports its result through a ${entry} entry`, () => {
    const { root } = fixture();
    const scripts = guardFixture(root);
    const alias = path.join(root, 'linked-scripts');
    symlinkSync(realpathSync(scripts), alias, 'dir');
    const script = path.join(entry === 'symlink' ? alias : realpathSync(scripts), 'check-guard-drift.ts');
    const checked = run(script);
    expect(checked.error).toBeUndefined();
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain('[guard:drift] ok — 0 new guard violations');
    writeFileSync(path.join(scripts, 'lib/self-test.ts'), 'export const runGuardSelfTest = () => [{ expectation: "fixture must block" }];');
    const failed = run(script);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('[guard:drift] SELF-TEST FAILED');
    expect(failed.stderr).toContain('fixture must block');
  }, 65_000);
}

test.each(['patch-canary.ts', 'check-guard-drift.ts'])('%s remains importable from stdin without running the command', script => {
  const imported = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-'], {
    cwd: workspace, encoding: 'utf8', timeout: 60_000,
    input: `import ${JSON.stringify(pathToFileURL(path.join(workspace, 'scripts', script)).href)}; console.log('imported');`,
  });
  expect(imported.status, imported.stderr).toBe(0);
  expect(imported.stdout.trim()).toBe('imported');
});
