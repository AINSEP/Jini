import { expect, it } from 'vitest';
import { publishContentItemIdempotencyKey } from '../idempotency.js';
import type { PackedEntity } from '../../transfer/index.js';

const entity: PackedEntity = { entityType: 'media', id: 'photo-3', schemaVersion: 2, hashVersion: 1,
  contentHash: 'content-v2', requiredBlobs: [], state: { title: 'Photo' } };
const input = { workspaceId: 'site-west', sourcePrincipalId: 'peer-west', entity };
const versionKey = 'publish-content:v1:da856494570670d7da6c7d4956e58bf0e0a01befcfbfbfc1604db209e23f5026';

it('keeps the command key stable for one exact packed version and independent of display labels', () => {
  expect(publishContentItemIdempotencyKey(input)).toBe(versionKey);
  expect(publishContentItemIdempotencyKey({ ...input, entity: { ...entity, displayLabel: 'Renamed in preview only' } })).toBe(versionKey);
  expect(publishContentItemIdempotencyKey({ ...input, entity: { ...entity, contentHash: 'new-bytes' } })).not.toBe(versionKey);
  expect(publishContentItemIdempotencyKey({ ...input, sourcePrincipalId: 'peer-east' })).not.toBe(versionKey);
});

it('binds a reviewed source replacement to the destination version', () => {
  expect(publishContentItemIdempotencyKey({ ...input, sourceReplacement: { version: 5, sourceSha256: 'old-blob' } })).toBe(versionKey + ':5');
  expect(publishContentItemIdempotencyKey({ ...input, sourceReplacement: { version: 6, sourceSha256: 'old-blob' } })).toBe(versionKey + ':6');
});
