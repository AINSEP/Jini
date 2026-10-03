import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

it.each([
  ['./react/shell', 'react/shell/index', 'browser'],
  ['./react/entities', 'react/entities/index', 'browser'],
  ['./browser/shell-navigation', 'browser/shell-navigation', 'browser'],
])('publishes %s with declarations, ESM and matching runtime metadata', (subpath, target, runtime) => {
  expect(manifest.exports[subpath]).toEqual({
    types: `./dist/${target}.d.ts`,
    import: `./dist/${target}.js`,
    default: `./dist/${target}.js`,
  });
  expect(manifest.jini.entries[subpath]).toBe(runtime);
  expect(existsSync(new URL(`src/${target}.ts`, root))).toBe(true);
});

it('preserves the original package entry points', () => {
  for (const [subpath, target, runtime] of [
    ['.', 'core/index', 'universal'],
    ['./core', 'core/index', 'universal'],
    ['./browser', 'browser/index', 'browser'],
    ['./react', 'react/index', 'browser'],
  ] satisfies ReadonlyArray<readonly [string, string, string]>) {
    expect(manifest.exports[subpath]).toEqual({
      types: `./dist/${target}.d.ts`,
      import: `./dist/${target}.js`,
      default: `./dist/${target}.js`,
    });
    expect(manifest.jini.entries[subpath]).toBe(runtime);
  }
});
