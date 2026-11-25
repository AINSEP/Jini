import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkEnvAccess, collectEnvAccess } from '../check-env-access.js';

const READ = 'export function key() { return process.env.KEY; }';
const roots: string[] = [];

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jini-env-access-'));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}
const found = (root: string, entryEnvNames: Record<string, readonly string[]> = {}) =>
  collectEnvAccess({ repoRoot: root }, { entryEnvNames }).map(v => [v.rule, v.file, v.line]);
const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({ name: '@jini-ai/fixture', jini: { runtime: 'node' }, ...extra });

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('env-access host scan (where it looks and which files are process entries)', () => {
  it('scans package source, including nested packages and .mjs, and skips tests', () => {
    const root = repo({
      'packages/family/domain/package.json': manifest(),
      'packages/family/domain/src/service.ts': READ,
      'packages/family/domain/src/worker.mjs': READ,
      'packages/family/domain/src/clean.ts': 'export function key({ env }) { return env.KEY; }',
      'packages/family/domain/src/__tests__/fixture.ts': READ,
      'packages/family/domain/src/service.test.ts': READ,
    });
    expect(found(root)).toEqual([
      ['HW9-env-access', 'packages/family/domain/src/service.ts', 1],
      ['HW9-env-access', 'packages/family/domain/src/worker.mjs', 1],
    ]);
  });

  it('treats src/bin/** and the source of each manifest bin target as process entries, and nothing else', () => {
    const root = repo({
      'packages/tool/package.json': manifest({ bin: { tool: './dist/main.js', other: 'dist/cli/run.js' } }),
      'packages/tool/src/main.ts': 'export const port = process.env.PORT;',
      'packages/tool/src/cli/run.ts': READ,
      'packages/tool/src/bin/serve.ts': 'export const port = process.env.PORT;',
      'packages/tool/src/main-helpers.ts': READ,
      'packages/tool/src/binary/serve.ts': READ,
      'packages/single/package.json': manifest({ name: '@jini-ai/single', bin: './dist/start.js' }),
      'packages/single/src/start.ts': READ,
      'packages/single/src/index.ts': 'export const port = process.env.PORT;',
    });
    expect(found(root, { 'packages/tool/src/main.ts': ['PORT'], 'packages/tool/src/bin/serve.ts': ['PORT'], 'packages/tool/src/cli/run.ts': ['KEY'], 'packages/single/src/start.ts': ['KEY'] })).toEqual([
      ['HW9-env-access', 'packages/single/src/index.ts', 1],
      ['HW12-env-import-time', 'packages/single/src/index.ts', 1],
      ['HW9-env-access', 'packages/tool/src/binary/serve.ts', 1],
      ['HW9-env-access', 'packages/tool/src/main-helpers.ts', 1],
    ]);
  });

  it('allows the NODE_ENV build define by the package runtime, not by the file', () => {
    const define = 'export const dev = process.env.NODE_ENV !== "production";';
    const root = repo({
      'packages/a-browser/package.json': manifest({ name: '@jini-ai/a-browser', jini: { runtime: 'browser' } }),
      'packages/a-browser/src/context.ts': define,
      'packages/b-dom/package.json': manifest({ name: '@jini-ai/b-dom', jini: { runtime: 'dom' } }),
      'packages/b-dom/src/context.ts': define,
      'packages/c-universal/package.json': manifest({ name: '@jini-ai/c-universal', jini: { runtime: 'universal' } }),
      'packages/c-universal/src/context.ts': define,
      'packages/d-node/package.json': manifest({ name: '@jini-ai/d-node' }),
      'packages/d-node/src/context.ts': define,
      'packages/e-unmarked/package.json': JSON.stringify({ name: '@jini-ai/e-unmarked' }),
      'packages/e-unmarked/src/context.ts': define,
    });
    expect(found(root).map(([, file]) => file)).toEqual([
      'packages/d-node/src/context.ts', 'packages/d-node/src/context.ts',
      'packages/e-unmarked/src/context.ts', 'packages/e-unmarked/src/context.ts',
    ]);
  });

  it('checks each process entry against the names declared for its repo-relative path', () => {
    const root = repo({
      'packages/tool/package.json': manifest({ bin: { tool: './dist/main.js' } }),
      'packages/tool/src/main.ts': 'const { PORT, HOST: host } = process.env;\nexport function start() { return run({ env: process.env, port: PORT, host }); }',
      'packages/tool/src/bin/serve.ts': 'export function read(name) { return process.env[name]; }',
      'packages/tool/src/helper.ts': 'export function port({ env }) { return env.PORT; }',
    });
    expect(found(root, { 'packages/tool/src/main.ts': ['PORT'] })).toEqual([
      ['HW13-env-undeclared-entry', 'packages/tool/src/bin/serve.ts', 1],
      ['HW13-env-undeclared-entry', 'packages/tool/src/main.ts', 1],
    ]);
    expect(found(root, { 'packages/tool/src/main.ts': ['PORT', 'HOST'] })).toEqual([
      ['HW13-env-undeclared-entry', 'packages/tool/src/bin/serve.ts', 1],
    ]);
  });

  it('fails closed on a declaration row for a file that is not a scanned process entry', () => {
    const root = repo({ 'packages/tool/package.json': manifest(), 'packages/tool/src/helper.ts': 'export const ok = 1;' });
    expect(() => found(root, { 'packages/tool/src/helper.ts': ['PORT'] }))
      .toThrow('1 env schema row(s) name a file that is not a scanned process entry; fix them in scripts/jini-env-schema.ts.');
  });

  it('scans plugin payloads under lib, worker and ui, and example sources', () => {
    const root = repo({
      'packages/agent-plugins/package.json': manifest({ name: '@jini-ai/agent-plugins' }),
      'packages/agent-plugins/forms/lib/upload.mjs': READ,
      'packages/agent-plugins/forms/worker/receiver.mjs': 'export default { async fetch(request, env) { return env.DB.prepare("select 1").all(); } };',
      'packages/agent-plugins/forms/ui/panel.mjs': 'export const dev = import.meta.env.DEV;',
      'packages/agent-plugins/forms/docs/sample.mjs': READ,
      'packages/agent-plugins/forms/lib/__tests__/upload.test.mjs': READ,
      'examples/demo/src/server.ts': 'export const port = process.env.PORT;',
      'examples/demo/scripts/build.ts': READ,
      'examples/README.md': 'process.env.KEY',
    });
    expect(found(root)).toEqual([
      ['HW9-env-access', 'packages/agent-plugins/forms/lib/upload.mjs', 1],
      ['HW9-env-access', 'packages/agent-plugins/forms/ui/panel.mjs', 1],
      ['HW12-env-import-time', 'packages/agent-plugins/forms/ui/panel.mjs', 1],
      ['HW9-env-access', 'examples/demo/src/server.ts', 1],
      ['HW12-env-import-time', 'examples/demo/src/server.ts', 1],
    ]);
  });

  it('returns only occurrences that are not in the debt file, and says when debt is stale', () => {
    const root = repo({ 'packages/tool/package.json': manifest(), 'packages/tool/src/a.ts': READ, 'packages/tool/src/b.ts': READ });
    const all = collectEnvAccess({ repoRoot: root }, { entryEnvNames: {} });
    const stale = { ...all[0]!, file: 'packages/tool/src/gone.ts' };
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'scripts/env-access-debt.json'), JSON.stringify({ violations: [all[0], stale] }));
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(checkEnvAccess({ repoRoot: root }, { entryEnvNames: {} })).toEqual([all[1]]);
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      '[hardwiring] HW9-env-access: 2 total; 1 new',
      '[hardwiring] HW12-env-import-time: 0 total; 0 new',
      '[hardwiring] HW13-env-undeclared-entry: 0 total; 0 new',
      '[hardwiring] 1 stale debt occurrences; remove them from scripts/env-access-debt.json.',
    ]);
  });
});

describe('env-access debt file of this repository', () => {
  it('is current: no occurrence is missing from it and none in it is stale', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const repoRoot = join(import.meta.dirname, '../..');
    const debt = JSON.parse(readFileSync(join(repoRoot, 'scripts/env-access-debt.json'), 'utf8')) as { violations: unknown[] };
    expect(checkEnvAccess({ repoRoot })).toEqual([]);
    expect(collectEnvAccess({ repoRoot })).toHaveLength(debt.violations.length);
  });
});
