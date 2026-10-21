import { afterEach, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentPluginLayout } from '../../layout.js';
import { AgentPluginInstallError, createInstallModule, type AgentPluginArchiveEntry, type AgentPluginArchiveReaderPort } from '../../install.js';
import type { AgentPluginLifecyclePorts, FilesystemPort } from '../../ports.js';
import { PackagePathViolation } from '../../package-paths.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/**
 * @file `installAgentPlugin` refusal paths that need an adversarial archive reader or an injected
 * filesystem fault: the archive cap, a reader that changes its entries between passes, extraction
 * containment faults, publication over a non-directory, and the host's identity-admission port.
 */

const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });
async function tempRoot(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'install-edges-')));
  temporaries.push(dir);
  return dir;
}
const manifest = JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'edge-plugin', version: '1.0.0' });
function fileEntry(entryPath: string, text: string): AgentPluginArchiveEntry {
  return { kind: 'file', entryPath, async *openReadStream() { yield Buffer.from(text); } };
}
function readerOf(...passes: AgentPluginArchiveEntry[][]): AgentPluginArchiveReaderPort {
  let pass = 0;
  return { async *entries() { yield* passes[Math.min(pass++, passes.length - 1)]!; } };
}
const basicEntries = () => [fileEntry('plugin.json', manifest), fileEntry('skills/edge-plugin/SKILL.md', '# Edge\n')];
async function install(overrides: Partial<AgentPluginLifecyclePorts>, archiveReader: AgentPluginArchiveReaderPort, archive = Buffer.from('edge-archive')) {
  const root = await tempRoot();
  const layout = createAgentPluginLayout({ root });
  const { installAgentPlugin } = createInstallModule({ ...ports, layout, ...overrides });
  const expectedSha256 = createHash('sha256').update(archive).digest('hex');
  return { root, result: installAgentPlugin({ layout, workspaceId: 'ws', archive, archiveReader, expectedSha256 }) };
}
async function installError(promise: Promise<unknown>): Promise<AgentPluginInstallError> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(AgentPluginInstallError);
  return error as AgentPluginInstallError;
}

describe('installAgentPlugin refusals', () => {
  test('an archive over the byte cap is refused before hashing or extraction', async () => {
    const { maxAgentPluginInstallArchiveBytes } = createInstallModule(ports);
    const archive = Buffer.alloc(maxAgentPluginInstallArchiveBytes() + 1);
    const { root, result } = await install({}, readerOf(basicEntries()), archive);
    const error = await installError(result);
    expect(error.code).toBe('ARCHIVE_TOO_LARGE');
    expect(error.message).toBe(`archive is ${archive.byteLength} bytes, over the ${maxAgentPluginInstallArchiveBytes()}-byte cap`);
    await expect(fs.stat(path.join(root, 'ws'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('a reader that yields more entries on the extraction pass than the counted pass is still capped', async () => {
    const many = Array.from({ length: 4097 }, (_, index) => fileEntry(`f${index}.md`, 'x'));
    const { result } = await install({}, readerOf(basicEntries(), [...basicEntries(), ...many]));
    expect((await installError(result)).code).toBe('TOO_MANY_ENTRIES');
  });

  test('a containment fault while extracting is re-shaped as an unsafe entry, keeping only a path-violation cause', async () => {
    // The extraction root itself cannot be resolved: a device fault, not a path violation.
    const deviceFault = { ...fs, realpath: (async (target: string) => {
      if (target.endsWith(`${path.sep}root`)) throw Object.assign(new Error('EIO: device fault'), { code: 'EIO' });
      return fs.realpath(target);
    }) as FilesystemPort['realpath'] } as FilesystemPort;
    const io = await installError((await install({ filesystem: deviceFault }, readerOf(basicEntries()))).result);
    expect(io).toMatchObject({ code: 'UNSAFE_ENTRY_PATH', message: "archive entry resolves outside the package root: 'plugin.json'" });
    expect(io.cause).toBeUndefined();
    // A directory that resolves elsewhere, as a planted symlink would: a real path violation.
    const redirected = { ...fs, realpath: (async (target: string) => (target.endsWith(`${path.sep}escapes`) ? '/' : fs.realpath(target))) as FilesystemPort['realpath'] } as FilesystemPort;
    const escape = await installError((await install({ filesystem: redirected }, readerOf([fileEntry('plugin.json', manifest), fileEntry('escapes/x.md', 'x')]))).result);
    expect(escape.code).toBe('UNSAFE_ENTRY_PATH');
    expect(escape.cause).toBeInstanceOf(PackagePathViolation);
  });
});

describe('publication', () => {
  test('a rename that reports an existing destination which is not a real directory fails publication', async () => {
    let finalRoot = '';
    const racing = { ...fs, rename: (async (from: string, to: string) => {
      if (path.basename(from) === 'root') { finalRoot = to; throw Object.assign(new Error('EEXIST: exists'), { code: 'EEXIST' }); }
      return fs.rename(from, to);
    }) as FilesystemPort['rename'] } as FilesystemPort;
    const error = await installError((await install({ filesystem: racing }, readerOf(basicEntries()))).result);
    expect(error).toMatchObject({ code: 'PUBLISH_FAILED', message: `'${finalRoot}' exists but is not a real, published package directory` });
  });

  test('a stat fault other than ENOENT on the destination propagates unchanged', async () => {
    const faulting = { ...fs, stat: (async (target: string, ...rest: []) => {
      if (/[a-f0-9]{64}$/.test(target)) throw Object.assign(new Error('EIO: stat fault'), { code: 'EIO' });
      return fs.stat(target, ...rest);
    }) as FilesystemPort['stat'] } as FilesystemPort;
    await expect((await install({ filesystem: faulting }, readerOf(basicEntries()))).result).rejects.toMatchObject({ code: 'EIO' });
  });

  test('a host identity-admission port wraps publication with the manifest identity', async () => {
    const admitted: Array<{ id: string; localId: string }> = [];
    const identityAdmission = async <T>({ id, localId, run }: { id: string; localId: string; run: () => Promise<T> }) => {
      admitted.push({ id, localId });
      return run();
    };
    const { result } = await install({ identityAdmission }, readerOf(basicEntries()));
    const installed = await result;
    expect(installed.pluginId).toBe('edge-plugin');
    expect(admitted).toEqual([{ id: installed.id, localId: 'edge-plugin' }]);
    expect((await fs.stat(installed.packageRoot)).isDirectory()).toBe(true);
  });
});
