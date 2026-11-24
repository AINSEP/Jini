import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import {
  exportSiteStatusRoute, exportSiteTriggerRoute, type ExportSiteStatusRouteDeps, type ExportSiteTriggerRouteDeps,
} from '../export-site.js';

const IDLE = { status: 'idle', extra: 1 };
const RUNNING = { status: 'running', startedAt: 't0' };

function triggerDeps(overrides: Partial<ExportSiteTriggerRouteDeps> = {}) {
  const starts: unknown[] = [];
  const deps: ExportSiteTriggerRouteDeps = {
    workspaceId: 'ws',
    getRunSnapshot: () => IDLE,
    startRun: (required, optional) => { starts.push([required, optional]); return RUNNING; },
    ...overrides,
  };
  return { deps, starts };
}

async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(RouteRefusalError);
  return (error as RouteRefusalError).response;
}

function trigger(deps: ExportSiteTriggerRouteDeps, body: unknown, { deny = false, noAuthorizer = false, noPrincipal = false } = {}) {
  const asked: unknown[] = [];
  const authorize = async (...args: unknown[]) => { asked.push(args); if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } }); };
  const parsed = exportSiteTriggerRoute.parse({ body, query: {}, params: { workspaceId: 'ws' } } as never);
  if (!parsed.ok) throw new Error('parse must be total');
  const context = noPrincipal ? undefined : { id: 'p1' };
  const result = Promise.resolve(exportSiteTriggerRoute.handle({ input: parsed.value, deps, context, ...(noAuthorizer ? {} : { authorize }) }, {}));
  return { asked, result };
}

describe('exportSiteTriggerRoute', () => {
  it('pins method, path, the 202 success status and no body cap', () => {
    expect(exportSiteTriggerRoute.method).toBe('post');
    expect(exportSiteTriggerRoute.path).toBe('/api/admin/v1/workspaces/:workspaceId/system/export');
    expect(exportSiteTriggerRoute.successStatus).toBe(202);
    expect(exportSiteTriggerRoute.maxBodyBytes).toBeUndefined();
  });

  it('parse never refuses: body validation runs after authorization and the running check', () => {
    expect(exportSiteTriggerRoute.parse({ body: 'junk', query: {}, params: {} } as never)).toEqual({ ok: true, value: { body: 'junk' } });
  });

  it('authorizes system.export on site-export and starts a run with the defaults for an absent body', async () => {
    for (const body of [undefined, null, {}]) {
      const { deps, starts } = triggerDeps();
      const { asked, result } = trigger(deps, body);
      expect(await result).toEqual({ ok: true, value: RUNNING });
      expect(asked).toEqual([[{ permission: 'system.export', entityType: 'site-export' }]]);
      expect(starts).toEqual([[{ clean: false, actorId: 'p1' }, { basePath: undefined }]]);
    }
  });

  it('passes clean and a non-blank basePath; a blank basePath is omitted', async () => {
    const { deps, starts } = triggerDeps();
    await trigger(deps, { clean: true, basePath: '/docs' }).result;
    await trigger(deps, { clean: false, basePath: '   ' }).result;
    expect(starts).toEqual([[{ clean: true, actorId: 'p1' }, { basePath: '/docs' }], [{ clean: false, actorId: 'p1' }, { basePath: undefined }]]);
  });

  it.each([
    [[1], 'request body must be a JSON object'],
    ['text', 'request body must be a JSON object'],
    [{ clean: 'yes' }, "'clean' must be a boolean"],
    [{ clean: true, basePath: 3 }, "'basePath' must be a string"],
    [{ clean: 1, basePath: 3 }, "'clean' must be a boolean"],
  ])('refuses %j with a flat 400 and starts nothing', async (body, error) => {
    const { deps, starts } = triggerDeps();
    expect(await refusalOf(trigger(deps, body).result)).toEqual({ status: 400, body: { error } });
    expect(starts).toEqual([]);
  });

  it('a second trigger while one is running is a 409 carrying the running snapshot, checked before the body', async () => {
    const { deps, starts } = triggerDeps({ getRunSnapshot: () => RUNNING });
    expect(await refusalOf(trigger(deps, { clean: 'bad' }).result)).toEqual({ status: 409, body: { error: 'an export is already running', run: RUNNING } });
    expect(starts).toEqual([]);
  });

  it('a refused authorization starts nothing and reads no run state', async () => {
    let reads = 0;
    const { deps, starts } = triggerDeps({ getRunSnapshot: () => { reads++; return IDLE; } });
    await refusalOf(trigger(deps, {}, { deny: true }).result);
    expect([reads, starts.length]).toEqual([0, 0]);
  });

  it('fails closed without an authorizer or a principal', async () => {
    const { deps, starts } = triggerDeps();
    await expect(trigger(deps, {}, { noAuthorizer: true }).result).rejects.toThrow(/no authorizer/);
    await expect(trigger(deps, {}, { noPrincipal: true }).result).rejects.toThrow(/no authenticated principal/);
    expect(starts).toEqual([]);
  });

  it('rethrows an unexpected start failure unchanged', async () => {
    const { deps } = triggerDeps({ startRun: () => { throw new Error('disk gone'); } });
    await expect(trigger(deps, {}).result).rejects.toThrow('disk gone');
  });
});

describe('exportSiteStatusRoute', () => {
  function status(deps: ExportSiteStatusRouteDeps, { deny = false } = {}) {
    const asked: unknown[] = [];
    const authorize = async (...args: unknown[]) => { asked.push(args); if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } }); };
    const parsed = exportSiteStatusRoute.parse({ body: {}, query: {}, params: { workspaceId: 'ws' } });
    if (!parsed.ok) throw new Error('parse must be total');
    return { asked, result: Promise.resolve(exportSiteStatusRoute.handle({ input: parsed.value, deps, context: { id: 'p1' }, authorize }, {})) };
  }

  it('pins method and path', () => {
    expect(exportSiteStatusRoute.method).toBe('get');
    expect(exportSiteStatusRoute.path).toBe('/api/admin/v1/workspaces/:workspaceId/system/export');
    expect(exportSiteStatusRoute.successStatus).toBeUndefined();
  });

  it('authorizes system.read on site-export and answers the current snapshot', async () => {
    const { asked, result } = status({ workspaceId: 'ws', getRunSnapshot: () => RUNNING });
    expect(await result).toEqual({ ok: true, value: RUNNING });
    expect(asked).toEqual([[{ permission: 'system.read', entityType: 'site-export' }]]);
  });

  it('a refused authorization reads no run state', async () => {
    let reads = 0;
    await refusalOf(status({ workspaceId: 'ws', getRunSnapshot: () => { reads++; return IDLE; } }, { deny: true }).result);
    expect(reads).toBe(0);
  });
});
