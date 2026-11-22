import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { createEnvAccessInspector, ENV_ACCESS_RULES } from '../env-access.js';
import type { EnvAccessSource } from '../env-access.js';
import { createHardwiringInspector, diffHardwiringDebt } from '../hardwiring.js';

const hardwiring = createHardwiringInspector({ compiler: ts });
const envAccess = createEnvAccessInspector({ compiler: ts, inspector: hardwiring });
const scan = (source: string, options: Partial<EnvAccessSource> = {}) =>
  envAccess.inspect({ file: 'packages/daemon/src/service.ts', source, envRoot: false, buildDefine: false, ...options });
const rules = (source: string, options: Partial<EnvAccessSource> = {}) => scan(source, options).map(v => v.rule);
/** Both audits over the same file, as the host runs them: an allowance in one may not hide a finding of the other. */
const combined = (source: string, options: Partial<EnvAccessSource> = {}) => [
  ...hardwiring.inspect({ file: options.file ?? 'packages/daemon/src/service.ts', source, mode: 'jini', server: true }),
  ...scan(source, options),
].map(v => v.rule);

describe('env-access rules (one failing and one passing fixture per case)', () => {
  it('names exactly the two rules that need no name list', () => {
    expect([...ENV_ACCESS_RULES]).toEqual(['HW9-env-access', 'HW12-env-import-time']);
  });

  it('HW9: a declared process entry may read the ambient environment; any other file may not', () => {
    const source = 'export function port() { return process.env.PORT; }';
    expect(rules(source, { envRoot: true })).toEqual([]);
    expect(rules(source)).toEqual(['HW9-env-access']);
    expect(rules('export function port() { return process["env"]["PORT"]; }')).toEqual(['HW9-env-access']);
    expect(rules('export function mode() { return import.meta.env.MODE; }')).toEqual(['HW9-env-access']);
    expect(rules('export function mode() { return import.meta.env.MODE; }', { envRoot: true })).toEqual([]);
  });

  it('HW9: the injected-default forms count too, although HW1 still allows them', () => {
    expect(combined('export function make(input) { return input.env ?? process.env; }')).toEqual(['HW9-env-access']);
    expect(combined('export function make({ env = process.env }) { return env.KEY; }')).toEqual(['HW9-env-access']);
    expect(combined('export function make(env = process.env) { return env.KEY; }')).toEqual(['HW9-env-access']);
    expect(combined('export function make() { return process.env.KEY; }')).toEqual(['HW1-env-default', 'HW9-env-access']);
  });

  it('HW9: passing the whole object on, spreading it or handing it to a child is an access', () => {
    expect(rules('export function start() { return spawn("x", { env: process.env }); }')).toEqual(['HW9-env-access']);
    expect(rules('export function copy() { return { ...process.env }; }')).toEqual(['HW9-env-access']);
    expect(rules('export function all() { return Object.keys(process.env); }')).toEqual(['HW9-env-access']);
  });

  it('HW9: an injected map, a binding namespace, a type and a property that is only called env are not the ambient object', () => {
    expect(rules('export function make({ env }) { return env.KEY ?? env["OTHER"]; }')).toEqual([]);
    expect(rules('export default { async fetch(request, env) { return env.DB.prepare("select 1").all(); } };', { file: 'packages/agent-plugins/edge-host/worker/forms-receiver.mjs' })).toEqual([]);
    expect(rules('export function make(env: typeof process.env, other: NodeJS.ProcessEnv) { return env.KEY ?? other.KEY; }')).toEqual([]);
    expect(rules('export function make(host) { return host.process.env.KEY ?? host.env.KEY; }')).toEqual([]);
    expect(rules('// process.env.KEY is read by the host\nexport const note = "process.env.KEY";')).toEqual([]);
  });

  it('HW12: a module-scope reference fails under both rules outside an entry and passes inside one', () => {
    const source = 'export const key = process.env.KEY;';
    expect(rules(source)).toEqual(['HW9-env-access', 'HW12-env-import-time']);
    expect(rules(source, { envRoot: true })).toEqual([]);
    expect(rules('const env = process.env; export function key() { return env.KEY; }')).toEqual(['HW9-env-access', 'HW12-env-import-time']);
    expect(rules('if (import.meta.env.DEV) console.log("dev");')).toEqual(['HW9-env-access', 'HW12-env-import-time']);
  });

  it('HW12: a read inside a function, a method or a parameter default runs at call time, not at import', () => {
    expect(rules('export function key() { return process.env.KEY; }')).toEqual(['HW9-env-access']);
    expect(rules('export const key = () => process.env.KEY;')).toEqual(['HW9-env-access']);
    expect(rules('export class Reader { key() { return process.env.KEY; } }')).toEqual(['HW9-env-access']);
    expect(rules('export function make(env = process.env) { return env; }')).toEqual(['HW9-env-access']);
  });

  it('build define: the exact expression process.env.NODE_ENV passes in a browser-runtime package and fails in a node one', () => {
    const source = 'export const dev = process.env.NODE_ENV !== "production";';
    expect(rules(source, { buildDefine: true })).toEqual([]);
    expect(rules(source)).toEqual(['HW9-env-access', 'HW12-env-import-time']);
    expect(rules('export const dev = process.env["NODE_ENV"] !== "production";', { buildDefine: true })).toEqual([]);
  });

  it('build define: no other key, no whole-object use and no import.meta.env read is covered by it', () => {
    expect(rules('export function key() { return process.env.API_KEY; }', { buildDefine: true })).toEqual(['HW9-env-access']);
    expect(rules('export function key(name) { return process.env[name]; }', { buildDefine: true })).toEqual(['HW9-env-access']);
    expect(rules('export function all() { return process.env; }', { buildDefine: true })).toEqual(['HW9-env-access']);
    expect(rules('export function mode() { return import.meta.env.NODE_ENV; }', { buildDefine: true })).toEqual(['HW9-env-access']);
  });

  it('reports the file, the line and a plain-words reason, and never the source text', () => {
    const [access, importTime] = scan('\n\nexport const secret = process.env.SERVICE_TOKEN ?? "fallback-value";');
    expect(access).toMatchObject({ rule: 'HW9-env-access', file: 'packages/daemon/src/service.ts', line: 3,
      reason: 'Only a declared process entry may touch process.env or import.meta.env; take the value or an environment map from the host.' });
    expect(importTime).toMatchObject({ rule: 'HW12-env-import-time', line: 3,
      reason: 'This environment read runs while the module is being imported, before a host can supply configuration; move it into the process entry.' });
    expect(JSON.stringify([access, importTime])).not.toContain('fallback-value');
    expect(JSON.stringify([access, importTime])).not.toContain('SERVICE_TOKEN');
  });

  it('a syntax error fails closed, also in a process entry', () => {
    expect(() => scan('export const = ;')).toThrow('Cannot parse packages/daemon/src/service.ts: syntax error at line 1.');
    expect(() => scan('export const = ;', { envRoot: true })).toThrow('Cannot parse packages/daemon/src/service.ts: syntax error at line 1.');
  });
});

