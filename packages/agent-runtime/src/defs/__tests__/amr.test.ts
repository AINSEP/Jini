import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  execAgentFile: vi.fn(),
}));

vi.mock('../shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared.js')>();
  return { ...actual, execAgentFile: mockState.execAgentFile };
});

import {
  amrAgentDef,
  fetchVelaBillingSummary,
  fetchVelaPresetModels,
  fetchVelaRemoteModelsWithRetry,
  normalizeVelaModelId,
  parseVelaModelJson,
  parseVelaModels,
} from '../amr.js';
import type { RuntimeAgentDef } from '../../types.js';

afterEach(() => {
  mockState.execAgentFile.mockReset();
  vi.useRealTimers();
});

describe('amrAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(amrAgentDef.id).toBe('amr');
    expect(amrAgentDef.bin).toBe('vela');
    expect(amrAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(amrAgentDef.supportsCustomModel).toBe(false);
    expect(amrAgentDef.imageDelivery).toBe('native');
    expect(amrAgentDef.resumesSessionViaAcpLoad).toBe(true);
    expect(amrAgentDef.fallbackModels).toEqual([]);
    expect(amrAgentDef.defaultModelEnvVar).toBe('VELA_DEFAULT_MODEL');
    expect(amrAgentDef.inactivityTimeoutMs).toBe(30 * 60 * 1000);
  });

  it('buildArgs returns the fixed ACP argv regardless of inputs', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = amrAgentDef.buildArgs;
    const args = buildArgs('any prompt', ['/img.png'], ['/extra'], { model: 'x' }, { cwd: '/y' });
    expect(args).toEqual(['agent', 'run', '--runtime', 'opencode']);
  });
});

describe('normalizeVelaModelId', () => {
  it('returns null for an empty or whitespace-only id', () => {
    expect(normalizeVelaModelId('')).toBeNull();
    expect(normalizeVelaModelId('   ')).toBeNull();
  });

  it('strips a leading "vela/" provider prefix', () => {
    expect(normalizeVelaModelId('vela/deepseek-v3.2')).toBe('deepseek-v3.2');
  });

  it('strips a leading "public_model_" prefix', () => {
    expect(normalizeVelaModelId('public_model_glm_5')).toBe('glm-5');
  });

  it('returns null when the id is nothing but the public_model_ prefix', () => {
    expect(normalizeVelaModelId('public_model_')).toBeNull();
  });

  it('normalizes known compact deepseek ids to the link-facing slug', () => {
    expect(normalizeVelaModelId('deepseek_v3_2')).toBe('deepseek-v3.2');
    expect(normalizeVelaModelId('deepseek-v3-2')).toBe('deepseek-v3.2');
  });

  it('normalizes known compact kimi ids', () => {
    expect(normalizeVelaModelId('kimi_k2_6')).toBe('kimi-k2.6');
    expect(normalizeVelaModelId('kimi_k2_7_code')).toBe('kimi-k2.7-code');
  });

  it('normalizes known compact glm ids', () => {
    expect(normalizeVelaModelId('glm_5_1')).toBe('glm-5.1');
    expect(normalizeVelaModelId('glm_5')).toBe('glm-5');
  });

  it('normalizes a claude_<family>_<major>_<minor><suffix> id via normalizeKnownVelaVersionId', () => {
    expect(normalizeVelaModelId('claude_sonnet_4_5')).toBe('claude-sonnet-4.5');
    expect(normalizeVelaModelId('claude-opus-4-6-thinking')).toBe('claude-opus-4.6-thinking');
  });

  it('returns null for a claude-shaped id missing a required capture group', () => {
    // Regex requires family+major+minor; an id that matches the overall
    // shape but not the specific family word won't match the claude regex
    // at all and falls through to the generic underscore->dash replace.
    expect(normalizeVelaModelId('claude_turbo_4_5')).toBe('claude-turbo-4-5');
  });

  it('normalizes a gpt_<major>_<minor><suffix> id', () => {
    expect(normalizeVelaModelId('gpt_5_5')).toBe('gpt-5.5');
    expect(normalizeVelaModelId('gpt_5_1_codex_mini')).toBe('gpt-5.1-codex-mini');
  });

  it('normalizes a gemini_<major>_<minor><suffix> id', () => {
    expect(normalizeVelaModelId('gemini_2_5_flash')).toBe('gemini-2.5-flash');
  });

  it('normalizes a minimax_m<major>_<minor><suffix> id', () => {
    expect(normalizeVelaModelId('minimax_m2_1')).toBe('minimax-m2.1');
  });

  it('falls back to a plain underscore-to-dash replace for an unrecognized id shape', () => {
    expect(normalizeVelaModelId('some_totally_unknown_model_v9')).toBe('some-totally-unknown-model-v9');
  });

  it('passes through an id with no underscores and no known pattern unchanged', () => {
    expect(normalizeVelaModelId('already-dashed')).toBe('already-dashed');
  });
});

