import { describe, expect, it, vi } from 'vitest';

import { adminDatabaseSchemaStateRoute } from '../schema-state.js';

const summary = { status: 'unknown', siteMeta: null, runtime: { lineage: 'x' } };

describe('adminDatabaseSchemaStateRoute', () => {
  it('keeps the wire path and passes the schema state through verbatim after authorizing', async () => {
    expect(adminDatabaseSchemaStateRoute.method).toBe('get');
    expect(adminDatabaseSchemaStateRoute.path).toBe('/api/admin/v1/database/schema-state');
    expect(adminDatabaseSchemaStateRoute.parse({ body: undefined, query: {}, params: {} }).ok).toBe(true);
    const authorize = vi.fn(async () => undefined);
    const deps = { databaseIntrospection: { getSchemaState: async () => summary } };
    const result = await adminDatabaseSchemaStateRoute.handle({ input: undefined, deps, context: { id: 'p-1' }, authorize });
    expect(authorize).toHaveBeenCalledWith({ permission: 'database.read', entityType: 'database-schema' });
    expect(result).toEqual({ ok: true, value: summary });
  });

  it('never reads the schema state when authorization refuses', async () => {
    const getSchemaState = vi.fn();
    await expect(adminDatabaseSchemaStateRoute.handle({ input: undefined, deps: { databaseIntrospection: { getSchemaState } }, context: { id: 'p-1' }, authorize: async () => { throw new Error('denied'); } })).rejects.toThrow('denied');
    expect(getSchemaState).not.toHaveBeenCalled();
  });

  it('lets a failed read throw for the host failure port instead of answering a status', async () => {
    const deps = { databaseIntrospection: { getSchemaState: async () => { throw new Error('boom'); } } };
    await expect(adminDatabaseSchemaStateRoute.handle({ input: undefined, deps, context: { id: 'p-1' }, authorize: async () => undefined })).rejects.toThrow('boom');
  });

  it('refuses to run without an authorizer', async () => {
    const deps = { databaseIntrospection: { getSchemaState: async () => summary } };
    await expect(adminDatabaseSchemaStateRoute.handle({ input: undefined, deps, context: { id: 'p-1' } })).rejects.toThrow(/authorizer/);
  });
});
