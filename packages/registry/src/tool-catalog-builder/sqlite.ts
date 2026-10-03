/**
 * Connect the provider-free snapshot builder to the existing SQLite catalog.
 * The host owns the connection: retiring a live binding does not close shared resources.
 * Use one connection/database per independent snapshot; reusing one deliberately
 * replaces its shared catalog, matching the storage adapter's reseed semantics.
 * Reseeding, tokenization, BM25 weights and score inversion remain in the storage adapter.
 * Keep this on a separate Node subpath so browser consumers never load storage imports.
 */
import type { SqliteDb } from '@jini-ai/db/sqlite';
import { ensureToolCatalogTables, getToolCatalogEntry, reseedToolCatalog, searchToolCatalog } from '../tool-catalog/sqlite.js';
import type { CatalogStoreFactory } from './ports.js';

export function createSqliteCatalogStoreFactory({ db }: { db: SqliteDb }): CatalogStoreFactory {
  return {
    create({ entries, builtAtIso }) {
      const now = Date.parse(builtAtIso);
      if (!Number.isFinite(now)) throw new RangeError('catalog build timestamp must be valid');
      ensureToolCatalogTables({ db });
      reseedToolCatalog({ db, entries }, { now });
      return {
        search: (required, optional) => [...searchToolCatalog({ db, query: required.query }, optional)],
        describe: ({ id }) => getToolCatalogEntry({ db, id }),
      };
    },
  };
}
