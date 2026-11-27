import { expect, it, vi } from 'vitest';
import type { DeployCredentialCheck, DeployTargetRegistry, LoadedDeployTarget } from '../../deploy-targets/types.js';
import { canYieldAccountLabel, InMemoryPublishCredentialVerificationCache,
  verifyPublishCredential, verifyPublishCredentialById, verifySubmittedPublishCredential, type VerifyPublishCredentialDeps } from '../verify.js';
import { credentialFixture, credentialSpec } from './credential.fixture.js';

class InvalidCredential extends Error {}
const checkedAt = '2026-11-25T10:30:00.000Z';
const input = { workspaceId: 'workspace-7', target: 'host' };
const envBasis = { kind: 'env' } as const;

function verificationFixture() {
  const f = credentialFixture();
  const verifyCredential = vi.fn<NonNullable<LoadedDeployTarget['module']['verifyCredential']>>().mockResolvedValue({ ok: true, accountLabel: 'public-account' });
  const target: LoadedDeployTarget = { ...f.target, module: { ...f.target.module, verifyCredential } };
  const registry: DeployTargetRegistry = { ...f.registry, get: id => id === 'host' ? target : undefined, list: () => [target] };
  f.loadDeployTargets.mockResolvedValue(registry);
  const cache = new InMemoryPublishCredentialVerificationCache();
  const assertCredentialToken = vi.fn<VerifyPublishCredentialDeps['assertCredentialToken']>();
  const createDeployHostKit = vi.fn<VerifyPublishCredentialDeps['createDeployHostKit']>().mockReturnValue(f.kit);
  const fetchFn = vi.fn<typeof fetch>();
  const deps: VerifyPublishCredentialDeps = {
    CredentialInputError: InvalidCredential, credentialText: ({ id }) => `guidance for ${id}`, assertCredentialToken,
    clock: { nowIso: () => checkedAt }, credentialSource: f.deps.credentialSource, cache,
    loadDeployTargets: f.loadDeployTargets, createDeployHostKit, fetchFn,
  };
  return { ...f, deps, registry, target, verifyCredential, cache, assertCredentialToken, createDeployHostKit, fetchFn };
}

it('checks the primary and declared secondary secrets, then caches only the public provider verdict', async () => {
  const f = verificationFixture();
  f.resolve.mockResolvedValueOnce({ ok: true, token: 'primary-secret', secondaryKey: 'second-secret', account: 'media', basis: envBasis });
  const expected = { status: 'valid', message: 'Studio vendor accepted this credential.', checkedAt, accountLabel: 'public-account' };
  expect(canYieldAccountLabel({ registry: f.registry, target: 'host' })).toBe(true);
  expect(canYieldAccountLabel({ registry: f.registry, target: 'unknown' })).toBe(false);
  expect(await verifyPublishCredential(f.deps, input)).toEqual(expected);
  expect(f.cache.get({ ...input, basis: envBasis })).toEqual(expected);
  expect(f.cache.get({ ...input, workspaceId: 'other', basis: envBasis })).toBeUndefined();
  expect(f.verifyCredential).toHaveBeenCalledExactlyOnceWith({ credential: { token: 'primary-secret', secondaryKey: 'second-secret', account: 'media' }, kit: f.kit });
  expect(f.assertCredentialToken.mock.calls).toEqual([[{ value: 'primary-secret' }], [{ value: 'second-secret', field: 'secondaryKey' }]]);
  expect(f.createDeployHostKit).toHaveBeenCalledExactlyOnceWith({ fetchFn: f.fetchFn,
    timeouts: expect.objectContaining({ QUICK: 10_000 }),
  });
});

const responseCases: [string, DeployCredentialCheck, string, string][] = [
  ['401', { ok: false, reason: 'unreachable', statusCode: 401 }, 'invalid', 'guidance for auth'],
  ['403', { ok: false, reason: 'unreachable', statusCode: 403 }, 'invalid', 'guidance for auth'],
  ['408', { ok: false, reason: 'unreachable', statusCode: 408 }, 'unreachable', 'guidance for timeout'],
  ['504', { ok: false, reason: 'unreachable', statusCode: 504 }, 'unreachable', 'guidance for timeout'],
  ['provider refusal', { ok: false, reason: 'rejected', statusCode: 422 }, 'invalid',
    'Studio vendor rejected this credential (HTTP 422) — it is invalid, expired, or missing the required permissions.'],
  ['service failure', { ok: false, reason: 'unreachable', statusCode: 503 }, 'unreachable',
    'Could not reach Studio vendor to verify this credential (HTTP 503) — this does not necessarily mean the credential is bad.'],
];
it.each(responseCases)('maps %s to a caller-safe verdict and updates the cache', async (_label, check, status, message) => {
  const f = verificationFixture();
  f.verifyCredential.mockResolvedValueOnce(check);
  expect(await verifyPublishCredential(f.deps, input)).toEqual({ status, message, checkedAt });
  expect(f.cache.get({ ...input, basis: envBasis })).toEqual({ status, message, checkedAt });
});

it('rejects unsafe local credential fields before the provider can see them', async () => {
  const f = verificationFixture();
  f.resolve.mockResolvedValue({ ok: true, token: 'primary', secondaryKey: 'unsafe', basis: envBasis });
  f.assertCredentialToken.mockImplementation(({ field }) => {
    if (field === 'secondaryKey') throw new InvalidCredential('Secondary key is malformed');
  });
  expect(await verifyPublishCredential(f.deps, input)).toEqual({ status: 'invalid', message: 'Secondary key is malformed', checkedAt });
  f.assertCredentialToken.mockImplementation(() => { throw new Error('raw private diagnostic'); });
  expect(await verifyPublishCredential(f.deps, input)).toEqual({ status: 'invalid', message: 'guidance for unreachable', checkedAt });
  expect(f.verifyCredential).not.toHaveBeenCalled();
});

