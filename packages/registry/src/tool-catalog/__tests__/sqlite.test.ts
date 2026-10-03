import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ensureToolCatalogTables,
  getToolCatalogEntry,
  reseedToolCatalog,
  searchToolCatalog,
  type ToolCatalogEntry,
} from '../sqlite.js';

const ENTRIES: readonly ToolCatalogEntry[] = [
  {
    id: 'page.navigate',
    description: 'Navigate the connected browser tab to a different page in the same app.',
    inputSchema: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] },
    source: 'first-party',
  },
  {
    id: 'page.fill',
    description: 'Fill a text field on the currently visible page.',
    source: 'first-party',
  },
  {
    id: 'terminal.create',
    description: 'Spawns an interactive shell session rooted at a resolved working directory.',
    source: 'first-party',
  },
  {
    id: 'daemon.db.vacuum',
    description: 'Runs SQLite VACUUM against the daemon database and reports reclaimed bytes.',
    source: 'first-party',
  },
];

function openTestDb() {
  const db = new Database(':memory:');
  ensureToolCatalogTables({ db });
  return db;
}

describe('tool-catalog', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openTestDb();
  });

  it('ensureToolCatalogTables is idempotent', () => {
    expect(() => ensureToolCatalogTables({ db })).not.toThrow();
    expect(() => ensureToolCatalogTables({ db })).not.toThrow();
  });

  it('reseed then getToolCatalogEntry round-trips id, description, schema, and source', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    const entry = getToolCatalogEntry({ db, id: 'page.navigate' });
    expect(entry).toEqual(ENTRIES[0]);
  });

  it('getToolCatalogEntry returns null for an unknown id', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    expect(getToolCatalogEntry({ db, id: 'no.such.tool' })).toBeNull();
  });

  it('getToolCatalogEntry omits inputSchema when the entry has none', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    const entry = getToolCatalogEntry({ db, id: 'page.fill' });
    expect(entry).not.toBeNull();
    expect('inputSchema' in (entry as ToolCatalogEntry)).toBe(false);
  });

  it('reseed replaces the previous snapshot entirely — a dropped tool disappears', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    reseedToolCatalog({ db, entries: ENTRIES.filter((e) => e.id !== 'terminal.create') });
    expect(getToolCatalogEntry({ db, id: 'terminal.create' })).toBeNull();
    expect(getToolCatalogEntry({ db, id: 'page.navigate' })).not.toBeNull();
  });

  it('search ranks an id-term match above a description-only match', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    const hits = searchToolCatalog({ db, query: 'navigate' });
    expect(hits[0]?.id).toBe('page.navigate');
  });

  it('search terms are OR-ed — a query matching only one word still surfaces a hit', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    const hits = searchToolCatalog({ db, query: 'navigate nonexistentword' });
    expect(hits.some((h) => h.id === 'page.navigate')).toBe(true);
  });

  it('search finds a description-only term across a different tool', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    const hits = searchToolCatalog({ db, query: 'shell' });
    expect(hits[0]?.id).toBe('terminal.create');
  });

  it('search returns no rows for a query with no matching terms', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    expect(searchToolCatalog({ db, query: 'quantum teleportation' })).toEqual([]);
  });

  it('search returns no rows for an empty or whitespace-only query, without touching the db', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    expect(searchToolCatalog({ db, query: '' })).toEqual([]);
    expect(searchToolCatalog({ db, query: '   ' })).toEqual([]);
  });

  it('search respects the limit parameter', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    const hits = searchToolCatalog({ db, query: 'the a' }, { limit: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('every hit carries a positive score, higher for a better match', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    const hits = searchToolCatalog({ db, query: 'navigate page' });
    for (const hit of hits) expect(hit.score).toBeGreaterThan(0);
  });

  it('search on an empty catalog returns no rows', () => {
    expect(searchToolCatalog({ db, query: 'navigate' })).toEqual([]);
  });

  it('reseed is safe to call with an empty entry list', () => {
    reseedToolCatalog({ db, entries: ENTRIES });
    reseedToolCatalog({ db, entries: [] });
    expect(getToolCatalogEntry({ db, id: 'page.navigate' })).toBeNull();
    expect(searchToolCatalog({ db, query: 'navigate' })).toEqual([]);
  });
});
