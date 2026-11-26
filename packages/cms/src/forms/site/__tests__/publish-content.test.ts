import assert from 'node:assert/strict';
import { test } from 'vitest';
import { InMemoryFormDefinitionRepo } from '../../repo.memory.js';
import { createFormDefinition, updateFormDefinition, setFormDefinitionStatus } from '../../write-service.js';
import { executeCommand } from '../../../core/index.js';
import { InMemoryChangeSetRepo } from '../../../core/commands/repo.memory.js';
import { contributeFormPublish } from '../publish-content.js';

test('source notification recipients never replace destination recipients', async () => {
  const repo = new InMemoryFormDefinitionRepo();
  const local = { enabled: true, recipients: ['local@example.com'] };
  await repo.create({ id: 'dest', workspaceId: 'ws', slug: 'contact', name: 'Contact', fields: [], notify: local, status: 'active', createdAt: 'now', updatedAt: 'now', version: 1 });
  const bind = (deps: Parameters<Parameters<typeof contributeFormPublish>[0]['createFormDefinition']>[0]['deps']) => ({ ...deps, permission: 'admin.forms.manage', reservedSlugs: new Set<string>() });
  const contributor = contributeFormPublish({ tableKey: 'forms', permission: 'admin.forms.manage', executeCommand,
    createFormDefinition: ({ deps, input }) => { const { notify, ...values } = input; return createFormDefinition({ deps: bind(deps), input: values }, { notify, outbox: deps.outbox }); },
    updateFormDefinition: ({ deps, input }) => updateFormDefinition({ deps: bind(deps), input }, { outbox: deps.outbox }),
    setFormDefinitionStatus: ({ deps, input }) => setFormDefinitionStatus({ deps: bind(deps), input }, { outbox: deps.outbox }),
  });
  const handler = contributor.build({ workspaceId: 'ws', clock: { nowMs: () => 0 }, idGen: { newId: () => 'id' }, ports: { form: { repo } },
    changeSets: new InMemoryChangeSetRepo(), authorize: async () => ({ allowed: true, reason: 'fixture' }),
    outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
  });
  await handler.apply({ entity: { entityType: 'form', id: 'contact', schemaVersion: 1, hashVersion: 1, contentHash: 'changed', requiredBlobs: [],
    state: { name: 'Updated', slug: 'contact', fields: [], status: 'active', notify: { enabled: true, recipients: ['source@example.com'] } } },
    expectedVersion: 1, principalId: 'owner', idempotencyKey: 'form' });
  assert.deepEqual((await repo.findBySlug({ workspaceId: 'ws', slug: 'contact' }))?.notify, local);
});
