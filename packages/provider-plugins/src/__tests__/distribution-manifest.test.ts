/** The published distribution ships only the providers with no package of their own (the charts):
 * its files, exports, build script and catalog name the same ids at the package version. */
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

const packageRoot = new URL('../../', import.meta.url);
const read = async (file: string) => JSON.parse(await readFile(new URL(file, packageRoot), 'utf8')) as unknown;
const CHARTS = ['charts-echarts', 'charts-recharts'];

it('files, exports and the build name each chart provider; nothing else ships a payload', async () => {
  const manifest = await read('package.json') as { private?: boolean; files: string[]; exports: Record<string, string>; scripts: Record<string, string> };
  expect(manifest.private).toBeUndefined();
  expect(manifest.files.filter(file => file.startsWith('plugins'))).toEqual(CHARTS.map(id => `plugins/${id}`));
  for (const id of CHARTS) {
    expect(manifest.exports[`./${id}/*`]).toBe(`./plugins/${id}/*`);
    expect(manifest.scripts.build).toContain(`scripts/build.ts ${id} .`);
  }
  expect(manifest.exports['./package.json']).toBe('./package.json');
});

it('catalog.json lists exactly the shipped charts at the package version', async () => {
  const { version } = await read('package.json') as { version: string };
  expect(await read('catalog.json')).toEqual(CHARTS.map(id => ({ id, version, path: `plugins/${id}/${version}` })));
});
