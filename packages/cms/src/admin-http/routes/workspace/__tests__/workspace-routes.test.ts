import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

import { InMemoryWorkspaceRepo, WorkspaceLastRemainingError, WorkspaceNotFoundError, WorkspaceValidationError, type WorkspaceRepoPort } from '../../../../workspace/index.js';
import { toAdminWorkspaceResponse } from '../../../http/workspace.js';
import { deleteWorkspaceFailure, deleteWorkspaceUnlessBound, workspaceDeleteRoute } from '../delete.js';
import type { WorkspaceAdminRouteDeps } from '../deps.js';
import { workspaceGetRoute } from '../get.js';
import { workspaceListRoute } from '../list.js';
import { parseWorkspaceUpdateBody, workspaceUpdateFailure, workspaceUpdateRoute } from '../update.js';

const BASE = '/api/admin/v1/workspaces';
const own = { id: 'ws-7', name: 'Original Site', slug: 'original-site', createdAt: '2026-09-01T00:00:00Z', version: 1 };
const other = { id: 'ws-8', name: 'Other Site', slug: 'other-site', createdAt: '2026-09-02T00:00:00Z', version: 1 };

type AnyRoute = typeof workspaceGetRoute | typeof workspaceListRoute | typeof workspaceUpdateRoute | typeof workspaceDeleteRoute;

