import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { SurfaceCardsPort } from '@jini-ai/core/contracts/cards';
import { buildPublishHostCredentialHandler } from '../publish-agent-tools.js';
import { readCredentialHints } from "../publish-tool-credential.js";
import { credentialTarget, storeFixture } from "../publish-credentials/__tests__/store-fixture.js";
import { resolveDefaultForPublish } from "../publish-credentials/store-resolution.js";
import { assertCredentialToken, CredentialInputError } from "@jini-ai/platform/secrets/credential-token";
import { createDeployHostKit } from "../deploy-targets/host-kit.js";
import { createPublishCredential } from "../publish-credentials/store.js";
import { PublishCredentialValidationError } from "../publish-credentials/store-validation.js";
import type { LoadedDeployTarget } from "../deploy-targets/types.js";
import type { StaticPublishToolDeps } from '../publish-tool-deps.js';

test('the credential review retains the descriptor fields and host card identity', async () => {
  const descriptor = { id: 'host', label: 'Host', configFields: [], credential: { vendorId: 'vendor', tokenField: 'token',
    fields: [{ name: 'token', label: 'Token', secret: true, required: true }, { name: 'region', label: 'Region', required: false }] } };
  let form: unknown;
  const defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'] = spec => ({ toolId: spec.toolId, secretFieldNames: () => ['token'], handler: () => async ctx => {
    const prep = await spec.prepare({ ctx }); form = spec.form({ prep }); return spec.result({ prep, run: { status: 'cancelled' } });
  } });
  const deps = { workspaceId: 'ws', loadDeployTargets: async () => ({ list: () => [{ descriptor, module: {} }], get: () => ({ descriptor, module: {} }) }),
    requireToolPermission: async () => {}, authorize: async () => ({ allowed: true }), assertCredentialFreeField: () => {},
    credentialStorePorts: { selectCredentialForProvider: () => null, credentialScopes: ({ deps, workspaceId }: { deps: unknown; workspaceId: string }) => [{ deps, workspaceId, scope: 'site' }] },
    vendorCredentialSetRepo: { credentialVault: { open: () => ({ list: async () => [] }), scope: () => ({}) } },
    resolveOperatorLocale: async () => 'en', findPluginCredentialCard: async () => undefined,
    applyPluginCredentialCard: ({ form }: { form: unknown }) => form, defineSecretCardTool,
    credentialSaveToolId: 'credential_save', credentialFormApp: { appName: 'host-save', appVersion: '1' },
    credentialText: () => 'not saved', secretCardOptions: { uriHost: 'host' },
  } as unknown as StaticPublishToolDeps;
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'person' }, run: { id: 'run' }, input: { target: 'host', region: 'west' }, signal: new AbortController().signal };
  assert.deepEqual(await buildPublishHostCredentialHandler({ deps, surfaces: {} as never })(ctx), { saved: false, cancelled: true });
  assert.deepEqual(form, { title: 'Connect Host', submitLabel: 'Save connection', fields: [
    { kind: 'string', name: 'token', label: 'Token', required: true, secret: true, allowBlank: false },
    { kind: 'string', name: 'region', label: 'Region', required: false, value: 'west' },
  ], app: { appName: 'host-save', appVersion: '1' }, preferredFrameSize: ['100%', '560px'] });
});

test('credential hints refuse secret input, wrong shapes and undeclared fields before the card opens', () => {
  const { deps } = storeFixture([]);
  const inputDeps = { assertCredentialFreeField: deps.assertCredentialFreeField } as StaticPublishToolDeps;
  const descriptor = credentialTarget('host', 'vendor', [
    { name: 'token', label: 'Token', required: true },
    { name: 'otherSecret', label: 'Secondary token', required: false, secret: true },
    { name: 'region', label: 'Region', required: false },
    { name: 'bucket', label: 'Bucket', required: false },
  ]).descriptor;
  assert.deepEqual(readCredentialHints({ target: 'host', region: ' ', bucket: 'docs' }, descriptor, inputDeps), { bucket: 'docs' });
  assert.throws(() => readCredentialHints({ target: 'host', token: 'raw-secret' }, descriptor, inputDeps),
    { name: 'ToolInputError', message: "'token' is secret: the person types it into the form, never into the chat." });
  assert.throws(() => readCredentialHints({ target: 'host', otherSecret: 'raw-secret' }, descriptor, inputDeps),
    { name: 'ToolInputError', message: "'otherSecret' is secret: the person types it into the form, never into the chat." });
  assert.throws(() => readCredentialHints({ target: 'host', bucket: 123 }, descriptor, inputDeps),
    { name: 'ToolInputError', message: "'bucket' must be a string." });
  assert.throws(() => readCredentialHints({ target: 'host', region: 'https://example.test/?token=sample' }, descriptor, inputDeps),
    { name: 'CredentialInputError', message: 'Put credentials in the secret field, not in this field.' });
  assert.throws(() => readCredentialHints({ target: 'host', label: 'Build' }, descriptor, inputDeps),
    { name: 'ToolInputError', message: "'label' is not a credential field of host. It takes: token, otherSecret, region, bucket." });
});

