import { expect, test, vi } from 'vitest';
import { assertClaudeFilesystemSupport, claudeFilesystemSettings, createClaudeFilesystemSupportProbe } from '../../claude-filesystem-policy.js';

test.each([
  ['1.99.999', false], ['2.0.999', false], ['2.1.284', false], ['2.1.285', true],
  ['2.2.0', true], ['3.0.0', true],
] as const)('official Claude %s enforces the recorded filesystem version floor: %s', async (version, expected) => {
  const probe = vi.fn(async () => ({ stdout: `${version} (Claude Code)\n`, stderr: '' }));
  expect(await assertClaudeFilesystemSupport({ agentId: 'claude', launchPath: process.execPath, env: {} }, { probe })).toBe(expected);
  expect(probe).toHaveBeenCalledTimes(1);
});

test('one executor coalesces concurrent filesystem probes, retries uncertainty once, and caches the result', async () => {
  const probe = vi.fn(async () => ({ stdout: 'unknown CLI output', stderr: '' }));
  const verify = createClaudeFilesystemSupportProbe({});
  const required = { agentId: 'claude', launchPath: process.execPath, env: {} };
  expect(await Promise.all([verify(required, { probe }), verify(required, { probe })])).toEqual([undefined, undefined]);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(probe.mock.calls).toHaveLength(2);
  expect(await verify(required, { probe })).toBeUndefined();
  expect(probe).toHaveBeenCalledTimes(2);
});

test('picked folders retain host denies, gain only read permission, and exclude rule metacharacters', () => {
  const settings = JSON.parse(claudeFilesystemSettings({ options: {
    filesystemRoot: '/site', filesystemReadOnlyDirs: ['/picked', '/bad*'],
    settings: JSON.stringify({ permissions: { deny: ['Read(private)'] } }),
  } }, { platform: 'linux', homeDir: '/home', tempDir: '/tmp' }));
  expect(settings.permissions).toEqual({ deny: ['Read(private)', 'Edit(//picked/**)'],
    blockReadsOutsideWorkingDirectories: true, additionalDirectories: ['/picked'] });
  expect(settings.sandbox.filesystem.denyWrite).toEqual(['/picked']);
  expect(settings.sandbox.filesystem.allowRead).toContain('/picked');
  expect(settings.sandbox.filesystem.allowWrite).toEqual(['/site', '/site/.agent-runtime/tmp']);
});

test('inaccessible canonical scratch roots propagate instead of widening the sandbox', () => {
  const failure = Object.assign(new Error('scratch inaccessible'), { code: 'EACCES' });
  expect(() => claudeFilesystemSettings({ options: { filesystemRoot: '/site', filesystemRuntimeTempBase: '/r' } }, {
    platform: 'linux', uid: 1, homeDir: '/home', tempDir: '/tmp', realpath: () => { throw failure; },
  })).toThrow(failure);
});
