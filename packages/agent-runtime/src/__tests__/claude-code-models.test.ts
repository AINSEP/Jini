import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLAUDE_CODE_INITIALIZE_ARGS,
  CLAUDE_CODE_INITIALIZE_REQUEST,
  loadClaudeCodeModels,
  parseClaudeCodePickerCache,
  parseClaudeInitializeModels,
  resolveClaudeConfigPath,
  setClaudeCodeModelIoForTesting,
  type ClaudeCodeModelIo,
} from '../claude-code-models.js';
import type { RuntimeModelOption } from '../types.js';

const FALLBACK: RuntimeModelOption[] = [
  { id: 'default', label: 'Default (CLI config)' },
  { id: 'sonnet', label: 'Sonnet (alias)' },
  { id: 'opus', label: 'Opus (alias)' },
  { id: 'claude-opus-5', label: 'claude-opus-5' },
];

/** The shape Claude Code 2.1.280 actually emitted for the initialize request (trimmed to the fields
 *  the parser reads), preceded by the hook/system lines that precede it in a real run. */
function initializeStdout(models: unknown[]): string {
  return [
    JSON.stringify({ type: 'system', subtype: 'hook_started' }),
    JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'jini-model-probe', response: { commands: [], models } },
    }),
    '',
  ].join('\n');
}

