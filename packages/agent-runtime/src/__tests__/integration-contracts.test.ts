import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ModelCatalogCache, unionModels, runProviderToolTurn, providerTurnAdapters,
  decodeSseStream, probeAcpModels, detectAcpModels, setAcpModelProbe,
  type AcpModelProbe, type ProviderTurnAdapters,
} from '../index.js';
import { ModelCatalogCache as CatalogSubpath } from '../model-catalog-cache.js';
import { runProviderToolTurn as TurnSubpath } from '../providers/tool-turn.js';
import { decodeSseStream as DecoderSubpath } from '../providers/sse-decode.js';
import { promotedAmrRetryStatusPayload, promotedAmrStderrPayload } from '../agent-protocol/acp/updates.js';

afterEach(() => setAcpModelProbe({ probe: null }));

describe('integrated runtime contracts', () => {
  it('exposes the same cache, turn and decoder implementations through the root barrel', () => {
    expect(ModelCatalogCache).toBe(CatalogSubpath);
    expect(runProviderToolTurn).toBe(TurnSubpath);
    expect(decodeSseStream).toBe(DecoderSubpath);
    // The real ACP transport and its injectable probe retain distinct exports.
    expect(probeAcpModels).not.toBe(detectAcpModels);
  });

  it('passes required and optional probe arguments to a host port separately', async () => {
    const required = { bin: 'example-cli', args: ['acp'] };
    const optional = { env: { CUSTOM_SCOPE: 'tenant' }, timeoutMs: 123, clientName: 'host', clientVersion: '1' };
    const detectModels = vi.fn<AcpModelProbe['detectModels']>(async () => [{ id: 'live', label: 'Live' }]);
    setAcpModelProbe({ probe: { detectModels } });
    expect(await probeAcpModels(required, optional)).toEqual([{ id: 'live', label: 'Live' }]);
    expect(detectModels).toHaveBeenCalledTimes(1);
    expect(detectModels).toHaveBeenCalledWith(required, optional);
  });

  it('promotes retry and stderr failures through the converted classifier port', () => {
    const classify = vi.fn(({ text }: { text: string }) => text.includes('quota exceeded')
      ? { code: 'QUOTA_EXCEEDED', message: 'quota exceeded', action: 'recharge' as const }
      : null);
    const classifier = { classify };
    expect(promotedAmrRetryStatusPayload({ status: 'retry', message: 'quota exceeded' }, classifier)).toMatchObject({
      error: { code: 'QUOTA_EXCEEDED', details: { promoted_by: 'agent_runtime_acp_retry_status' } },
    });
    expect(promotedAmrStderrPayload('opencode_event_stream_failure retry quota exceeded', classifier)).toMatchObject({
      error: { code: 'QUOTA_EXCEEDED', details: { promoted_by: 'agent_runtime_acp_stderr_retry_status' } },
    });
    expect(classify.mock.calls).toEqual([
      [{ text: 'retry\nquota exceeded' }],
      [{ text: 'opencode_event_stream_failure retry quota exceeded' }],
    ]);
  });

  it('keeps required provider dependencies separate from optional turn controls', async () => {
    const events: unknown[] = [];
    const executeTool = vi.fn(async () => ({ content: 'tool output' }));
    const openai = vi.fn<ProviderTurnAdapters['openai']>(async (required, optional = {}) => {
      expect(required.apiKey).toBe('fixture-key');
      expect(required.messages).toEqual([{ role: 'system', content: 'Brief' }, { role: 'user', content: 'Hello' }]);
      expect(required).not.toHaveProperty('baseUrl');
      expect(optional).toMatchObject({ baseUrl: 'https://provider.example', maxTokens: 77, maxToolTurns: 2 });
      const result = await optional.executeTool!({ id: 'call-1', name: 'lookup', input: { query: 'x' } });
      expect(result.content).toBe('tool output');
      required.onEvent({ type: 'end', reason: 'max_tool_turns' });
      return { finishReason: 'tool_calls', toolTurns: 2 };
    });
    const result = await runProviderToolTurn({
      protocol: 'openai', adapters: { ...providerTurnAdapters, openai }, apiKey: 'fixture-key', model: 'model',
      system: 'Brief', messages: [{ role: 'user', content: 'Hello' }], tools: [{ id: 'lookup' }],
      executeTool, onEvent: event => events.push(event),
    }, { baseUrl: 'https://provider.example', maxTokens: 77, maxToolTurns: 2 });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith({ id: 'call-1', name: 'lookup', input: { query: 'x' } });
    expect(result).toEqual({ stopReason: 'max_tool_turns', toolTurns: 2 });
    expect(events).toEqual([{ type: 'end', reason: 'max_tool_turns' }]);
  });

  it('uses root-exported cache ports without sharing state or overwriting fallback labels', async () => {
    const discover = vi.fn(async () => [{ id: 'same', label: 'Remote' }, { id: 'new', label: 'New' }]);
    const required = { clock: { nowMs: () => 0 }, discover, merge: unionModels<{ id: string; label: string }> };
    const first = new ModelCatalogCache(required);
    const second = new ModelCatalogCache(required);
    const input = { cacheKey: ['tenant', 'credential'], fallback: [{ id: 'same', label: 'Fallback' }] };
    expect(await first.get(input)).toEqual([{ id: 'same', label: 'Fallback' }, { id: 'new', label: 'New' }]);
    await first.get(input);
    await second.get(input);
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('decodes UTF-8 chunks through the independently importable universal entry', async () => {
    const bytes = new TextEncoder().encode('event: update\ndata: café\n\n');
    async function* source() {
      yield bytes.slice(0, bytes.length - 3); // Split the final UTF-8 character.
      yield bytes.slice(bytes.length - 3);
    }
    const frames = [];
    for await (const frame of DecoderSubpath({ source: source() })) frames.push(frame);
    expect(frames).toEqual([{ event: 'update', data: 'café' }]);
  });

  it('declares each subpath runtime and both declaration resolution paths', () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
    for (const [subpath, module, runtime] of [
      ['providers/tool-turn', 'providers/tool-turn', 'node'],
      ['model-catalog/cache', 'model-catalog-cache', 'universal'],
      ['providers/sse-decode', 'providers/sse-decode', 'universal'],
    ] satisfies [string, string, string][]) {
      expect(manifest.exports[`./${subpath}`]).toEqual({
        types: `./dist/${module}.d.ts`, import: `./dist/${module}.js`, default: `./dist/${module}.js`,
      });
      expect(manifest.jini.entries[`./${subpath}`]).toBe(runtime);
      expect(manifest.typesVersions['*'][subpath]).toEqual([`./dist/${module}.d.ts`]);
    }
    expect(manifest.jini.entries['.']).toBe('node');
    expect(manifest.dependencies['@jini-ai/oauth']).toBe('workspace:*');
  });
});
