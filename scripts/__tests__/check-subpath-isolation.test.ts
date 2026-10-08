import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditSubpathIsolation, checkSubpathIsolation } from '../check-subpath-isolation.js';
import { runPublishHygieneSelfTest } from '../lib/publish-hygiene-self-test.js';

describe('source subpath and installation isolation', () => {
  let root: string;
  function write(required: { file: string; content: string }, _optional = {}): void {
    const file = join(root, required.file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, required.content);
  }
  function manifest(optional: Record<string, unknown> = {}): void {
    write({ file: 'packages/sample/package.json', content: JSON.stringify({
      name: '@jini-ai/sample', sideEffects: false,
      exports: { './alpha': './dist/alpha/index.js', './beta': './dist/beta/index.js', './core': './dist/core/index.js' },
      ...optional,
    }) });
  }
  function findings() { return checkSubpathIsolation({ repoRoot: root }); }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jini-subpath-isolation-'));
    manifest();
    for (const domain of ['alpha', 'beta', 'core'])
      write({ file: `packages/sample/src/${domain}/index.ts`, content: `export const ${domain} = true;` });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    "export { beta } from '../beta/index.js';",
    "import '../beta/index.js';",
    "const value = import('../beta/index.js');",
    "const value = require('../beta/index.js');",
    "import { beta, type SomeType } from '../beta/index.js';",
  ])('rejects a sibling runtime edge: %s', content => {
    write({ file: 'packages/sample/src/alpha/index.ts', content });
    expect(findings()).toEqual([{
      rule: 'SI-domain', file: 'packages/sample/src/alpha/index.ts',
      reason: './alpha (alpha) reaches src/beta/index.ts (beta) via ../beta/index.js',
    }]);
  });

  it.each([
    "import type { SomeType } from '../beta/index.js';",
    "import { type SomeType, type AnotherType } from '../beta/index.js';",
    "export type { SomeType } from '../beta/index.js';",
    "export { type SomeType } from '../beta/index.js';",
    "const source = \"import { beta } from '../beta/index.js'\";",
    "// import '../beta/index.js';\nexport { core } from '../core/index.js';",
  ])('accepts erased types, source strings and shared core: %s', content => {
    write({ file: 'packages/sample/src/alpha/index.ts', content });
    expect(findings()).toEqual([]);
  });

  it('follows a core bridge to the sibling without trusting the shared path', () => {
    write({ file: 'packages/sample/src/alpha/index.ts', content: "export * from '../core/index.js';" });
    write({ file: 'packages/sample/src/core/index.ts', content: "export * from '../beta/index.js';" });
    expect(findings().filter(finding => finding.reason.startsWith('./alpha'))).toEqual([{
      rule: 'SI-domain', file: 'packages/sample/src/core/index.ts',
      reason: './alpha (alpha) reaches src/beta/index.ts (beta) via ../beta/index.js',
    }]);
  });

  it('follows a Jini dependency back into the original package', () => {
    write({ file: 'packages/bridge/package.json', content: JSON.stringify({ name: '@jini-ai/bridge', exports: { '.': './dist/index.js' } }) });
    write({ file: 'packages/bridge/src/index.ts', content: "export { beta } from '@jini-ai/sample/beta';" });
    write({ file: 'packages/sample/src/alpha/index.ts', content: "export * from '@jini-ai/bridge';" });
    const alpha = auditSubpathIsolation({ repoRoot: root }).closures.find(closure => closure.subpath === './alpha');
    expect(alpha?.files).toContain('packages/sample/src/beta/index.ts');
    expect(findings()).toContainEqual({
      rule: 'SI-domain', file: 'packages/bridge/src/index.ts',
      reason: './alpha (alpha) reaches src/beta/index.ts (beta) via @jini-ai/sample/beta',
    });
  });

  it('checks conditional require targets as well as import targets', () => {
    manifest({ exports: { './alpha': { import: './dist/alpha/index.js', require: './dist/cjs/alpha/leak.js' }, './beta': './dist/beta/index.js' } });
    write({ file: 'packages/sample/src/alpha/leak.ts', content: "export * from '../beta/index.js';" });
    expect(findings()).toHaveLength(1);
    expect(findings()[0]?.rule).toBe('SI-domain');
  });

  it('expands wildcard source entries and respects an explicit null override', () => {
    manifest({ exports: { './alpha/*': './dist/alpha/*.js', './alpha/private': null, './beta': './dist/beta/index.js' } });
    write({ file: 'packages/sample/src/alpha/leak.ts', content: "export * from '../beta/index.js';" });
    write({ file: 'packages/sample/src/alpha/private.ts', content: "export * from '../beta/index.js';" });
    const result = auditSubpathIsolation({ repoRoot: root });
    expect(result.closures.map(closure => closure.subpath)).not.toContain('./alpha/private');
    expect(result.findings.filter(finding => finding.kind === 'a').map(finding => finding.subpath)).toEqual(['./alpha/leak']);
  });

  it('maps nested adapters and aliases to their owning domain', () => {
    manifest({ exports: { './beta': './dist/beta/index.js', './beta/node': './dist/beta/node.js', './adapter': './dist/adapter/index.js' },
      jini: { isolation: { entries: { './adapter': 'beta' } } } });
    write({ file: 'packages/sample/src/beta/node.ts', content: "export { beta } from './index.js';" });
    write({ file: 'packages/sample/src/adapter/index.ts', content: "export { beta } from '../beta/index.js';" });
    expect(findings()).toEqual([]);
  });

  it('checks all source modules of a domain, not just its index file', () => {
    write({ file: 'packages/sample/src/beta/private.ts', content: 'export const secret = true;' });
    write({ file: 'packages/sample/src/alpha/index.ts', content: "export { secret } from '../beta/private.js';" });
    expect(findings()[0]?.rule).toBe('SI-domain');
  });

  it('keeps a named domain nested under core distinct from shared core', () => {
    manifest({ exports: { './core': './dist/core/index.js', './dom': './dist/core/dom/index.js' } });
    write({ file: 'packages/sample/src/core/dom/index.ts', content: 'export const dom = true;' });
    write({ file: 'packages/sample/src/core/index.ts', content: "export * from './dom/index.js';" });
    expect(findings()).toEqual([{
      rule: 'SI-domain', file: 'packages/sample/src/core/index.ts',
      reason: './core (core) reaches src/core/dom/index.ts (dom) via ./dom/index.js',
    }]);
  });

  it('reports subset-only dependencies even when a broad root also uses them', () => {
    manifest({ dependencies: { driver: '^1.0.0' }, exports: { '.': './dist/index.js', './alpha': './dist/alpha/index.js', './beta': './dist/beta/index.js' } });
    write({ file: 'packages/sample/src/index.ts', content: "export * from './alpha/index.js'; export * from './beta/index.js';" });
    write({ file: 'packages/sample/src/beta/index.ts', content: "import 'driver'; export const beta = true;" });
    expect(findings()).toEqual([{
      rule: 'SI-dependency', file: 'packages/sample/package.json',
      reason: 'driver is an install-time dependency used by 2/3 source closures; declare an optional peer and a development dependency',
    }]);
    expect(auditSubpathIsolation({ repoRoot: root }).findings.filter(finding => finding.kind === 'd')).toHaveLength(1);
  });

  it('permits a dependency required by every always-loaded core closure', () => {
    manifest({ dependencies: { driver: '*' } });
    write({ file: 'packages/sample/src/core/index.ts', content: "import 'driver'; export const core = true;" });
    for (const domain of ['alpha', 'beta']) write({ file: `packages/sample/src/${domain}/index.ts`, content: "export * from '../core/index.js';" });
    expect(findings()).toEqual([]);
  });

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'])('rejects a forced subset installation via %s', field => {
    manifest({ [field]: { driver: '*' } });
    write({ file: 'packages/sample/src/beta/index.ts', content: "import 'driver'; export const beta = true;" });
    expect(findings().map(finding => finding.rule)).toEqual(['SI-dependency']);
  });

  it('permits optional peers but does not let type-only usage justify a regular dependency', () => {
    write({ file: 'packages/sample/src/beta/index.ts', content: "import type { Driver } from 'driver'; export const beta = true;" });
    manifest({ dependencies: { driver: '*' } });
    expect(findings()[0]?.rule).toBe('SI-dependency');
    manifest({ peerDependencies: { driver: '*' }, peerDependenciesMeta: { driver: { optional: true } } });
    expect(findings()).toEqual([]);
  });

  it('counts build-free JavaScript and type-only aliases correctly', () => {
    manifest({ exports: { '.': './dist/core/index.js', './core': './dist/core/index.js', './alpha': './alpha.js' }, dependencies: { driver: '*' } });
    write({ file: 'packages/sample/alpha.js', content: "import 'driver'; export const value = 1;" });
    expect(findings()[0]?.reason).toContain('1/2 source closures');
  });

  it('allows CMS to register runtime restrictions without a second walker', () => {
    manifest({ jini: { entries: { './alpha': 'universal' }, isolation: { forbidden: { universal: ['node:', 'react'] } } } });
    write({ file: 'packages/sample/src/alpha/index.ts', content: "import 'node:fs'; import type { ReactNode } from 'react';" });
    expect(findings()).toEqual([{
      rule: 'SI-domain', file: 'packages/sample/src/alpha/index.ts', reason: './alpha: forbidden runtime import node:fs',
    }]);
  });

  it('fails closed on missing export sources and unresolved Jini imports', () => {
    manifest({ exports: { './missing': './dist/no-source.js', './alpha': './dist/alpha/index.js' } });
    write({ file: 'packages/sample/src/alpha/index.ts', content: "import '@jini-ai/unavailable';" });
    expect(findings().map(finding => finding.rule)).toEqual(['SI-resolution', 'SI-resolution']);
  });

  it('audits module effects without executing source and preserves CLI import guards', () => {
    write({ file: 'packages/sample/src/alpha/index.ts', content: "externalRegistry.register({}); const isMainModule = false; if (isMainModule) console.log('CLI'); export const alpha = true;" });
    const audit = auditSubpathIsolation({ repoRoot: root });
    expect(audit.findings.filter(finding => finding.kind === 'c').map(finding => finding.reason)).toEqual(['module top-level effect: line 1: externalRegistry.register']);
  });

  it('keeps the fail-closed guard self-test green', () => {
    expect(runPublishHygieneSelfTest()).toEqual([]);
  });
});
