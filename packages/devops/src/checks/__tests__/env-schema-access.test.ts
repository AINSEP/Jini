import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { createEnvAccessInspector, ENV_ACCESS_RULES, readDeclaredEnvKey } from '../env-access.js';
import type { EnvAccessSource } from '../env-access.js';
import { createHardwiringInspector } from '../hardwiring.js';

const envAccess = createEnvAccessInspector({ compiler: ts, inspector: createHardwiringInspector({ compiler: ts }) });
const ENTRY = 'packages/tool/src/bin/serve.ts';
const declared = (...names: string[]): ReadonlySet<string> => new Set(names);
const scan = (source: string, options: Partial<EnvAccessSource> = {}) =>
  envAccess.inspect({ file: ENTRY, source, envRoot: true, buildDefine: false, ...options });
const findings = (source: string, options: Partial<EnvAccessSource> = {}) => scan(source, options).map(v => [v.rule, v.line]);
const fingerprint = (identity: string) => createHash('sha256').update(identity).digest('hex');

describe('HW13: a process entry reads only the environment names declared for it', () => {
  it('names the entry rule after the two ambient-access rules', () => {
    expect([...ENV_ACCESS_RULES]).toEqual(['HW9-env-access', 'HW12-env-import-time', 'HW13-env-undeclared-entry']);
  });

  it('a declared entry rejects an undeclared bracket or destructured name', () => {
    const names = declared('PORT');
    expect(findings('export const port = process.env.PORT;', { declaredEnvNames: names })).toEqual([]);
    expect(findings('export const host = process.env["HOST"];', { declaredEnvNames: names })).toEqual([['HW13-env-undeclared-entry', 1]]);
    expect(findings('export const host = import.meta.env.HOST;', { declaredEnvNames: names })).toEqual([['HW13-env-undeclared-entry', 1]]);
    expect(findings('const { PORT, HOST } = process.env;', { declaredEnvNames: names })).toEqual([['HW13-env-undeclared-entry', 1]]);
    // The source key decides, not the local binding name.
    expect(findings('const { HOST: PORT } = process.env;', { declaredEnvNames: names })).toEqual([['HW13-env-undeclared-entry', 1]]);
    expect(findings('const { PORT: host } = process.env;', { declaredEnvNames: names })).toEqual([]);
    expect(findings('const { "HOST": host } = process.env;', { declaredEnvNames: names })).toEqual([['HW13-env-undeclared-entry', 1]]);
    expect(findings('function start({ HOST } = process.env) { return HOST; }', { declaredEnvNames: names })).toEqual([['HW13-env-undeclared-entry', 1]]);
    // An absent declaration gives an entry no names at all.
    expect(findings('export const port = process.env.PORT;')).toEqual([['HW13-env-undeclared-entry', 1]]);
    const [violation] = scan('\nexport const host = process.env.HOST ?? "fallback-value";', { declaredEnvNames: names });
    expect(violation).toMatchObject({ rule: 'HW13-env-undeclared-entry', file: ENTRY, line: 2, fingerprint: fingerprint('HOST') });
    expect(JSON.stringify(violation)).not.toContain('fallback-value');
  });

  it('whole-map forwarding is not a key read; the helpers reading it are inventoried in the declaration', () => {
    expect(findings('export function start(deps) { return run({ env: deps.env ?? process.env }); }')).toEqual([]);
    expect(findings('export function start() { return spawn("x", { env: { ...process.env } }); }')).toEqual([]);
  });

  it('a declared name does not legalize a library ambient read', () => {
    const library = { file: 'packages/tool/src/service.ts', envRoot: false, declaredEnvNames: declared('PORT', 'NODE_ENV') };
    expect(findings('export function port() { return process.env.PORT; }', library)).toEqual([['HW9-env-access', 1]]);
    expect(findings('export const port = process.env.PORT;', library)).toEqual([['HW9-env-access', 1], ['HW12-env-import-time', 1]]);
    expect(findings('const { PORT } = process.env;', library)).toEqual([['HW9-env-access', 1], ['HW12-env-import-time', 1]]);
  });

  it('a dynamic key cannot escape the entry\'s declared set', () => {
    const names = declared('PORT');
    const dynamic = scan('export function read(name) { return process.env[name]; }', { declaredEnvNames: names });
    expect(dynamic).toMatchObject([{ rule: 'HW13-env-undeclared-entry', line: 1, fingerprint: fingerprint('dynamic-key') }]);
    expect(findings('const { PORT, ...rest } = process.env;', { declaredEnvNames: names })).toEqual([['HW13-env-undeclared-entry', 1]]);
    expect(findings('const key = "PORT"; const { [key]: port } = process.env;', { declaredEnvNames: names })).toEqual([['HW13-env-undeclared-entry', 1]]);
    // The checked accessor is the one way to read a computed key from the injected map.
    expect(findings('export function read(name) { return readDeclaredEnvKey({ env: process.env, declaredNames, key: name }); }', { declaredEnvNames: names })).toEqual([]);

    const env = { PORT: '8080', HOST: 'secret-host' };
    expect(readDeclaredEnvKey({ env, declaredNames: names, key: 'PORT' })).toBe('8080');
    expect(readDeclaredEnvKey({ env: {}, declaredNames: names, key: 'PORT' })).toBeUndefined();
    for (const key of ['HOST', 'constructor', '__proto__', 'toString']) {
      expect(() => readDeclaredEnvKey({ env, declaredNames: names, key })).toThrow('The requested environment name is not declared for this process entry.');
    }
    // A declared name missing from the map never falls through to an inherited property.
    expect(readDeclaredEnvKey({ env: {}, declaredNames: declared('toString'), key: 'toString' })).toBeUndefined();
    let message = '';
    try { readDeclaredEnvKey({ env, declaredNames: names, key: 'HOST' }); } catch (error) { message = String(error); }
    expect(message).not.toContain('HOST');
    expect(message).not.toContain('secret-host');
  });
});

describe('unchanged by the entry rule', () => {
  it('the NODE_ENV build define stays exempt, in a library and in an entry', () => {
    const define = 'export const dev = process.env.NODE_ENV !== "production";';
    expect(findings(define, { envRoot: false, buildDefine: true, declaredEnvNames: declared() })).toEqual([]);
    expect(findings(define, { buildDefine: true })).toEqual([]);
    expect(findings(define, { envRoot: false, declaredEnvNames: declared('NODE_ENV') })).toEqual([['HW9-env-access', 1], ['HW12-env-import-time', 1]]);
  });

  it('HW9 and HW12 occurrences keep the env-name (or ambient-object) identity', () => {
    const library = { file: 'packages/tool/src/service.ts', envRoot: false, declaredEnvNames: declared('KEY') };
    const [access, importTime] = scan('export const key = process.env.KEY;', library);
    expect(access).toMatchObject({ rule: 'HW9-env-access', fingerprint: fingerprint('KEY') });
    expect(importTime).toMatchObject({ rule: 'HW12-env-import-time', fingerprint: fingerprint('KEY') });
    const [whole] = scan('export function all() { return process.env; }', library);
    expect(whole).toMatchObject({ rule: 'HW9-env-access', fingerprint: fingerprint('process.env') });
    const [meta] = scan('export function mode() { return import.meta.env; }', library);
    expect(meta).toMatchObject({ rule: 'HW9-env-access', fingerprint: fingerprint('import.meta.env') });
  });
});
