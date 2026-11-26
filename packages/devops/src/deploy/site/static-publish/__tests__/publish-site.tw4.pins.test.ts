import { expect, it, vi } from 'vitest';
import { describePublishTargets, publishPreviewFor } from '../admin-publish-read.js';

it('does not inspect a target when planning or credential readiness fails', async () => {
  for (const [valid, configured] of [[false, true], [true, false]]) {
    const inspectStaticPublish = vi.fn(async () => ({}));
    const registry = { refusals: [], get: () => ({}) } as unknown as Parameters<typeof describePublishTargets>[0]['registry'];
    const read = publishPreviewFor({ context: { credentialSource: {
      isConfigured: async () => configured ? { configured: true as const } : { configured: false as const, reason: 'not configured' },
      resolve: async () => { throw new Error('unexpected secret read'); },
    }, deps: {
      workspaceId: 'w', loadDeployTargets: async () => registry, refusal: () => {},
      unknownTargetMessage: () => 'unknown', readStaticPublishConfig: () => ({ ok: true, config: { target: 'target' } }),
      missingRequiredFieldMessage: () => null,
      planStaticPublish: () => valid ? { ok: true } : { ok: false, message: 'invalid' }, inspectStaticPublish,
    } } });
    const result = await read({ query: { target: 'target' } });
    expect(result.ok && result.value.valid).toBe(valid);
    expect(result.ok && result.value.credentialsConfigured).toBe(configured);
    expect(inspectStaticPublish).not.toHaveBeenCalled();
  }
});

it('projects only the public target descriptor fields', () => {
  const registry = {
    list: () => [{ descriptor: { id: 'target', label: 'Target', configFields: [], modulePath: '/private/module', credential: { tokenField: 'token', fields: [], vendorId: 'private-vendor', vendorLabel: 'Vendor' } } }],
    get: () => ({ module: { defaultForNewDestination: true } }),
  } as unknown as Parameters<typeof describePublishTargets>[0]['registry'];
  expect(describePublishTargets({ registry })).toEqual([{ id: 'target', label: 'Target', defaultForNewDestination: true, authenticatedPreview: false, configFields: [], credential: { vendorLabel: 'Vendor', tokenField: 'token', fields: [] } }]);
});
