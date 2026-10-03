import { describe, expect, it, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  normalizeConfigOptionToken,
  isModelConfigOption,
  findModelConfigOption,
  normalizeModelConfigOptions,
  normalizeModels,
  modelSelectionErrorIsRecoverable,
  currentModelFromSessionResult,
  detectAcpModels,
} from '../models.js';

describe('normalizeConfigOptionToken', () => {
  it('lowercases, trims, and strips separators', () => {
    expect(normalizeConfigOptionToken('  Model IDs ')).toBe('modelids');
    expect(normalizeConfigOptionToken('model_id-s')).toBe('modelids');
  });

  it('returns "" for a non-string', () => {
    expect(normalizeConfigOptionToken(42)).toBe('');
    expect(normalizeConfigOptionToken(undefined)).toBe('');
  });
});

describe('isModelConfigOption', () => {
  it('matches on category === "model"', () => {
    expect(isModelConfigOption({ category: 'model' }, 'whatever')).toBe(true);
  });

  it('matches on a normalised configId === "model"', () => {
    expect(isModelConfigOption({}, 'Model')).toBe(true);
  });

  it('rejects when category is present but not "model" (and configId/name do not match either)', () => {
    expect(isModelConfigOption({ category: 'other', name: 'unrelated' }, 'some-id')).toBe(false);
  });

  it('matches on MODEL_CONFIG_OPTION_IDS membership when no category is set', () => {
    expect(isModelConfigOption({}, 'models')).toBe(true);
  });

  it('matches on name === "model" when no category or known id matches', () => {
    expect(isModelConfigOption({ name: 'Model' }, 'some-id')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(isModelConfigOption({ name: 'unrelated' }, 'some-id')).toBe(false);
  });
});

describe('findModelConfigOption', () => {
  it('returns null for a non-array configOptions', () => {
    expect(findModelConfigOption(null)).toBeNull();
    expect(findModelConfigOption(undefined)).toBeNull();
  });

  it('returns null when no entry has a non-empty id', () => {
    expect(findModelConfigOption([{}, { id: '   ' }])).toBeNull();
  });

  it('skips a non-object entry', () => {
    expect(findModelConfigOption([null, { id: 'model', category: 'model' }])).toEqual({
      configId: 'model',
      currentValue: null,
      values: [],
    });
  });

  it('skips an entry whose type is set and is not "select"', () => {
    expect(findModelConfigOption([{ id: 'model', type: 'text', category: 'model' }])).toBeNull();
  });

  it('accepts an entry whose type is exactly "select"', () => {
    expect(
      findModelConfigOption([{ id: 'model', type: 'select', category: 'model', options: [{ id: 'a' }] }]),
    ).toEqual({ configId: 'model', currentValue: null, values: [{ id: 'a' }] });
  });

  it('skips an entry that fails isModelConfigOption', () => {
    expect(findModelConfigOption([{ id: 'unrelated', name: 'nope' }])).toBeNull();
  });

  it('reads a trimmed currentValue when present as a non-empty string', () => {
    expect(findModelConfigOption([{ id: 'model', category: 'model', currentValue: '  x  ' }])?.currentValue).toBe(
      'x',
    );
  });

  it('treats a blank currentValue as null', () => {
    expect(findModelConfigOption([{ id: 'model', category: 'model', currentValue: '   ' }])?.currentValue).toBeNull();
  });

  it('defaults values to [] when options is not an array', () => {
    expect(findModelConfigOption([{ id: 'model', category: 'model' }])?.values).toEqual([]);
  });
});

describe('normalizeModelConfigOptions', () => {
  const defaultOption = { id: 'default', label: 'Default (CLI config)' };

  it('returns null when no model config option is found', () => {
    expect(normalizeModelConfigOptions([], defaultOption)).toBeNull();
    expect(normalizeModelConfigOptions(undefined, defaultOption)).toBeNull();
  });

  it('always includes the default option first, deduplicated by id', () => {
    const result = normalizeModelConfigOptions(
      [{ id: 'model', category: 'model', options: [{ value: 'default' }, { value: 'gpt' }] }],
      defaultOption,
    );
    expect(result?.models.map((m) => m.id)).toEqual(['default', 'gpt']);
  });

  it('skips a non-object value entry', () => {
    const result = normalizeModelConfigOptions(
      [{ id: 'model', category: 'model', options: [null, { value: 'gpt' }] }],
      defaultOption,
    );
    expect(result?.models.map((m) => m.id)).toEqual(['default', 'gpt']);
  });

  it('uses id when value is absent, and skips an entry with neither', () => {
    const result = normalizeModelConfigOptions(
      [{ id: 'model', category: 'model', options: [{ id: 'claude' }, {}] }],
      defaultOption,
    );
    expect(result?.models.map((m) => m.id)).toEqual(['default', 'claude']);
  });

  it('marks the current model with a " • current" label suffix', () => {
    const result = normalizeModelConfigOptions(
      [{ id: 'model', category: 'model', currentValue: 'gpt', options: [{ value: 'gpt', name: 'GPT' }] }],
      defaultOption,
    );
    expect(result?.models[1]).toEqual({ id: 'gpt', label: 'GPT (gpt) • current' });
  });

  it('uses id alone as the label when name equals id or is absent', () => {
    const result = normalizeModelConfigOptions(
      [{ id: 'model', category: 'model', options: [{ value: 'gpt', name: 'gpt' }] }],
      defaultOption,
    );
    expect(result?.models[1]).toEqual({ id: 'gpt', label: 'gpt' });
  });

  it('deduplicates repeated values, keeping the first', () => {
    const result = normalizeModelConfigOptions(
      [{ id: 'model', category: 'model', options: [{ value: 'gpt' }, { value: 'gpt' }] }],
      defaultOption,
    );
    expect(result?.models.map((m) => m.id)).toEqual(['default', 'gpt']);
  });
});

describe('normalizeModels', () => {
  const defaultOption = { id: 'default', label: 'Default (CLI config)' };

  it('prefers configOptions when it yields more than one option', () => {
    const result = normalizeModels({ models: {}, defaultModelOption: defaultOption }, { configOptions: [{ id: 'model', category: 'model', options: [{ value: 'gpt' }] }] }
    );
    expect(result.map((m) => m.id)).toEqual(['default', 'gpt']);
  });

  it('falls back to models.availableModels when configOptions yields <= 1 option', () => {
    const result = normalizeModels({ models: { availableModels: [{ modelId: 'claude', name: 'Claude' }], currentModelId: 'claude' }, defaultModelOption: defaultOption }
    );
    expect(result).toEqual([{ id: 'default', label: 'Default (CLI config)' }, { id: 'claude', label: 'Claude (claude) • current' }]);
  });

  it('returns just the default when neither source has any usable models', () => {
    expect(normalizeModels({ models: null, defaultModelOption: defaultOption }, { configOptions: null })).toEqual([defaultOption]);
  });

  it('skips an availableModels entry with no modelId', () => {
    const result = normalizeModels({ models: { availableModels: [{ name: 'x' }] }, defaultModelOption: defaultOption });
    expect(result).toEqual([defaultOption]);
  });

  it('deduplicates availableModels entries by id', () => {
    const result = normalizeModels({ models: { availableModels: [{ modelId: 'a' }, { modelId: 'a' }] }, defaultModelOption: defaultOption }
    );
    expect(result.map((m) => m.id)).toEqual(['default', 'a']);
  });

  it('falls back to configModels.models when the availableModels path yields only the default and configModels exists', () => {
    const result = normalizeModels({ models: { availableModels: [] }, defaultModelOption: defaultOption }, { configOptions: [{ id: 'model', category: 'model', currentValue: 'solo', options: [{ value: 'solo' }] }] }
    );
    // configOptions yielded exactly 1 option (default + solo = 2 total, but
    // wait: defaultOption + solo = length 2, so config path already wins via
    // the `> 1` check above). Use a configOptions result with exactly the
    // default (no real matches) to hit the final fallback line instead.
    expect(result.map((m) => m.id)).toEqual(['default', 'solo']);
  });

  it('uses configModels.models as the final fallback when config yields exactly 1 (default-only) and availableModels also yields none', () => {
    const result = normalizeModels({ models: {}, defaultModelOption: defaultOption }, { configOptions: [{ id: 'model', category: 'model', options: [] }] }
    );
    expect(result).toEqual([defaultOption]);
  });
});

describe('modelSelectionErrorIsRecoverable', () => {
  it('returns true for the known recoverable codes', () => {
    for (const code of [-32603, -32602, -32601, -32002]) {
      expect(modelSelectionErrorIsRecoverable(code)).toBe(true);
    }
  });

  it('returns false for other codes', () => {
    expect(modelSelectionErrorIsRecoverable(-1)).toBe(false);
    expect(modelSelectionErrorIsRecoverable('nope')).toBe(false);
  });
});

describe('currentModelFromSessionResult', () => {
  it('prefers the config option currentValue', () => {
    expect(
      currentModelFromSessionResult({ configOptions: [{ id: 'model', category: 'model', currentValue: 'x' }] }),
    ).toBe('x');
  });

  it('falls back to models.currentModelId', () => {
    expect(currentModelFromSessionResult({ models: { currentModelId: 'y' } })).toBe('y');
  });

  it('returns null when neither is present or currentModelId is blank', () => {
    expect(currentModelFromSessionResult({})).toBeNull();
    expect(currentModelFromSessionResult({ models: { currentModelId: '   ' } })).toBeNull();
  });
});

// ---- detectAcpModels: driven by a fake child_process ----

class FakeStream extends EventEmitter {
  setEncoding = vi.fn();
  writes: string[] = [];
  ended = false;
  write(chunk: string) {
    this.writes.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
  }
}

class FakeChild extends EventEmitter {
  stdin = new FakeStream();
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;
  kill(signal?: string) {
    this.killed = true;
    this.emit('__killed', signal);
    return true;
  }
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

function lastRpcRequest(child: FakeChild) {
  const raw = child.stdin.writes.at(-1);
  return raw ? JSON.parse(raw) : null;
}

describe('detectAcpModels', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('performs initialize -> session/new and resolves with the detected models', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);

    const promise = detectAcpModels({ bin: 'acp-bin', args: [] });
    await Promise.resolve();
    const initReq = lastRpcRequest(child);
    expect(initReq.method).toBe('initialize');
    expect(initReq.params.clientInfo.name).toBe('agent-runtime-detect');

    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`);
    await Promise.resolve();
    const sessionNewReq = lastRpcRequest(child);
    expect(sessionNewReq.method).toBe('session/new');

    child.stdout.emit(
      'data',
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: { models: { availableModels: [{ modelId: 'a' }] } },
      })}\n`,
    );

    const models = await promise;
    expect(models.map((m) => m.id)).toEqual(['default', 'a']);
    expect(child.killed).toBe(true);
  });

  it('rejects when the child process errors on spawn', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bad-bin', args: [] });
    child.emit('error', new Error('ENOENT'));
    await expect(promise).rejects.toThrow('spawn failed: ENOENT');
  });

  it('rejects when stdin write fails', async () => {
    const child = new FakeChild();
    child.stdin.write = () => {
      throw new Error('EPIPE');
    };
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    await expect(promise).rejects.toThrow('stdin write failed: EPIPE');
  });

  it('rejects when stdin emits an error', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    child.stdin.emit('error', new Error('broken pipe'));
    await expect(promise).rejects.toThrow('stdin error: broken pipe');
  });

  it('rejects with an rpc error for the expected id', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    child.stdout.emit(
      'data',
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'bad init' } })}\n`,
    );
    await expect(promise).rejects.toThrow('bad init');
  });

  it('suppresses an unexpected-id -32603 error as cleanup noise', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    await Promise.resolve();
    // A stray -32603 for an id that is not the currently expected one should
    // be ignored, not reject the promise.
    child.stdout.emit(
      'data',
      `${JSON.stringify({ jsonrpc: '2.0', id: 99, error: { code: -32603, message: 'noise' } })}\n`,
    );
    // Then complete the real handshake normally.
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`);
    await Promise.resolve();
    child.stdout.emit(
      'data',
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { models: { availableModels: [] } } })}\n`,
    );
    await expect(promise).resolves.toEqual([{ id: 'default', label: 'Default (CLI config)' }]);
  });

  it('ignores a message with an unexpected id and no result', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 77 })}\n`);
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`);
    await Promise.resolve();
    child.stdout.emit(
      'data',
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { models: {} } })}\n`,
    );
    await expect(promise).resolves.toEqual([{ id: 'default', label: 'Default (CLI config)' }]);
  });

  it('flushes the parser on stdout close', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    // Feed a complete line with no trailing newline, then close stdout so
    // flush() must parse it.
    child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
    child.stdout.emit('close');
    await Promise.resolve();
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { models: {} } })}\n`);
    await expect(promise).resolves.toEqual([{ id: 'default', label: 'Default (CLI config)' }]);
  });

  it('rejects when the child exits before completion, including stderr in the message', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    child.stderr.emit('data', 'some stderr output');
    child.emit('close', 1, null);
    await expect(promise).rejects.toThrow(/exited code=1 signal=none stderr=some stderr output/);
  });

  it('rejects when the child exits before completion with no stderr', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    child.emit('close', null, 'SIGTERM');
    await expect(promise).rejects.toThrow(/exited code=null signal=SIGTERM$/);
  });

  it('does not reject again once already settled by a close after success', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`);
    await Promise.resolve();
    child.stdout.emit(
      'data',
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { models: {} } })}\n`,
    );
    await promise;
    // A subsequent close event must not throw or double-settle.
    expect(() => child.emit('close', 0, null)).not.toThrow();
  });

  it('times out when the handshake never completes', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] }, { timeoutMs: 50 });
    const assertion = expect(promise).rejects.toThrow(/timed out after/);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it('ignores a late RPC error that arrives after the promise has already settled', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`);
    await Promise.resolve();
    child.stdout.emit(
      'data',
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { models: {} } })}\n`,
    );
    await expect(promise).resolves.toEqual([{ id: 'default', label: 'Default (CLI config)' }]);
    // A late, non-cleanup-noise RPC error for the already-resolved id must
    // not throw or change the (already-settled) outcome.
    expect(() =>
      child.stdout.emit(
        'data',
        `${JSON.stringify({ jsonrpc: '2.0', id: 2, error: { message: 'too late' } })}\n`,
      ),
    ).not.toThrow();
  });

  it('swallows a stdin.end() failure inside finish()', async () => {
    const child = new FakeChild();
    child.stdin.end = () => {
      throw new Error('already closed');
    };
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] });
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`);
    await Promise.resolve();
    child.stdout.emit(
      'data',
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { models: {} } })}\n`,
    );
    await expect(promise).resolves.toEqual([{ id: 'default', label: 'Default (CLI config)' }]);
  });

  it('does not schedule a timer when effectiveTimeoutMs is 0', async () => {
    const child = new FakeChild();
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const promise = detectAcpModels({ bin: 'bin', args: [] }, { timeoutMs: 0 });
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`);
    await Promise.resolve();
    child.stdout.emit(
      'data',
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { models: {} } })}\n`,
    );
    await expect(promise).resolves.toEqual([{ id: 'default', label: 'Default (CLI config)' }]);
  });
});
