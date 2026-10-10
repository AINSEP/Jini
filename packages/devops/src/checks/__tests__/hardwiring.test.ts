import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { createHardwiringInspector, diffHardwiringDebt } from '../hardwiring.js';
import type { HardwiringSource } from '../hardwiring.js';

const inspector = createHardwiringInspector({ compiler: ts });
const scan = (source: string, options: Partial<HardwiringSource> = {}) => inspector.inspect({ file: 'packages/daemon/src/service.ts', source, mode: 'jini', server: true, ...options });
const rules = (source: string, options: Partial<HardwiringSource> = {}) => scan(source, options).map((v) => v.rule);

describe('hardwiring audit fixtures (bad and clean for every guard)', () => {
  it('HW1 permits only an injected env default, with bin/cli/testing exceptions', () => {
    expect(rules('export function make() { return process.env.KEY; }')).toEqual(['HW1-env-default']);
    expect(rules('export function make(input) { return input.env ?? process.env; }')).toEqual([]);
    expect(rules('export const key = process["env"]["KEY"];')).toEqual(['HW1-env-default']);
    expect(rules('export const key = process.env.KEY;', { file: 'packages/cli/src/cli/main.ts' })).toEqual([]);
    expect(rules('const key = (input.env ?? process.env).KEY;')).toEqual([]);
  });

  it('HW2 catches static, type, dynamic and CommonJS driver/vendor imports', () => {
    for (const source of ['import Database from "better-sqlite3";', 'import type { Pool } from "pg";', 'const sdk = import("@anthropic-ai/sdk");', 'const sdk = require("openai");', 'export * from "@electric-sql/pglite";', 'import { Client } from "@modelcontextprotocol/sdk/client/index.js";', 'const driver = import("playwright");']) {
      expect(rules(source)).toEqual(['HW2-vendor-adapter']);
      expect(rules(source, { file: 'packages/db/src/adapters/sqlite.ts' })).toEqual([]);
    }
    expect(rules('import { readFile } from "node:fs";')).toEqual([]);
    expect(rules('import Database from "better-sqlite3";', { file: 'packages/db/src/catalogs/index.ts' })).toEqual(['HW2-vendor-adapter']);
  });

  it('HW3 catches module let/var and mutable collections, while instance state and readonly collections pass', () => {
    expect(rules('let state = 0; const cache = new Map(); const seen = new Set();')).toEqual(['HW3-module-state', 'HW3-module-state', 'HW3-module-state']);
    expect(rules('const cache: ReadonlyMap<string, number> = new Map(); function make() { let state = 0; return new Map(); }')).toEqual([]);
    expect(rules('if (enabled) { let shared = 0; }')).toEqual(['HW3-module-state']);
    expect(rules('const cache: Readonly<Map<string, number>> = new Map();')).toEqual(['HW3-module-state']);
  });

  it('HW4 rejects global calls and accepts injected fetch, including its native default', () => {
    expect(rules('export async function load() { return fetch(url); }')).toEqual(['HW4-injected-fetch']);
    expect(rules('export async function load() { return globalThis.fetch(url); }')).toEqual(['HW4-injected-fetch']);
    expect(rules('const fetch = globalThis.fetch; export async function load() { return fetch(url); }')).toEqual(['HW4-injected-fetch']);
    expect(rules('export async function load({ fetch = globalThis.fetch }) { return fetch(url); }')).toEqual([]);
    expect(rules('export function load(input) { return input.fetch(url); }')).toEqual([]);
    expect(rules('function other({ fetch }) {} function load() { return fetch(url); }')).toEqual(['HW4-injected-fetch']);
  });

  it('HW5 finds declared, arrow and aliased exported functions, but allows owner imports and reexports', () => {
    const options: Partial<HardwiringSource> = { mode: 'consumer', jiniExports: new Set(['escapeHtml']) };
    for (const source of ['export function escapeHtml(input) { return input; }', 'export const escapeHtml = (input) => input;', 'function local(input) { return input; } export { local as escapeHtml };']) expect(rules(source, options)).toEqual(['HW5-jini-export']);
    expect(rules('import { escapeHtml } from "@jini-ai/platform/html"; export { escapeHtml };', options)).toEqual([]);
    expect(rules('export function ownCmsBehavior(input) { return input; }', options)).toEqual([]);
    const declaration = inspector.parse({ file: 'published.d.ts', source: 'export declare const escapeHtml: (input: string) => string;' });
    expect(inspector.exportedFunctions({ tree: declaration }).map((item) => item.name)).toEqual(['escapeHtml']);
  });

  it('HW6 refuses uncovered insecure salt/password defaults and requires the exact env key', () => {
    const options: Partial<HardwiringSource> = { mode: 'consumer', bootCoveredEnv: new Set(['SAFE_KEY']) };
    expect(rules('const salt = process.env.OTHER_KEY ?? "dev-only-insecure-salt";', options)).toEqual(['HW6-boot-default']);
    expect(rules('const password = input.password ?? DEFAULT_OWNER_PASSWORD;', options)).toEqual(['HW6-boot-default']);
    expect(rules('const salt = process.env.SAFE_KEY ?? "dev-only-insecure-salt";', options)).toEqual([]);
    expect(rules('const password = input.password ?? "ordinary-display-copy";', options)).toEqual([]);
  });

  it('HW7 follows transitive runtime imports, barrels, cycles and require; type-only edges pass', () => {
    const sources: Record<string, string> = { 'entry.ts': 'import "./barrel";', 'barrel.ts': 'export * from "./widget";', 'widget.ts': 'import "./barrel"; const view = require("react-dom/client");' };
    const graph = () => inspector.inspectPublicGraph({ entries: ['entry.ts'], readSource: (file) => sources[file]!, resolveImport: (specifier) => specifier.slice(2) + '.ts', displayFile: (file) => file });
    expect(graph().map((v) => [v.rule, v.file])).toEqual([['HW7-public-react', 'widget.ts']]);
    sources['widget.ts'] = 'import type { ReactNode } from "react"; export const view = 1;';
    expect(graph()).toEqual([]);
    sources['widget.ts'] = 'const view = import("react");';
    expect(graph().map((v) => v.rule)).toEqual(['HW7-public-react']);
    sources['widget.ts'] = 'import { type ReactNode } from "react";';
    expect(graph().map((v) => v.rule)).toEqual(['HW7-public-react']);
  });

  it('HW7 accounts for the automatic JSX runtime without an explicit React import', () => {
    expect(inspector.inspectPublicGraph({ entries: ['entry.tsx'], readSource: () => 'export const view = <div />;', resolveImport: () => undefined, displayFile: (file) => file }).map((v) => v.rule)).toEqual(['HW7-public-react']);
  });

  it('HW8 catches literal and template API URLs, keeping catalogs/providers clean', () => {
    for (const source of ['const url = "https://api.vendor.example/v1";', 'const url = `https://api.${vendor}/v1`;']) {
      expect(rules(source)).toEqual(['HW8-provider-url']);
      expect(rules(source, { file: 'packages/integrations/src/providers/vendor.ts' })).toEqual([]);
      expect(rules(source, { file: 'packages/integrations/src/catalogs/vendor.ts' })).toEqual([]);
    }
    expect(rules('const url = "https://docs.example/guide";')).toEqual([]);
  });

  it('HW9 forbids cross-plugin static/type/dynamic/reexport imports, including site to agent', () => {
    const options: Partial<HardwiringSource> = { mode: 'consumer', file: 'site.ts', pluginIdentity: (file) => file.startsWith('site') ? 'site' : file.startsWith('agent') ? 'agent' : undefined, resolveImport: (specifier) => specifier + '.ts' };
    for (const source of ['import { tool } from "agent";', 'import type { Tool } from "agent";', 'const tool = import("agent");', 'export * from "agent";']) expect(rules(source, options)).toEqual(['HW9-plugin-import']);
    expect(rules('import { helper } from "site-helper";', options)).toEqual([]);
    expect(rules('import { port } from "host-port";', options)).toEqual([]);
  });

  it('comments and string-shaped code do not create syntax violations', () => {
    expect(rules('// process.env.KEY; fetch(url); import("pg");\nconst example = "process.env.KEY; fetch(url); import(pg)";')).toEqual([]);
  });

  it('debt is per occurrence, independent of line shifts; modified syntax cannot reuse a waiver', () => {
    const baseline = scan('let cache = 0;');
    const shifted = scan('\n\nlet cache = 0;');
    expect(diffHardwiringDebt({ baseline, current: shifted })).toEqual({ added: [], removed: [] });
    const repeated = scan('let cache = 0; let cache = 0;');
    expect(diffHardwiringDebt({ baseline, current: repeated }).added).toHaveLength(1);
    expect(diffHardwiringDebt({ baseline, current: scan('let other = 0;') }).added).toHaveLength(1);
    expect(diffHardwiringDebt({ baseline, current: [] }).removed).toEqual(baseline);
    expect(baseline[0]?.reason).not.toContain('let cache');
    expect(baseline[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});

it('review lg: env parameter and destructuring defaults pass, direct module env capture fails', () => {
  for (const source of [
    'function make(input, env = process.env) { return env.KEY; }',
    'function make({ env = process.env }) { return env.KEY; }',
    'const { env = (process.env) } = options;',
  ]) expect(rules(source)).toEqual([]);
  expect(rules('const env = process.env;')).toEqual(['HW1-env-default']);
});

it('review lg: identifying values survive implementation, import binding and initializer edits', () => {
  const cases: Array<[string, string, Partial<HardwiringSource>]> = [
    ['export function escapeHtml(input) { return input; }', 'export function escapeHtml(input) { return String(input); }', { mode: 'consumer', jiniExports: new Set(['escapeHtml']) }],
    ['import { A } from "pg";', 'import { B as C } from "pg";', {}],
    ['let cache = 0;', 'let cache = 42;', {}],
    ['let { cache = 0 } = input;', 'let { cache = 42 } = changed;', {}],
    ['let [first, , last = 0] = input;', 'let [first, , last = 42] = changed;', {}],
    ['const key = process.env.KEY;', 'function changed() { return process.env.KEY; }', {}],
    ['function load() { return fetch(url); }', 'function load() { return fetch(other, options); }', {}],
    ['const password = process.env.KEY ?? "dev-only-insecure-old";', 'const password = process.env.KEY ?? "dev-only-insecure-new";', { mode: 'consumer' }],
    ['const url = "https://api.vendor.example";', 'const renamed = "https://api.vendor.example";', {}],
  ];
  for (const [before, after, options] of cases) {
    const baseline = scan(before, options);
    expect(baseline.length).toBeGreaterThan(0);
    expect(diffHardwiringDebt({ baseline, current: scan(after, options) })).toEqual({ added: [], removed: [] });
  }
  const baseline = scan('import { A } from "pg";');
  expect(diffHardwiringDebt({ baseline, current: scan('import { A } from "openai";') }).added).toHaveLength(1);
});

it('review lg: JSX edits do not create debt and one implicit JSX entry is emitted per authored file', () => {
  const graph = (source: string) => inspector.inspectPublicGraph({ entries: ['apps/view.tsx'], readSource: () => source, resolveImport: () => undefined, displayFile: file => file });
  const baseline = graph('export const view = <div>before</div>;');
  const current = graph('export const view = <section>after</section>; export const other = <div />;');
  expect(current).toHaveLength(1);
  expect(diffHardwiringDebt({ baseline, current })).toEqual({ added: [], removed: [] });
});

it('review lg: dependency debt records one package even with multiple internal React edges', () => {
  const sources: Record<string, string> = {
    'entry.ts': 'import "./first"; import "./second";',
    'first.ts': 'import "react";', 'second.ts': 'import "react-dom/client";',
  };
  const current = inspector.inspectPublicGraph({ entries: ['entry.ts'], readSource: file => sources[file]!,
    resolveImport: specifier => specifier.slice(2) + '.ts', displayFile: file => file === 'entry.ts' ? file : 'node_modules/fixture-widget' });
  expect(current.map(v => [v.file, v.line])).toEqual([['node_modules/fixture-widget', 1]]);
  sources['first.ts'] = 'import { changed } from "react-dom";';
  const edited = inspector.inspectPublicGraph({ entries: ['entry.ts'], readSource: file => sources[file]!,
    resolveImport: specifier => specifier.slice(2) + '.ts', displayFile: file => file === 'entry.ts' ? file : 'node_modules/fixture-widget' });
  expect(diffHardwiringDebt({ baseline: current, current: edited })).toEqual({ added: [], removed: [] });
});

it('review lg: malformed authored source and reachable graph modules fail with a source-safe location', () => {
  expect(() => scan('const broken = ;')).toThrow('Cannot parse packages/daemon/src/service.ts: syntax error at line 1.');
  expect(() => inspector.inspectPublicGraph({ entries: ['broken.ts'], readSource: () => 'const broken = ;',
    resolveImport: () => undefined, displayFile: file => file })).toThrow('Cannot parse broken.ts: syntax error at line 1.');
});


it('distinguishes positional array binding holes in declaration debt identity', () => {
  const baseline = scan('let [first, , last] = input;');
  const shifted = scan('let [first, last] = input;');
  expect(baseline).toHaveLength(1);
  expect(shifted).toHaveLength(1);
  const diff = diffHardwiringDebt({ baseline, current: shifted });
  expect(diff.added).toEqual(shifted);
  expect(diff.removed).toEqual(baseline);
});
