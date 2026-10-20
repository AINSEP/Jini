import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { check, diagnosePublishedTypes, parseDiagnosticBlocks, registryDependencies } from '../index.js';
import type { CompileProject, LinksProject } from '../index.js';
import type { FilesystemPort, PackageInstallerPort, ProcessRequest, ProcessResult, ProcessRunnerPort } from '../../ports.js';
import { createNodeFilesystem } from '../../node.js';

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const pass: ProcessResult = { exitCode: 0, stdout: '', stderr: '' };
const diagnostic = (message: string, exitCode: number | null = 1): ProcessResult => ({ exitCode, stdout: `src/main.ts(1,2): error TS2305: ${message}\n`, stderr: '' });

/** Real filesystem, except the copy merges into the directory the shadow already owns. */
function filesystem(): FilesystemPort {
  return { ...createNodeFilesystem({}), copyDirectory: ({ source, destination }) => { cpSync(source, destination, { recursive: true }); } };
}

function fixture(manifest: object = { dependencies: { '@example/core': '^1.0.0' } }) {
  const directory = mkdtempSync(path.join(tmpdir(), 'published-types-pins-'));
  roots.push(directory);
  const shadowAnchor = path.join(directory, 'source');
  mkdirSync(shadowAnchor);
  const manifestPath = path.join(directory, 'package.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const project: CompileProject = {
    key: 'example', directory, manifestPath, mode: 'drift', scratchParent: directory,
    shadowAnchor, prerequisites: [], compiler: { command: 'compiler', args: [], cwd: directory },
  };
  const installer = { install: vi.fn<PackageInstallerPort['install']>(async ({ directory: scratch }) => {
    const dir = path.join(scratch, 'node_modules', '@example', 'core');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    return pass;
  }) };
  const runner = { run: vi.fn<ProcessRunnerPort['run']>(async () => pass) };
  const fs = filesystem();
  return { directory, project, fs, installer, runner, args: { projects: [project], scope: '@example', fs, installer, runner } };
}
const first = async (args: Parameters<typeof check>[0]) => (await check(args)).projects[0]!;

describe('scope and dependency validation', () => {
  it('rejects a malformed scope in every entry point', async () => {
    expect(() => registryDependencies({ manifest: {}, scope: 'example' })).toThrow(new TypeError('scope must be an npm scope such as @example'));
    expect(() => diagnosePublishedTypes({ scope: '@Example', logs: [] })).toThrow(new TypeError('scope must be an npm scope such as @example'));
    const f = fixture();
    await expect(check({ ...f.args, scope: '@' })).rejects.toThrow(new TypeError('scope must be an npm scope such as @example'));
  });

  it('rejects malformed scoped dependency names and ignores lookalike scopes', () => {
    expect(() => registryDependencies({ scope: '@example', manifest: { dependencies: { '@example/Bad': '1' } } })).toThrow(new TypeError('invalid dependency name: @example/Bad'));
    expect(registryDependencies({ scope: '@example', manifest: { dependencies: { '@examples/a': '1', '@example/ok.name-1': '2' } } })).toEqual({ '@example/ok.name-1': '2' });
    expect(registryDependencies({ scope: '@example', manifest: {} })).toEqual({});
  });

  it('dot in the scope is matched literally', () => {
    expect(() => registryDependencies({ scope: '@a.b', manifest: { dependencies: { '@a.b/x/y': '1' } } })).toThrow(new TypeError('invalid dependency name: @a.b/x/y'));
  });

  it('requires at least one project', async () => {
    const f = fixture();
    await expect(check({ ...f.args, projects: [] })).rejects.toThrow(new TypeError('at least one project is required'));
  });
});

describe('parseDiagnosticBlocks', () => {
  it('starts blocks at global "error TS" lines and drops leading noise', () => {
    expect(parseDiagnosticBlocks({ output: 'noise\nerror TS6053: missing\n  more\n\n' })).toEqual(['error TS6053: missing\n  more']);
    expect(parseDiagnosticBlocks({ output: '' })).toEqual([]);
    expect(parseDiagnosticBlocks({ output: ' a.ts(1,2): error TS1: indented is detail' })).toEqual([]);
  });
});

