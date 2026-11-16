import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNodeRuntimeResolver } from '../staged-closure-node.js';

const FLAG = '--experimental-import-meta-resolve';
const original = [...process.execArgv];
afterEach(() => { process.execArgv.splice(0, process.execArgv.length, ...original); });

describe('createNodeRuntimeResolver', () => {
  it('refuses to build without Node import.meta.resolve enabled', () => {
    expect(process.execArgv).not.toContain(FLAG);
    expect(() => createNodeRuntimeResolver({})).toThrow('staged closure needs node --experimental-import-meta-resolve to resolve from each staged importer');
  });

  it('resolves require edges from the importing file using real Node resolution', () => {
    process.execArgv.push(FLAG);
    const dir = mkdtempSync(join(tmpdir(), 'jini-resolver-'));
    try {
      mkdirSync(join(dir, 'node_modules/dep'), { recursive: true });
      writeFileSync(join(dir, 'node_modules/dep/package.json'), JSON.stringify({ name: 'dep', main: 'main.js' }));
      writeFileSync(join(dir, 'node_modules/dep/main.js'), 'exports.ok = 1;');
      writeFileSync(join(dir, 'importer.js'), '');
      const resolver = createNodeRuntimeResolver({});
      expect(resolver.resolve({ fromFile: join(dir, 'importer.js'), specifier: 'dep', kind: 'require' })).toBe(join(dir, 'node_modules/dep/main.js'));
      expect(() => resolver.resolve({ fromFile: join(dir, 'importer.js'), specifier: 'absent-dep', kind: 'require' })).toThrow(/absent-dep/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('resolves import edges with the importer as parent URL and returns a file path', () => {
    process.execArgv.push(FLAG);
    const calls: Array<[string, string]> = [];
    const resolver = createNodeRuntimeResolver({}, { importResolve: (specifier, parent) => { calls.push([specifier, parent]); return pathToFileURL('/stage/node_modules/dep/esm.js').href; } });
    expect(resolver.resolve({ fromFile: '/stage/dist/a.js', specifier: 'dep', kind: 'import' })).toBe('/stage/node_modules/dep/esm.js');
    expect(calls).toEqual([['dep', 'file:///stage/dist/a.js']]);
  });

  it('propagates a resolution failure from the import path', () => {
    process.execArgv.push(FLAG);
    const resolver = createNodeRuntimeResolver({}, { importResolve: () => { throw new Error('ERR_MODULE_NOT_FOUND'); } });
    expect(() => resolver.resolve({ fromFile: '/stage/a.js', specifier: 'x', kind: 'import' })).toThrow('ERR_MODULE_NOT_FOUND');
  });
});
