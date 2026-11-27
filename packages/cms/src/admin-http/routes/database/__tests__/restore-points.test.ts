import { describe, expect, it, vi } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

import {
  adminDatabaseRestorePointsCreateRoute,
  adminDatabaseRestorePointsListRoute,
  type DatabaseRestorePointsCreateRouteDeps,
  type DatabaseRestorePointsListRouteDeps,
} from '../restore-points.js';

class FakeUnavailableError extends Error {}
class FakeValidationError extends Error {}

const row = { id: 'rp-1', trigger: 'manual', costClass: 'cheap', kind: 'file-snapshot', watermarkAtCapture: 7, createdAt: '2026-01-01T00:00:00.000Z', artifactRef: '/a.db' };

function listDeps(): DatabaseRestorePointsListRouteDeps {
  return {
    restorePointsRepo: { list: async () => [row] },
    listRestorePoints: async ({ repo }) => ({ items: await repo.list() }),
  };
}

function createDeps(overrides: Partial<DatabaseRestorePointsCreateRouteDeps> = {}): DatabaseRestorePointsCreateRouteDeps & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    workspaceId: 'ws-1',
    clock: { nowIso: () => '2026-02-02T00:00:00.000Z' },
    dbOps: {
      getCapabilities: async () => ({ restorePoint: { costClass: 'cheap', kind: 'file-snapshot' } }),
      captureRestorePoint: async () => ({ artifactRef: '/snap.db', watermarkAtCapture: 73 }),
    },
    restorePointsRepo: {
      list: async () => [row],
      findByIdempotencyKey: async () => null,
      save: async (input) => { saved.push(input); },
    },
    createRestorePoint: async ({ costClass, kind, costAck, capture }) => {
      if (costClass === 'unavailable') throw new FakeUnavailableError('no restore point here');
      if (costClass === 'expensive' && !costAck) throw new FakeValidationError('costAck required');
      await capture();
      return { id: 'new-rp', costClass, kind };
    },
    restorePointErrors: { unavailable: FakeUnavailableError, validation: FakeValidationError },
    ...overrides,
  };
}

