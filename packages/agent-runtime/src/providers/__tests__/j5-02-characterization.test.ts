import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProviderModels } from '../model-catalog.js';
import { sanitizeOAuthTokenFile, setStoredOAuthToken, getStoredOAuthToken } from '../oauth-tokens.js';
import { resolveOAuthBearer } from '../oauth-credentials.js';
import { startOAuthCallbackListener, type OAuthCallbackOutcome } from '../oauth-callback-server.js';
import { providerTurnAdapters, runProviderToolTurn, type ProviderTurnEvent } from '../tool-turn.js';
import type { StoredOAuthToken } from '../oauth-tokens.js';
import type { OAuthTokenResponse } from '../pkce.js';
import type { OAuthPkceProviderConfig } from '../oauth-provider.js';

const { refreshPort, fsObserver } = vi.hoisted(() => ({
  fsObserver: { beforeRename: undefined as ((from: import('node:fs').PathLike, to: import('node:fs').PathLike) => Promise<void>) | undefined },
  refreshPort: vi.fn<typeof import('../oauth-provider.js').refreshOAuthPkceToken>(),
}));
vi.mock('../oauth-provider.js', () => ({ refreshOAuthPkceToken: refreshPort }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    chmod: vi.fn(actual.chmod),
    rename: async (...args: Parameters<typeof actual.rename>) => {
      await fsObserver.beforeRename?.(...args);
      return actual.rename(...args);
    },
  };
});

const dnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const catalog = { protocol: 'openai' as const, baseUrl: 'https://provider.example', apiKey: 'fixture-credential' };
const config: OAuthPkceProviderConfig = {
  providerId: 'fixture', issuer: 'https://auth.example', authorizationEndpoint: 'https://auth.example/authorize',
  tokenEndpoint: 'https://auth.example/token', clientId: 'fixture-client', scope: 'openid',
};
afterEach(() => { vi.restoreAllMocks(); refreshPort.mockReset(); fsObserver.beforeRename = undefined; });

describe('J5-02 catalog characterization before restructuring', () => {
  it.each([
    [{ error: 'upstream' }, 'upstream'], [{ error: { message: ' nested ' } }, ' nested '],
    [{ error: { message: ' ' }, message: ' outer ' }, ' outer '],
    [{ error: 7, message: 'outer' }, 'outer'], [{ message: ' ' }, '{"message":" "}'],
    [null, 'null'], [false, 'false'], ['wire', '"wire"'],
  ])('preserves error-envelope precedence for %j', async (data, detail) => {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify(data), { status: 400 });
    expect(await listProviderModels(catalog, { dnsLookup, fetchFn })).toMatchObject({ ok: false, kind: 'unknown', detail });
  });
  it.each(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'OTHER'])('classifies network cause %s', async (code) => {
    const fetchFn: typeof fetch = async () => { throw new Error('transport', { cause: { code } }); };
    expect(await listProviderModels(catalog, { dnsLookup, fetchFn })).toMatchObject({ kind: code === 'OTHER' ? 'unknown' : 'invalid_base_url', detail: 'transport' });
  });
  it.each([
    ['embedding', false], ['moderation', false], ['rerank', false], ['whisper', false], ['tts', false],
    ['transcribe', false], ['speech', false], ['image', false], ['video', false], ['dall-e', false],
    ['stable-diffusion', false], ['flux', false], ['wan-t2v', false], ['other-i2i', false],
    ['t2i', false], ['i2v', false], ['v2v', false], ['asr', false], ['ocr', false],
    ['wan-chat', true], ['swan', true], ['gpt-chat', true], ['  ', false],
  ])('filters model family %s as before', async (id, keep) => {
    const fetchFn: typeof fetch = async () => Response.json({ data: [{ id }] });
    const result = await listProviderModels(catalog, { dnsLookup, fetchFn });
    expect(result.kind).toBe(keep ? 'success' : 'no_models');
    if (keep) expect(result.models).toEqual([{ id, label: id }]);
  });
  it.each([
    [{ has_more: true }, 'Provider omitted its pagination cursor.'],
    [{ has_more: true, last_id: '' }, 'Provider omitted its pagination cursor.'],
    [{ next_cursor: 'repeat' }, 'Provider repeated a pagination cursor.'],
  ])('retains pagination safety for %j', async (pagination, detail) => {
    const fetchFn: typeof fetch = async () => Response.json({ data: [{ id: 'chat' }], ...pagination });
    expect(await listProviderModels(catalog, { dnsLookup, fetchFn })).toMatchObject({ ok: false, detail });
  });
  it('stops at exactly 100 pages', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => Response.json({ data: [{ id: 'chat' }], next_cursor: String(++calls) });
    expect(await listProviderModels(catalog, { dnsLookup, fetchFn })).toMatchObject({ kind: 'unknown', detail: 'Provider pagination exceeded its safety limit.' });
    expect(calls).toBe(100);
  });
  it.each([['', 'no_models'], ['{', 'unknown']])('retains empty/malformed successful response behavior', async (body, kind) => {
    const fetchFn: typeof fetch = async () => new Response(body);
    expect(await listProviderModels(catalog, { dnsLookup, fetchFn })).toMatchObject({ ok: false, kind, status: 200 });
  });
  it('uses raw invalid JSON text for HTTP errors and redacts the key', async () => {
    const fetchFn: typeof fetch = async () => new Response(`invalid ${catalog.apiKey}`, { status: 401 });
    const result = await listProviderModels(catalog, { dnsLookup, fetchFn });
    expect(result.kind).toBe('auth_failed');
    expect(result.detail).toContain('invalid');
    expect(result.detail).not.toContain(catalog.apiKey);
  });
  it('forwards pre-abort and removes the parent listener after fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchFn: typeof fetch = async (_url, init) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('aborted', 'AbortError');
    };
    expect(await listProviderModels(catalog, { dnsLookup, fetchFn, signal: controller.signal })).toMatchObject({ kind: 'timeout' });
    expect(remove).toHaveBeenCalledOnce();
  });
});

