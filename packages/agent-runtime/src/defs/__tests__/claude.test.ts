import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../capabilities.js';
import { claudeAgentDef } from '../claude.js';

afterEach(() => {
  agentCapabilities.delete('claude');
});

describe('claudeAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(claudeAgentDef.id).toBe('claude');
    expect(claudeAgentDef.bin).toBe('claude');
    expect(claudeAgentDef.fallbackBins).toEqual(['openclaude']);
    expect(claudeAgentDef.promptViaStdin).toBe(true);
    expect(claudeAgentDef.promptInputFormat).toBe('stream-json');
    expect(claudeAgentDef.streamFormat).toBe('claude-stream-json');
    expect(claudeAgentDef.externalMcpInjection).toBe('claude-mcp-json');
    expect(claudeAgentDef.resumesSessionViaCli).toBe(true);
    expect(claudeAgentDef.authProbe).toEqual({ args: ['auth', 'status'], timeoutMs: 5000 });
    expect(claudeAgentDef.fallbackModels.map((m) => m.id)).toEqual([
      'default',
      'sonnet',
      'opus',
      'haiku',
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
    ]);
  });
});

describe('claudeAgentDef.buildArgs', () => {
  it('produces the base argv with no capability flags, no model, no dirs, no session', () => {
    const args = claudeAgentDef.buildArgs('hi', [], []);
    expect(args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
    ]);
  });

  it('adds --include-partial-messages only when the capability probe recorded partialMessages', () => {
    agentCapabilities.set('claude', { partialMessages: true });
    const args = claudeAgentDef.buildArgs('hi', [], []);
    expect(args).toContain('--include-partial-messages');
  });

  it('omits --include-partial-messages when the capability entry says false', () => {
    agentCapabilities.set('claude', { partialMessages: false });
    const args = claudeAgentDef.buildArgs('hi', [], []);
    expect(args).not.toContain('--include-partial-messages');
  });

  it('omits --include-partial-messages when there is no capability entry at all', () => {
    const args = claudeAgentDef.buildArgs('hi', [], []);
    expect(args).not.toContain('--include-partial-messages');
  });

  it('adds --model <id> for a concrete model selection', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { model: 'sonnet' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
  });

  it('omits --model for the "default" sentinel', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { model: 'default' });
    expect(args).not.toContain('--model');
  });

  it('omits --model when falsy', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { model: '' });
    expect(args).not.toContain('--model');
  });

  it('adds --add-dir with all non-empty string dirs when addDir capability is not explicitly false', () => {
    const args = claudeAgentDef.buildArgs('hi', [], ['/a', '', '/b']);
    const idx = args.indexOf('--add-dir');
    expect(idx).toBeGreaterThan(-1);
    expect(args.slice(idx + 1, idx + 3)).toEqual(['/a', '/b']);
  });

  it('omits --add-dir entirely when the filtered dirs list is empty', () => {
    const args = claudeAgentDef.buildArgs('hi', [], ['']);
    expect(args).not.toContain('--add-dir');
  });

  it('tolerates an explicit null extraAllowedDirs (the `|| []` fallback, distinct from the default param)', () => {
    const args = claudeAgentDef.buildArgs('hi', [], null as unknown as string[]);
    expect(args).not.toContain('--add-dir');
  });

  it('omits --add-dir when the capability probe explicitly recorded addDir: false, even with dirs present', () => {
    agentCapabilities.set('claude', { addDir: false });
    const args = claudeAgentDef.buildArgs('hi', [], ['/a']);
    expect(args).not.toContain('--add-dir');
  });

  it('includes --add-dir when addDir capability is explicitly true', () => {
    agentCapabilities.set('claude', { addDir: true });
    const args = claudeAgentDef.buildArgs('hi', [], ['/a']);
    expect(args).toContain('--add-dir');
  });

  it('uses --resume <id> when runtimeContext.resumeSessionId is a non-empty string', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: 'sess-123' });
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-123');
    expect(args).not.toContain('--session-id');
  });

  it('uses --session-id <id> when resumeSessionId is absent but newSessionId is present', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { newSessionId: 'new-456' });
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe('new-456');
    expect(args).not.toContain('--resume');
  });

  it('emits neither --resume nor --session-id when both are absent', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, {});
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--session-id');
  });

  it('treats an empty-string resumeSessionId as absent and falls through to newSessionId', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: '', newSessionId: 'new-789' });
    expect(args).not.toContain('--resume');
    expect(args).toContain('--session-id');
  });

  it('treats a null resumeSessionId as absent', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: null });
    expect(args).not.toContain('--resume');
  });

  it('treats an empty-string newSessionId as absent (no --session-id emitted)', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { newSessionId: '' });
    expect(args).not.toContain('--session-id');
  });

  it('always appends --permission-mode bypassPermissions as the trailing flag', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { model: 'opus' }, { resumeSessionId: 'x' });
    expect(args.slice(-2)).toEqual(['--permission-mode', 'bypassPermissions']);
  });

  it('omits --permission-mode bypassPermissions entirely when permissionMode is "restricted"', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' });
    expect(args).not.toContain('--permission-mode');
    expect(args).not.toContain('bypassPermissions');
  });

  it('still bypasses permissions when permissionMode is left unset (backward-compatible default)', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {});
    expect(args.slice(-2)).toEqual(['--permission-mode', 'bypassPermissions']);
  });

  it('defaults extraAllowedDirs/options/runtimeContext when omitted entirely', () => {
    expect(() => claudeAgentDef.buildArgs('hi', [])).not.toThrow();
  });
});

describe('claudeAgentDef.fetchModels', () => {
  let dir: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-claude-fetchmodels-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it('falls back to null when no mmd routes file is resolvable (no HOME, no override)', async () => {
    const result = await claudeAgentDef.fetchModels!('claude', {});
    // With an empty env (no HOME, no MMD_MODEL_ROUTES_FILE), resolveMmdRoutesFile
    // falls back to the real OS homedir(), which normally exists on this dev
    // machine and won't have a mms/model-routes.json file, so this resolves to
    // null (file not found) rather than throwing.
    expect(result).toBeNull();
  });

  it('merges live mmd route ids with the static fallback models when a valid routes file exists', async () => {
    const routesFile = path.join(dir, 'model-routes.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      routesFile,
      JSON.stringify({
        routes: {
          'my-routed-model': { primary: { anthropic_base_url: 'https://example.com', api_key: 'k' } },
        },
      }),
      'utf8',
    );
    const result = await claudeAgentDef.fetchModels!('claude', { MMD_MODEL_ROUTES_FILE: routesFile });
    expect(result).not.toBeNull();
    expect(result!.some((m) => m.id === 'my-routed-model')).toBe(true);
    // Static fallback models still present alongside the routed id.
    expect(result!.some((m) => m.id === 'sonnet')).toBe(true);
  });

  it('returns null when the configured routes file does not exist', async () => {
    const result = await claudeAgentDef.fetchModels!('claude', {
      MMD_MODEL_ROUTES_FILE: path.join(dir, 'does-not-exist.json'),
    });
    expect(result).toBeNull();
  });
});
