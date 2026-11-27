import { expect, it } from 'vitest';
import { InMemoryMediaRepo } from '../../repo.memory.js';
import type { MediaRecord } from '../../types.js';
import { createDerivedMediaLink } from '../derived-media-link.js';

const workspaceId = 'west';
const row = (id: string, title: string, scope = workspaceId): MediaRecord => ({
  id, workspaceId: scope, slug: id, title, alt: '', caption: '', credit: '', source: { sha256: 'b'.repeat(64) },
  status: 'active', createdAt: '2026-11-19', updatedAt: '2026-11-19', version: 7,
  width: null, height: null, cssClass: null, htmlAttributes: null,
});

it('links only the derived copy using the original title and never overwrites a description', async () => {
  const original = row('original', 'Garden Tour');
  const derived = row('derived', 'Web version');
  const curated = { ...row('curated', 'Edited copy'), description: 'Editor notes' };
  const mediaRepo = new InMemoryMediaRepo({}, { initialRows: [original, derived, curated] });
  const link = createDerivedMediaLink({ mediaRepo, clock: { nowMs: () => Date.parse('2026-11-20T12:00:00Z') },
    description: ({ title }) => `Converted from ${title}`, refusal: 'Cannot find both videos' });
  await link({ workspaceId, originalId: 'original', derivedId: 'derived' });
  expect(await mediaRepo.findById({ workspaceId, id: derived.id })).toEqual({
    ...derived, description: 'Converted from Garden Tour', updatedAt: '2026-11-20T12:00:00.000Z', version: 8,
  });
  await link({ workspaceId, originalId: 'original', derivedId: 'derived' });
  await link({ workspaceId, originalId: 'original', derivedId: 'curated' });
  expect((await mediaRepo.findById({ workspaceId, id: derived.id }))?.version).toBe(8);
  expect(await mediaRepo.findById({ workspaceId, id: original.id })).toEqual(original);
  expect(await mediaRepo.findById({ workspaceId, id: curated.id })).toEqual(curated);
});

it('refuses missing scoped rows without changing a copy or importing another workspace title', async () => {
  const original = row('original', 'Unrelated title', 'east');
  const derived = row('derived', 'Web version');
  const mediaRepo = new InMemoryMediaRepo({}, { initialRows: [original, derived] });
  const link = createDerivedMediaLink({ mediaRepo, clock: { nowMs: () => 0 },
    description: ({ title }) => `Converted from ${title}`, refusal: 'Cannot find both videos' });
  await expect(link({ workspaceId, originalId: 'original', derivedId: 'derived' })).rejects.toThrow('Cannot find both videos');
  await expect(link({ workspaceId: 'east', originalId: 'original', derivedId: 'missing' })).rejects.toThrow('Cannot find both videos');
  expect(await mediaRepo.findById({ workspaceId, id: derived.id })).toEqual(derived);
});
