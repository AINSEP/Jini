import assert from 'node:assert/strict';
import { test } from 'vitest';
import { bindDeployOpsRuntime, secretFingerprint } from '../run-ops.js';
import type { DeployOpsRuntime } from '../../../ops-tool-contracts.js';
import type { ChatDeleteSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import { secretConfirm } from '../secret-confirm.js';
import type { ToolExecutionContext } from '@jini-ai/core';
import { getDeployOpsAgentToolCatalog } from '../agent-tools.js';
import type { LoadedDeployOps } from '../../../index.js';

test('deploy read tools retain the injected permission', () => {
  const catalog = getDeployOpsAgentToolCatalog({ sourceRoot: '/bundled', readBundledDescriptors: () => [],
    maxWaitSeconds: 600, readPermission: 'ops.read', writePermission: 'ops.write', secretNameDescription: 'Name', unsetSecretDescription: 'Remove' });
  assert.deepEqual(catalog.filter(tool => tool.sideEffects === 'none').map(tool => tool.authorization?.permission), Array(5).fill('ops.read'));
});

test('secret replacement rechecks permission before confirming and refuses a lost permit', async () => {
  const order: string[] = [];
  const ctx: ToolExecutionContext = { executionId: 'e', principal: { id: 'human' }, run: { id: 'run' }, input: {}, signal: new AbortController().signal };
  const confirm = secretConfirm({ ctx, surfaces: {} as ChatDeleteSurfaceDeps, options: undefined, permit: async permission => {
    order.push(permission); throw new Error('denied');
  }, deps: {
    removeDescription: 'Remove', replaceDescription: 'Replace',
    notConfirmedResult: () => ({ cancelled: true, note: 'declined' }),
    approvalToolHandler: steps => async snapshot => {
      const prepared = await steps.prepare();
      const card = steps.describe({ prepared });
      assert.equal(card.toolId, 'deployment_ops_set_secret');
      order.push('card');
      return steps.run({ ctx: snapshot });
    },
  } });
  await assert.rejects(confirm!({ action: 'overwrite', platform: 'host', target: 'site', name: 'KEY', appliesOn: 'next-deploy' }), /denied/);
  assert.deepEqual(order, ['card', 'custom-credentials.write']);
});

test('deploy requests forward the byte ceiling and preserve transport truncation', async () => {
  const signal = new AbortController().signal;
  const bound = bindDeployOpsRuntime({ runtime: { credentials: {} } as DeployOpsRuntime,
    deps: { deployOpsHttpClient: { send: async (request: import("@jini-ai/core/primitives").HttpRequest) => {
      assert.equal(request.maxResponseBytes, 123);
      assert.equal(request.signal, signal);
      return { status: 200, headers: {}, bodyText: 'clipped', bodyTruncated: true };
    } } } as Parameters<typeof bindDeployOpsRuntime>[0]['deps'],
    makeCredentialedRequest: async (deps, input) => {
      const result = await deps.httpClient.send({ method: 'GET', url: input.url, headers: {}, timeoutMs: 100 });
      return { executed: true, status: result.status, headers: {}, bodyText: result.bodyText };
    },
  });
  assert.deepEqual(await bound.credentials.request({ workspaceId: 'ws', label: 'key', method: 'GET', url: 'https://host.example', maxResponseBytes: 123 }, { signal }),
    { executed: true, status: 200, headers: {}, bodyText: 'clipped', bodyTruncated: true });
});

test('secret fingerprint fallback hashes the exact UTF-8 value', () => {
  assert.deepEqual(secretFingerprint({ value: 'abc', deps: { parseSiteKeyHex: () => ({ ok: false }), fingerprintSiteKeyHex: () => 'unused' } }),
    { fingerprint: 'ba7816bf8f01', fingerprintKind: 'sha256' });
});

test('the live catalog advertises secret operations only for capable platforms', () => {
  const status = async () => assert.fail('catalog should not call status');
  const logs = async () => assert.fail('catalog should not call logs');
  const observe: LoadedDeployOps = { pluginId: 'observe-plugin',
    descriptor: { id: 'observe', label: 'Observe', module: 'observe.mjs', hosts: ['observe.example.com'] },
    module: { status, logs } };
  const manage: LoadedDeployOps = { pluginId: 'manage-plugin',
    descriptor: { id: 'manage', label: 'Manage', module: 'manage.mjs', hosts: ['manage.example.com'] },
    module: { status, logs, secretCapabilities: { appliesOn: 'next-deploy', supportsStaging: true },
      listSecrets: async () => assert.fail('catalog should not list secrets'),
      setSecret: async () => assert.fail('catalog should not set secrets'), unsetSecret: async () => assert.fail('catalog should not unset secrets') } };
  const tools = getDeployOpsAgentToolCatalog({
    sourceRoot: '/bundled', readBundledDescriptors: () => assert.fail('live registry must win'),
    registry: { list: () => [observe, manage], get: id => [observe, manage].find(item => item.descriptor.id === id), refusals: [] },
    maxWaitSeconds: 420, readPermission: 'ops.read', writePermission: 'ops.write',
    secretNameDescription: 'Environment name', unsetSecretDescription: 'Remove environment value.',
  });
  function schema(name: string) {
    const found = tools.find(tool => tool.name === name);
    if (!found) assert.fail(`no tool named ${name}`);
    return found;
  }
  assert.match(schema('deployment_ops_status').description, /observe \(Observe\), manage \(Manage\)/);
  assert.match(schema('deployment_ops_unset_secret').description, /Remove environment value\..*Platforms: manage \(Manage\)\./);
  assert.deepEqual((schema('deployment_ops_wait').inputSchema.properties as Record<string, unknown>).timeoutSeconds,
    { type: 'integer', minimum: 10, maximum: 420, default: 180 });
  const secret = schema('deployment_ops_set_secret');
  assert.deepEqual(secret.authorization, { permission: 'ops.write' });
  const fields = secret.inputSchema.properties as Record<string, unknown>;
  assert.deepEqual(fields.platform, { type: 'string', enum: ['manage'] });
  const source = fields.source as { additionalProperties: boolean; properties: Record<string, unknown>; required: string[] };
  assert.equal(source.additionalProperties, false);
  assert.deepEqual(source.required, ['kind']);
  assert.deepEqual(Object.keys(source.properties).sort(), ['kind', 'name']);
});

test('an unreadable bundled inventory leaves a usable empty catalog', () => {
  const tools = getDeployOpsAgentToolCatalog({
    sourceRoot: '/broken', readBundledDescriptors: () => { throw new Error('source directory unavailable'); },
    maxWaitSeconds: 420, readPermission: 'ops.read', writePermission: 'ops.write',
    secretNameDescription: 'Name', unsetSecretDescription: 'Remove',
  });
  const status = tools.find(tool => tool.name === 'deployment_ops_status');
  assert.match(status?.description ?? '', /none available; enable a hosting plugin under Agent Plugins/);
  assert.deepEqual((status?.inputSchema.properties as Record<string, unknown>).platform, { type: 'string', enum: [] });
});

test('site-key-shaped fingerprints use the parsed key and Security fingerprint', () => {
  assert.deepEqual(secretFingerprint({ value: ' SITE-KEY ', deps: {
    parseSiteKeyHex: input => { assert.deepEqual(input, { raw: ' SITE-KEY ' }); return { ok: true, hex: 'abc123' }; },
    fingerprintSiteKeyHex: input => { assert.deepEqual(input, { hex: 'abc123' }); return 'security-page'; },
  } }), { fingerprint: 'security-page', fingerprintKind: 'site-key' });
});

test('missing HTTP client refuses before loading a saved credential', async () => {
  const bound = bindDeployOpsRuntime({ runtime: { credentials: {} } as DeployOpsRuntime,
    deps: {} as Parameters<typeof bindDeployOpsRuntime>[0]['deps'],
    makeCredentialedRequest: async () => assert.fail('must refuse before resolving a credential'),
  });
  await assert.rejects(bound.credentials.request({ workspaceId: 'ws', label: 'key', method: 'GET', url: 'https://host.example', maxResponseBytes: 123 }, {}),
    { message: 'Deployment operations have no HTTP client' });
});

test('cancellation during credential resolution prevents later transport', async () => {
  const controller = new AbortController();
  let transportCalls = 0;
  const bound = bindDeployOpsRuntime({ runtime: { credentials: {} } as DeployOpsRuntime,
    deps: { deployOpsHttpClient: { send: async () => { transportCalls++; return { status: 200, headers: {}, bodyText: 'unexpected' }; } } } as Parameters<typeof bindDeployOpsRuntime>[0]['deps'],
    makeCredentialedRequest: async (deps, input) => {
      controller.abort();
      const result = await deps.httpClient.send({ method: 'GET', url: input.url, headers: {}, timeoutMs: 100 });
      return { executed: true, status: result.status, headers: {}, bodyText: result.bodyText };
    },
  });
  await assert.rejects(bound.credentials.request({ workspaceId: 'ws', label: 'key', method: 'GET', url: 'https://host.example', maxResponseBytes: 123 }, { signal: controller.signal }),
    { message: 'Deployment ops wait was aborted.' });
  assert.equal(transportCalls, 0);
});

test('a declined removal names the target and never grants write permission', async () => {
  const ctx: ToolExecutionContext = { executionId: 'e', principal: { id: 'human' }, run: { id: 'run' }, input: {}, signal: new AbortController().signal };
  const confirm = secretConfirm({
    ctx, surfaces: {} as ChatDeleteSurfaceDeps, options: undefined, permit: async () => assert.fail('declined removal must not grant a write'),
    deps: {
      removeDescription: 'Delete one value.', replaceDescription: 'Replace one value.',
      notConfirmedResult: input => {
        assert.deepEqual(input, { confirmed: false, reason: 'expired' });
        return { cancelled: true, reason: 'expired', note: 'No secret was removed.' };
      },
      approvalToolHandler: (steps, optional) => async () => {
        const card = steps.describe({ prepared: await steps.prepare() });
        assert.deepEqual(card, {
          toolId: 'deployment_ops_unset_secret', errorCode: 'DEPLOY_OPS', title: 'Remove secret BUILD_KEY from docs?',
          description: 'Delete one value.', details: [
            { label: 'Count', value: '1' }, { label: 'Platform', value: 'cloud' }, { label: 'Target', value: 'docs' },
            { label: 'Secret', value: 'BUILD_KEY' }, { label: 'Takes effect', value: 'after the platform restarts the app' },
          ],
          warning: 'An app that still reads this variable may fail to boot after the next deploy.', danger: true, confirmLabel: 'Remove secret',
        });
        return optional.declined({ reason: 'expired' });
      },
    },
  });
  if (!confirm) assert.fail('confirmation surface is installed');
  assert.deepEqual(await confirm({ action: 'remove', platform: 'cloud', target: 'docs', name: 'BUILD_KEY', appliesOn: 'vendor-restart' }),
    { confirmed: false, result: { cancelled: true, reason: 'expired', note: 'No secret was removed.' } });
});

test('a confirmation aborted after the permission check cannot approve replacement', async () => {
  const controller = new AbortController();
  const ctx: ToolExecutionContext = { executionId: 'e', principal: { id: 'person' }, run: { id: 'run' }, input: {}, signal: controller.signal };
  const confirm = secretConfirm({
    ctx, surfaces: {} as ChatDeleteSurfaceDeps, options: undefined,
    permit: async permission => { assert.equal(permission, 'custom-credentials.write'); controller.abort(); },
    deps: {
      removeDescription: 'Remove one.', replaceDescription: 'Replace one.',
      notConfirmedResult: input => {
        assert.deepEqual(input, { confirmed: false, reason: 'abandoned' });
        return { cancelled: true, reason: 'abandoned', note: 'No secret was replaced.' };
      },
      approvalToolHandler: steps => async snapshot => {
        const card = steps.describe({ prepared: await steps.prepare() });
        assert.equal(card.toolId, 'deployment_ops_set_secret');
        assert.deepEqual(card.details, [
          { label: 'Count', value: '1' }, { label: 'Platform', value: 'cloud' }, { label: 'Target', value: 'docs' },
          { label: 'Secret', value: 'BUILD_KEY' }, { label: 'New value from', value: 'secure form' },
          { label: 'Current value', value: 'different from the new value' }, { label: 'Takes effect', value: 'immediately' },
        ]);
        return steps.run({ ctx: snapshot });
      },
    },
  });
  if (!confirm) assert.fail('confirmation surface is installed');
  assert.deepEqual(await confirm({ action: 'overwrite', platform: 'cloud', target: 'docs', name: 'BUILD_KEY', appliesOn: 'immediately',
    source: 'secure form', comparison: 'different' }),
  { confirmed: false, result: { cancelled: true, reason: 'abandoned', note: 'No secret was replaced.' } });
});

test('a non-truncated write forwards headers and body without adding an absent signal', async () => {
  const audit = { record: () => assert.fail('audit writes are owned by the credential adapter') };
  const send = async (request: import('@jini-ai/core/primitives').HttpRequest) => {
    assert.deepEqual(request, { method: 'PATCH', url: 'https://host.example/config', headers: { 'content-type': 'application/json' },
      timeoutMs: 200, body: '{"active":true}', maxResponseBytes: 256 });
    return { status: 204, headers: {}, bodyText: '', bodyTruncated: false };
  };
  const bound = bindDeployOpsRuntime({ runtime: { credentials: {} } as DeployOpsRuntime,
    deps: { deployOpsHttpClient: { send }, customCredentialsAudit: audit } as Parameters<typeof bindDeployOpsRuntime>[0]['deps'],
    makeCredentialedRequest: async (deps, input) => {
      assert.equal(deps.audit, audit);
      assert.deepEqual(input, { workspaceId: 'site', label: 'owner', method: 'PATCH', url: 'https://host.example/config',
        headers: { 'content-type': 'application/json' }, body: '{"active":true}' });
      if (typeof input.body !== 'string') assert.fail('the write body must be text');
      const response = await deps.httpClient.send({ method: 'PATCH', url: input.url, headers: { 'content-type': 'application/json' },
        timeoutMs: 200, body: input.body });
      return { executed: true, status: response.status, headers: response.headers, bodyText: response.bodyText };
    },
  });
  const result = await bound.credentials.request({ workspaceId: 'site', label: 'owner', method: 'PATCH', url: 'https://host.example/config', maxResponseBytes: 256 },
    { headers: { 'content-type': 'application/json' }, body: '{"active":true}' });
  assert.deepEqual(result, { executed: true, status: 204, headers: {}, bodyText: '', bodyTruncated: false });
});
