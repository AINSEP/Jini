/** @file `verifyCustomCredential` probes only the saved origin: which `path` values it accepts and the one value-free refusal for the rest. */
import { describe, expect, it } from 'vitest';
import type { HttpClientPort, HttpRequest, HttpResponse } from '@jini-ai/core/primitives';
import { InMemoryCredentialedRequestAuditLog, verifyCustomCredential, type CredentialedRequestDeps } from '../credentialed-request.js';
import { CredentialedRequestValidationError } from '../../contracts/credentialed-request-errors.js';
import { createCustomCredential, loadBundledAuthSchemes, makeWriteDeps } from './resolver-fixtures.js';

const WS = 'ws-1';
const REFUSAL = 'probe path must be relative to the saved base URL and remain on its origin';

async function setup() {
  const sent: HttpRequest[] = [];
  const httpClient: HttpClientPort = { send: async ({ request }: { request: HttpRequest }): Promise<HttpResponse> => { sent.push(request); return { status: 200, headers: {}, bodyText: '' }; } } as never;
  const write = makeWriteDeps();
  await createCustomCredential(write, { workspaceId: WS, label: 'probe.example', category: 'hosting', baseUrl: 'https://api.probe.example', connection: { token: 'probe-secret-token' } });
  const deps: CredentialedRequestDeps = { resolver: write.repo, clock: write.clock, httpClient, schemeRegistry: { load: loadBundledAuthSchemes }, audit: new InMemoryCredentialedRequestAuditLog() };
  return { deps, sent };
}
const verify = (deps: CredentialedRequestDeps, path?: unknown) => verifyCustomCredential({ deps, input: { workspaceId: WS, label: 'probe.example' } }, path === undefined ? {} : { path: path as string });

describe('verifyCustomCredential probe path', () => {
  it('probes the origin root when no path is given and a relative path on the saved origin otherwise', async () => {
    const { deps, sent } = await setup();
    expect((await verify(deps)).status).toBe('valid');
    expect((await verify(deps, '/user?x=1')).status).toBe('valid');
    expect((await verify(deps, 'v2/ping')).status).toBe('valid');
    expect(sent.map(r => r.url)).toEqual(['https://api.probe.example/', 'https://api.probe.example/user?x=1', 'https://api.probe.example/v2/ping']);
  });

  it.each([
    ['an absolute URL on another host', 'https://evil.example/x'],
    ['the same host written as an absolute URL', 'https://api.probe.example/x'],
    ['a network-path reference', '//evil.example/x'],
    ['a backslash network-path reference', '\\\\evil.example\\x'],
    ['a javascript scheme', 'javascript:alert(1)'],
    ['a blank string', '   '],
    ['an empty string', ''],
    ['a non-string', 42],
    ['a control character', '/ok\u0000bad'],
    ['a DEL character', '/ok\u007fbad'],
  ])('refuses %s with the same value-free message', async (_name, path) => {
    const { deps, sent } = await setup();
    const error = await verify(deps, path).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialedRequestValidationError);
    expect((error as Error).message).toBe(REFUSAL);
    if (String(path).trim() !== '') expect((error as Error).message).not.toContain(String(path));
    expect(sent).toEqual([]);
  });
});
