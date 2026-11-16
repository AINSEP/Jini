import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectNodeRuntime } from '../node-runtime.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A temp project whose `electron` package exports the given JS expression. */
function project(exportExpression: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'jini-node-runtime-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), '{"name":"host"}');
  if (exportExpression !== null) {
    mkdirSync(join(dir, 'node_modules/electron'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/electron/package.json'), '{"name":"electron","main":"index.js"}');
    writeFileSync(join(dir, 'node_modules/electron/index.js'), `module.exports = ${exportExpression};`);
  }
  return dir;
}

describe('selectNodeRuntime with the real resolver and probe', () => {
  it('uses an installed binary that really runs as Node', () => {
    const dir = project(JSON.stringify(process.execPath));
    expect(selectNodeRuntime({ searchFrom: [dir], nodePath: '/fallback/node' })).toEqual({ command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, fallback: false });
  });

  it('falls back when the installed binary cannot be executed', () => {
    const dir = project(JSON.stringify(join(tmpdir(), 'definitely-not-a-binary-xyz')));
    expect(selectNodeRuntime({ searchFrom: [dir], nodePath: '/fallback/node' })).toEqual({ command: '/fallback/node', env: {}, fallback: true });
  });

  it('falls back when the installed binary exits non-zero', () => {
    const dir = project(JSON.stringify('/bin/false'));
    expect(selectNodeRuntime({ searchFrom: [dir], nodePath: '/fallback/node' })).toEqual({ command: '/fallback/node', env: {}, fallback: true });
  });

  it('falls back when the electron package does not export a path', () => {
    const dir = project('{ notAPath: true }');
    expect(selectNodeRuntime({ searchFrom: [dir], nodePath: '/fallback/node' })).toEqual({ command: '/fallback/node', env: {}, fallback: true });
  });

  it('moves on to the next search root after an unusable one', () => {
    const bad = project('{ }');
    const good = project(JSON.stringify(process.execPath));
    expect(selectNodeRuntime({ searchFrom: [bad, good], nodePath: '/fallback/node' }).command).toBe(process.execPath);
  });
});