const REAL_MODELS = [
  { value: 'default', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Default (recommended)' },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Opus (1M context)' },
  { value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1', displayName: 'Fable' },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
];

function fakeIo(overrides: Partial<ClaudeCodeModelIo> = {}): ClaudeCodeModelIo & {
  runInitialize: ReturnType<typeof vi.fn>;
  readConfigFile: ReturnType<typeof vi.fn>;
} {
  return {
    runInitialize: vi.fn(overrides.runInitialize ?? (async () => null)),
    readConfigFile: vi.fn(overrides.readConfigFile ?? (async () => null)),
  };
}

afterEach(() => {
  setClaudeCodeModelIoForTesting(null);
});

describe('parseClaudeCodePickerCache', () => {
  it('returns the normalized cache ids', () => {
    const raw = JSON.stringify({
      additionalModelOptionsCache: [{ value: 'claude-fable-5-1[1m]', label: 'Fable' }, { value: 'claude-x-9' }, { value: 3 }, null],
    });
    expect(parseClaudeCodePickerCache(raw)).toEqual({ ok: true, ids: ['claude-fable-5-1', 'claude-x-9'] });
  });

  it('reports malformed JSON, a missing/empty cache, and valueless entries as distinct reasons', () => {
    expect(parseClaudeCodePickerCache('{not json')).toEqual({ ok: false, reason: 'invalid-json' });
    expect(parseClaudeCodePickerCache('null')).toEqual({ ok: false, reason: 'no-cache' });
    expect(parseClaudeCodePickerCache('{}')).toEqual({ ok: false, reason: 'no-cache' });
    expect(parseClaudeCodePickerCache('{"additionalModelOptionsCache":[]}')).toEqual({ ok: false, reason: 'no-cache' });
    expect(parseClaudeCodePickerCache('{"additionalModelOptionsCache":[{"value":null}]}')).toEqual({
      ok: false,
      reason: 'no-usable-values',
    });
  });
});

describe('parseClaudeInitializeModels', () => {
  it('yields aliases and concrete ids, strips [1m], drops the default sentinel, dedupes', () => {
    const rows = parseClaudeInitializeModels(initializeStdout(REAL_MODELS));
    expect(rows?.map((r) => r.id)).toEqual([
      'claude-opus-5-5',
      'opus',
      'claude-fable-5-1',
      'sonnet',
      'claude-sonnet-5',
      'haiku',
      'claude-haiku-4-5-20251001',
    ]);
    expect(rows?.find((r) => r.id === 'sonnet')?.label).toBe('Sonnet (alias)');
    expect(rows?.find((r) => r.id === 'claude-opus-5-5')?.label).toBe('claude-opus-5-5');
  });

  it('returns null for no response, an error response, garbage, or an empty models list', () => {
    expect(parseClaudeInitializeModels('')).toBeNull();
    expect(parseClaudeInitializeModels('Error: unknown option\n')).toBeNull();
    expect(parseClaudeInitializeModels('{"type":"control_response","response":{"subtype":"error","error":"x"}}')).toBeNull();
    expect(parseClaudeInitializeModels('{"type":"control_response", truncated')).toBeNull();
    expect(parseClaudeInitializeModels(initializeStdout([]))).toBeNull();
    expect(parseClaudeInitializeModels(initializeStdout([{ value: 'default' }]))).toBeNull();
  });

  it('drops ids the chat path would refuse', () => {
    const rows = parseClaudeInitializeModels(initializeStdout([{ value: 'bad id with spaces' }, { value: 'claude-ok-1' }]));
    expect(rows?.map((r) => r.id)).toEqual(['claude-ok-1']);
  });
});

describe('resolveClaudeConfigPath', () => {
  it('prefers CLAUDE_CONFIG_DIR, then HOME', () => {
    expect(resolveClaudeConfigPath({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' })).toBe('/cfg/.claude.json');
    expect(resolveClaudeConfigPath({ HOME: '/home/u' })).toBe('/home/u/.claude.json');
  });
});

describe('the probe request', () => {
  it('is a single initialize control request with no user message, and the argv starts no MCP servers or hooks', () => {
    const lines = CLAUDE_CODE_INITIALIZE_REQUEST.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'control_request', request: { subtype: 'initialize' } });
    expect(CLAUDE_CODE_INITIALIZE_ARGS).toEqual(expect.arrayContaining([
      '-p', '--no-session-persistence', '--strict-mcp-config', '{"disableAllHooks":true}',
    ]));
  });
});

describe('loadClaudeCodeModels', () => {
  it('unions the CLI picker catalog into the fallback without a credential', async () => {
    const io = fakeIo({ runInitialize: async () => initializeStdout(REAL_MODELS) });
    setClaudeCodeModelIoForTesting(io);
    const result = await loadClaudeCodeModels('claude', { HOME: '/home/u' }, FALLBACK);
    const ids = result!.map((m) => m.id);
    // Fallback fully present, first, in order.
    expect(ids.slice(0, FALLBACK.length)).toEqual(FALLBACK.map((m) => m.id));
    expect(ids).toContain('claude-opus-5-5');
    expect(ids).toContain('claude-fable-5-1');
    expect(new Set(ids).size).toBe(ids.length);
    // Fallback's label wins for an id present in both.
    expect(result!.find((m) => m.id === 'sonnet')?.label).toBe('Sonnet (alias)');
    // The CLI answered, so the weaker cache file is never read.
    expect(io.readConfigFile).not.toHaveBeenCalled();
  });

  it('falls back to ~/.claude.json additionalModelOptionsCache when the CLI probe yields nothing', async () => {
    const io = fakeIo({
      runInitialize: async () => 'error: unknown option --strict-mcp-config\n',
      readConfigFile: async () => JSON.stringify({ additionalModelOptionsCache: [{ value: 'claude-fable-6[1m]' }] }),
    });
    setClaudeCodeModelIoForTesting(io);
    const result = await loadClaudeCodeModels('openclaude', { CLAUDE_CONFIG_DIR: '/cfg' }, FALLBACK);
    expect(io.readConfigFile).toHaveBeenCalledWith('/cfg/.claude.json');
    expect(result!.map((m) => m.id)).toEqual([...FALLBACK.map((m) => m.id), 'claude-fable-6']);
  });

  it.each([
    ['missing', async () => null],
    ['malformed', async () => '{oops'],
    ['cache-less', async () => '{"numStartups":3}'],
    ['throwing', async () => { throw new Error('EACCES'); }],
  ])('degrades to null (never throws, never empties) for a %s ~/.claude.json', async (_label, readConfigFile) => {
    setClaudeCodeModelIoForTesting(fakeIo({ readConfigFile }));
    await expect(loadClaudeCodeModels('claude', { HOME: '/h' }, FALLBACK)).resolves.toBeNull();
  });

  it('degrades to null when the CLI probe itself rejects', async () => {
    setClaudeCodeModelIoForTesting(fakeIo({ runInitialize: async () => { throw new Error('ENOENT'); } }));
    await expect(loadClaudeCodeModels('claude', { HOME: '/h' }, FALLBACK)).resolves.toBeNull();
  });

  it('spawns once per TTL window per key, and again after it expires', async () => {
    const io = fakeIo({ runInitialize: async () => initializeStdout(REAL_MODELS) });
    setClaudeCodeModelIoForTesting(io);
    let t = 1_000;
    const now = () => t;
    await Promise.all([
      loadClaudeCodeModels('claude', { HOME: '/h' }, FALLBACK, now),
      loadClaudeCodeModels('claude', { HOME: '/h' }, FALLBACK, now),
    ]);
    t += 29 * 60_000;
    await loadClaudeCodeModels('claude', { HOME: '/h' }, FALLBACK, now);
    expect(io.runInitialize).toHaveBeenCalledTimes(1);
    // A different account (config dir) gets its own slot.
    await loadClaudeCodeModels('claude', { HOME: '/other' }, FALLBACK, now);
    expect(io.runInitialize).toHaveBeenCalledTimes(2);
    t += 2 * 60_000;
    await loadClaudeCodeModels('claude', { HOME: '/h' }, FALLBACK, now);
    expect(io.runInitialize).toHaveBeenCalledTimes(3);
  });
});
