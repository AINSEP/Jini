import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractImports, listSourceFiles } from '../lib/walk-imports.js';

describe('shared import extraction', () => {
  let directory: string;
  function refs(source: string) {
    const file = join(directory, 'entry.ts');
    writeFileSync(file, source);
    return extractImports(file).map(({ specifier, typeOnly }) => ({ specifier, typeOnly }));
  }
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'jini-walk-imports-')); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('does not let a value declaration consume a following type export', () => {
    expect(refs("export const active = true;\nexport type { Shape } from './shape.js';")).toEqual([
      { specifier: './shape.js', typeOnly: true },
    ]);
  });
  it('distinguishes erased and mixed clauses, bare and dynamic imports', () => {
    expect(refs(`
      import type { A } from './a.js';
      import { type B, type C } from './b.js';
      import { D, type E } from './d.js';
      export { type F } from './f.js';
      import './initialize.js';
      const lazy = import('./lazy.js');
    `)).toEqual([
      { specifier: './a.js', typeOnly: true },
      { specifier: './b.js', typeOnly: true },
      { specifier: './d.js', typeOnly: false },
      { specifier: './f.js', typeOnly: true },
      { specifier: './initialize.js', typeOnly: false },
      { specifier: './lazy.js', typeOnly: false },
    ]);
  });
  it('ignores import-shaped strings, regex literals and comments', () => {
    expect(refs(`
      // import './comment.js';
      const sample = "export * from './string.js';";
      const template = \`import './template.js';\`;
      const pattern = /https?:\\/\\//;
      import { real } from './real.js';
    `)).toEqual([{ specifier: './real.js', typeOnly: false }]);
  });
  it('sees dynamic imports inside template substitutions', () => {
    expect(refs("const label = `${import('./runtime.js')}`;")).toEqual([{ specifier: './runtime.js', typeOnly: false }]);
  });
  it('supports require, createRequire aliases and import equals', () => {
    expect(refs(`
      import { createRequire } from 'node:module';
      const requirePackage = createRequire(import.meta.url);
      const driver = requirePackage('driver');
      const other = require('other');
      import legacy = require('legacy');
    `)).toEqual([
      { specifier: 'node:module', typeOnly: false },
      { specifier: 'driver', typeOnly: false },
      { specifier: 'other', typeOnly: false },
      { specifier: 'legacy', typeOnly: false },
    ]);
  });
  it('inventories mts/cts source, skips declarations and optionally includes build-free JS', () => {
    for (const name of ['one.ts', 'two.mts', 'three.cts', 'four.js', 'five.cjs', 'one.d.ts', 'two.d.mts'])
      writeFileSync(join(directory, name), '');
    expect(listSourceFiles(directory).map(file => file.slice(directory.length + 1)).sort()).toEqual(['one.ts', 'three.cts', 'two.mts']);
    expect(listSourceFiles(directory, { includeJavaScript: true })).toHaveLength(5);
  });
});