describe('env-access debt (the hardwiring ratchet, keyed by rule, file and env name)', () => {
  const one = scan('export function a() { return process.env.KEY; }');
  const two = scan('export function a() { return process.env.KEY; }\nexport function b() { return process.env.KEY; }');

  it('a listed occurrence passes, even after it moves to another line', () => {
    const moved = scan('\n\n\nexport function a() { return process.env.KEY; }');
    expect(moved[0]!.line).toBe(4);
    expect(diffHardwiringDebt({ baseline: one, current: moved })).toEqual({ added: [], removed: [] });
  });

  it('a higher count in the same file fails', () => {
    expect(diffHardwiringDebt({ baseline: one, current: two }).added).toEqual([two[1]]);
  });

  it('a lower count is reported as stale debt', () => {
    expect(diffHardwiringDebt({ baseline: two, current: one })).toEqual({ added: [], removed: [two[1]] });
  });

  it('another env name, another file or the import-time rule cannot inherit a waiver', () => {
    const otherName = scan('export function a() { return process.env.OTHER; }');
    const otherFile = scan('export function a() { return process.env.KEY; }', { file: 'packages/daemon/src/other.ts' });
    const hoisted = scan('export const a = process.env.KEY;');
    expect(diffHardwiringDebt({ baseline: one, current: otherName }).added).toEqual(otherName);
    expect(diffHardwiringDebt({ baseline: one, current: otherFile }).added).toEqual(otherFile);
    expect(diffHardwiringDebt({ baseline: one, current: hoisted }).added.map(v => v.rule)).toEqual(['HW12-env-import-time']);
  });
});
