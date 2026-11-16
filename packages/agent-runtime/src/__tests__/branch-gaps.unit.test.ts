import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { claudeFilesystemSettings } from '../claude-filesystem-policy.js';
import { normalizeClaudePickerModelId, parseClaudeInitializeModels } from '../claude-code-models.js';
import { createClaudeStreamHandler, isRedundantWrittenArtifact } from '../claude-stream.js';
import { startupFailureMessage } from '../diagnostics.js';
import { claudeAgentDef } from '../defs/claude.js';
import { resolveModelForLaunch } from '../model-discovery.js';
import { planRun } from '../native-tool-policy.js';

describe('normalizeClaudePickerModelId', () => {
  it.each([
    ['claude-sonnet-4[1m]', 'claude-sonnet-4'],
    ['  sonnet  ', 'sonnet'],
    ['odd]', 'odd]'],
    ['a]b', 'a]b'],
  ])('maps %j to %j', (raw, expected) => {
    expect(normalizeClaudePickerModelId(raw)).toBe(expected);
  });
});

describe('parseClaudeInitializeModels', () => {
  const line = (models: unknown) => JSON.stringify({ type: 'control_response', response: { subtype: 'success', response: { models } } });
  it('returns null when the success response carries no models array', () => {
    expect(parseClaudeInitializeModels(line('not-an-array'))).toBeNull();
    expect(parseClaudeInitializeModels(line(undefined))).toBeNull();
  });
  it('reads rows from a models array', () => {
    expect(parseClaudeInitializeModels(line([{ value: 'sonnet', resolvedModel: 'claude-sonnet-4', displayName: 'Sonnet' }])))
      .toEqual([{ id: 'sonnet', label: 'Sonnet (alias)' }, { id: 'claude-sonnet-4', label: 'claude-sonnet-4' }]);
  });
});

describe('isRedundantWrittenArtifact padding', () => {
  const ctx = (recent: string[]) => ({ suppressHtmlArtifactsAfterFileWrite: false, wroteHtmlFileThisTurn: false, recentWriteContents: recent });
  const artifact = (body: string) => `<artifact type="text/plain">${body}</artifact>`;

  it('ignores literal backslash-escaped CR/LF padding on both sides of the echoed body', () => {
    expect(isRedundantWrittenArtifact(artifact('\\rhello\\n'), ctx(['hello']))).toBe(true);
    expect(isRedundantWrittenArtifact(artifact('\\nhello\\r'), ctx(['hello']))).toBe(true);
    expect(isRedundantWrittenArtifact(artifact('\\nhello\\r'), ctx(['other']))).toBe(false);
  });

  it('handles a single-character body without reading before the start', () => {
    expect(isRedundantWrittenArtifact(artifact('x'), ctx(['x']))).toBe(true);
    expect(isRedundantWrittenArtifact(artifact('x'), ctx(['y']))).toBe(false);
  });
});

describe('createClaudeStreamHandler tool blocks without input', () => {
  it('emits nothing for a streamed tool_use block that never received input', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createClaudeStreamHandler({ onEvent: (event) => events.push(event) });
    for (const line of [
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'Read' } } },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
    ]) handler.feed({ chunk: `${JSON.stringify(line)}\n` });
    handler.flush();
    expect(events.filter((e) => e.type === 'tool_use')).toEqual([]);
  });
});

describe('startupFailureMessage causes', () => {
  it('names a missing cause explicitly', () => {
    expect(startupFailureMessage({ stage: 'spawn', error: undefined })).toContain('Cause: No startup cause was supplied.');
  });
  it('keeps code and message, falls back for an object with neither', () => {
    expect(startupFailureMessage({ stage: 'spawn', error: Object.assign(new Error('boom'), { code: 'ENOENT' }) })).toContain('Cause: ENOENT: boom');
    expect(startupFailureMessage({ stage: 'spawn', error: { unrelated: true } })).toContain('Cause: Startup error without a message');
  });
  it('chains causes oldest first', () => {
    const error = new Error('outer', { cause: new Error('inner') });
    expect(startupFailureMessage({ stage: 's', error })).toContain('Cause: inner\nCaused by: outer');
  });
});

describe('planRun without a capabilities map', () => {
  it('treats absent nativeCapabilities as no denied capabilities', () => {
    expect(planRun({ def: { name: 'Test' }, policy: { nativeToolAccess: false } })).toMatchObject({ verdict: 'ASK', keys: expect.arrayContaining(['enabled']) });
  });
});

describe('resolveModelForLaunch without an agent id', () => {
  it('refuses an unknown effort naming the generic runtime label', async () => {
    const deps = {
      process: { run: async () => { throw new Error('unexpected'); } }, fs: { read: async () => null }, http: { list: async () => { throw new Error('unexpected'); } },
      credential: { connection: async () => { throw new Error('unexpected'); } }, acp: { probe: async () => { throw new Error('unexpected'); } },
      rpc: { probe: async () => { throw new Error('unexpected'); } }, clock: { now: () => 0 }, cache: new Map(),
    };
    await expect(resolveModelForLaunch({
      def: { fallbackModels: [{ id: 'static-a', label: 'Static A' }] } as never,
      context: { executable: '/cli', cwd: '/w', env: {}, model: 'static-a' }, deps: deps as never, effort: 'high',
    })).rejects.toThrow("Unknown effort 'high' for 'runtime'.");
  });
});

describe('claude launch policy cwd', () => {
  it('defaults the launch cwd to the filesystem root when the runtime context has none', () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-cwd-'));
    try {
      const args = claudeAgentDef.buildArgs({ prompt: 'p', imagePaths: [] } as never, {
        options: { filesystemRoot: root }, runtimeContext: {}, extraAllowedDirs: [],
      } as never);
      expect(args).toContain('--settings');
      const settings = JSON.parse(args[args.indexOf('--settings') + 1]!);
      expect(settings.autoMemoryEnabled).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('claudeFilesystemSettings realpath failures', () => {
  it('rethrows a non-ENOENT realpath error while resolving denied roots', () => {
    const realpath = (path: string): string => {
      if (path === '/tmp') return '/tmp';
      throw Object.assign(new Error('i/o failure'), { code: 'EIO' });
    };
    expect(() => claudeFilesystemSettings({ options: { filesystemRoot: '/site', filesystemRuntimeTempBase: '/tmp' } },
      { platform: 'darwin', homeDir: '/Users/owner', tempDir: '/var/tmp', uid: 501, realpath })).toThrow('i/o failure');
  });

  it('keeps an unresolvable (ENOENT) denied root under its literal name', () => {
    const realpath = (path: string): string => {
      if (path === '/opt/rt') return '/opt/rt';
      throw Object.assign(new Error('gone'), { code: 'ENOENT' });
    };
    const settings = JSON.parse(claudeFilesystemSettings({ options: { filesystemRoot: '/site', filesystemRuntimeTempBase: '/opt/rt' } },
      { platform: 'darwin', homeDir: '/Users/owner', tempDir: '/var/tmp', uid: 501, realpath }));
    expect(settings.sandbox.filesystem.denyRead).toEqual(expect.arrayContaining(['/Users/owner']));
  });
});
