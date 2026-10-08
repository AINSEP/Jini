import { expect, test } from 'vitest';
import { buildToolCatalogQuery, createSearchEnricher, createPrefixSourceClassifier, type ToolCatalogEntry, type ToolDescriptor } from '../index.js';

/** Phase 16: discovery reads registered metadata; no module replacement or production dictionaries. */
function fixture(descriptor: ToolDescriptor) {
  let entries: readonly ToolCatalogEntry[] = [];
  const required = {
    source: { list: () => [descriptor] },
    enricher: createSearchEnricher({ marker: ' — keywords: ', keywords: { notes_edit: 'fallback noun' }, questions: { notes_edit: ['Fallback question?'] } }),
    classifier: createPrefixSourceClassifier({ separator: '_', fallbackSource: 'host' }),
    clock: { nowMs: () => 0 },
    storeFactory: { create: ({ entries: seeded }: { entries: readonly ToolCatalogEntry[] }) => {
      entries = seeded;
      return { search: () => entries.map(entry => ({ ...entry, score: 1 })), describe: () => entries[0] ?? null };
    } },
  };
  return { required, entries: () => entries };
}

test('registered search metadata reaches the existing enricher, with authored text kept separate', () => {
  const f = fixture({ id: 'notes_edit', description: 'Edit a note.', metadata: {
    search: { keywords: 'registered vocabulary', queries: ['Change this note.'] },
    approval: { class: 'edit', confirmation: 'direct' },
  } });
  const query = buildToolCatalogQuery(f.required);
  expect(f.entries()[0]!.description).toBe('Edit a note. — keywords: registered vocabulary Change this note.');
  expect(query.describe({ id: 'notes_edit' })?.description).toBe('Edit a note.');
  expect(query.search({ query: 'registered' })[0]!.description).toBe('Edit a note.');
});

test('metadata and legacy dictionaries preserve independent vocabulary/question disabling', () => {
  const f = fixture({ id: 'notes_edit', description: 'Edit a note.', metadata: { search: { keywords: 'registered vocabulary', queries: ['Change this note.'] } } });
  buildToolCatalogQuery(f.required, { includeDoc2query: false });
  expect(f.entries()[0]!.description).toBe('Edit a note. — keywords: registered vocabulary');
  buildToolCatalogQuery(f.required, { includeSearchKeywords: false });
  expect(f.entries()[0]!.description).toBe('Edit a note.');
  const legacy = fixture({ id: 'notes_edit', description: 'Edit a note.' });
  buildToolCatalogQuery(legacy.required);
  expect(legacy.entries()[0]!.description).toBe('Edit a note. — keywords: fallback noun Fallback question?');
});

test('unowned and inherited dictionary keys remain plain authored descriptions', () => {
  const f = fixture({ id: 'constructor', description: 'Unowned.' });
  buildToolCatalogQuery(f.required);
  expect(f.entries()[0]!.description).toBe('Unowned.');
});