describe('J5-02 OAuth token normalization', () => {
  it('creates token staging files with umask permissions before chmod (reported, not fixed)', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'j5-02-mode-'));
    let stagingMode: number | undefined;
    vi.mocked(chmod).mockClear();
    fsObserver.beforeRename = async (from) => {
      stagingMode = (await stat(from)).mode & 0o777;
      expect(chmod).not.toHaveBeenCalled();
    };
    try {
      await setStoredOAuthToken({ dataDir, fileName: 'tokens.json', token: { accessToken: 'fixture', tokenType: 'Bearer', savedAt: 0 } });
      expect(chmod).toHaveBeenCalledOnce();
      expect(chmod).toHaveBeenCalledWith(path.join(dataDir, 'tokens.json'), 0o600);
      // Windows does not expose POSIX owner/group modes; the chmod assertion above still pins lockdown there.
      if (process.platform !== 'win32') {
        expect(stagingMode).toBe(0o666 & ~process.umask());
        expect((await stat(path.join(dataDir, 'tokens.json'))).mode & 0o777).toBe(0o600);
      }
    } finally { await rm(dataDir, { recursive: true, force: true }); }
  });
  it.each([null, [], false, 'token', {}, { accessToken: ' ' }, { accessToken: 7 }])('rejects malformed token %j', (raw) => {
    expect(sanitizeOAuthTokenFile({ raw: { token: raw } })).toEqual({});
  });
  it.each([undefined, null, ' ', 4])('defaults optional strings and non-finite timestamps for %j', (value) => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    expect(sanitizeOAuthTokenFile({ raw: { token: { accessToken: ' access ', tokenType: value, refreshToken: value, scope: value, expiresAt: Infinity, savedAt: NaN } } })).toEqual({ token: { accessToken: 'access', tokenType: 'Bearer', savedAt: 123 } });
  });
  it('trims all strings and preserves zero timestamps', () => {
    expect(sanitizeOAuthTokenFile({ raw: { token: { accessToken: ' access ', tokenType: ' Custom ', refreshToken: ' refresh ', scope: ' scope ', expiresAt: 0, savedAt: 0 } } })).toEqual({ token: { accessToken: 'access', tokenType: 'Custom', refreshToken: 'refresh', scope: 'scope', expiresAt: 0, savedAt: 0 } });
  });
  const refreshCases: [OAuthTokenResponse, StoredOAuthToken][] = [
    [{ access_token: 'fresh' }, { accessToken: 'fresh', tokenType: 'Bearer', refreshToken: 'original', savedAt: 1000 }],
    [{ access_token: 'fresh', refresh_token: 'rotated', token_type: 'Custom', expires_in: 0, scope: 'new' }, { accessToken: 'fresh', tokenType: 'Custom', refreshToken: 'rotated', savedAt: 1000, expiresAt: 1000, scope: 'new' }],
  ];
  it.each(refreshCases)('persists refresh response defaults and rotation %j', async (response, expected) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'j5-02-'));
    try {
      vi.spyOn(Date, 'now').mockReturnValue(1000);
      await setStoredOAuthToken({ dataDir, fileName: 'tokens.json', token: { accessToken: 'old', tokenType: 'Bearer', refreshToken: 'original', expiresAt: 0, savedAt: 0 } });
      refreshPort.mockResolvedValue(response);
      const fetchImpl: typeof fetch = async () => { throw new Error('refresh port owns HTTP'); };
      expect(await resolveOAuthBearer({ config, dataDir, tokenFileName: 'tokens.json' }, { fetchImpl })).toEqual({ accessToken: 'fresh', source: 'refreshed' });
      expect(await getStoredOAuthToken({ dataDir, fileName: 'tokens.json' })).toEqual(expected);
      expect(refreshPort).toHaveBeenCalledWith({ config, refreshToken: 'original' }, { fetchImpl });
    } finally { await rm(dataDir, { recursive: true, force: true }); }
  });
});