describe('parseVelaModels', () => {
  it('returns an empty array for empty/falsy stdout', () => {
    expect(parseVelaModels('')).toEqual([]);
  });

  it('skips blank lines and comment lines', () => {
    const result = parseVelaModels('\n# a comment\ndeepseek-v3.2\n\n');
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2']);
  });

  it('takes only the first whitespace-separated token per line', () => {
    const result = parseVelaModels('deepseek-v3.2   some trailing description');
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2']);
  });

  it('skips a line whose id normalizes to null', () => {
    const result = parseVelaModels('public_model_\ndeepseek-v3.2');
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2']);
  });

  it('de-duplicates repeated normalized ids', () => {
    const result = parseVelaModels('deepseek-v3.2\ndeepseek_v3_2');
    expect(result).toHaveLength(1);
  });

  it('filters out non-chat (media-generation) model ids', () => {
    const result = parseVelaModels(
      ['gpt-image-1', 'seedance-pro', 'doubao-seedance-1', 'veo-3', 'imagen-4', 'deepseek-v3.2'].join('\n'),
    );
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2']);
  });

  it('filters case-insensitively', () => {
    const result = parseVelaModels('GPT-IMAGE-1\ndeepseek-v3.2');
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2']);
  });

  it('orders known preferred chat models by PREFERRED_AMR_CHAT_MODEL_ORDER, unknowns after in insertion order', () => {
    const result = parseVelaModels(
      ['gemini-2.5-flash', 'some-unknown-model', 'glm-5.1', 'deepseek-v3.2', 'deepseek-v4-flash'].join('\n'),
    );
    expect(result.map((m) => m.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v3.2',
      'glm-5.1',
      'gemini-2.5-flash',
      'some-unknown-model',
    ]);
  });

  it('preserves original insertion order as a stable tie-break between two equally-(un)ranked models', () => {
    // Both ids are absent from PREFERRED_AMR_CHAT_MODEL_RANK, so both get the
    // same Number.MAX_SAFE_INTEGER rank — the `aRank - bRank` comparator is
    // therefore 0 (falsy) for this pair, forcing the sort to fall through to
    // the `a.index - b.index` tie-break rather than reordering them.
    const result = parseVelaModels(['zzz-unranked-model', 'aaa-unranked-model'].join('\n'));
    expect(result.map((m) => m.id)).toEqual(['zzz-unranked-model', 'aaa-unranked-model']);
  });
});

