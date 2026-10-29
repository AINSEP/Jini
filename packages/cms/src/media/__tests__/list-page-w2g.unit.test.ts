import { expect, test, vi } from 'vitest';
import { listMediaPage } from '../list-page.js';
import { InMemoryMediaRepo } from '../repo.memory.js';
import type { MediaRecord } from '../types.js';

function row(required: { id: string }, optional: Partial<MediaRecord> = {}): MediaRecord {
  return { ...required, workspaceId: 'site', title: '', alt: '', slug: required.id,
    caption: '', credit: '', source: { sha256: required.id }, status: 'active',
    createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z', version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null, ...optional };
}

test('unknown legacy MIME belongs to other; stored MIME overrides source MIME and lookup is deduplicated', async () => {
  const mediaRepo = new InMemoryMediaRepo({});
  await mediaRepo.save(row({ id: 'unknown' }));
  await mediaRepo.save(row({ id: 'image' }, { source: { sha256: 'shared', contentType: 'image/png' } }));
  await mediaRepo.save(row({ id: 'video' }, { source: { sha256: 'shared', contentType: 'image/png' } }));
  const getMany = vi.fn(async () => new Map([['shared', 'video/webm']]));
  const required = { mediaRepo, workspaceId: 'site', library: false };
  expect((await listMediaPage({ ...required, input: { kind: 'other' } }, { contentTypes: { getMany } })).media.map(item => item.id)).toEqual(['unknown']);
  expect(getMany).toHaveBeenCalledWith({ workspaceId: 'site', sha256s: ['unknown', 'shared'] });
  expect((await listMediaPage({ ...required, input: { kind: 'video' } }, { contentTypes: { getMany } })).media.map(item => item.id)).toEqual(['image', 'video']);
  expect((await listMediaPage({ ...required, input: { kind: 'media' } })).media.map(item => item.id)).toEqual(['image', 'unknown', 'video']);
});

test('paging orders different timestamps before ids and resumes beyond a deleted cursor row', async () => {
  const mediaRepo = new InMemoryMediaRepo({});
  await mediaRepo.save(row({ id: 'a' }, { createdAt: '2026-10-29T00:00:00Z' }));
  await mediaRepo.save(row({ id: 'z' }));
  const required = { mediaRepo, workspaceId: 'site', library: false };
  const first = await listMediaPage({ ...required, input: { limit: 1 } });
  expect(first.media.map(item => item.id)).toEqual(['z']);
  expect(first.nextCursor).not.toBeNull();
  await mediaRepo.remove({ workspaceId: 'site', id: 'z' });
  const last = await listMediaPage({ ...required, input: { cursor: first.nextCursor } });
  expect(last.media.map(item => item.id)).toEqual(['a']);
  expect(last.nextCursor).toBeNull();
});

test.each([{ cursor: 42 }, { query: 'a'.repeat(1001) }, { limit: NaN }, { limit: '2' }])('invalid list input %j rejects before a storage read', async input => {
  const mediaRepo = new InMemoryMediaRepo({});
  const read = vi.spyOn(mediaRepo, 'list');
  await expect(listMediaPage({ mediaRepo, workspaceId: 'site', library: false, input })).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
