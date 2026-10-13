// @vitest-environment node
/** Import the publishable dist tree in a clean consumer with forbidden packages absent. */
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
const execute = promisify(execFile);

it('imports headless and React UI exports without Recharts or the private artifact package', async () => {
  const packageRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
    expect(manifest[section]?.recharts).toBeUndefined();
    expect(manifest[section]?.['@jini-ai/charts-recharts']).toBeUndefined();
  }
  const consumer = await mkdtemp(join(tmpdir(), 'jini-ui-chart-consumer-'));
  try {
    const installed = join(consumer, 'node_modules/@jini-ai/ui');
    await mkdir(installed, { recursive: true });
    // The release coordinator can provide its real npm tarball; this job never packs a package.
    // Before release, the same check uses the publishable dist layout after a clean UI build.
    if (process.env.JINI_UI_TARBALL) {
      await execute('tar', ['-xzf', process.env.JINI_UI_TARBALL, '-C', consumer]);
      await cp(join(consumer, 'package'), installed, { recursive: true });
    } else {
      await writeFile(join(installed, 'package.json'), JSON.stringify(manifest));
      await cp(join(packageRoot, 'dist'), join(installed, 'dist'), { recursive: true, filter: (path) => !path.includes('__tests__') && !path.includes('test-support') && !path.includes('.test.') });
    }
    // Incremental tsc can leave removed files behind; a publishable extraction must be clean.
    await expect(access(join(installed, 'dist/features/interactive-ui/providers/recharts'))).rejects.toMatchObject({ code: 'ENOENT' });
    const packed = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    for (const section of ['dependencies', 'peerDependencies']) {
      expect(packed[section]?.recharts).toBeUndefined();
      expect(packed[section]?.['@jini-ai/charts-recharts']).toBeUndefined();
    }
    for (const name of new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])) {
      const target = join(consumer, 'node_modules', name);
      await mkdir(dirname(target), { recursive: true });
      await symlink(join(packageRoot, 'node_modules', name), target);
    }
    // Symlinked peers may live in pnpm's store. Block transitive fallback to any forbidden package
    // there as well, so local development installs cannot conceal a leaking published import.
    await writeFile(join(consumer, 'deny-loader.mjs'), `export async function resolve(name, context, next) {
      if (/^(?:recharts|@jini-ai\\/charts-recharts)(?:\\/|$)/.test(name) || (process.env.JINI_CHART_HEADLESS === '1' && /^(?:react|react-dom)(?:\\/|$)/.test(name))) throw new Error('Forbidden chart dependency: ' + name);
      return next(name, context);
    }`);
    await writeFile(join(consumer, 'probe.mjs'), `
      import { chartSpecSchema } from '@jini-ai/ui/charts';
      import { mountChart } from '@jini-ai/ui/charts/browser';
      import { ChartHost } from '@jini-ai/ui/charts/react';
      import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '@jini-ai/ui/interactive-ui';
      import { buildA2uiCatalogFromRegistry } from '@jini-ai/ui/a2ui';
      if (!chartSpecSchema || typeof mountChart !== 'function' || typeof ChartHost !== 'function') throw new Error('Missing chart exports');
      const catalog = buildA2uiCatalogFromRegistry({ registry: DEFAULT_INTERACTIVE_UI_REGISTRY, catalogId: 'probe' });
      if (!catalog.components.has('recharts.bar-chart')) throw new Error('Missing wire alias');
      process.stdout.write('chart imports ok');
    `);
    await writeFile(join(consumer, 'headless.mjs'), `import '@jini-ai/ui/charts'; import '@jini-ai/ui/charts/browser'; process.stdout.write('headless imports ok');`);
    const headless = await execute(process.execPath, ['--experimental-loader', './deny-loader.mjs', './headless.mjs'], { cwd: consumer, env: { ...process.env, JINI_CHART_HEADLESS: '1' } });
    expect(headless.stdout).toBe('headless imports ok');
    const result = await execute(process.execPath, ['--experimental-loader', './deny-loader.mjs', './probe.mjs'], { cwd: consumer });
    expect(result.stdout).toBe('chart imports ok');
  } finally { await rm(consumer, { recursive: true, force: true }); }
});
