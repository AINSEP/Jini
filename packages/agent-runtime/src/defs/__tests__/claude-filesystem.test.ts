import { promises as fs } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { claudeFilesystemAdapter, type ClaudeFilesystemRunInput } from '../claude/filesystem.js';

function withPlatform(platform: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value: platform });
  return () => { Object.defineProperty(process, 'platform', original); };
}

it.each(['linux', 'win32'] as const)('registers and canonicalizes scratch only on supported platforms (%s)', async platform => {
  const restore = withPlatform(platform);
  const allocate = vi.spyOn(fs, 'mkdtemp').mockResolvedValue('/var/tmp/jini-unit');
  const canonical = vi.spyOn(fs, 'realpath').mockResolvedValue('/canonical/jini-unit');
  try {
    const input: ClaudeFilesystemRunInput = {};
    const spawnEnv: NodeJS.ProcessEnv = { CLAUDE_CODE_TMPDIR: '/old' };
    const runtimeTemps: string[] = [];
    await claudeFilesystemAdapter.prepare({ input, spawnEnv, runtimeTemps });
    if (platform === 'linux') {
      expect(allocate.mock.calls).toEqual([['/var/tmp/jini-']]);
      expect(canonical.mock.calls).toEqual([['/var/tmp/jini-unit']]);
      expect(runtimeTemps).toEqual(['/var/tmp/jini-unit']);
      expect(input.filesystemRuntimeTempBase).toBe('/canonical/jini-unit');
      expect(spawnEnv.CLAUDE_CODE_TMPDIR).toBe('/canonical/jini-unit');
    } else {
      expect(allocate.mock.calls).toEqual([]);
      expect(canonical.mock.calls).toEqual([]);
      expect(runtimeTemps).toEqual([]);
      expect(input).toEqual({});
      expect(spawnEnv.CLAUDE_CODE_TMPDIR).toBe('/old');
    }
  } finally {
    allocate.mockRestore();
    canonical.mockRestore();
    restore();
  }
});

it('keeps a just-allocated scratch directory registered for cleanup when canonicalization fails', async () => {
  const restore = withPlatform('linux');
  const failure = new Error('cannot resolve private scratch');
  const allocate = vi.spyOn(fs, 'mkdtemp').mockResolvedValue('/var/tmp/jini-owned');
  const canonical = vi.spyOn(fs, 'realpath').mockRejectedValue(failure);
  try {
    const input: ClaudeFilesystemRunInput = {};
    const spawnEnv: NodeJS.ProcessEnv = {};
    const runtimeTemps: string[] = [];
    await expect(claudeFilesystemAdapter.prepare({ input, spawnEnv, runtimeTemps })).rejects.toBe(failure);
    expect(runtimeTemps).toEqual(['/var/tmp/jini-owned']);
    expect(spawnEnv).toEqual({});
  } finally {
    allocate.mockRestore();
    canonical.mockRestore();
    restore();
  }
});

it('applies the validated runtime paths and settings while overriding the login auto-memory flag', () => {
  const input: ClaudeFilesystemRunInput = { filesystemRoot: '/workspace', settings: '{"old":true}' };
  const spawnEnv = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0', PATH: '/tools' };
  const runtimePaths = vi.fn(() => ['/agent/runner']);
  const settings = vi.fn(({ options }: { options: ClaudeFilesystemRunInput }) => JSON.stringify({
    root: options.filesystemRoot, paths: options.filesystemRuntimeReadPaths,
  }));
  claudeFilesystemAdapter.supported({ input, launchPath: '/agent/claude', spawnEnv }, { filesystem: { runtimePaths, settings } });
  expect(runtimePaths.mock.calls).toEqual([[{ launchPath: '/agent/claude' }]]);
  expect(input).toEqual({
    filesystemRoot: '/workspace', filesystemRuntimeReadPaths: ['/agent/runner'],
    settings: '{"root":"/workspace","paths":["/agent/runner"]}',
  });
  expect(spawnEnv).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', PATH: '/tools' });
});

it('removes user and project setting sources even on an unconfined fallback', () => {
  const input: ClaudeFilesystemRunInput = { settingSources: ['user', 'project'], model: 'chosen' };
  claudeFilesystemAdapter.unsupported({ input });
  expect(input).toEqual({ settingSources: [], model: 'chosen' });
});
