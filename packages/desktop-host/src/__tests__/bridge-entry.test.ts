import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * @file The `./bridge` entry is what a renderer bundle imports, so `bridge.ts` must stay free of Node
 * built-ins and of relative imports: either would pull `node:*` (or the sidecar and registry modules
 * the root entry re-exports) into a browser build. The scan reads the source so it runs without a build.
 */
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

function importSpecifiers({ source }: { source: string }): string[] {
  return [...source.matchAll(SPECIFIER)].map(match => match[1]!);
}

describe('./bridge entry', () => {
  const source = readFileSync(new URL('../bridge.ts', import.meta.url), 'utf8');

  it('imports no node: built-in', () => {
    expect(importSpecifiers({ source }).filter(specifier => specifier.startsWith('node:'))).toEqual([]);
  });

  it('imports no relative module', () => {
    expect(importSpecifiers({ source }).filter(specifier => specifier.startsWith('.'))).toEqual([]);
  });

  it('is published as its own universal entry next to the root entry', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(manifest.exports['./bridge']).toEqual({ types: './dist/bridge.d.ts', import: './dist/bridge.js', default: './dist/bridge.js' });
    expect(manifest.jini.entries['./bridge']).toBe('universal');
  });

  it('the scan sees every import form: static, side-effect, dynamic and re-export', () => {
    const forms = `import a from 'node:fs';\nimport 'node:os';\nconst b = import('./x.js');\nexport * from "../y.js";`;
    expect(importSpecifiers({ source: forms })).toEqual(['node:fs', 'node:os', './x.js', '../y.js']);
  });
});
