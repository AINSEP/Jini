import { expect, test, vi } from 'vitest';
import { buildToolCatalogQuery, createSearchEnricher, createPrefixSourceClassifier, listToolCatalogEntries } from '../index.js';
import type { ToolCatalogEntry, ToolDescriptor, CatalogStoreFactory } from '../index.js';

// Generalized source characterization: assembly/forwarding, live entries, and fold/strip boundaries.
const marker = ' — also known as: ';
const enricher = createSearchEnricher({ marker, keywords: { users_create: 'invite staff account' },
  questions: { users_create: ['How do I create a password?'] } });
const classifier = createPrefixSourceClassifier({ separator: '_', fallbackSource: 'host' });
function fixture(descriptors: ToolDescriptor[] = [
  { id: 'users_create', description: 'Creates a human operator.', inputSchema: { type: 'object' } },
  { id: 'forms_update', description: 'Updates a form.' },
]) {
  let seeded: readonly ToolCatalogEntry[] = [];
  const search = vi.fn(() => seeded.map(entry => ({ ...entry, score: 1 })));
  const storeFactory: CatalogStoreFactory = { create: vi.fn(({ entries }) => {
    seeded = entries;
    return { search, describe: ({ id }) => seeded.find(entry => entry.id === id) ?? null };
  }) };
  const required = { source: { list: () => descriptors }, enricher, classifier, storeFactory,
    clock: { nowMs: () => Date.parse('2026-10-01T00:00:00.000Z') } };
  return { required, search, entries: () => seeded };
}

test('seeds enriched entries and timestamp, derives sources, preserves schema and omits undeclared schema', () => {
  const f = fixture();
  const query = buildToolCatalogQuery(f.required);
  expect(f.required.storeFactory.create).toHaveBeenCalledWith({ entries: f.entries(), builtAtIso: '2026-10-01T00:00:00.000Z' });
  expect(f.entries()[0]!.description).toBe(`Creates a human operator.${marker}invite staff account How do I create a password?`);
  expect(query.describe({ id: 'users_create' })).toEqual({ id: 'users_create', source: 'users', description: 'Creates a human operator.', inputSchema: { type: 'object' } });
  expect(query.describe({ id: 'forms_update' })).not.toHaveProperty('inputSchema');
  expect(query.describe({ id: 'missing' })).toBeNull();
});

test('search forwards query and explicit/default limits while returning authored descriptions', () => {
  const f = fixture();
  const query = buildToolCatalogQuery(f.required);
  expect(query.search({ query: 'invite' })[0]!.description).toBe('Creates a human operator.');
  expect(f.search).toHaveBeenLastCalledWith({ query: 'invite' }, { limit: 10 });
  query.search({ query: 'forms' }, { limit: 1 });
  expect(f.search).toHaveBeenLastCalledWith({ query: 'forms' }, { limit: 1 });
});

test('keyword and question folds can be independently disabled', () => {
  const f = fixture();
  buildToolCatalogQuery(f.required, { includeDoc2query: false });
  expect(f.entries()[0]!.description).toBe(`Creates a human operator.${marker}invite staff account`);
  buildToolCatalogQuery(f.required, { includeSearchKeywords: false });
  expect(f.entries()[0]!.description).toBe('Creates a human operator.');
});

test('live entries agree with describe, strip already-folded text and see later registrations', () => {
  const descriptors: ToolDescriptor[] = [{ id: 'items_read', description: `Reads items.${marker}assets` }];
  const f = fixture(descriptors);
  const query = buildToolCatalogQuery(f.required);
  expect(listToolCatalogEntries(f.required)).toEqual([query.describe({ id: 'items_read' })]);
  descriptors.push({ id: 'media_list' });
  expect(listToolCatalogEntries(f.required).at(-1)).toEqual({ id: 'media_list', source: 'media', description: '' });
  expect(query.describe({ id: 'media_list' })).toBeNull();
});

test('missing descriptions remain empty even for an enriched ID; orphan fallback is host supplied', () => {
  const f = fixture([{ id: 'users_create' }, { id: '_orphan' }]);
  const query = buildToolCatalogQuery(f.required);
  expect(query.describe({ id: 'users_create' })!.description).toBe('');
  expect(query.describe({ id: '_orphan' })!.source).toBe('host');
});

test('empty source seeds an empty snapshot', () => {
  const f = fixture([]);
  const query = buildToolCatalogQuery(f.required);
  expect(query.search({ query: 'anything' })).toEqual([]);
  expect(query.describe({ id: 'anything' })).toBeNull();
});

test('duplicate IDs reject before allocating the search backend and invalid limits never reach it', () => {
  const f = fixture([{ id: 'same' }, { id: 'same' }]);
  expect(() => buildToolCatalogQuery(f.required)).toThrow('unique');
  expect(f.required.storeFactory.create).not.toHaveBeenCalled();
  const valid = fixture();
  const query = buildToolCatalogQuery(valid.required);
  expect(() => query.search({ query: '' }, { limit: -1 })).toThrow(RangeError);
  expect(valid.search).not.toHaveBeenCalled();
});

test('enricher preserves untouched descriptions and rejects unusable host policies', () => {
  expect(enricher.indexedDescription({ id: 'bare', description: 'Plain' }, { includeDoc2query: true })).toBe('Plain');
  expect(enricher.authoredDescription({ description: 'Plain' })).toBe('Plain');
  expect(() => createSearchEnricher({ marker: '', keywords: {}, questions: {} })).toThrow('marker');
  expect(() => createPrefixSourceClassifier({ separator: '', fallbackSource: 'host' })).toThrow('separator');
});
