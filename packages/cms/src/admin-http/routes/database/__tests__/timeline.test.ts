import { describe, expect, it, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

import { adminDatabaseTimelineRoute, type DatabaseTimelineRouteDeps } from '../timeline.js';

const page = { items: [{ id: 'l-1', kind: 'migration', createdAt: '2026-01-01T00:00:00.000Z', restorePointId: null, outcome: 'ok' }], nextCursor: null };

class TimelineValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'TimelineValidationError'; }
}

// The host binding (Tovu's database-recovery module): the ledger's `ToolInputError` or the read
// model's `TimelineValidationError` (matched by name) is a validation error.
const hostValidationPredicate: DatabaseTimelineRouteDeps['isTimelineValidationError'] = ({ err }) =>
  err instanceof ToolInputError || (err instanceof Error && err.name === 'TimelineValidationError');

function deps(getTimeline: DatabaseTimelineRouteDeps['getTimeline'] = async () => page, isTimelineValidationError = hostValidationPredicate): DatabaseTimelineRouteDeps {
  return { databaseLedgerRepo: { query: async () => page }, getTimeline, isTimelineValidationError };
}

const parse = (query: Record<string, unknown>) => {
  const parsed = adminDatabaseTimelineRoute.parse({ body: undefined, query, params: {} });
  if (!parsed.ok) throw new Error('parse failed');
  return parsed.value;
};

async function refusalOf(promise: Promise<unknown>): Promise<RouteRefusalError['response']> {
  try { await promise; } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('adminDatabaseTimelineRoute', () => {
  it('keeps the wire path and reads the six string/number filter fields', () => {
    expect(adminDatabaseTimelineRoute.method).toBe('get');
    expect(adminDatabaseTimelineRoute.path).toBe('/api/admin/v1/database/timeline');
    expect(parse({ kind: 'migration', outcome: 'ok', fromDate: 'a', toDate: 'b', cursor: 'c', limit: '20', extra: 'x' }))
      .toEqual({ kind: 'migration', outcome: 'ok', fromDate: 'a', toDate: 'b', cursor: 'c', limit: 20 });
    expect(parse({ kind: ['a'], limit: 5 })).toEqual({ kind: undefined, outcome: undefined, fromDate: undefined, toDate: undefined, cursor: undefined, limit: undefined });
    expect(Number.isNaN(parse({ limit: 'abc' }).limit)).toBe(true);
  });

  it('authorizes database.read on database-ledger and returns the timeline page', async () => {
    const authorize = vi.fn(async () => undefined);
    const getTimeline = vi.fn(async () => page);
    const d = deps(getTimeline);
    const result = await adminDatabaseTimelineRoute.handle({ input: parse({ kind: 'migration' }), deps: d, context: { id: 'p-1' }, authorize });
    expect(authorize).toHaveBeenCalledWith({ permission: 'database.read', entityType: 'database-ledger' });
    expect(getTimeline).toHaveBeenCalledWith({ ledger: d.databaseLedgerRepo, filter: parse({ kind: 'migration' }) });
    expect(result).toEqual({ ok: true, value: page });
  });

  it('refuses 400 VALIDATION_ERROR for a TimelineValidationError (matched by name)', async () => {
    const response = await refusalOf(Promise.resolve(adminDatabaseTimelineRoute.handle({ input: parse({ limit: '999' }), deps: deps(async () => { throw new TimelineValidationError('requested limit 999 exceeds the server cap of 200'); }), context: { id: 'p-1' }, authorize: async () => undefined })));
    expect(response).toEqual({ status: 400, body: { error: 'requested limit 999 exceeds the server cap of 200', code: 'VALIDATION_ERROR' } });
  });

  it('refuses 400 VALIDATION_ERROR for an undecodable cursor (ToolInputError)', async () => {
    const response = await refusalOf(Promise.resolve(adminDatabaseTimelineRoute.handle({ input: parse({ cursor: '!!' }), deps: deps(async () => { throw new ToolInputError({ message: 'bad cursor' }); }), context: { id: 'p-1' }, authorize: async () => undefined })));
    expect(response).toEqual({ status: 400, body: { error: 'bad cursor', code: 'VALIDATION_ERROR' } });
  });

  it('classifies through the injected predicate only, passing it the thrown error', async () => {
    const thrown = new ToolInputError({ message: 'bad cursor' });
    const predicate = vi.fn(() => false);
    await expect(adminDatabaseTimelineRoute.handle({ input: parse({}), deps: deps(async () => { throw thrown; }, predicate), context: { id: 'p-1' }, authorize: async () => undefined })).rejects.toBe(thrown);
    expect(predicate).toHaveBeenCalledWith({ err: thrown });
    const custom = new Error('host says invalid');
    const response = await refusalOf(Promise.resolve(adminDatabaseTimelineRoute.handle({ input: parse({}), deps: deps(async () => { throw custom; }, ({ err }) => err === custom), context: { id: 'p-1' }, authorize: async () => undefined })));
    expect(response).toEqual({ status: 400, body: { error: 'host says invalid', code: 'VALIDATION_ERROR' } });
  });

  it('lets any other failure throw for the host failure port', async () => {
    await expect(adminDatabaseTimelineRoute.handle({ input: parse({}), deps: deps(async () => { throw new Error('ledger down'); }), context: { id: 'p-1' }, authorize: async () => undefined })).rejects.toThrow('ledger down');
  });

  it('never reads the ledger when authorization refuses, or without an authorizer', async () => {
    const getTimeline = vi.fn(async () => page);
    await expect(adminDatabaseTimelineRoute.handle({ input: parse({}), deps: deps(getTimeline), context: { id: 'p-1' }, authorize: async () => { throw new Error('denied'); } })).rejects.toThrow('denied');
    await expect(adminDatabaseTimelineRoute.handle({ input: parse({}), deps: deps(getTimeline), context: { id: 'p-1' } })).rejects.toThrow(/authorizer/);
    expect(getTimeline).not.toHaveBeenCalled();
  });
});
