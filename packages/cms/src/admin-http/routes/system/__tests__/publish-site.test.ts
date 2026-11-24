import { describe, expect, it } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import { publishPreviewRoute, type PublishPreviewRouteDeps } from '../publish-site/preview.js';
import { publishStatusRoute } from '../publish-site/status.js';
import { publishTargetsRoute } from '../publish-site/targets.js';

type AnyRoute = typeof publishStatusRoute | typeof publishTargetsRoute | typeof publishPreviewRoute;

function run(route: AnyRoute, deps: unknown, { query = {}, deny = false, noAuthorizer = false }: { query?: Record<string, unknown>; deny?: boolean; noAuthorizer?: boolean } = {}) {
  const asked: unknown[] = [];
  const authorize = async (...args: unknown[]) => { asked.push(args); if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } }); };
  const parsed = route.parse({ body: {}, query, params: { workspaceId: 'ws' } } as never);
  if (!parsed.ok) throw new Error('parse must be total');
  const handle = route.handle as (a: unknown, o: unknown) => unknown;
  return { asked, result: Promise.resolve(handle({ input: parsed.value, deps, context: { id: 'p1' }, ...(noAuthorizer ? {} : { authorize }) }, {})) };
}

async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(RouteRefusalError);
  return (error as RouteRefusalError).response;
}

describe('publish-site specs: method, path, status', () => {
  it.each([
    [publishStatusRoute, '/api/admin/v1/workspaces/:workspaceId/system/publish'],
    [publishTargetsRoute, '/api/admin/v1/workspaces/:workspaceId/system/publish-targets'],
    [publishPreviewRoute, '/api/admin/v1/workspaces/:workspaceId/system/publish/preview'],
  ])('%#: GET %s, 200, no body cap', (route, path) => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(['get', path, undefined, undefined]);
  });
});

describe('publishStatusRoute', () => {
  it('authorizes system.publish on site-publish and answers the run snapshot', async () => {
    const { asked, result } = run(publishStatusRoute, { workspaceId: 'ws', getRunSnapshot: () => ({ status: 'idle' }) });
    expect(await result).toEqual({ ok: true, value: { status: 'idle' } });
    expect(asked).toEqual([[{ permission: 'system.publish', entityType: 'site-publish' }]]);
  });
  it('a refusal reads nothing; no authorizer fails closed', async () => {
    let reads = 0;
    const deps = { workspaceId: 'ws', getRunSnapshot: () => { reads++; return { status: 'idle' }; } };
    await refusalOf(run(publishStatusRoute, deps, { deny: true }).result);
    await expect(run(publishStatusRoute, deps, { noAuthorizer: true }).result).rejects.toThrow(/no authorizer/);
    expect(reads).toBe(0);
  });
});

describe('publishTargetsRoute', () => {
  it('authorizes system.read on site-publish and wraps the injected descriptors in { targets }', async () => {
    const { asked, result } = run(publishTargetsRoute, { workspaceId: 'ws', listTargets: async () => [{ id: 'a' }] });
    expect(await result).toEqual({ ok: true, value: { targets: [{ id: 'a' }] } });
    expect(asked).toEqual([[{ permission: 'system.read', entityType: 'site-publish' }]]);
  });
  it('rethrows a registry failure unchanged', async () => {
    await expect(run(publishTargetsRoute, { workspaceId: 'ws', listTargets: async () => { throw new Error('registry gone'); } }).result).rejects.toThrow('registry gone');
  });
});

describe('publishPreviewRoute', () => {
  const deps = (previewPublish: PublishPreviewRouteDeps['previewPublish']): PublishPreviewRouteDeps => ({ workspaceId: 'ws', previewPublish });

  it('passes the query through and answers the preview', async () => {
    const seen: unknown[] = [];
    const { asked, result } = run(publishPreviewRoute, deps(async ({ query }) => { seen.push(query); return { ok: true, value: { target: 't' } }; }), { query: { target: 't', projectName: 'p' } });
    expect(await result).toEqual({ ok: true, value: { target: 't' } });
    expect(seen).toEqual([{ target: 't', projectName: 'p' }]);
    expect(asked).toEqual([[{ permission: 'system.read', entityType: 'site-publish' }]]);
  });
  it('a malformed query is a flat 400 with the host message', async () => {
    expect(await refusalOf(run(publishPreviewRoute, deps(async () => ({ ok: false, error: "'target' query param (non-empty string) is required" }))).result))
      .toEqual({ status: 400, body: { error: "'target' query param (non-empty string) is required" } });
  });
  it('a provider input rejection is a 400 PROVIDER_INSPECTION_FAILED', async () => {
    expect(await refusalOf(run(publishPreviewRoute, deps(async () => { throw new ToolInputError({ message: 'stale connection' }); })).result))
      .toEqual({ status: 400, body: { error: 'stale connection', code: 'PROVIDER_INSPECTION_FAILED' } });
  });
  it('anything else is rethrown unchanged; a refusal previews nothing', async () => {
    await expect(run(publishPreviewRoute, deps(async () => { throw new Error('db gone'); })).result).rejects.toThrow('db gone');
    let calls = 0;
    await refusalOf(run(publishPreviewRoute, deps(async () => { calls++; return { ok: true, value: {} }; }), { deny: true }).result);
    expect(calls).toBe(0);
  });
});
