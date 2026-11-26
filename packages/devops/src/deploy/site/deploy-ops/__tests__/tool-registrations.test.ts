import assert from 'node:assert/strict';
import { test } from 'vitest';
import { bindDeployOpsRuntime, secretFingerprint } from '../run-ops.js';
import type { DeployOpsRuntime } from '../../../ops-tool-contracts.js';
import type { ChatDeleteSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import { secretConfirm } from '../secret-confirm.js';
import type { ToolExecutionContext } from '@jini-ai/core';
import { getDeployOpsAgentToolCatalog } from '../agent-tools.js';

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