function fixture(rows = [own], { deny = false, repo }: { deny?: boolean; repo?: WorkspaceRepoPort } = {}) {
  const calls: unknown[] = [];
  const deps: WorkspaceAdminRouteDeps = { workspaceId: 'ws-7', workspaceRepo: repo ?? new InMemoryWorkspaceRepo({}, { initialRows: rows }) };
  const authorize = async (args: { permission: string; entityType: string }) => {
    calls.push(args);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  async function run(route: AnyRoute, { params = { workspaceId: 'ws-7' }, body }: { params?: Record<string, string>; body?: unknown } = {}) {
    const spec = route as unknown as { parse: (raw: unknown) => { ok: boolean; value?: unknown }; handle: (args: unknown) => Promise<unknown> };
    const parsed = spec.parse({ body, query: {}, params });
    if (!parsed.ok) throw new Error('parse must be total');
    return spec.handle({ input: parsed.value, deps, context: { id: 'principal-7' }, authorize });
  }
  return { calls, deps, run };
}

async function refusal(promise: Promise<unknown>): Promise<RouteRefusalError['response']> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  if (!(error instanceof RouteRefusalError)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error.response;
}

describe('workspace admin route specs', () => {
  it('keeps each method, byte-identical path and the 204 delete status', () => {
    expect([workspaceListRoute, workspaceGetRoute, workspaceUpdateRoute, workspaceDeleteRoute].map(r => `${r.method} ${r.path}`)).toEqual([
      `get ${BASE}`, `get ${BASE}/:workspaceId`, `patch ${BASE}/:workspaceId`, `delete ${BASE}/:workspaceId`,
    ]);
    expect(workspaceDeleteRoute.successStatus).toBe(204);
    expect(workspaceGetRoute.successStatus).toBeUndefined();
  });

  it('get authorizes workspace.manage and answers the projected own workspace', async () => {
    const f = fixture();
    expect(await f.run(workspaceGetRoute)).toEqual({ ok: true, value: { workspace: own } });
    expect(f.calls).toEqual([{ permission: 'workspace.manage', entityType: 'workspace' }]);
  });

  it('get answers 404 when the boot-wired row is missing', async () => {
    expect(await refusal(fixture([]).run(workspaceGetRoute))).toEqual({ status: 404, body: { error: 'workspace was not found' } });
  });

  it('a refused authorization stops every route before storage is touched', async () => {
    const reads: unknown[] = [];
    const repo = { findById: async (x: unknown) => { reads.push(x); return own; } } as unknown as WorkspaceRepoPort;
    for (const route of [workspaceListRoute, workspaceGetRoute, workspaceUpdateRoute, workspaceDeleteRoute]) {
      expect(await refusal(fixture([own], { deny: true, repo }).run(route, { body: { name: 'x' } }))).toEqual({ status: 403, body: { error: 'denied' } });
    }
    expect(reads).toEqual([]);
  });

  it('a route mounted without an authorizer fails closed', async () => {
    const deps: WorkspaceAdminRouteDeps = { workspaceId: 'ws-7', workspaceRepo: new InMemoryWorkspaceRepo({}, { initialRows: [own] }) };
    await expect(workspaceGetRoute.handle({ input: {}, deps })).rejects.toThrow('workspace admin route has no authorizer');
  });

  it('list answers exactly the own workspace, or an empty list when its row is missing', async () => {
    expect(await fixture([own, other]).run(workspaceListRoute, { params: {} })).toEqual({ ok: true, value: { workspaces: [own] } });
    expect(await fixture([]).run(workspaceListRoute, { params: {} })).toEqual({ ok: true, value: { workspaces: [] } });
  });

  it('update parse is total: an absent body leaves both fields undefined, present fields are stringified', () => {
    expect(parseWorkspaceUpdateBody({ rawBody: undefined })).toEqual({ name: undefined, slug: undefined });
    expect(parseWorkspaceUpdateBody({ rawBody: { name: 42 } })).toEqual({ name: '42', slug: undefined });
    expect(workspaceUpdateRoute.parse({ body: { slug: 'next' }, query: {}, params: {} })).toEqual({ ok: true, value: { name: undefined, slug: 'next' } });
  });

  it('update renames the own workspace and answers the projection', async () => {
    const f = fixture();
    expect(await f.run(workspaceUpdateRoute, { body: { name: 'Autumn Journal' } })).toEqual({ ok: true, value: { workspace: { ...own, name: 'Autumn Journal', version: 2 } } });
  });

  it('update maps validation 400, slug conflict 409 and missing row 404; anything else passes through', async () => {
    expect(await refusal(fixture().run(workspaceUpdateRoute, { body: undefined }))).toMatchObject({ status: 400, body: { code: 'VALIDATION_ERROR' } });
    expect(await refusal(fixture([own, other]).run(workspaceUpdateRoute, { body: { slug: 'other-site' } }))).toMatchObject({ status: 409, body: { code: 'RESOURCE_CONFLICT', details: { field: 'slug' } } });
    expect(await refusal(fixture([other]).run(workspaceUpdateRoute, { body: { name: 'x' } }))).toMatchObject({ status: 404, body: { code: 'RESOURCE_NOT_FOUND' } });
    const boom = new Error('db exploded');
    expect(workspaceUpdateFailure({ error: boom })).toBe(boom);
    expect((workspaceUpdateFailure({ error: new WorkspaceValidationError({ message: 'bad' }) }) as RouteRefusalError).response).toEqual({ status: 400, body: { error: 'bad', code: 'VALIDATION_ERROR' } });
  });

  it('delete parse reads a missing :workspaceId as an empty string, never "undefined"', () => {
    expect(workspaceDeleteRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { workspaceId: '' } });
  });

  it('deleting the bound workspace is refused BOUND_WORKSPACE (INV-05) after authorizing, and the rows survive', async () => {
    const f = fixture([own, other]);
    expect(await refusal(f.run(workspaceDeleteRoute))).toEqual({ status: 409, body: {
      error: 'the workspace this server is bound to cannot be deleted while it is serving that workspace', code: 'BOUND_WORKSPACE',
    } });
    expect(f.calls).toHaveLength(1);
    expect(await f.deps.workspaceRepo.list()).toEqual([own, other]);
  });

  it('deleteWorkspaceUnlessBound, given a non-bound target, runs the domain delete on deps.workspaceId', async () => {
    const f = fixture([own, other]);
    await deleteWorkspaceUnlessBound({ deps: f.deps, targetWorkspaceId: 'ws-8' });
    expect(await f.deps.workspaceRepo.list()).toEqual([other]);
  });

  it('deleteWorkspaceUnlessBound lets the domain typed errors through, and refuses without a transaction port', async () => {
    const f = fixture([own]);
    await expect(deleteWorkspaceUnlessBound({ deps: f.deps, targetWorkspaceId: 'ws-8' })).rejects.toBeInstanceOf(WorkspaceLastRemainingError);
    expect(await f.deps.workspaceRepo.list()).toEqual([own]);
    const deleted: unknown[] = [];
    const repo = { findById: async () => other, list: async () => [own, other], delete: async (x: unknown) => { deleted.push(x); } } as unknown as WorkspaceRepoPort;
    await expect(deleteWorkspaceUnlessBound({ deps: { workspaceId: 'ws-7', workspaceRepo: repo }, targetWorkspaceId: 'ws-8' })).rejects.toThrow('workspace deletion requires a transaction port');
    expect(deleted).toEqual([]);
  });

  it('deleteWorkspaceFailure maps NotFound to 404 RESOURCE_NOT_FOUND, LastRemaining to 409 LAST_WORKSPACE, and returns anything else unchanged', () => {
    expect((deleteWorkspaceFailure({ error: new WorkspaceNotFoundError({ message: "workspace 'nope' was not found" }) }) as RouteRefusalError).response)
      .toEqual({ status: 404, body: { error: "workspace 'nope' was not found", code: 'RESOURCE_NOT_FOUND' } });
    expect((deleteWorkspaceFailure({ error: new WorkspaceLastRemainingError({ message: 'last' }) }) as RouteRefusalError).response)
      .toEqual({ status: 409, body: { error: 'last', code: 'LAST_WORKSPACE' } });
    const leak = new Error('db exploded: connection string postgres://user:pw@host');
    expect(deleteWorkspaceFailure({ error: leak })).toBe(leak);
    expect(deleteWorkspaceFailure({ error: 'plain string failure' })).toBe('plain string failure');
  });
});

describe('toAdminWorkspaceResponse', () => {
  it('projects exactly the five wire fields, dropping anything else', () => {
    expect(toAdminWorkspaceResponse({ ...own, internal: 'x' } as typeof own)).toEqual(own);
  });
});
