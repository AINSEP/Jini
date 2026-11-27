import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import { composePublishCredentialSource, type DbPublishCredentialSourceDeps } from '../credentials.js';
import { createDbPublishCredentialSource, createEnvPublishCredentialSource, projectConnectionForPublish, redactDeployTargetMessage, toDeployTargetCredential } from "../credentials.js";
import { credentialFixture, credentialSpec } from "./credential.fixture.js";

test('an explicit unavailable connection never falls back to environment credentials', async () => {
  const dbDeps = { describeCredential: async () => null, resolveForPublish: async () => null,
    hasDefaultForPublish: async () => null, loadDeployTargets: async () => assert.fail('fallback registry was read'),
  } as unknown as DbPublishCredentialSourceDeps;
  const source = composePublishCredentialSource({ workspaceId: 'ws', executionMode: 'self-hosted-cli', dbDeps, env: { PUBLISH_TOKEN: 'available' } });
  const choice = { workspaceId: 'ws', target: 'host', credentialId: 'missing' };
  assert.deepEqual(await source.resolve(choice), { ok: false, reason: 'the selected publish credential is not available in this workspace — reload the Static Site tab and choose a connection again' });
  assert.deepEqual(await source.isConfigured(choice), { configured: false, reason: 'the selected publish credential is not available in this workspace — reload the Static Site tab and choose a connection again' });
});

test('environment resolution skips blank token variables and trims all selected values', async () => {
  const f = credentialFixture();
  const input = { workspaceId: 'workspace-7', target: 'host' };
  const env = { PRIMARY_KEY: '  ', FALLBACK_KEY: ' second ', PUBLISH_ACCOUNT: ' media ' };
  const source = createEnvPublishCredentialSource({ workspaceId: input.workspaceId, loadDeployTargets: f.loadDeployTargets, env });
  expect(await source.resolve(input)).toEqual({ ok: true, token: 'second', account: 'media', basis: { kind: 'env' } });
  expect(await source.isConfigured(input)).toEqual({ configured: true, basis: { kind: 'env' } });
  env.PRIMARY_KEY = ' first ';
  expect(await source.resolve(input)).toEqual({ ok: true, token: 'first', account: 'media', basis: { kind: 'env' } });
});

test('environment readiness explains missing token alternatives and required extra fields', async () => {
  const f = credentialFixture();
  const input = { workspaceId: 'workspace-7', target: 'host' };
  const env = { PRIMARY_KEY: '  ', PUBLISH_ACCOUNT: ' ' };
  const source = createEnvPublishCredentialSource({ workspaceId: input.workspaceId, loadDeployTargets: f.loadDeployTargets, env });
  expect(await source.resolve(input)).toEqual({ ok: false, reason: 'none of PRIMARY_KEY, FALLBACK_KEY is set — publishing to host requires a token with write access configured in the server environment (any one of these env vars)' });
  env.PRIMARY_KEY = 'present';
  expect(await source.isConfigured(input)).toEqual({ configured: false, reason: 'PUBLISH_ACCOUNT is not set — publishing to host requires both a token (PRIMARY_KEY or FALLBACK_KEY) and PUBLISH_ACCOUNT' });
  const alone = { ...f.target, descriptor: { ...f.target.descriptor, env: { tokenVars: ['ONLY_TOKEN'] } } };
  f.loadDeployTargets.mockResolvedValue({ ...f.registry, get: id => id === 'host' ? alone : undefined });
  expect(await source.resolve(input)).toEqual({ ok: false, reason: 'ONLY_TOKEN is not set — publishing to host requires a token with write access configured in the server environment' });
});

