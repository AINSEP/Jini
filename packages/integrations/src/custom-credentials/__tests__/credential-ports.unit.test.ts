import { describe, expect, it, vi } from 'vitest';
import { bindCredentialedRequestPort, classifyCredentialedRequestError, type CredentialedRequestHostOperations } from '../credential-ports.js';
import type { CredentialVerification } from '@jini-ai/core/contracts/credentials';
import { CredentialedRequestTransportError, CredentialedRequestValidationError } from '../../credentialed-http/credentialed-request.js';
import { CustomCredentialNotFoundError } from '../../credentialed-http/sets/store.js';

class EgressRefused extends Error {
  readonly callerSafeMessage: string;
  constructor(details: { message: string }, options: { callerSafeMessage: string }) { super(details.message); this.callerSafeMessage = options.callerSafeMessage; }
}

describe('classifyCredentialedRequestError', () => {
  it('egress refusals expose only the caller-safe message, including on the rebuilt error', () => {
    const error = new EgressRefused({ message: 'internal.test resolved to 10.0.0.9' }, { callerSafeMessage: 'internal.test is not public' });
    const out = classifyCredentialedRequestError({ error, EgressRefusedError: EgressRefused });
    expect(out).toMatchObject({ category: 'egress-refused', error, callerSafeMessage: 'internal.test is not public' });
    if (out.category !== 'egress-refused') throw new Error(`unexpected ${out.category}`);
    const safe = out.callerSafeError as EgressRefused;
    expect(safe).toBeInstanceOf(EgressRefused);
    expect([safe.message, safe.callerSafeMessage]).toEqual(['internal.test is not public', 'internal.test is not public']);
  });

  it('maps validation, not-found, transport and unknown errors', () => {
    const v = new CredentialedRequestValidationError({ message: 'bad url' });
    const n = new CustomCredentialNotFoundError('no row');
    const t = new CredentialedRequestTransportError({ message: 'timeout' });
    const u = 'boom';
    expect(classifyCredentialedRequestError({ error: v, EgressRefusedError: EgressRefused })).toEqual({ category: 'validation', error: v, callerSafeMessage: 'bad url' });
    expect(classifyCredentialedRequestError({ error: n, EgressRefusedError: EgressRefused })).toEqual({ category: 'not-found', error: n, callerSafeMessage: 'no row' });
    expect(classifyCredentialedRequestError({ error: t, EgressRefusedError: EgressRefused })).toEqual({ category: 'transport', error: t });
    expect(classifyCredentialedRequestError({ error: u, EgressRefusedError: EgressRefused })).toEqual({ category: 'unknown', error: u });
  });
});

describe('bindCredentialedRequestPort', () => {
  it('forwards each call to the host operation with the bound deps', async () => {
    const deps = { repo: { id: 'repo' }, httpClient: { id: 'http' } };
    const verification: CredentialVerification = { status: 'valid', message: 'm', checkedAt: 't' };
    const operations = {
      makeCredentialedRequest: vi.fn(async () => ({ executed: true as const, status: 201, headers: {}, bodyText: 'x' })),
      resolveRequestTarget: vi.fn(async () => ({ label: 'L', url: new URL('https://a.test/') })),
      verifyCustomCredential: vi.fn(async () => verification),
      probeCredentialConnection: vi.fn(async () => 'refused' as const),
    } satisfies CredentialedRequestHostOperations<typeof deps>;
    const port = bindCredentialedRequestPort({ deps, operations, EgressRefusedError: EgressRefused });
    const req = { workspaceId: 'w', label: 'L', method: 'GET', url: 'https://a.test/' };
    expect((await port.request(req, { headers: { a: '1' }, body: 'b' })).status).toBe(201);
    expect(operations.makeCredentialedRequest).toHaveBeenLastCalledWith(deps, { ...req, headers: { a: '1' }, body: 'b' });
    await port.request(req);
    expect(operations.makeCredentialedRequest).toHaveBeenLastCalledWith(deps, { ...req, headers: undefined, body: undefined });
    expect((await port.resolveTarget({ workspaceId: 'w', label: 'L', url: 'u' })).label).toBe('L');
    expect(operations.resolveRequestTarget).toHaveBeenCalledWith({ repo: deps.repo }, { workspaceId: 'w', label: 'L', url: 'u' });
    expect(await port.verify({ workspaceId: 'w', label: 'L' })).toBe(verification);
    expect(operations.verifyCustomCredential).toHaveBeenCalledWith(deps, { workspaceId: 'w', label: 'L' });
    const probe = { connection: { token: 'tok-a' }, url: 'https://a.test/me', schemes: [] };
    expect(await port.probe(probe)).toBe('refused');
    expect(operations.probeCredentialConnection).toHaveBeenCalledWith(probe, { httpClient: deps.httpClient });
    expect(port.classifyError({ error: 'x' })).toEqual({ category: 'unknown', error: 'x' });
  });
});