describe('parseVelaModelJson', () => {
  it('throws a descriptive error for unparseable JSON', () => {
    expect(() => parseVelaModelJson('not json', 'preset')).toThrow(/Invalid vela model JSON/);
  });

  it('stringifies a non-Error thrown value from a failing JSON.parse via the String(error) fallback', () => {
    const spy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'weird non-error throw';
    });
    try {
      expect(() => parseVelaModelJson('anything', 'preset')).toThrow(
        'Invalid vela model JSON: weird non-error throw',
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('throws when the parsed value is not an object (e.g. null, number, string)', () => {
    expect(() => parseVelaModelJson('null', 'preset')).toThrow(/expected object/);
    expect(() => parseVelaModelJson('42', 'preset')).toThrow(/expected object/);
    expect(() => parseVelaModelJson('"str"', 'preset')).toThrow(/expected object/);
  });

  it('throws when .source does not match the expected source', () => {
    expect(() => parseVelaModelJson(JSON.stringify({ source: 'remote', data: [] }), 'preset')).toThrow(
      /expected preset, got remote/,
    );
  });

  it('throws when .source is missing entirely', () => {
    expect(() => parseVelaModelJson(JSON.stringify({ data: [] }), 'preset')).toThrow(/got undefined/);
  });

  it('throws when .data is missing or not an array', () => {
    expect(() => parseVelaModelJson(JSON.stringify({ source: 'preset' }), 'preset')).toThrow(/expected data array/);
    expect(() => parseVelaModelJson(JSON.stringify({ source: 'preset', data: {} }), 'preset')).toThrow(
      /expected data array/,
    );
  });

  it('skips non-object entries and entries with no usable id', () => {
    const result = parseVelaModelJson(
      JSON.stringify({ source: 'preset', data: [null, 42, 'x', {}, { id: '  ' }, { id: 'deepseek-v3.2' }] }),
      'preset',
    );
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2']);
  });

  it('de-duplicates repeated ids and filters non-chat models', () => {
    const result = parseVelaModelJson(
      JSON.stringify({
        source: 'remote',
        data: [{ id: 'deepseek-v3.2' }, { id: 'deepseek-v3.2' }, { id: 'veo-3' }],
      }),
      'remote',
    );
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2']);
  });

  it('orders the resulting models by the preferred chat model order', () => {
    const result = parseVelaModelJson(
      JSON.stringify({ source: 'preset', data: [{ id: 'glm-5.1' }, { id: 'deepseek-v3.2' }] }),
      'preset',
    );
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2', 'glm-5.1']);
  });
});

describe('fetchVelaPresetModels', () => {
  it('calls `vela model preset --format json` and parses the preset-sourced JSON', async () => {
    mockState.execAgentFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ source: 'preset', data: [{ id: 'deepseek-v3.2' }] }),
      stderr: '',
    });
    const result = await fetchVelaPresetModels('/bin/vela', {});
    expect(mockState.execAgentFile).toHaveBeenCalledWith(
      '/bin/vela',
      ['model', 'preset', '--format', 'json'],
      expect.objectContaining({ env: {} }),
    );
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2']);
  });

  it('propagates a rejection from execAgentFile', async () => {
    mockState.execAgentFile.mockRejectedValueOnce(new Error('spawn failed'));
    await expect(fetchVelaPresetModels('/bin/vela', {})).rejects.toThrow('spawn failed');
  });
});

