import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeNodeToolchain, type WriteNodeToolchainInput, type ToolchainFilesystemPort } from '../index.js';

function fixture(_required: Record<string, never>, options: { fail?: string; failCleanup?: boolean } = {}) {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const modes = new Map<string, number>();
  const original = new Error('filesystem failure');
  const record = ({ operation }: { operation: string }, _options = {}) => {
    calls.push(operation);
    if (options.fail === operation) throw original;
  };
  const filesystem: ToolchainFilesystemPort = {
    mkdirSync: ({ path }, optional) => {
      record({ operation: `mkdir:${path}` });
      if (optional?.mode !== undefined) modes.set(`mkdir:${path}`, optional.mode);
    },
    chmodSync: ({ path, mode }) => { record({ operation: `chmod:${path}` }); modes.set(`chmod:${path}`, mode); },
    writeFileSync: ({ path, data }, optional) => {
      record({ operation: `write:${path}` });
      files.set(path, data);
      if (optional?.mode !== undefined) modes.set(`write:${path}`, optional.mode);
    },
    renameSync: ({ oldPath, newPath }) => {
      record({ operation: `rename:${oldPath}` });
      const contents = files.get(oldPath);
      if (contents === undefined) throw new Error('missing temporary file');
      files.set(newPath, contents);
      files.delete(oldPath);
    },
    unlinkSync: ({ path }) => {
      calls.push(`unlink:${path}`);
      if (options.failCleanup) throw new Error('cleanup failure');
      files.delete(path);
    },
  };
  const input: WriteNodeToolchainInput = {
    paths: { toolchainDir: '/tools', binDir: '/tools/bin', npmCacheDir: '/cache', npmPrefixDir: '/prefix' },
    filesystem, writerPid: 42, electronPath: '/app/electron', npmRoot: '/npm', platform: 'linux',
    generatedComment: '# Host generated', joinPath: ({ parts }) => posix.join(...parts),
    isTransientPath: () => false, launcherNamesDurableInstall: () => false,
  };
  return { input, files, calls, modes, original };
}

describe('atomic shim publication before extraction', () => {
  it('publishes all three complete launchers with owner-only permissions in order', () => {
    const f = fixture({});
    expect(writeNodeToolchain(f.input)).toBe(f.input.paths);
    expect([...f.files.keys()]).toEqual(['/tools/bin/node', '/tools/bin/npm', '/tools/bin/npx']);
    expect(f.files.get('/tools/bin/npm')).toBe('#!/bin/sh\n# Host generated\nELECTRON_RUN_AS_NODE=1\nexport ELECTRON_RUN_AS_NODE\nexec \'/app/electron\' \'/npm/bin/npm-cli.js\' "$@"\n');
    expect(f.calls).toEqual([
      'mkdir:/tools/bin', 'chmod:/tools/bin', 'mkdir:/cache', 'mkdir:/prefix',
      'write:/tools/bin/node.42.tmp', 'chmod:/tools/bin/node.42.tmp', 'rename:/tools/bin/node.42.tmp',
      'write:/tools/bin/npm.42.tmp', 'chmod:/tools/bin/npm.42.tmp', 'rename:/tools/bin/npm.42.tmp',
      'write:/tools/bin/npx.42.tmp', 'chmod:/tools/bin/npx.42.tmp', 'rename:/tools/bin/npx.42.tmp',
    ]);
    expect([...f.modes]).toEqual([
      ['mkdir:/tools/bin', 0o700], ['chmod:/tools/bin', 0o700],
      ['write:/tools/bin/node.42.tmp', 0o700], ['chmod:/tools/bin/node.42.tmp', 0o700],
      ['write:/tools/bin/npm.42.tmp', 0o700], ['chmod:/tools/bin/npm.42.tmp', 0o700],
      ['write:/tools/bin/npx.42.tmp', 0o700], ['chmod:/tools/bin/npx.42.tmp', 0o700],
    ]);
  });

  it.each(['write', 'chmod', 'rename'])('cleans a failed %s and preserves the original error even if cleanup fails', stage => {
    for (const failCleanup of [false, true]) {
      const f = fixture({}, { fail: `${stage}:/tools/bin/node.42.tmp`, failCleanup });
      f.files.set('/tools/bin/node', 'previous durable launcher');
      expect(() => writeNodeToolchain(f.input)).toThrow(f.original);
      expect(f.calls.at(-1)).toBe('unlink:/tools/bin/node.42.tmp');
      expect(f.files.get('/tools/bin/node')).toBe('previous durable launcher');
      expect(f.files.has('/tools/bin/node.42.tmp')).toBe(failCleanup && stage !== 'write');
    }
  });

  it.each(['mkdir:/tools/bin', 'chmod:/tools/bin', 'mkdir:/cache', 'mkdir:/prefix'])('propagates setup failure %s without publishing', fail => {
    const f = fixture({}, { fail });
    expect(() => writeNodeToolchain(f.input)).toThrow(f.original);
    expect(f.files.size).toBe(0);
    expect(f.calls.at(-1)).toBe(fail);
  });

  it.each(['linux', 'win32'] as const)('probes transient %s launchers without touching files', platform => {
    const f = fixture({});
    const seen: string[] = [];
    for (const durable of [false, true]) {
      const result = writeNodeToolchain({ ...f.input, platform, isTransientPath: () => true,
        launcherNamesDurableInstall: ({ launcherPath }) => { seen.push(launcherPath); return durable; } });
      expect(result).toBe(durable ? f.input.paths : null);
    }
    expect(seen).toEqual(platform === 'win32' ? ['/tools/bin/node.cmd', '/tools/bin/node.cmd'] : ['/tools/bin/node', '/tools/bin/node']);
    expect(f.calls).toEqual([]);
  });

  it('validates all shims before creating directories', () => {
    const f = fixture({});
    expect(() => writeNodeToolchain({ ...f.input, npmRoot: "/bad'root" })).toThrow(/npmRoot/);
    expect(f.calls).toEqual([]);
  });
});
