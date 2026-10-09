import { describe, expect, it } from 'vitest';
import { assertPackedExports } from '../lib/packed-exports.js';

// cms@0.5.3's !forms/** also excluded dist/forms/**, while dist/index.* still shipped.
const cms053 = {
  name: '@jini-ai/cms', version: '0.5.3', files: ['dist', '!forms/**'],
  exports: {
    '.': { types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' },
    './forms': { types: './dist/forms/index.d.ts', import: './dist/forms/index.js', default: './dist/forms/index.js' },
  },
};
const cms053Tarball = ['package/package.json', 'package/dist/index.js', 'package/dist/index.d.ts'];

describe('packed export targets', () => {
  it('rejects cms@0.5.3 when dist exists but the exported forms subpath is absent', () => {
    expect(() => assertPackedExports({ manifest: cms053, packedPaths: cms053Tarball })).toThrow(
      '@jini-ai/cms: exported paths missing from tarball: ./dist/forms/index.d.ts, ./dist/forms/index.js');
  });

  it('accepts the same manifest once both forms runtime and declaration files ship', () => {
    expect(() => assertPackedExports({ manifest: cms053, packedPaths: [
      ...cms053Tarball, 'package/dist/forms/index.js', 'package/dist/forms/index.d.ts',
    ] })).not.toThrow();
  });

  it.each(['types', 'import', 'default', 'require'])('checks a missing %s target under nested conditions', condition => {
    const manifest = { name: '@jini-ai/fixture', exports: {
      '.': { node: { [condition]: './dist/missing.js' }, browser: './dist/browser.js' },
    } };
    expect(() => assertPackedExports({ manifest, packedPaths: ['package/dist/browser.js'] })).toThrow(
      '@jini-ai/fixture: exported paths missing from tarball: ./dist/missing.js');
  });

  it('checks every array alternative rather than allowing an existing first target to hide a missing one', () => {
    expect(() => assertPackedExports({ manifest: { name: 'fixture', exports: ['./dist/first.js', './dist/second.js'] },
      packedPaths: ['package/dist/first.js'] })).toThrow('fixture: exported paths missing from tarball: ./dist/second.js');
  });

  it('accepts string exports, nested conditions, null exclusions and wildcard families', () => {
    expect(() => assertPackedExports({ manifest: { name: 'fixture', exports: {
      '.': './dist/index.js', './disabled': null,
      './contracts/*': { types: './dist/contracts/*.d.ts', import: './dist/contracts/*.js' },
      './node': { node: { require: './dist/node.cjs' }, default: './dist/index.js' },
    } }, packedPaths: ['package/dist/index.js', 'package/dist/contracts/a.js',
      'package/dist/contracts/a.d.ts', 'package/dist/node.cjs'] })).not.toThrow();
  });

  it('rejects a wildcard family with no packed files', () => {
    expect(() => assertPackedExports({ manifest: { name: 'fixture', exports: { './forms/*': './dist/forms/*.js' } },
      packedPaths: cms053Tarball })).toThrow('fixture: exported paths missing from tarball: ./dist/forms/*.js');
  });

  it('does not accept a directory listing in place of an exported file', () => {
    expect(() => assertPackedExports({ manifest: { name: 'fixture', exports: './dist/index.js' },
      packedPaths: ['package/dist/index.js/'] })).toThrow('fixture: exported paths missing from tarball: ./dist/index.js');
  });

  it('rejects a non-relative export target', () => {
    expect(() => assertPackedExports({ manifest: { name: 'fixture', exports: '/dist/index.js' },
      packedPaths: ['package/dist/index.js'] })).toThrow('fixture: invalid export target: /dist/index.js');
  });
});
