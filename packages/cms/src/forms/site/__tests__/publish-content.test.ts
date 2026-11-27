import { createRepoPublishHandler, gatewayDeps } from "../../../publish/content/repo-handler.js";
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { InMemoryFormDefinitionRepo } from '../../repo.memory.js';
import { createFormDefinition, updateFormDefinition, setFormDefinitionStatus } from '../../write-service.js';
import { executeCommand } from '../../../core/index.js';
import { InMemoryChangeSetRepo } from '../../../core/commands/repo.memory.js';
import { contributeFormPublish } from '../publish-content.js';

// The write service requires at least one valid field descriptor.
const field = { id: 'email', label: 'Email', type: 'email' as const, required: true };

function makeHandler(repo: InMemoryFormDefinitionRepo) {
  let next = 0;
  const bind = (deps: Parameters<Parameters<typeof contributeFormPublish>[0]['createFormDefinition']>[0]['deps']) => ({ ...deps, permission: 'admin.forms.manage', reservedSlugs: new Set<string>() });
  const contributor = contributeFormPublish({ createRepoPublishHandler, gatewayDeps, tableKey: 'forms', permission: 'admin.forms.manage', executeCommand,
    createFormDefinition: ({ deps, input }) => { const { notify, ...values } = input; return createFormDefinition({ deps: bind(deps), input: values }, { notify, outbox: deps.outbox }); },
    updateFormDefinition: ({ deps, input }) => updateFormDefinition({ deps: bind(deps), input }, { outbox: deps.outbox }),
    setFormDefinitionStatus: ({ deps, input }) => setFormDefinitionStatus({ deps: bind(deps), input }, { outbox: deps.outbox }),
  });
  return contributor.build({ workspaceId: 'ws', clock: { nowMs: () => 0 }, idGen: { newId: () => `id-${++next}` }, ports: { form: { repo } },
    changeSets: new InMemoryChangeSetRepo(), authorize: async () => ({ allowed: true, reason: 'fixture' }),
    outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
  });
}

test('source notification recipients never replace destination recipients', async () => {
  const repo = new InMemoryFormDefinitionRepo();
  const local = { enabled: true, recipients: ['local@example.com'] };
  await repo.create({ id: 'dest', workspaceId: 'ws', slug: 'contact', name: 'Contact', fields: [field], notify: local, status: 'active', createdAt: 'now', updatedAt: 'now', version: 1 });
  const handler = makeHandler(repo);
  await handler.apply({ entity: { entityType: 'form', id: 'contact', schemaVersion: 1, hashVersion: 1, contentHash: 'changed', requiredBlobs: [],
    state: { name: 'Updated', slug: 'contact', fields: [field], status: 'active', notify: { enabled: true, recipients: ['source@example.com'] } } },
    expectedVersion: 1, principalId: 'owner', idempotencyKey: 'form' });
  assert.deepEqual((await repo.findBySlug({ workspaceId: 'ws', slug: 'contact' }))?.notify, local);
});

test('packs a legacy form with canonical authoring defaults and applies the disabled status on create', async () => {
  const source = new InMemoryFormDefinitionRepo();
  await source.create({ id: 'source-id', workspaceId: 'ws', slug: 'booking', name: 'Booking',
    fields: [field], notify: { enabled: true, recipients: ['source@example.com'] },
    status: 'disabled', createdAt: 'now', updatedAt: 'now', version: 2 });
  const entities = [];
  for await (const entity of makeHandler(source).pack()) entities.push(entity);
  assert.deepEqual(entities.map(({ id, state }) => [id, state]), [['booking', {
    name: 'Booking', slug: 'booking', fields: [field], status: 'disabled',
    mode: 'builder', html: '', provider: { id: 'builtin', config: {} },
  }]]);
  const dest = new InMemoryFormDefinitionRepo();
  const handler = makeHandler(dest);
  const entity = entities[0]!;
  assert.equal(await handler.precheck({ entity }), null);
  await handler.apply({ entity, expectedVersion: undefined, principalId: 'owner', idempotencyKey: 'publish-booking' });
  const created = await dest.findBySlug({ workspaceId: 'ws', slug: 'booking' });
  assert.equal(created?.id, 'id-1');
  assert.equal(created?.status, 'disabled');
  assert.deepEqual(created?.notify, { enabled: false, recipients: [] });
});

test('a slug held in destination Trash is blocked at precheck and remains trashed', async () => {
  const repo = new InMemoryFormDefinitionRepo();
  const trashed = { id: 'dest', workspaceId: 'ws', slug: 'contact', name: 'Deleted Contact', fields: [],
    notify: { enabled: false, recipients: [] }, status: 'disabled' as const, createdAt: 'now', updatedAt: 'now', version: 3, deletedAt: '2026-11-20' };
  await repo.save(trashed);
  const handler = makeHandler(repo);
  const entity = { entityType: 'form', id: 'contact', schemaVersion: 1, hashVersion: 1, contentHash: 'incoming', requiredBlobs: [],
    state: { name: 'New Contact', slug: 'contact', fields: [], status: 'active' } };
  assert.equal(await handler.inspect({ id: 'contact' }), null);
  assert.equal(await handler.precheck({ entity }), "form 'contact' is in the trash at this destination — restore it before publishing over it, or publishing would resurrect it as live content");
  assert.deepEqual(await repo.findAnyById({ workspaceId: 'ws', id: 'dest' }), trashed);
});