describe('links mode', () => {
  const links = (directory: string, manifestPath: string): LinksProject => ({ key: 'links', mode: 'links', directory, manifestPath });

  it('passes when declared packages are missing or real directories', async () => {
    const f = fixture({ dependencies: { '@example/core': '1', '@example/real': '1' } });
    mkdirSync(path.join(f.directory, 'node_modules', '@example', 'real'), { recursive: true });
    const result = await first({ ...f.args, projects: [links(f.directory, f.project.manifestPath)] });
    expect(result.status).toBe('pass');
    expect(result.linkedPackages).toEqual([]);
  });

  it('reports a broken symlink as linked', async () => {
    const f = fixture();
    mkdirSync(path.join(f.directory, 'node_modules', '@example'), { recursive: true });
    symlinkSync(path.join(f.directory, 'gone'), path.join(f.directory, 'node_modules', '@example', 'core'));
    expect((await first({ ...f.args, projects: [links(f.directory, f.project.manifestPath)] })).linkedPackages).toEqual(['@example/core']);
  });

  it('other lstat failures are operation errors, including non-Error throws', async () => {
    const f = fixture();
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const fs: FilesystemPort = { ...f.fs, isSymbolicLink: () => { throw denied; } };
    expect(await first({ ...f.args, fs, projects: [links(f.directory, f.project.manifestPath)] })).toMatchObject({ status: 'operation-error', output: 'EACCES: permission denied' });
    const odd: FilesystemPort = { ...f.fs, isSymbolicLink: () => { throw 'plain failure'; } };
    expect(await first({ ...f.args, fs: odd, projects: [links(f.directory, f.project.manifestPath)] })).toMatchObject({ status: 'operation-error', output: 'plain failure' });
    const nullish: FilesystemPort = { ...f.fs, isSymbolicLink: () => { throw null; } };
    expect(await first({ ...f.args, fs: nullish, projects: [links(f.directory, f.project.manifestPath)] })).toMatchObject({ status: 'operation-error', output: 'null' });
  });
});

describe('compile mode', () => {
  it('a failing prerequisite stops before install with its combined output', async () => {
    const f = fixture();
    const second: ProcessRequest = { command: 'second', args: [], cwd: f.directory };
    f.project.prerequisites = [{ command: 'first', args: [], cwd: f.directory }, second];
    f.runner.run.mockResolvedValueOnce({ exitCode: 2, stdout: 'out;', stderr: 'err' });
    expect(await first(f.args)).toMatchObject({ status: 'prerequisite-error', output: 'out;err' });
    expect(f.runner.run).toHaveBeenCalledTimes(1);
    expect(f.installer.install).not.toHaveBeenCalled();
  });

  it('a null prerequisite exit is a failure', async () => {
    const f = fixture();
    f.project.prerequisites = [{ command: 'first', args: [], cwd: f.directory }];
    f.runner.run.mockResolvedValueOnce({ exitCode: null, stdout: '', stderr: 'killed' });
    expect((await first(f.args)).status).toBe('prerequisite-error');
  });

  it('passes with installed versions and writes an empty override map when none are declared', async () => {
    const f = fixture();
    f.installer.install.mockImplementationOnce(async ({ directory }) => {
      expect(JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))).toEqual({ name: 'published-types-scratch', private: true, dependencies: { '@example/core': '^1.0.0' }, overrides: {} });
      const dir = path.join(directory, 'node_modules', '@example', 'core');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), '{"version":"9.9.9"}');
      return pass;
    });
    const report = await check(f.args);
    expect(report.ok).toBe(true);
    expect(report.projects[0]).toEqual({ projectKey: 'example', status: 'pass', output: '', versions: { '@example/core': '9.9.9' }, linkedPackages: [], diagnostics: [], baselineDiagnostics: [] });
    expect([...f.fs.readDirectory({ path: f.directory })].sort()).toEqual(['package.json', 'source']);
  });

  it('identical baseline diagnostics pass and leave no new diagnostics', async () => {
    const f = fixture();
    f.runner.run.mockResolvedValue(diagnostic('old'));
    const result = await first(f.args);
    expect(result).toMatchObject({ status: 'pass', diagnostics: [], baselineDiagnostics: ['src/main.ts(1,2): error TS2305: old'] });
  });

  it('a clean baseline makes every registry diagnostic drift', async () => {
    const f = fixture();
    f.runner.run.mockResolvedValueOnce(pass).mockResolvedValueOnce(diagnostic('new'));
    expect(await first(f.args)).toMatchObject({ status: 'drift', diagnostics: ['src/main.ts(1,2): error TS2305: new'] });
  });

  it('a broken baseline cannot suppress registry diagnostics', async () => {
    for (const baseline of [{ exitCode: null, stdout: '', stderr: '' }, { exitCode: 2, stdout: 'crash', stderr: '' }, diagnostic('old', null)]) {
      const f = fixture();
      f.runner.run.mockResolvedValueOnce(baseline).mockResolvedValueOnce(diagnostic('old'));
      expect((await first(f.args)).status).toBe('typecheck-error');
    }
  });

  it('published mode runs the compiler once and any failure is a typecheck error', async () => {
    const f = fixture();
    f.project.mode = 'published';
    f.runner.run.mockResolvedValue(diagnostic('new'));
    expect(await first(f.args)).toMatchObject({ status: 'typecheck-error', diagnostics: ['src/main.ts(1,2): error TS2305: new'], baselineDiagnostics: [] });
    expect(f.runner.run).toHaveBeenCalledTimes(1);
  });

  it('a linked installed scope directory is refused', async () => {
    const f = fixture();
    f.installer.install.mockImplementationOnce(async ({ directory }) => {
      mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
      symlinkSync(f.project.shadowAnchor, path.join(directory, 'node_modules', '@example'));
      return pass;
    });
    expect(await first(f.args)).toMatchObject({ status: 'operation-error', output: 'installed scope must not be linked' });
    expect(f.runner.run).not.toHaveBeenCalled();
  });

  it('a symlinked shadow node_modules is refused before anything is created there', async () => {
    const f = fixture();
    const target = path.join(f.directory, 'elsewhere');
    mkdirSync(target);
    symlinkSync(target, path.join(f.project.shadowAnchor, 'node_modules'));
    expect(await first(f.args)).toMatchObject({ status: 'operation-error', output: 'shadow node_modules must not be a symlink' });
    expect(f.fs.readDirectory({ path: target })).toEqual([]);
  });

  it('a pre-existing shadow node_modules is kept, while the owned scope is removed', async () => {
    const f = fixture();
    mkdirSync(path.join(f.project.shadowAnchor, 'node_modules'));
    expect((await first(f.args)).status).toBe('pass');
    expect(f.fs.readDirectory({ path: path.join(f.project.shadowAnchor, 'node_modules') })).toEqual([]);
  });

  it('entries added to a created node_modules during the compile survive cleanup', async () => {
    const f = fixture();
    f.runner.run.mockImplementationOnce(async () => pass).mockImplementationOnce(async () => {
      writeFileSync(path.join(f.project.shadowAnchor, 'node_modules', 'other'), 'x');
      return pass;
    });
    expect((await first(f.args)).status).toBe('pass');
    expect(f.fs.readDirectory({ path: path.join(f.project.shadowAnchor, 'node_modules') })).toEqual(['other']);
  });

  it('a compiler that throws still removes the shadow and scratch, as an operation error', async () => {
    const f = fixture();
    f.runner.run.mockResolvedValueOnce(pass).mockRejectedValueOnce(new Error('spawn exploded'));
    expect(await first(f.args)).toMatchObject({ status: 'operation-error', output: 'spawn exploded' });
    expect(f.fs.readDirectory({ path: f.project.shadowAnchor })).toEqual([]);
    expect([...f.fs.readDirectory({ path: f.directory })].sort()).toEqual(['package.json', 'source']);
  });

  it('a scratch cleanup failure is reported, not swallowed', async () => {
    const f = fixture();
    const fs: FilesystemPort = { ...f.fs, removeDirectory: (args) => {
      if (path.basename(args.path).startsWith('published-types-')) throw new Error('cleanup refused');
      f.fs.removeDirectory(args);
    } };
    expect(await first({ ...f.args, fs })).toMatchObject({ status: 'operation-error', output: 'cleanup refused' });
  });
});

