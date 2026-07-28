/**
 * UNSAFE REFERENCE IMPLEMENTATION — not production code. See the header
 * comment in `src/unsafe-reference/index.ts` for the full warning; the
 * short version: `createInMemoryDbProvider` has no principal/tenant/ACL
 * dimension, no quotas, and no size bounds. It exists only to prove
 * `DbProvider` (defined in `../db.ts`) is implementable and unit-testable.
 * Never wire this into anything that handles real user data.
 *
 * A real adapter (`@jini-ai/sqlite`, Supabase Postgres) implements the same
 * `DbProvider` interface without importing this file — this is
 * deliberately not that adapter (see the scope note in `source-map.md`).
 */
import type { DbProvider, DbQuery, DbRecord } from '../db.js';

function matchesWhere(record: DbRecord, where: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

/** Creates the in-memory reference `DbProvider`. No persistence — state is lost on process exit. */
export function createInMemoryDbProvider(): DbProvider {
  const collections = new Map<string, Map<string, DbRecord>>();

  function collectionFor(name: string): Map<string, DbRecord> {
    let collection = collections.get(name);
    if (!collection) {
      collection = new Map();
      collections.set(name, collection);
    }
    return collection;
  }

  return {
    async insert(collectionName: string, record: DbRecord): Promise<DbRecord> {
      const collection = collectionFor(collectionName);
      if (collection.has(record.id)) {
        throw new Error(`record already exists: ${collectionName}/${record.id}`);
      }
      collection.set(record.id, record);
      return record;
    },

    async get(collectionName: string, id: string): Promise<DbRecord | null> {
      return collections.get(collectionName)?.get(id) ?? null;
    },

    async update(collectionName: string, id: string, patch: Readonly<Record<string, unknown>>): Promise<DbRecord | null> {
      const collection = collections.get(collectionName);
      const existing = collection?.get(id);
      if (!collection || !existing) return null;
      const updated: DbRecord = { ...existing, ...patch, id };
      collection.set(id, updated);
      return updated;
    },

    async delete(collectionName: string, id: string): Promise<void> {
      collections.get(collectionName)?.delete(id);
    },

    async query(collectionName: string, query: DbQuery = {}): Promise<DbRecord[]> {
      const collection = collections.get(collectionName);
      if (!collection) return [];
      return [...collection.values()].filter((record) => matchesWhere(record, query.where));
    },
  };
}
