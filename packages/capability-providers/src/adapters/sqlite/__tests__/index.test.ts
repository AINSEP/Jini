import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDbProvider } from '../index.js';

/**
 * `:memory:` is a real `better-sqlite3` engine (genuine SQL semantics — the whole point of this
 * adapter's tests), but it never touches the filesystem, matching this package's "no real
 * filesystem I/O in tests by default" convention.
 */
let db: Database.Database;
let provider: SqliteDbProvider;

beforeEach(() => {
  db = new Database(':memory:');
  provider = new SqliteDbProvider(db);
});

afterEach(() => {
  db.close();
});

describe('SqliteDbProvider', () => {
  it('insert() persists a record and returns it', async () => {
    const record = await provider.insert('users', { id: 'u1', name: 'Ada' });
    expect(record).toEqual({ id: 'u1', name: 'Ada' });
    expect(await provider.get('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' });
  });

  it('insert() rejects a duplicate id within the same collection', async () => {
    await provider.insert('users', { id: 'u1', name: 'Ada' });
    await expect(provider.insert('users', { id: 'u1', name: 'Grace' })).rejects.toThrow(/already exists/);
    // The original record must be untouched.
    expect(await provider.get('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' });
  });

  it('insert() allows the same id in two different collections', async () => {
    await provider.insert('users', { id: 'x', name: 'Ada' });
    await provider.insert('orgs', { id: 'x', name: 'Acme' });
    expect(await provider.get('users', 'x')).toEqual({ id: 'x', name: 'Ada' });
    expect(await provider.get('orgs', 'x')).toEqual({ id: 'x', name: 'Acme' });
  });

  it('get() returns null for an unknown id', async () => {
    expect(await provider.get('users', 'nope')).toBeNull();
  });

  it('get() returns null for a known id in a different collection', async () => {
    await provider.insert('users', { id: 'u1', name: 'Ada' });
    expect(await provider.get('orgs', 'u1')).toBeNull();
  });

  it('update() shallow-merges a patch into an existing record and keeps the id fixed', async () => {
    await provider.insert('users', { id: 'u1', name: 'Ada', age: 30 });
    const updated = await provider.update('users', 'u1', { age: 31 });
    expect(updated).toEqual({ id: 'u1', name: 'Ada', age: 31 });
    expect(await provider.get('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', age: 31 });
  });

  it('update() ignores an id field inside the patch — the record keeps its original id', async () => {
    await provider.insert('users', { id: 'u1', name: 'Ada' });
    const updated = await provider.update('users', 'u1', { id: 'hijacked', name: 'Ada Lovelace' });
    expect(updated).toEqual({ id: 'u1', name: 'Ada Lovelace' });
  });

  it('update() returns null for an unknown id (no upsert)', async () => {
    expect(await provider.update('users', 'nope', { name: 'x' })).toBeNull();
    expect(await provider.get('users', 'nope')).toBeNull();
  });

  it('delete() removes a record; a second get returns null', async () => {
    await provider.insert('users', { id: 'u1', name: 'Ada' });
    await provider.delete('users', 'u1');
    expect(await provider.get('users', 'u1')).toBeNull();
  });

  it('delete() on an unknown id is a silent no-op', async () => {
    await expect(provider.delete('users', 'nope')).resolves.toBeUndefined();
  });

  it('query() with no filter returns every record in the collection', async () => {
    await provider.insert('users', { id: 'u1', name: 'Ada' });
    await provider.insert('users', { id: 'u2', name: 'Grace' });
    await provider.insert('orgs', { id: 'o1', name: 'Acme' });
    const results = await provider.query('users');
    expect(results.map((r) => r.id).sort()).toEqual(['u1', 'u2']);
  });

  it('query() applies an exact-match where filter', async () => {
    await provider.insert('users', { id: 'u1', name: 'Ada', role: 'admin' });
    await provider.insert('users', { id: 'u2', name: 'Grace', role: 'member' });
    const results = await provider.query('users', { where: { role: 'admin' } });
    expect(results).toEqual([{ id: 'u1', name: 'Ada', role: 'admin' }]);
  });

  it('query() with a where clause matching nothing returns []', async () => {
    await provider.insert('users', { id: 'u1', name: 'Ada' });
    expect(await provider.query('users', { where: { name: 'nobody' } })).toEqual([]);
  });

  it('query() on an unknown collection returns []', async () => {
    expect(await provider.query('nope')).toEqual([]);
  });

  it('query() where requires every key/value pair to match (AND semantics)', async () => {
    await provider.insert('users', { id: 'u1', role: 'admin', active: true });
    await provider.insert('users', { id: 'u2', role: 'admin', active: false });
    const results = await provider.query('users', { where: { role: 'admin', active: true } });
    expect(results.map((r) => r.id)).toEqual(['u1']);
  });

  it('data survives across two SqliteDbProvider instances sharing the same handle', async () => {
    await provider.insert('users', { id: 'u1', name: 'Ada' });
    const second = new SqliteDbProvider(db);
    expect(await second.get('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' });
  });
});
