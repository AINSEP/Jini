import assert from 'node:assert/strict';
import { test } from 'vitest';
import { composePublishCredentialSource, type DbPublishCredentialSourceDeps } from '../credentials.js';

test('an explicit unavailable connection never falls back to environment credentials', async () => {
  const dbDeps = { describeCredential: async () => null, resolveForPublish: async () => null,
    hasDefaultForPublish: async () => false, loadDeployTargets: async () => assert.fail('fallback registry was read'),
  } as unknown as DbPublishCredentialSourceDeps;
  const source = composePublishCredentialSource({ workspaceId: 'ws', executionMode: 'self-hosted-cli', dbDeps, env: { PUBLISH_TOKEN: 'available' } });
  const choice = { workspaceId: 'ws', target: 'host', credentialId: 'missing' };
  assert.deepEqual(await source.resolve(choice), { ok: false, reason: 'the selected publish credential is not available in this workspace — reload the Static Site tab and choose a connection again' });
  assert.deepEqual(await source.isConfigured(choice), { configured: false, reason: 'the selected publish credential is not available in this workspace — reload the Static Site tab and choose a connection again' });
});