it('does not disclose transport exceptions and clears stale verification if the connection disappears', async () => {
  const f = verificationFixture();
  f.verifyCredential.mockRejectedValueOnce(new Error('transport exposed private URL'));
  expect(await verifyPublishCredential(f.deps, input)).toEqual({
    status: 'unreachable', message: 'Could not reach Studio vendor to verify this credential — this does not necessarily mean the credential is bad.', checkedAt,
  });
  f.resolve.mockResolvedValueOnce({ ok: false, reason: 'deleted' });
  expect(await verifyPublishCredential(f.deps, input)).toBeNull();
  expect(f.cache.get({ ...input, basis: envBasis })).toBeUndefined();
  expect(f.verifyCredential).toHaveBeenCalledTimes(1);
});

it('checks a named connection without replacing the active credential verdict unless it is the default', async () => {
  const f = verificationFixture();
  const deps = { ...f.deps, ...f.dbDeps };
  const row = { providerId: 'host', vendorId: 'studio-vendor', label: 'Alternate', revision: 3,
    isDefault: false, connection: { providerId: 'host', apiKey: 'submitted-key', account: 'news' } };
  const selected = { workspaceId: input.workspaceId, id: 'named-row' };
  const old = { status: 'invalid', message: 'Previous key is revoked', checkedAt } as const;
  f.cache.set({ ...input, basis: { id: 'old-row', revision: 1 } }, old);
  expect(await verifyPublishCredentialById(deps, selected)).toBeNull();
  expect(f.verifyCredential).not.toHaveBeenCalled();
  f.resolveForPublish.mockResolvedValueOnce(row);
  const verdict = { status: 'valid', message: 'Studio vendor accepted this credential.', checkedAt, accountLabel: 'public-account' };
  expect(await verifyPublishCredentialById(deps, selected)).toEqual(verdict);
  expect(f.verifyCredential).toHaveBeenCalledExactlyOnceWith({ credential: { token: 'submitted-key', account: 'news' }, kit: f.kit });
  expect(f.cache.get({ ...input, basis: { id: 'old-row', revision: 1 } })).toEqual(old);
  expect(f.cache.get({ ...input, basis: { id: 'named-row', revision: 3 } })).toBeUndefined();
  f.resolveForPublish.mockResolvedValueOnce({ ...row, isDefault: true });
  expect(await verifyPublishCredentialById(deps, selected)).toEqual(verdict);
  expect(f.cache.get({ ...input, basis: { id: 'named-row', revision: 3 } })).toEqual(verdict);
  expect(f.cache.get({ ...input, basis: { id: 'old-row', revision: 1 } })).toBeUndefined();
});

it('gives actionable guidance for an incomplete replacement or a host without a verifier', async () => {
  const f = verificationFixture();
  const required = { ...input, deps: f.deps, spec: credentialSpec };
  expect(await verifySubmittedPublishCredential({ ...required, connection: { providerId: 'host', account: 'news' } })).toEqual({
    status: 'unreachable', message: 'Could not verify this credential: the submitted connection is incomplete.', checkedAt,
  });
  expect(f.loadDeployTargets).not.toHaveBeenCalled();
  f.loadDeployTargets.mockResolvedValueOnce({ ...f.registry, get: () => undefined });
  const connection = { providerId: 'host', apiKey: 'replacement', account: 'news' };
  expect(await verifySubmittedPublishCredential({ ...required, connection })).toEqual({
    status: 'unreachable', message: "Could not verify this credential: no turned-on hosting plugin can check 'host' credentials.", checkedAt,
  });
  expect(f.verifyCredential).not.toHaveBeenCalled();
  f.verifyCredential.mockResolvedValueOnce({ ok: true });
  expect(await verifySubmittedPublishCredential({ ...required, connection })).toEqual({ status: 'valid', message: 'Studio vendor accepted this credential.', checkedAt });
  expect(f.verifyCredential).toHaveBeenCalledExactlyOnceWith({ credential: { token: 'replacement', account: 'news' }, kit: f.kit });
  expect(f.cache.get({ ...input, basis: envBasis })).toBeUndefined();
});

it('does not probe a saved connection that cannot be projected onto a host credential', async () => {
  const f = verificationFixture();
  const deps = { ...f.deps, ...f.dbDeps };
  const row = { providerId: 'host', vendorId: 'studio-vendor', label: 'Damaged', revision: 3,
    isDefault: false, connection: { providerId: 'host', account: 'news' } };
  const selected = { workspaceId: input.workspaceId, id: 'damaged-row' };
  f.resolveForPublish.mockResolvedValue(row);
  expect(await verifyPublishCredentialById(deps, selected)).toEqual({
    status: 'unreachable', message: "Could not verify this credential: the saved 'host' credential has no apiKey — save the connection again.", checkedAt,
  });
  f.loadDeployTargets.mockResolvedValueOnce({ ...f.registry, get: () => undefined });
  expect(await verifyPublishCredentialById(deps, selected)).toEqual({
    status: 'unreachable', message: "Could not verify this credential: no turned-on hosting plugin can check 'host' credentials.", checkedAt,
  });
  expect(f.verifyCredential).not.toHaveBeenCalled();
});
