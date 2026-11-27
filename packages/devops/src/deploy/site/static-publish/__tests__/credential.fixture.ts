import { vi } from 'vitest';
import type { DeployTargetCredentialSpec } from '../../deploy-targets/types.js';
import type { DbPublishCredentialSourceDeps } from '../credentials.js';
import { publishFixture } from './publish.fixture.js';

export const credentialSpec: DeployTargetCredentialSpec = {
  vendorId: 'studio-vendor', vendorLabel: 'Studio vendor', tokenField: 'apiKey', yieldsAccountLabel: true,
  fields: [
    { name: 'apiKey', label: 'API key', required: true, secret: true },
    { name: 'secondaryKey', label: 'Secondary key', required: false, secret: true },
    { name: 'account', label: 'Account', required: true },
  ],
};

export function credentialFixture() {
  const f = publishFixture();
  const target = { ...f.target, descriptor: { ...f.target.descriptor, credential: credentialSpec,
    env: { tokenVars: ['PRIMARY_KEY', 'FALLBACK_KEY'], fields: { account: 'PUBLISH_ACCOUNT' } },
  } };
  const registry = { ...f.registry, get: (id: string) => id === 'host' ? target : undefined, list: () => [target] };
  f.loadDeployTargets.mockResolvedValue(registry);
  function unexpected(): never { throw new Error('Unexpected credential storage call'); }
  const describeCredential = vi.fn<DbPublishCredentialSourceDeps['describeCredential']>().mockResolvedValue(null);
  const resolveForPublish = vi.fn<DbPublishCredentialSourceDeps['resolveForPublish']>().mockResolvedValue(null);
  const hasDefaultForPublish = vi.fn<DbPublishCredentialSourceDeps['hasDefaultForPublish']>().mockResolvedValue(null);
  const resolveDefaultForPublish = vi.fn<DbPublishCredentialSourceDeps['resolveDefaultForPublish']>().mockResolvedValue(null);
  const dbDeps: DbPublishCredentialSourceDeps = {
    loadDeployTargets: f.loadDeployTargets, describeCredential, resolveForPublish, hasDefaultForPublish, resolveDefaultForPublish,
    repo: { insert: unexpected, update: unexpected, delete: unexpected, findById: unexpected, findDefaultByVendor: unexpected,
      listByVendor: unexpected, listByWorkspace: unexpected, updateAccountLabel: unexpected },
    sealer: { open: unexpected, seal: unexpected },
  };
  return { ...f, target, registry, dbDeps, describeCredential, resolveForPublish, hasDefaultForPublish, resolveDefaultForPublish };
}
