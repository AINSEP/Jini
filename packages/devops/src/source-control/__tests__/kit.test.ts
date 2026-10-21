import { describe, expect, it } from 'vitest';
import type { HttpClientPort } from '@jini-ai/core/primitives';
import { DeployError } from '../../core/deploy-types.js';
import { createSourceControlFetchAdapter, createSourceControlProviderKit } from '../kit.js';
import type { SourceControlFetchPort } from '../contracts.js';

/** Hand-written fetch port that records the init each request was sent with. */
function recordingFetch(response: () => Response = () => new Response('ok')) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const port: SourceControlFetchPort = async ({ url }, optional = {}) => { calls.push({ url, init: optional.init }); return response(); };
  return { port, calls };
}
const unusedHttpClient: HttpClientPort = { send: async () => { throw new Error('unused'); } };
const describeTransportError = ({ error }: { error: unknown }) => ({ refusal: undefined, logDetail: `described: ${String(error)}` });
const redirected = (): Response => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } });

describe('createSourceControlProviderKit', () => {
  it('adds the manual-redirect guard to every provider fetch by default without mutating the caller init', async () => {
    const fetch = recordingFetch();
    const kit = createSourceControlProviderKit({ httpClient: unusedHttpClient, fetch: fetch.port, describeTransportError });
    const init: RequestInit = { method: 'POST', headers: { authorization: 'token-header' } };
    await kit.fetch({ url: 'https://git.example/api/repos', init });
    expect(fetch.calls).toEqual([{ url: 'https://git.example/api/repos', init: { method: 'POST', headers: { authorization: 'token-header' }, redirect: 'manual' } }]);
    expect(init.redirect).toBeUndefined();
  });

  it('forwards the caller init untouched when the host opts into caller-owned redirect policy', async () => {
    const fetch = recordingFetch();
    const kit = createSourceControlProviderKit({ httpClient: unusedHttpClient, fetch: fetch.port, describeTransportError }, { fetchRedirectPolicy: 'caller' });
    const init: RequestInit = { method: 'GET', redirect: 'follow' };
    await kit.fetch({ url: 'https://git.example/archive', init });
    expect(fetch.calls[0]?.init).toBe(init);
  });

  it('exposes the shared redirect guard: manual-redirect init, typed refusal of a redirected response, and its classifier', () => {
    const kit = createSourceControlProviderKit({ httpClient: unusedHttpClient, fetch: recordingFetch().port, describeTransportError });
    expect(kit.redirectGuardInit({ init: { method: 'GET' } })).toEqual({ method: 'GET', redirect: 'manual' });
    expect(() => kit.assertNotRedirected({ response: new Response('ok'), hostName: 'GitHost' })).not.toThrow();

    let refusal: unknown;
    try { kit.assertNotRedirected({ response: redirected(), hostName: 'GitHost' }); } catch (error) { refusal = error; }
    expect(refusal).toBeInstanceOf(DeployError);
    expect((refusal as Error).message).toContain('GitHost attempted to redirect an authenticated request');
    expect(kit.isRedirectRefusal({ error: refusal })).toBe(true);
    expect(kit.isRedirectRefusal({ error: new Error('socket hang up') })).toBe(false);
  });

  it('keeps the host http client and delegates transport-error description to the host', () => {
    const kit = createSourceControlProviderKit({ httpClient: unusedHttpClient, fetch: recordingFetch().port, describeTransportError });
    expect(kit.httpClient).toBe(unusedHttpClient);
    expect(kit.describeTransportError({ error: 'ECONNRESET' })).toEqual({ refusal: undefined, logDetail: 'described: ECONNRESET' });
  });
});

describe('createSourceControlFetchAdapter', () => {
  it('calls the host-selected fetch with the url and init, and with no init when none is given', async () => {
    const seen: [string, RequestInit | undefined][] = [];
    const adapter = createSourceControlFetchAdapter({ fetch: async (input, init) => { seen.push([String(input), init]); return new Response('body'); } });
    const init: RequestInit = { method: 'HEAD' };
    expect(await (await adapter({ url: 'https://git.example/a' }, { init })).text()).toBe('body');
    await adapter({ url: 'https://git.example/b' });
    expect(seen).toEqual([['https://git.example/a', init], ['https://git.example/b', undefined]]);
  });
});