test('the submitted card saves only declared fields and returns a recognition hint without the key', async () => {
  const host = credentialTarget('host', 'vendor', [
    { name: 'token', label: 'Token', required: true },
    { name: 'region', label: 'Region', required: true },
    { name: 'session', label: 'Optional secret', required: false, secret: true },
  ]);
  const { deps: store, repo, registry } = storeFixture([host]);
  const sentinel = 'private-demo-token-2701';
  const outcomes: unknown[] = [];
  const defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'] = spec => ({
    toolId: spec.toolId, secretFieldNames: () => ['token', 'session'],
    handler: () => async ctx => {
      const prep = await spec.prepare({ ctx });
      const saved = await spec.save({ prep, signal: ctx.signal, values: { token: sentinel, region: ' west ', session: '', ignored: 'do not keep' } });
      const run = { status: 'saved' as const, saved };
      outcomes.push(spec.outcome({ prep, run }));
      return spec.result({ prep, run });
    },
  });
  const deps = {
    workspaceId: 'site', vendorCredentialSetRepo: repo, credentialStorePorts: store,
    loadDeployTargets: async () => registry,
    siteAssistantSecretKeyring: store.keyring, siteAssistantSecretSealer: store.sealer, clock: store.clock, idGen: store.idGen,
    abortGuardedCredentialRepo: ({ store }: { store: typeof repo }) => store,
    credentialRowLabel: 'Connection', credentialSaveToolId: 'credential_save',
    assertCredentialFreeField: store.assertCredentialFreeField, authorize: async () => ({ allowed: true }),
    requireToolPermission: async ({ workspaceId, principalId, permission }: { workspaceId: string; principalId: string; permission: string }) =>
      assert.deepEqual({ workspaceId, principalId, permission }, { workspaceId: 'site', principalId: 'person', permission: 'deployments.credentials.write' }),
    resolveOperatorLocale: async () => 'en', findPluginCredentialCard: async () => undefined,
    applyPluginCredentialCard: ({ form }: { form: unknown }) => form, defineSecretCardTool, secretCardOptions: {},
    credentialText: ({ id }: { id: string }) => id === 'saved' ? 'Saved, not tested.' : id,
    formatCredentialHint: ({ hint }: { hint: { last4: string | null } }) => `Ends in ${hint.last4}`,
  } as unknown as StaticPublishToolDeps;
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'person' }, run: { id: 'run' }, input: { target: 'host', region: 'west' }, signal: new AbortController().signal };
  const result = await buildPublishHostCredentialHandler({ deps, surfaces: {} as never })(ctx);
  assert.deepEqual(result, {
    saved: true, credentialId: 'key-2', providerId: 'host', connected: false, connection: 'saved',
    tokenHint: { length: sentinel.length, last4: '2701' }, message: 'Ends in 2701. Saved, not tested.',
  });
  assert.deepEqual(outcomes, [{ title: 'savedTitle', state: 'success', message: 'Ends in 2701. Saved, not tested.' }]);
  assert.deepEqual((await resolveDefaultForPublish(store, { workspaceId: 'site', providerId: 'host' }))?.connection,
    { providerId: 'host', token: sentinel, region: 'west' });
});

test('expired, abandoned and invalid card submissions report distinct safe results', async () => {
  const host = credentialTarget('host', 'vendor');
  const { deps: store, repo, registry } = storeFixture([host]);
  const resultByState: unknown[] = [];
  const outcomeByState: unknown[] = [];
  const defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'] = spec => ({
    toolId: spec.toolId, secretFieldNames: () => ['token'],
    handler: () => async ctx => {
      const prep = await spec.prepare({ ctx });
      const states = [{ status: 'expired' }, { status: 'abandoned' }, { status: 'blank' }, { status: 'failed', safeMessage: 'Please use a supported token.' }] as const;
      for (const run of states) {
        resultByState.push(spec.result({ prep, run }));
        outcomeByState.push(spec.outcome({ prep, run }));
      }
      return spec.result({ prep, run: { status: 'cancelled' } });
    },
  });
  const deps = {
    workspaceId: 'site', loadDeployTargets: async () => registry, vendorCredentialSetRepo: repo, credentialStorePorts: store,
    requireToolPermission: async () => {}, authorize: async () => ({ allowed: true }), resolveOperatorLocale: async () => 'fr',
    findPluginCredentialCard: async () => undefined, defineSecretCardTool, credentialSaveToolId: 'credential_save', secretCardOptions: {},
    credentialText: ({ id, locale }: { id: string; locale: string }) => `${locale}/${id}`,
  } as unknown as StaticPublishToolDeps;
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'person' }, run: { id: 'run' }, input: { target: 'host' }, signal: new AbortController().signal };
  assert.deepEqual(await buildPublishHostCredentialHandler({ deps, surfaces: {} as never })(ctx), { saved: false, cancelled: true });
  assert.deepEqual(resultByState, [
    { saved: false, cancelled: false, reason: 'expired', note: 'The user did not respond to the credential form before it expired. Nothing was saved.' },
    { saved: false, cancelled: false, reason: 'abandoned', note: 'The credential form was closed because the run ended. Nothing was saved.' },
    { saved: false, cancelled: false, reason: 'invalid', message: 'fr/blank' },
    { saved: false, cancelled: false, reason: 'invalid', message: 'Please use a supported token.' },
  ]);
  assert.deepEqual(outcomeByState, [
    undefined, undefined,
    { title: 'fr/unreachable', state: 'failure', message: 'fr/blank' },
    { title: 'fr/unreachable', state: 'failure', message: 'Please use a supported token.' },
  ]);
  assert.deepEqual(await repo.listByWorkspace({ workspaceId: 'site' }), []);
});

