import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { createResolver, displayGraphFile, installedPublicFunctions, runHardwiring, sourceFiles } from '../hardwiring-node.js';
import { createHardwiringInspector } from '../hardwiring.js';

function fixture(run: (root: string, put: (file: string, text: string) => void) => void): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hardwiring-node-')));
  const put = (file: string, text: string) => {
    const target = join(root, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, text);
  };
  try { run(root, put); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('review lg: shared Node adapters', () => {
  it('HW5 sees installed public declarations, aliases, barrels and wildcard entries, never private or checkout exports', () => {
    fixture((root, put) => {
      const dir = 'node_modules/@jini-ai/fixture/';
      put(dir + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './tools/*': { types: './dist/tools/*.d.ts' } } }));
      put(dir + 'dist/index.d.ts', 'export { owner as publicAlias } from "./owner.js"; export * from "./barrel.js";');
      put(dir + 'dist/index.js', 'throw new Error("inventory must not execute package code");');
      put(dir + 'dist/owner.d.ts', 'export declare function owner(input: unknown): string; export declare function privateSibling(input: unknown): string;');
      put(dir + 'dist/barrel.d.ts', 'export declare const publicArrow: (input: unknown) => string; export interface TypeOnly { (): string; }');
      put(dir + 'dist/tools/read.d.ts', 'export declare function publicTool(input: unknown): string;');
      put(dir + 'dist/private.d.ts', 'export declare function hidden(input: unknown): string;');
      put('packages/fixture/src/index.ts', 'export function unpublished() {}');
      expect([...installedPublicFunctions({ root, compiler: ts })].sort()).toEqual(['publicAlias', 'publicArrow', 'publicTool']);
    });
  });

  it('HW5 fails closed on missing inventory, empty public exports and malformed declarations', () => {
    fixture((root, put) => {
      expect(() => installedPublicFunctions({ root, compiler: ts })).toThrow('Jini export inventory unavailable; install the declared packages.');
      const dir = 'node_modules/@jini-ai/fixture/';
      put(dir + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { '.': { types: './index.d.ts' } } }));
      put(dir + 'index.d.ts', 'export declare const value: number;');
      expect(() => installedPublicFunctions({ root, compiler: ts })).toThrow('Jini export inventory is empty; refusing a vacuous duplication check.');
      put(dir + 'index.d.ts', 'export declare function broken(;');
      expect(() => installedPublicFunctions({ root, compiler: ts })).toThrow(`Cannot parse ${join(root, dir, 'index.d.ts')}: syntax error at line 1.`);
    });
  });

  it('source inventory excludes tests, fixtures and build output', () => {
    fixture((root, put) => {
      put('src/owner.ts', 'export function owner() {}');
      put('src/owner.d.ts', 'export declare function owner(): void;');
      for (const file of ['src/__tests__/bad.ts', 'src/fixtures/bad.ts', 'dist/bad.js', 'src/owner.spec.ts', 'node_modules/bad.ts']) put(file, 'fetch(url);');
      expect(sourceFiles({ directory: root })).toEqual([join(root, 'src/owner.ts')]);
    });
  });

  it('debt stops at package ownership while apps and content remain file-specific', () => {
    fixture((root, put) => {
      for (const directory of ['workspace/package', 'node_modules/package']) {
        put(directory + '/package.json', JSON.stringify({ name: '@jini-ai/widget' }));
        expect(displayGraphFile({ root, file: join(root, directory, 'dist/view.js') })).toBe('node_modules/@jini-ai/widget');
      }
      expect(displayGraphFile({ root, file: join(root, 'apps/site-chat/src/main.tsx') })).toBe('apps/site-chat/src/main.tsx');
      expect(displayGraphFile({ root, file: join(root, 'content/public/widget.tsx') })).toBe('content/public/widget.tsx');
    });
  });

  it('runtime resolution uses browser executable exports and host-supplied aliases, and rejects missing code', () => {
    fixture((root, put) => {
      put('node_modules/widget/package.json', JSON.stringify({ name: 'widget', exports: { '.': { types: './index.d.ts', browser: './browser.js', default: './server.js' } } }));
      put('node_modules/widget/index.d.ts', 'export declare const view: number;');
      put('node_modules/widget/browser.js', 'import "react";');
      put('node_modules/widget/server.js', 'export const view = 1;');
      put('src/entry.ts', '');
      put('src/owner.ts', 'export const value = 1;');
      const entry = join(root, 'src/entry.ts');
      const resolver = createResolver({ root, compiler: ts, runtime: true, aliases: { '#host/': join(root, 'src') } });
      expect(resolver('widget', entry)).toBe(join(root, 'node_modules/widget/browser.js'));
      expect(resolver('#host/owner', entry)).toBe(join(root, 'src/owner.ts'));
      expect(resolver('node:fs', entry)).toBeUndefined();
      expect(() => resolver('./missing', entry)).toThrow('Unresolved code import in src/entry.ts (specifier omitted); refusing an incomplete public/plugin graph.');
    });
  });

  it('the shared generator writes exact current debt and preserves the occurrence ratchet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hardwiring-debt-'));
    try {
      const debtPath = join(root, 'debt.json');
      const inspector = createHardwiringInspector({ compiler: ts });
      const current = inspector.inspect({ file: 'owner.ts', mode: 'jini', source: 'let cache = 0;' });
      const lines: string[] = [];
      const logger = { log: (value: string) => { lines.push(value); }, error: (value: string) => { lines.push(value); } };
      const required = { debtPath, collect: () => current, baselineComment: 'fixture', logger };
      expect(await runHardwiring(required, { writeBaseline: true })).toEqual([]);
      expect(JSON.parse(readFileSync(debtPath, 'utf8'))).toEqual({ _comment: 'fixture', violations: current });
      expect(await runHardwiring({ ...required, collect: () => [...current, ...current] })).toEqual(current);
      expect(lines).toContain('[hardwiring] HW3-module-state: 2 total; 1 new');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
