/** The published distribution ships all provider runtimes:
 * its files, exports, build script and catalog name the same ids at the package version. */
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

const packageRoot = new URL('../../', import.meta.url);
const read = async (file: string) => JSON.parse(await readFile(new URL(file, packageRoot), 'utf8')) as unknown;
const PROVIDERS = ['ai-trace-langfuse', 'analytics-posthog', 'charts-echarts', 'charts-recharts', 'fixture-provider', 'formspree', 'google-forms', 'observability-opentelemetry', 'observability-sentry', 'payments-stripe'];

it('files, exports and the build name each provider runtime exactly once', async () => {
  const manifest = await read('package.json') as { private?: boolean; files: string[]; exports: Record<string, string>; scripts: Record<string, string> };
  expect(manifest.private).toBeUndefined();
  expect(manifest.files.filter(file => file.startsWith('plugins'))).toEqual(PROVIDERS.map(id => `plugins/${id}`));
  for (const id of PROVIDERS) {
    expect(manifest.exports[`./${id}/*`]).toBe(`./plugins/${id}/*`);
    expect(manifest.scripts.build).toContain(`scripts/build.ts ${id} .`);
  }
  expect(manifest.exports['./package.json']).toBe('./package.json');
});

it('catalog.json lists exactly the shipped providers at the package version', async () => {
  const { version } = await read('package.json') as { version: string };
  expect(await read('catalog.json')).toEqual(PROVIDERS.map(id => ({ id, version, path: `plugins/${id}/${version}` })));
});
