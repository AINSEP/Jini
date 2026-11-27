import { expect, it, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { knownPublishCredentialListRefusal, listPublishCredentialsReply, registerPublishCredentialsListRoute } from '../list.js';

it('maps typed credential list failures and leaves unknown failures to the host', () => {
  class StoreError extends Error {}
  const storeErrors = { validation: StoreError, duplicateLabel: StoreError, notFound: StoreError, secretStoreUnconfigured: StoreError };
  expect(knownPublishCredentialListRefusal({ err: new ToolInputError({ message: 'in use' }), storeErrors })).toEqual({ status: 409, body: { error: 'KEY_IN_USE', detail: 'in use' } });
  expect(knownPublishCredentialListRefusal({ err: new StoreError('invalid'), storeErrors })).toEqual({ status: 400, body: { error: 'VALIDATION', detail: 'invalid' } });
  expect(knownPublishCredentialListRefusal({ err: new Error('private'), storeErrors })).toBeUndefined();
});

it('writes the credential list before triggering label healing', async () => {
  const order: string[] = [];
  const credentials = [{ id: 'credential', credentialType: 'vendor' as const, worksFor: [], publishHosts: [], defaultFor: [], providerId: 'host', vendorId: 'vendor', label: 'label', configured: true as const, isDefault: false, tokenTail: 'tail', accountLabel: null, createdAt: 'now', updatedAt: 'now' }];
  await listPublishCredentialsReply({ deps: {
    list: async () => { order.push('list'); return credentials; },
    executionMode: () => 'local',
    json: reply => { expect(reply).toEqual({ credentials, executionMode: 'local' }); order.push('json'); },
    triggerAccountLabelHeal: async rows => { expect(rows).toBe(credentials); order.push('heal'); },
  } });
  expect(order).toEqual(['list', 'json', 'heal']);
});

it.each([
  new ToolInputError({ message: "That key is in use." }),
  new Error("private connection failure"),
])("routes list failure %s to the public reply or incident sink", async (error) => {
  class Validation extends Error {}
  class Duplicate extends Error {}
  class Missing extends Error {}
  class Unconfigured extends Error {}
  const mounted: Array<Parameters<Parameters<typeof registerPublishCredentialsListRoute>[0]["mount"]>[0]> = [];
  const json = vi.fn();
  const failure = vi.fn();
  const authorize = vi.fn(async () => true);
  const triggerAccountLabelHeal = vi.fn(async () => {});
  registerPublishCredentialsListRoute({
    mount: (route) => mounted.push(route), workspaceId: "ws-2", operation: "publish.credentials.list",
    list: async () => { throw error; }, executionMode: () => "local", triggerAccountLabelHeal,
    storeErrors: { validation: Validation, duplicateLabel: Duplicate, notFound: Missing, secretStoreUnconfigured: Unconfigured },
  });
  expect(mounted.map(({ method, path }) => [method, path])).toEqual([["get", "/api/admin/v1/workspaces/:workspaceId/system/publish/credentials"]]);
  await mounted[0]!.handle({ foreignWorkspace: () => false, principalId: () => "editor-3", authorize, json, failure });
  expect(authorize.mock.calls).toEqual([[{ principalId: "editor-3", workspaceId: "ws-2", permission: "system.publish", entityType: "site-publish" }]]);
  expect(triggerAccountLabelHeal.mock.calls).toEqual([]);
  if (error instanceof ToolInputError) {
    expect(json.mock.calls).toEqual([[{ error: "KEY_IN_USE", detail: "That key is in use." }, 409]]);
    expect(failure.mock.calls).toEqual([]);
  } else {
    expect(json.mock.calls).toEqual([]);
    expect(failure.mock.calls).toEqual([[error, { operation: "publish.credentials.list", code: "INTERNAL_ERROR" }]]);
  }
});