test('environment resolution refuses explicit choices and foreign workspaces before looking up targets', async () => {
  const f = credentialFixture();
  const input = { workspaceId: 'workspace-7', target: 'host' };
  const source = createEnvPublishCredentialSource({ workspaceId: input.workspaceId, loadDeployTargets: f.loadDeployTargets, env: { PRIMARY_KEY: 'present' } });
  expect(await source.resolve({ ...input, credentialId: 'other-row' })).toEqual({ ok: false, reason: "a saved connection was chosen for this publish, but this install resolves 'host' credentials from server environment variables, which have no saved connections to choose from" });
  expect(await source.isConfigured({ ...input, workspaceId: 'foreign' })).toEqual({ configured: false, reason: "this credential source is bound to workspace 'workspace-7' and refuses to resolve a token for workspace 'foreign'" });
  expect(f.loadDeployTargets).not.toHaveBeenCalled();
  expect(await source.resolve({ ...input, target: 'unknown' })).toEqual({ ok: false, reason: "'unknown' is not a deploy target this workspace knows — turn on a hosting plugin under Agent Plugins" });
  const { env: _env, ...descriptor } = f.target.descriptor;
  f.loadDeployTargets.mockResolvedValue({ ...f.registry, get: id => id === 'host' ? { ...f.target, descriptor } : undefined });
  expect(await source.resolve(input)).toEqual({ ok: false, reason: 'host has no server-environment-variable fallback — its credential can only be configured through a saved connection, never through env vars' });
});

test('projects declared credentials without bookkeeping and redacts declared secrets, not public account context', () => {
  const f = credentialFixture();
  const connection = { providerId: 'host', apiKey: 'fake-one-19', secondaryKey: 'fake-two-12', account: 'media-studio', unrelated: 'discard' };
  const projection = projectConnectionForPublish(connection, credentialSpec);
  expect(projection).toEqual({ ok: true, token: 'fake-one-19', secondaryKey: 'fake-two-12', account: 'media-studio' });
  expect(projectConnectionForPublish({ providerId: 'host', account: 'media-studio' }, credentialSpec)).toEqual({ ok: false, reason: "the saved 'host' credential has no apiKey — save the connection again" });
  if (!projection.ok) throw new Error(projection.reason);
  const resolved = { ...projection, credentialId: 'private-row', basis: { id: 'private-row', revision: 6 } };
  expect(toDeployTargetCredential(resolved)).toEqual({ token: 'fake-one-19', secondaryKey: 'fake-two-12', account: 'media-studio' });
  const message = redactDeployTargetMessage({ message: 'Refused media-studio: fake-one-19 / fake-two-12', credential: resolved, target: f.target });
  expect(message).toMatch(/^Refused media-studio: (?!.*fake-(?:one|two)).+ \/ .+$/);
});

test('default and chosen DB connections preserve independent identities, revisions and selection ports', async () => {
  const f = credentialFixture();
  const source = createDbPublishCredentialSource(f.dbDeps);
  const input = { workspaceId: 'workspace-7', target: 'host' };
  const chosen = { ...input, credentialId: 'row-chosen' };
  f.resolveDefaultForPublish.mockResolvedValue({ id: 'row-default', revision: 7, label: 'Default',
    connection: { providerId: 'host', apiKey: 'default-key', account: 'news' } });
  f.resolveForPublish.mockResolvedValue({ providerId: 'host', vendorId: 'studio-vendor', isDefault: false, revision: 9, label: 'Chosen',
    connection: { providerId: 'vendor-facing-id', apiKey: 'chosen-key', account: 'media' } });
  f.hasDefaultForPublish.mockResolvedValue({ id: 'row-chosen', revision: 9 });
  expect(await source.isConfigured(chosen)).toEqual({ configured: true, basis: { id: 'row-chosen', revision: 9 } });
  expect(f.resolveForPublish).not.toHaveBeenCalled();
  expect(f.resolveDefaultForPublish).not.toHaveBeenCalled();
  expect(await source.resolve(input)).toEqual({ ok: true, token: 'default-key', account: 'news', credentialId: 'row-default', basis: { id: 'row-default', revision: 7 } });
  expect(await source.resolve(chosen)).toEqual({ ok: true, token: 'chosen-key', account: 'media', credentialId: 'row-chosen', basis: { id: 'row-chosen', revision: 9 } });
  expect(f.resolveDefaultForPublish).toHaveBeenCalledExactlyOnceWith(f.dbDeps, { workspaceId: 'workspace-7', providerId: 'host' });
  expect(f.resolveForPublish).toHaveBeenCalledExactlyOnceWith(f.dbDeps, { workspaceId: 'workspace-7', providerId: 'host', id: 'row-chosen' });
  expect(f.hasDefaultForPublish).toHaveBeenCalledExactlyOnceWith(f.dbDeps, { workspaceId: 'workspace-7', providerId: 'host', id: 'row-chosen' });
});

