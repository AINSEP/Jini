import { createRepoPublishHandler, gatewayDeps, okOrThrow } from "../../../publish/content/repo-handler.js";
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { InMemoryContentTypeRepo, NoopContentTypeIndexProvisioner, registerContentType, type ContentTypeRecord } from '../../index.js';
import { InMemoryChangeSetRepo } from '../../../core/commands/repo.memory.js';
import { contributeContentTypePublish } from '../publish-content.js';

const policy = { seededKeys: new Set(['widget', 'widget_area']), permission: 'admin.collections.manage', registerContentType,
  seededKeyRefusal: ({ key }: { key: string }) => ['widget', 'widget_area'].includes(key) ? `content-type '${key}' is seeded on every instance and is never published` : null };
const row: ContentTypeRecord = { workspaceId: 'ws', key: 'recipe', label: 'Recipes', fields: [{ name: 'servings', kind: 'integer', required: false, queryable: true }], status: 'active', version: 3, tombstonedAt: null };
function handler(repo: InMemoryContentTypeRepo) {
  return contributeContentTypePublish({ ...policy, createRepoPublishHandler, gatewayDeps, okOrThrow }).build({ workspaceId: 'ws', clock: { nowMs: () => 0 }, idGen: { newId: () => 'id' },
    ports: { 'content-type': { repo, indexProvisioner: new NoopContentTypeIndexProvisioner() } },
    authorize: async () => ({ allowed: true, reason: 'fixture' }), changeSets: new InMemoryChangeSetRepo(),
    outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
  });
}

test('inbound seeded keys are refused at precheck and apply', async () => {
  const repo = new InMemoryContentTypeRepo();
  await repo.save({ ...row, key: 'widget' });
  const tool = handler(repo);
  const entity = { entityType: 'content-type', id: 'widget', schemaVersion: 1, contentHash: 'x', hashVersion: 1, requiredBlobs: [], state: { key: 'widget', label: 'Changed', fields: row.fields, status: 'deprecated' } };
  const reason = "content-type 'widget' is seeded on every instance and is never published";
  assert.equal(await tool.precheck({ entity }), reason);
  await assert.rejects(tool.apply({ entity, expectedVersion: 3, principalId: 'owner', idempotencyKey: 'seeded' }), { message: reason });
  assert.deepEqual(await repo.findByKey({ workspaceId: 'ws', key: 'widget' }), { ...row, key: 'widget' });
});

test('fields-only updates retain label and lifecycle status', async () => {
  const repo = new InMemoryContentTypeRepo(); await repo.save(row);
  const fields = [...row.fields, { name: 'cuisine', kind: 'text' as const, required: false, queryable: false }];
  const entity = { entityType: 'content-type', id: row.key, schemaVersion: 1, contentHash: 'x', hashVersion: 1, requiredBlobs: [], state: { key: row.key, label: row.label, fields, status: row.status } };
  await handler(repo).apply({ entity, expectedVersion: 3, principalId: 'owner', idempotencyKey: 'fields' });
  assert.deepEqual(await repo.findByKey({ workspaceId: 'ws', key: row.key }), { ...row, fields, version: 4 });
});

test('registers a missing type and applies the transferred deprecation state to the new record', async () => {
  const repo = new InMemoryContentTypeRepo();
  assert.equal(await repo.findByKey({ workspaceId: 'ws', key: 'recipe' }), null);
  const entity = { entityType: 'content-type', id: 'recipe', schemaVersion: 1, contentHash: 'x', hashVersion: 1, requiredBlobs: [],
    state: { key: 'recipe', label: 'Dinner recipes', fields: row.fields, status: 'deprecated' } };
  await handler(repo).apply({ entity, expectedVersion: undefined, principalId: 'owner', idempotencyKey: 'create-deprecated' });
  assert.deepEqual(await repo.findByKey({ workspaceId: 'ws', key: 'recipe' }), {
    workspaceId: 'ws', key: 'recipe', label: 'Dinner recipes', fields: row.fields, status: 'deprecated', version: 2, tombstonedAt: null,
  });
});

test('reactivates a deprecated type without rewriting its unchanged fields', async () => {
  const repo = new InMemoryContentTypeRepo();
  await repo.save({ ...row, status: 'deprecated' });
  const entity = { entityType: 'content-type', id: row.key, schemaVersion: 1, contentHash: 'x', hashVersion: 1, requiredBlobs: [],
    state: { key: row.key, label: row.label, fields: row.fields, status: 'active' } };
  await handler(repo).apply({ entity, expectedVersion: 3, principalId: 'owner', idempotencyKey: 'reactivate' });
  assert.deepEqual(await repo.findByKey({ workspaceId: 'ws', key: row.key }), { ...row, version: 4 });
});

test('does not pack local seeded or tombstoned collection types', async () => {
  const repo = new InMemoryContentTypeRepo();
  await repo.save(row);
  await repo.save({ ...row, key: 'widget' });
  await repo.save({ ...row, key: 'gone', status: 'tombstone', tombstonedAt: '2026-11-26T00:00:00.000Z' });
  const ids: string[] = [];
  for await (const packed of handler(repo).pack()) ids.push(packed.id);
  assert.deepEqual(ids, ['recipe']);
  assert.equal(await handler(repo).precheck({ entity: {
    entityType: 'content-type', id: 'gone', schemaVersion: 1, contentHash: 'x', hashVersion: 1, requiredBlobs: [],
    state: { key: 'gone', label: 'Revived', fields: [], status: 'active' },
  } }), "content-type 'gone' is permanently removed at this destination and cannot be republished over");
});
