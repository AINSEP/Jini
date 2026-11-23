import { expect, test } from 'vitest';
import { listMediaPage } from '../list-page.js';
import { InMemoryMediaRepo } from '../repo.memory.js';
import type { MediaRecord } from '../types.js';

function row(required: { id: string }, optional: Partial<MediaRecord> = {}): MediaRecord {
  return { ...required, workspaceId: 'site', title: '', alt: '', slug: required.id,
    caption: '', credit: '', source: { sha256: required.id }, status: 'active',
    createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z', version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null, ...optional };
}

/** Media descriptions for semantic search: the agent-written description is searchable text. */
test('media search finds an asset by its description, case-insensitively, and tolerates rows with none', async () => {
  const mediaRepo = new InMemoryMediaRepo({});
  await mediaRepo.save(row({ id: 'sofa' }, { description: 'A brown dog asleep on a RED sofa.' }));
  await mediaRepo.save(row({ id: 'legacy' }));
  const page = await listMediaPage({ mediaRepo, workspaceId: 'site', library: false, input: { query: 'red sofa' } });
  expect(page.media.map(item => item.id)).toEqual(['sofa']);
});