test('explicit DB selection refuses a row scoped to another provider without opening it', async () => {
  const f = credentialFixture();
  const owner = { workspaceId: 'workspace-7', target: 'host', credentialId: 'row-other' };
  f.describeCredential.mockResolvedValue({ id: owner.credentialId, providerId: 'other-provider', vendorId: 'other-vendor',
    label: 'Other', configured: true, credentialType: 'vendor', worksFor: [], publishHosts: ['other-provider'], defaultFor: [],
    isDefault: false, tokenTail: '1234', accountLabel: null, createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z' });
  expect(await createDbPublishCredentialSource(f.dbDeps).resolve(owner)).toEqual({
    ok: false, reason: "the selected publish credential is saved for 'other-provider', not 'host' — choose a 'host' connection",
  });
  expect(f.describeCredential).toHaveBeenCalledExactlyOnceWith(f.dbDeps, { workspaceId: 'workspace-7', id: 'row-other' });
  expect(f.resolveForPublish).not.toHaveBeenCalled();
});

test('saved connections outrank environment credentials and hosted mode never uses the fallback', async () => {
  const f = credentialFixture();
  const input = { workspaceId: 'workspace-7', target: 'host' };
  const common = { dbDeps: f.dbDeps, workspaceId: input.workspaceId, env: { PRIMARY_KEY: 'env-only', PUBLISH_ACCOUNT: 'operator' } };
  const hosted = composePublishCredentialSource({ ...common, executionMode: 'hosted-api-only' });
  const local = composePublishCredentialSource({ ...common, executionMode: 'self-hosted-cli' });
  expect(await hosted.resolve(input)).toEqual({ ok: false, reason: "no default 'host' credential is saved for this workspace yet — add one in the Static Site tab" });
  expect(await hosted.isConfigured(input)).toEqual({ configured: false, reason: "no default 'host' credential is saved for this workspace yet — add one in the Static Site tab" });
  expect(f.loadDeployTargets).not.toHaveBeenCalled();
  expect(await local.resolve(input)).toEqual({ ok: true, token: 'env-only', account: 'operator', basis: { kind: 'env' } });
  expect(await local.isConfigured(input)).toEqual({ configured: true, basis: { kind: 'env' } });
  f.resolveDefaultForPublish.mockResolvedValue({ id: 'saved', revision: 3, label: 'Media',
    connection: { providerId: 'host', apiKey: 'saved-token', account: 'public-site' } });
  f.hasDefaultForPublish.mockResolvedValue({ id: 'saved', revision: 3 });
  expect(await local.resolve(input)).toEqual({ ok: true, token: 'saved-token', account: 'public-site', credentialId: 'saved', basis: { id: 'saved', revision: 3 } });
  expect(await local.isConfigured(input)).toEqual({ configured: true, basis: { id: 'saved', revision: 3 } });
});

test('DB resolution refuses connections with no current credential descriptor or a missing token field', async () => {
  const f = credentialFixture();
  const source = createDbPublishCredentialSource(f.dbDeps);
  const input = { workspaceId: 'workspace-7', target: 'host' };
  f.resolveDefaultForPublish.mockResolvedValueOnce({ id: 'saved-row', label: 'Default', revision: 1,
    connection: { providerId: 'retired-provider', apiKey: 'private-key' } });
  expect(await source.resolve(input)).toEqual({
    ok: false, reason: "'retired-provider' is not a deploy target this workspace knows — turn on a hosting plugin under Agent Plugins",
  });
  f.resolveForPublish.mockResolvedValueOnce({ providerId: 'host', vendorId: 'studio-vendor', label: 'Chosen', revision: 1, isDefault: false,
    connection: { providerId: 'host', account: 'studio' } });
  expect(await source.resolve({ ...input, credentialId: 'saved-row' })).toEqual({
    ok: false, reason: "the saved 'host' credential has no apiKey — save the connection again",
  });
});