describe('report', () => {
  it('logs every project and is ok only when all pass or skip', async () => {
    const f = fixture();
    const skipped = fixture({ dependencies: {} });
    const broken = fixture();
    broken.installer.install.mockResolvedValue({ exitCode: 1, stdout: 'a', stderr: 'b' });
    const entries: unknown[] = [];
    const logger = { log: (entry: { projectKey: string; status: string; message: string }) => { entries.push(entry); } };
    const projects = [f.project, { ...skipped.project, key: 'skipped' }];
    expect((await check({ ...f.args, projects }, { logger })).ok).toBe(true);
    expect(entries).toEqual([{ projectKey: 'example', status: 'pass', message: '' }, { projectKey: 'skipped', status: 'skipped', message: 'no registry-resolved scoped dependencies' }]);
    const failed = await check({ ...f.args, installer: broken.installer, projects: [{ ...f.project }, { ...skipped.project, key: 'skipped' }] });
    expect(failed.ok).toBe(false);
    expect(failed.projects[0]).toMatchObject({ status: 'install-error', output: 'ab' });
  });
});

describe('diagnosePublishedTypes', () => {
  it('ignores successful logs and reads double-quoted and repeated hits', () => {
    const text = `Module '"@example/a"' has no exported member 'X'. Module "@example/a" has no exported member "Y". Cannot find module "@example/b" or its corresponding type declarations. Module '@other/a' has no exported member 'Z'.`;
    expect(diagnosePublishedTypes({ scope: '@example', logs: [{ projectKey: 'ok', exitCode: 0, stdout: text, stderr: '' }, { projectKey: 'bad', exitCode: null, stdout: '', stderr: text }] })).toEqual({
      ok: false, failures: [{ projectKey: 'bad', exitCode: null, stdout: '', stderr: text, hits: ["missing export 'X'", "missing export 'Y'", "missing module '@example/b'"] }],
    });
    expect(diagnosePublishedTypes({ scope: '@example', logs: [] })).toEqual({ ok: true, failures: [] });
  });
});
