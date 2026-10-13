import { describe, expect, it } from 'vitest';
import type { HttpClientPort, HttpRequest, HttpResponse } from '@jini-ai/core/primitives';
import { FETCH_TIMEOUT_MS } from '@jini-ai/platform/fetch-with-timeout';
import {
  createElevenLabsVoiceClient, ElevenLabsCredentialMissingError,
  type ElevenLabsCredentials, type ElevenLabsVoiceClientOptions,
} from '../elevenlabs.js';

const credentials: ElevenLabsCredentials = { apiKey: 'synthetic-fixture-key' };
const catalog: HttpResponse = { status: 200, headers: {}, bodyText: JSON.stringify({ voices: [
  { voice_id: 'voice-a', name: ' Alice ', labels: { accent: ' British ', blank: ' ', count: 1 } },
] }) };

function fixture(options: ElevenLabsVoiceClientOptions = {}) {
  let now = 0;
  let response = catalog;
  const requests: HttpRequest[] = [];
  const http: HttpClientPort = { send: async ({ request }) => { requests.push(request); return response; } };
  const client = createElevenLabsVoiceClient({ http, clock: { nowMs: () => now } }, options);
  const list = (workspaceKey = 'workspace-a', creds = credentials, limit?: number) => client.listVoiceOptions(
    { workspaceKey, resolveCredentials: async () => creds }, limit === undefined ? {} : { limit },
  );
  return { client, list, requests, setTime: (value: number) => { now = value; },
    respond: (value: HttpResponse) => { response = value; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('owned ElevenLabs voice client', () => {
  it('uses the supplied HTTP port with explicit budgets and normalizes its catalog', async () => {
    const f = fixture();
    expect(await f.list('workspace-a', { ...credentials, baseUrl: 'https://voice.example/' }, 7)).toEqual([
      { voiceId: 'voice-a', name: 'Alice', labels: { accent: 'British' } },
    ]);
    expect(f.requests).toEqual([{
      url: 'https://voice.example/v2/voices?page_size=7', method: 'GET',
      headers: { 'xi-api-key': credentials.apiKey, accept: 'application/json' },
      idleTimeoutMs: FETCH_TIMEOUT_MS.QUICK, totalDeadlineMs: FETCH_TIMEOUT_MS.QUICK,
      maxResponseBytes: 1024 * 1024,
    }]);
  });

  it('clones both new and cached results, including nested labels', async () => {
    const f = fixture();
    const first = await f.list();
    first[0]!.name = 'changed'; first[0]!.labels!.accent = 'changed'; first.push({ voiceId: 'extra', name: 'extra' });
    const second = await f.list();
    expect(second).toEqual([{ voiceId: 'voice-a', name: 'Alice', labels: { accent: 'British' } }]);
    second[0]!.labels!.accent = 'changed again';
    expect(await f.list()).toEqual([{ voiceId: 'voice-a', name: 'Alice', labels: { accent: 'British' } }]);
    expect(f.requests).toHaveLength(1);
  });

  it('keeps workspace, endpoint, credential and page variants distinct within one client', async () => {
    const f = fixture();
    await f.list(); await f.list();
    await f.list('workspace-b');
    await f.list('workspace-a', { ...credentials, baseUrl: 'https://voice.example' });
    await f.list('workspace-a', { apiKey: 'another-synthetic-key' });
    await f.list('workspace-a', credentials, 5);
    expect(f.requests).toHaveLength(5);
    await f.list('workspace-a', { ...credentials, baseUrl: 'https://voice.example/' });
    expect(f.requests).toHaveLength(5);
  });

  it('independent clients using the same identifiers return their own transport output', async () => {
    const first = fixture(); const second = fixture();
    second.respond({ ...catalog, bodyText: JSON.stringify({ voices: [{ voice_id: 'voice-b' }] }) });
    expect(await first.list()).toEqual([{ voiceId: 'voice-a', name: 'Alice', labels: { accent: 'British' } }]);
    expect(await second.list()).toEqual([{ voiceId: 'voice-b', name: 'voice-b' }]);
    first.client.clearCache();
    await second.list();
    expect(second.requests).toHaveLength(1);
  });

  it('expires exactly at the TTL on the supplied clock', async () => {
    const f = fixture(); await f.list();
    f.setTime(599_999); await f.list(); expect(f.requests).toHaveLength(1);
    f.setTime(600_000); await f.list(); expect(f.requests).toHaveLength(2);
  });

  it('evicts the oldest insertion at the configured capacity', async () => {
    const f = fixture({ maxCacheEntries: 2 });
    await f.list('a'); await f.list('b'); await f.list('c');
    await f.list('b'); await f.list('c'); expect(f.requests).toHaveLength(3);
    await f.list('a'); expect(f.requests).toHaveLength(4);
  });

  it('concurrent misses stay within the cache bound when they finish together', async () => {
    const pending = deferred<HttpResponse>(); const started = deferred<void>(); let calls = 0;
    const client = createElevenLabsVoiceClient({ clock: { nowMs: () => 0 }, http: { send: async () => {
      if (++calls === 2) started.resolve();
      return pending.promise;
    } } }, { maxCacheEntries: 1 });
    const required = (workspaceKey: string) => ({ workspaceKey, resolveCredentials: async () => credentials });
    const first = client.listVoiceOptions(required('a')); const second = client.listVoiceOptions(required('b'));
    await started.promise; pending.resolve(catalog); await Promise.all([first, second]);
    await client.listVoiceOptions(required('b')); expect(calls).toBe(2);
    await client.listVoiceOptions(required('a')); expect(calls).toBe(3);
  });

  it('sweeps expired variants before evicting a still-fresh variant', async () => {
    const f = fixture({ maxCacheEntries: 2 });
    await f.list('expired'); f.setTime(1_000); await f.list('fresh');
    f.setTime(600_000); await f.list('new'); await f.list('fresh');
    expect(f.requests).toHaveLength(3);
    await f.list('expired'); expect(f.requests).toHaveLength(4);
  });

  it('rechecks credentials on cache hits and rejects missing credentials without HTTP', async () => {
    const f = fixture(); await f.list();
    await expect(f.list('workspace-a', { apiKey: '' })).rejects.toBeInstanceOf(ElevenLabsCredentialMissingError);
    expect(f.requests).toHaveLength(1);
  });

  it('does not retain an unsuccessful, truncated or malformed response', async () => {
    for (const response of [
      { ...catalog, status: 401, bodyText: 'unauthorized' },
      { ...catalog, bodyTruncated: true },
      { ...catalog, bodyText: '{' },
    ]) {
      const f = fixture(); f.respond(response);
      if (response.status === 401) await expect(f.list()).rejects.toThrow('elevenlabs voices 401: unauthorized');
      else if (response.bodyTruncated) await expect(f.list()).rejects.toThrow('elevenlabs voices response was truncated');
      else await expect(f.list()).rejects.toBeInstanceOf(SyntaxError);
      f.respond(catalog);
      expect(await f.list()).toEqual([{ voiceId: 'voice-a', name: 'Alice', labels: { accent: 'British' } }]);
      expect(f.requests).toHaveLength(2);
    }
  });

  it('propagates the supplied transport failure and retries on the next lookup', async () => {
    const failure = new Error('fixture egress refused'); let calls = 0;
    const client = createElevenLabsVoiceClient({ clock: { nowMs: () => 0 }, http: { send: async () => {
      if (++calls === 1) throw failure;
      return catalog;
    } } });
    const required = { workspaceKey: 'a', resolveCredentials: async () => credentials };
    await expect(client.listVoiceOptions(required)).rejects.toBe(failure);
    expect(await client.listVoiceOptions(required)).toEqual([{ voiceId: 'voice-a', name: 'Alice', labels: { accent: 'British' } }]);
    expect(calls).toBe(2);
  });

  it('clears retained results', async () => {
    const f = fixture(); await f.list(); f.client.clearCache(); await f.list();
    expect(f.requests).toHaveLength(2);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid cache bound %s', maxCacheEntries => {
    expect(() => fixture({ maxCacheEntries })).toThrow('maxCacheEntries must be a positive safe integer');
  });
});
