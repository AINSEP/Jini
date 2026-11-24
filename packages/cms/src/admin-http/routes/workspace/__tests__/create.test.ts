import { describe, expect, it } from 'vitest';
import type { OutboxPort, OutboxRecord } from '@jini-ai/core/contracts/events';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

import { InMemoryWorkspaceRepo, WorkspaceNotFoundError, type WorkspaceRepoPort } from '../../../../workspace/index.js';
import { parseWorkspaceCreateBody, workspaceCreateFailure, workspaceCreateRoute, type WorkspaceCreateRouteDeps } from '../create.js';

const BASE = '/api/admin/v1/workspaces';
const existing = { id: 'existing', name: 'Existing', slug: 'acme', createdAt: '2026-01-01T00:00:00.000Z', version: 1 };

/** Minimal in-memory `OutboxPort`, declared locally like `workspace/__tests__/create.test.ts`'s:
 *  the host's outbox runtime is not part of this package's closure. */
function fakeOutbox(): OutboxPort & { records: OutboxRecord[] } {
  const records: OutboxRecord[] = [];
  return {
    records,
    enqueue: async (event) => { records.push({ id: event.id, event, status: 'pending', attempts: 0, nextAttemptAt: event.occurredAt, createdAt: event.occurredAt }); },
    claimPending: async () => [],
    markDelivered: async () => {},
    markFailed: async () => {},
  };
}

function fixture({ rows = [] as typeof existing[], deny = false, repo, flushOutbox }: { rows?: typeof existing[]; deny?: boolean; repo?: WorkspaceRepoPort; flushOutbox?: () => Promise<unknown> } = {}) {
  const calls: unknown[] = [];
  const order: string[] = [];
  const outbox = fakeOutbox();
  const deps: WorkspaceCreateRouteDeps = {
    workspaceId: 'ws-1',
    workspaceRepo: repo ?? new InMemoryWorkspaceRepo({}, { initialRows: rows }),
    idGen: { newId: () => 'id-1' },
    clock: { nowMs: () => Date.parse('2026-01-01T00:00:00.000Z') },
    outbox,
    flushOutbox: flushOutbox ?? (async () => { order.push(`flush:${outbox.records.length}`); }),
  };
  const authorize = async (args: { permission: string; entityType: string }) => {
    calls.push(args);
    order.push('authorize');
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  async function run(body: unknown) {
    const parsed = workspaceCreateRoute.parse({ body, query: {}, params: {} });
    if (!parsed.ok) throw new Error('parse must be total');
    return workspaceCreateRoute.handle({ input: parsed.value, deps, context: { id: 'principal-1' }, authorize });
  }
  return { calls, order, deps, outbox, run };
}

async function refusal(promise: Promise<unknown>): Promise<RouteRefusalError['response']> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  if (!(error instanceof RouteRefusalError)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error.response;
}

describe('workspace create route spec', () => {
  it('keeps the method, byte-identical path and the 201 status', () => {
    expect(`${workspaceCreateRoute.method} ${workspaceCreateRoute.path}`).toBe(`post ${BASE}`);
    expect(workspaceCreateRoute.successStatus).toBe(201);
  });

  it('authorizes, creates, then flushes the enqueued event before answering the new id', async () => {
    const f = fixture();
    expect(await f.run({ name: 'Acme', slug: 'acme' })).toEqual({ ok: true, value: { id: 'id-1' } });
    expect(f.calls).toEqual([{ permission: 'workspace.manage', entityType: 'workspace' }]);
    expect(f.order).toEqual(['authorize', 'flush:1']);
    expect(f.outbox.records.map((r) => r.event.name)).toEqual(['workspace.created']);
    expect(await f.deps.workspaceRepo.findBySlug({ slug: 'acme' })).toMatchObject({ id: 'id-1', name: 'Acme', slug: 'acme' });
  });

  it('a refused authorization stops before validation, storage and the flush', async () => {
    const f = fixture({ deny: true });
    expect(await refusal(f.run({ name: '', slug: '' }))).toEqual({ status: 403, body: { error: 'denied' } });
    expect(f.order).toEqual(['authorize']);
    expect(await f.deps.workspaceRepo.list()).toEqual([]);
  });

  it('an invalid name is the 400 VALIDATION_ERROR refusal and nothing is flushed', async () => {
    const f = fixture();
    const res = await refusal(f.run({ name: '', slug: 'acme' }));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(f.order).toEqual(['authorize']);
  });

  it('a taken slug is the 409 RESOURCE_CONFLICT refusal naming the slug field', async () => {
    const res = await refusal(fixture({ rows: [existing] }).run({ name: 'Acme Two', slug: 'acme' }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'RESOURCE_CONFLICT', details: { field: 'slug' } });
  });

  it('an unexpected storage or flush failure is rethrown unchanged for the host 500', async () => {
    const boom = new Error('db down');
    const repo = { findBySlug: async () => null, insert: async () => { throw boom; } } as unknown as WorkspaceRepoPort;
    await expect(fixture({ repo }).run({ name: 'Acme', slug: 'acme' })).rejects.toBe(boom);
    const flushBoom = new Error('bus down');
    await expect(fixture({ flushOutbox: async () => { throw flushBoom; } }).run({ name: 'Acme', slug: 'acme' })).rejects.toBe(flushBoom);
  });

  it('parse is total: an absent body or field is the empty string, present fields are stringified', () => {
    expect(parseWorkspaceCreateBody({ rawBody: undefined })).toEqual({ name: '', slug: '' });
    expect(parseWorkspaceCreateBody({ rawBody: { name: 42, slug: null } })).toEqual({ name: '42', slug: '' });
  });

  it('maps only its two typed domain errors; anything else is returned unchanged', () => {
    const notFound = new WorkspaceNotFoundError({ message: 'gone' });
    expect(workspaceCreateFailure({ error: notFound })).toBe(notFound);
  });
});