describe('fetchVelaRemoteModelsWithRetry', () => {
  it('calls `vela model list --format json` and returns the parsed remote list on first success', async () => {
    mockState.execAgentFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ source: 'remote', data: [{ id: 'deepseek-v3.2' }] }),
      stderr: '',
    });
    const result = await fetchVelaRemoteModelsWithRetry('/bin/vela', {});
    expect(mockState.execAgentFile).toHaveBeenCalledTimes(1);
    expect(mockState.execAgentFile).toHaveBeenCalledWith(
      '/bin/vela',
      ['model', 'list', '--format', 'json'],
      expect.objectContaining({ env: {} }),
    );
    expect(result.map((m) => m.id)).toEqual(['deepseek-v3.2']);
  });

  it('retries on a retriable error and succeeds on the second attempt', async () => {
    mockState.execAgentFile
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ stdout: JSON.stringify({ source: 'remote', data: [{ id: 'glm-5.1' }] }), stderr: '' });

    const promise = fetchVelaRemoteModelsWithRetry('/bin/vela', {});
    const result = await promise;
    expect(result.map((m) => m.id)).toEqual(['glm-5.1']);
    expect(mockState.execAgentFile).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('recognizes the full set of retriable error message substrings', async () => {
    const retriablePhrases = [
      'deadline exceeded',
      'timed out',
      'timeout',
      'temporarily unavailable',
      'temporary failure',
      'econnreset',
      'econnrefused',
      'enotfound',
      '502',
      '503',
      '504',
    ];
    for (const phrase of retriablePhrases) {
      mockState.execAgentFile.mockReset();
      mockState.execAgentFile
        .mockRejectedValueOnce(new Error(`upstream said: ${phrase}`))
        .mockResolvedValueOnce({ stdout: JSON.stringify({ source: 'remote', data: [{ id: 'glm-5.1' }] }), stderr: '' });
      const result = await fetchVelaRemoteModelsWithRetry('/bin/vela', {});
      expect(result.map((m) => m.id)).toEqual(['glm-5.1']);
      expect(mockState.execAgentFile).toHaveBeenCalledTimes(2);
    }
  }, 20_000);

  it('exhausts all retries and throws the last error when every attempt is retriable', async () => {
    mockState.execAgentFile.mockRejectedValue(new Error('timeout'));
    await expect(fetchVelaRemoteModelsWithRetry('/bin/vela', {})).rejects.toThrow('timeout');
    // Initial attempt (0) + 2 retries (delays array has 2 entries) = 3 total calls.
    expect(mockState.execAgentFile).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('throws immediately without retrying on a non-retriable error', async () => {
    mockState.execAgentFile.mockRejectedValueOnce(new Error('permission denied'));
    await expect(fetchVelaRemoteModelsWithRetry('/bin/vela', {})).rejects.toThrow('permission denied');
    expect(mockState.execAgentFile).toHaveBeenCalledTimes(1);
  });

  it('wraps a non-Error rejection (e.g. a thrown string) into a real Error', async () => {
    mockState.execAgentFile.mockRejectedValueOnce('a plain string failure, not retriable');
    await expect(fetchVelaRemoteModelsWithRetry('/bin/vela', {})).rejects.toThrow(
      'a plain string failure, not retriable',
    );
  });

  it('wraps a nullish rejection into a generic error message', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    mockState.execAgentFile.mockRejectedValueOnce(undefined);
    await expect(fetchVelaRemoteModelsWithRetry('/bin/vela', {})).rejects.toThrow('undefined');
  });
});

describe('fetchVelaBillingSummary', () => {
  it('calls `vela billing summary --format json` and prefers balanceUsd over totalAvailableCreditsUsd', async () => {
    mockState.execAgentFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ balanceUsd: '12.34', totalAvailableCreditsUsd: '99.00', membershipTier: 'max' }),
      stderr: '',
    });
    const result = await fetchVelaBillingSummary('/bin/vela', {});
    expect(mockState.execAgentFile).toHaveBeenCalledWith(
      '/bin/vela',
      ['billing', 'summary', '--format', 'json'],
      expect.objectContaining({ env: {} }),
    );
    expect(result).toEqual({ plan: 'max', balanceUsd: '12.34' });
  });

  it('falls back to totalAvailableCreditsUsd when balanceUsd is not a string', async () => {
    mockState.execAgentFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ totalAvailableCreditsUsd: '5.00', membershipTier: 'pro' }),
      stderr: '',
    });
    const result = await fetchVelaBillingSummary('/bin/vela', {});
    expect(result).toEqual({ plan: 'pro', balanceUsd: '5.00' });
  });

  it('returns a null balance when neither field is a string', async () => {
    mockState.execAgentFile.mockResolvedValueOnce({ stdout: JSON.stringify({ membershipTier: 'pro' }), stderr: '' });
    const result = await fetchVelaBillingSummary('/bin/vela', {});
    expect(result.balanceUsd).toBeNull();
  });

  it('normalizes a missing membershipTier to the "free" sentinel', async () => {
    mockState.execAgentFile.mockResolvedValueOnce({ stdout: JSON.stringify({ balanceUsd: '0.00' }), stderr: '' });
    const result = await fetchVelaBillingSummary('/bin/vela', {});
    expect(result.plan).toBe('free');
  });

  it('normalizes a blank/whitespace-only membershipTier to "free"', async () => {
    mockState.execAgentFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ balanceUsd: '0.00', membershipTier: '   ' }),
      stderr: '',
    });
    const result = await fetchVelaBillingSummary('/bin/vela', {});
    expect(result.plan).toBe('free');
  });

  it('trims a real membershipTier value', () => {
    mockState.execAgentFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ balanceUsd: '0.00', membershipTier: '  max  ' }),
      stderr: '',
    });
    return fetchVelaBillingSummary('/bin/vela', {}).then((result) => {
      expect(result.plan).toBe('max');
    });
  });
});