describe('J5-02 callback outcome and consumption', () => {
  it.each([
    ['code=abc&state=expected', 200, { kind: 'ok', code: 'abc', state: 'expected' }],
    ['error=denied', 400, { kind: 'error', error: 'denied' }],
    ['error=denied&state=expected&code=abc', 400, { kind: 'error', error: 'denied', state: 'expected' }],
    ['error=denied&state=stale', 400, null], ['code=abc&state=stale', 400, null],
    ['code=abc', 400, null], ['state=expected', 400, null], ['', 400, null],
  ])('preserves outcome and listener consumption for %s', async (query, status, outcome) => {
    const outcomes: OAuthCallbackOutcome[] = [];
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'expected', onCallback: value => { outcomes.push(value); } });
    try {
      const base = `http://${listener.address.host}:${listener.address.port}/callback`;
      const response = await fetch(`${base}?${query}`);
      expect(response.status).toBe(status);
      await response.text();
      expect(outcomes).toEqual(outcome ? [outcome] : []);
      if (!outcome) {
        const retry = await fetch(`${base}?code=real&state=expected`);
        expect(retry.status).toBe(200);
        await retry.text();
        expect(outcomes).toEqual([{ kind: 'ok', code: 'real', state: 'expected' }]);
      }
    } finally { await listener.stop(); }
  });
});

describe('J5-02 readable tool image event MIME', () => {
  it.each([
    ['data:image/png;base64,AAAA', '[image: image/png]'],
    ['https://example.test/image.png', '[image: url]'],
    ['data:;base64,AAAA', '[image: url]'],
  ])('describes OpenAI image URL %s', async (url, content) => {
    const events: ProviderTurnEvent[] = [];
    await runProviderToolTurn({ protocol: 'openai', apiKey: 'fixture', model: 'chat', system: '', messages: [], tools: [], executeTool: async () => ({ content: '' }), onEvent: event => { events.push(event); }, adapters: {
      ...providerTurnAdapters,
      openai: async ({ onEvent }) => {
        onEvent({ type: 'tool_result', toolUseId: 'call', content: [{ type: 'image_url', image_url: { url } }], isError: false });
        return { finishReason: 'stop', toolTurns: 1 };
      },
    } });
    expect(events).toEqual([{ type: 'tool_result', toolUseId: 'call', content, isError: false }]);
  });
});