const parseCreate = (body: unknown) => {
  const parsed = adminDatabaseRestorePointsCreateRoute.parse({ body, query: {}, params: {} });
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

describe('adminDatabaseRestorePointsListRoute', () => {
  it('keeps the wire path and authorizes database.read on restore-point before listing', async () => {
    expect(adminDatabaseRestorePointsListRoute.method).toBe('get');
    expect(adminDatabaseRestorePointsListRoute.path).toBe('/api/admin/v1/database/restore-points');
    const authorize = vi.fn(async () => undefined);
    const parsed = adminDatabaseRestorePointsListRoute.parse({ body: undefined, query: {}, params: {} });
    expect(parsed.ok).toBe(true);
    const result = await adminDatabaseRestorePointsListRoute.handle({ input: undefined, deps: listDeps(), context: { id: 'p-1' }, authorize });
    expect(authorize).toHaveBeenCalledWith({ permission: 'database.read', entityType: 'restore-point' });
    expect(result).toEqual({ ok: true, value: { items: [row] } });
  });

  it('does not list when authorization refuses', async () => {
    const deps = listDeps();
    const list = vi.spyOn(deps.restorePointsRepo, 'list');
    const authorize = async () => { throw new Error('denied'); };
    await expect(adminDatabaseRestorePointsListRoute.handle({ input: undefined, deps, context: { id: 'p-1' }, authorize })).rejects.toThrow('denied');
    expect(list).not.toHaveBeenCalled();
  });

  it('refuses to run without an authorizer', async () => {
    await expect(adminDatabaseRestorePointsListRoute.handle({ input: undefined, deps: listDeps(), context: { id: 'p-1' } })).rejects.toThrow(/authorizer/);
  });
});

describe('adminDatabaseRestorePointsCreateRoute', () => {
  it('parses defaults: manual trigger, no cost ack, a fresh idempotency key', () => {
    const value = parseCreate(undefined);
    expect(value.trigger).toBe('manual');
    expect(value.costAck).toBe(false);
    expect(value.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(parseCreate({ trigger: 'pre-upgrade', costAck: true, idempotencyKey: 'k' })).toEqual({ trigger: 'pre-upgrade', costAck: true, idempotencyKey: 'k' });
    expect(parseCreate({ costAck: 'yes' }).costAck).toBe(false);
  });

  it('answers 201 with the summary and persists the captured row', async () => {
    expect(adminDatabaseRestorePointsCreateRoute.successStatus).toBe(201);
    const deps = createDeps();
    const authorize = vi.fn(async () => undefined);
    const result = await adminDatabaseRestorePointsCreateRoute.handle({ input: parseCreate({ idempotencyKey: 'k1' }), deps, context: { id: 'p-1' }, authorize });
    expect(authorize).toHaveBeenCalledWith({ permission: 'backup.create', entityType: 'restore-point' });
    expect(result).toEqual({ ok: true, value: { restorePoint: { id: 'new-rp', costClass: 'cheap', kind: 'file-snapshot' } } });
    expect(deps.saved).toEqual([{
      restorePointId: 'new-rp', idempotencyKey: 'k1', trigger: 'manual', createdAt: '2026-02-02T00:00:00.000Z', createdBy: 'p-1',
      costClass: 'cheap', kind: 'file-snapshot', watermarkAtCapture: 73, artifactRef: '/snap.db',
    }]);
  });

  it('returns the original restore point for a repeated idempotency key without capturing', async () => {
    const capture = vi.fn();
    const deps = createDeps();
    deps.restorePointsRepo.findByIdempotencyKey = async () => ({ restorePointId: 'rp-1', idempotencyKey: 'k1' });
    deps.dbOps.captureRestorePoint = capture;
    const result = await adminDatabaseRestorePointsCreateRoute.handle({ input: parseCreate({ idempotencyKey: 'k1' }), deps, context: { id: 'p-1' }, authorize: async () => undefined });
    expect(result).toEqual({ ok: true, value: { restorePoint: { id: 'rp-1', costClass: 'cheap', kind: 'file-snapshot' } } });
    expect(capture).not.toHaveBeenCalled();
    expect(deps.saved).toEqual([]);
  });

  it('throws (500 path) when a known idempotency key has no persisted row', async () => {
    const deps = createDeps();
    deps.restorePointsRepo.findByIdempotencyKey = async () => ({ restorePointId: 'lost', idempotencyKey: 'k1' });
    await expect(adminDatabaseRestorePointsCreateRoute.handle({ input: parseCreate({ idempotencyKey: 'k1' }), deps, context: { id: 'p-1' }, authorize: async () => undefined }))
      .rejects.toThrow("restore point 'lost' has a known idempotency key but no persisted row");
  });

  it('refuses 400 VALIDATION_ERROR when an expensive restore point lacks costAck', async () => {
    const deps = createDeps();
    deps.dbOps.getCapabilities = async () => ({ restorePoint: { costClass: 'expensive', kind: 'logical-dump' } });
    const response = await refusalOf(Promise.resolve(adminDatabaseRestorePointsCreateRoute.handle({ input: parseCreate({}), deps, context: { id: 'p-1' }, authorize: async () => undefined })));
    expect(response).toEqual({ status: 400, body: { error: 'costAck required', code: 'VALIDATION_ERROR' } });
    expect(deps.saved).toEqual([]);
  });

  it('refuses 409 RESTORE_POINT_UNAVAILABLE when the site has no restore capability', async () => {
    const deps = createDeps();
    deps.dbOps.getCapabilities = async () => ({ restorePoint: { costClass: 'unavailable', kind: 'file-snapshot' } });
    const response = await refusalOf(Promise.resolve(adminDatabaseRestorePointsCreateRoute.handle({ input: parseCreate({}), deps, context: { id: 'p-1' }, authorize: async () => undefined })));
    expect(response).toEqual({ status: 409, body: { error: 'no restore point here', code: 'RESTORE_POINT_UNAVAILABLE' } });
  });

  it('lets an unexpected save failure throw for the host failure port', async () => {
    const deps = createDeps();
    deps.restorePointsRepo.save = async () => { throw new Error('disk full'); };
    await expect(adminDatabaseRestorePointsCreateRoute.handle({ input: parseCreate({}), deps, context: { id: 'p-1' }, authorize: async () => undefined })).rejects.toThrow('disk full');
  });

  it('authorizes before any repository read', async () => {
    const deps = createDeps();
    const lookup = vi.spyOn(deps.restorePointsRepo, 'findByIdempotencyKey');
    await expect(adminDatabaseRestorePointsCreateRoute.handle({ input: parseCreate({}), deps, context: { id: 'p-1' }, authorize: async () => { throw new Error('denied'); } })).rejects.toThrow('denied');
    expect(lookup).not.toHaveBeenCalled();
  });
});

it("does not capture a restore point without an authenticated actor", async () => {
  const deps = createDeps();
  const captureRestorePoint = vi.fn(deps.dbOps.captureRestorePoint);
  const findByIdempotencyKey = vi.fn(deps.restorePointsRepo.findByIdempotencyKey);
  await expect(adminDatabaseRestorePointsCreateRoute.handle({
    input: parseCreate({ idempotencyKey: "missing-actor" }), authorize: async () => {},
    deps: { ...deps, dbOps: { ...deps.dbOps, captureRestorePoint }, restorePointsRepo: { ...deps.restorePointsRepo, findByIdempotencyKey } },
  })).rejects.toThrow(new Error("restore-point create requires an authenticated principal"));
  expect(captureRestorePoint).not.toHaveBeenCalled();
  expect(findByIdempotencyKey).not.toHaveBeenCalled();
  expect(deps.saved).toEqual([]);
});
