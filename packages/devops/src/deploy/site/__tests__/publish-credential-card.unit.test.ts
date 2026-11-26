import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { SurfaceCardsPort } from '@jini-ai/core/contracts/cards';
import { buildPublishHostCredentialHandler } from '../publish-agent-tools.js';
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