test.each([
  ['rejected', 401, 'This key was refused for this purpose. Nothing was saved. The previous key was kept.'],
  ['unreachable', 504, "The service couldn't be reached. Nothing was saved. The previous key was kept."],
] as const)('a %s replacement probe leaves the existing credential usable', async (reason, statusCode, message) => {
  const original = credentialTarget('host', 'vendor', [
    { name: 'token', label: 'Token', required: true },
    { name: 'session', label: 'Session', required: false, secret: true },
  ]);
  const verifyCredential = vi.fn<NonNullable<LoadedDeployTarget['module']['verifyCredential']>>(async () => ({ ok: false, reason, statusCode }));
  const { deps: store, repo, registry, site } = storeFixture([{ ...original, module: { ...original.module, verifyCredential } }]);
  const saved = await createPublishCredential(store, { workspaceId: 'site', label: 'Live key',
    connection: { providerId: 'host', token: 'original-token-2345', session: 'original-session' } });
  const before = await site.vault.find({ workspaceId: 'site', id: saved.id });
  const forbidden = () => { throw new Error('provider probes must use the test double'); };
  const kit = createDeployHostKit({ fetchFn: forbidden, createReachability: forbidden, createSigV4Client: forbidden, now: () => 0, sleep: forbidden });
  const defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'] = spec => ({
    toolId: spec.toolId, secretFieldNames: () => ['token', 'session'],
    handler: () => async ctx => {
      const prep = await spec.prepare({ ctx });
      const form = spec.form({ prep });
      assert.deepEqual(form.fields.map(field => field.name), ['token', 'session', 'clear-session']);
      const result = await spec.save({ prep, signal: ctx.signal, values: { token: 'proposed-token', session: '' } });
      return spec.result({ prep, run: { status: 'saved', saved: result } });
    },
  });
  const deps = {
    workspaceId: 'site', vendorCredentialSetRepo: repo, credentialStorePorts: store, loadDeployTargets: async () => registry,
    siteAssistantSecretSealer: store.sealer, siteAssistantSecretKeyring: store.keyring, clock: store.clock, idGen: store.idGen,
    abortGuardedCredentialRepo: ({ store }: { store: typeof repo }) => store,
    requireToolPermission: async () => {}, authorize: async () => ({ allowed: true }), assertCredentialFreeField: store.assertCredentialFreeField,
    resolveOperatorLocale: async () => 'en', findPluginCredentialCard: async () => undefined,
    applyPluginCredentialCard: ({ form }: { form: unknown }) => form, defineSecretCardTool, credentialSaveToolId: 'credential_save',
    secretCardOptions: {}, credentialText: ({ id }: { id: string }) => id,
    verificationPorts: { assertCredentialToken, CredentialInputError, createDeployHostKit: () => kit, credentialText: ({ id }: { id: string }) => id },
  } as unknown as StaticPublishToolDeps;
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'person' }, run: { id: 'run' }, input: { target: 'host' }, signal: new AbortController().signal };
  await assert.rejects(buildPublishHostCredentialHandler({ deps, surfaces: {} as never })(ctx), error => {
    assert.ok(error instanceof PublishCredentialValidationError);
    assert.equal(error.message, message);
    return true;
  });
  assert.deepEqual(verifyCredential.mock.calls, [[{ kit, credential: { token: 'proposed-token' } }]]);
  assert.deepEqual(await site.vault.find({ workspaceId: 'site', id: saved.id }), before);
  assert.deepEqual((await resolveDefaultForPublish(store, { workspaceId: 'site', providerId: 'host' }))?.connection,
    { providerId: 'host', token: 'original-token-2345', session: 'original-session' });
});
