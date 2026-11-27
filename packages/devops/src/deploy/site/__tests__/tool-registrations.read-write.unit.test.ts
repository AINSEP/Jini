import { ToolInputError, type ToolExecutionContext } from '@jini-ai/core';
import { expect, it, vi } from 'vitest';
import { buildDeploymentsRegistrations, contributeDeploymentsTools, pickExportSiteOptions, type DeploymentsToolDeps } from '../tool-registrations.js';
import { createExportRunner } from '../export-run.js';

function fixture() {
  const runner = createExportRunner({ describeError: ({ error }) => String(error) });
  let file = { contents: 'FROM scratch\n', etag: '"original"', exists: true };
  const requireToolPermission = vi.fn<DeploymentsToolDeps['requireToolPermission']>().mockResolvedValue(undefined);
  const writeDockerfileSourceWithIfMatch = vi.fn<DeploymentsToolDeps['writeDockerfileSourceWithIfMatch']>(({ contents, ifMatch }) => {
    if (ifMatch !== file.etag) return { ok: false, reason: 'conflict', current: file };
    file = { contents, etag: '"updated"', exists: true };
    return { ok: true, snapshot: file };
  });
  const exportSiteBound = vi.fn<DeploymentsToolDeps['exportSiteBound']>(async () => ({
    routes: { succeeded: ['/'], failed: [{ path: '/pricing', kind: 'page', reason: 'render error' }] },
    assets: { succeeded: ['theme.css'], failed: [] }, skippedManifestEntries: [], unreferencedThemeFiles: [], droppedReferences: [],
  }));
  const deps: DeploymentsToolDeps = { ...runner, requireToolPermission, exportSiteBound,
    readDockerfileSource: () => file, writeDockerfileSourceWithIfMatch, workspaceId: 'workspace-7',
    authorize: async () => ({ allowed: true, reason: 'allowed' }), clock: { nowMs: () => 0 }, exportOutputRootDir: '/not-used' };
  const tool = (id: string) => {
    const registration = buildDeploymentsRegistrations(deps).find(item => item.descriptor.id === id);
    if (!registration) throw new Error(`Missing deployment registration: ${id}`);
    return registration.handler;
  };
  const ctx = (input: unknown, signal = new AbortController().signal): ToolExecutionContext =>
    ({ executionId: 'req-7', principal: { id: 'operator' }, run: { id: 'run' }, input, signal });
  return { deps, tool, ctx, requireToolPermission, exportSiteBound, writeDockerfileSourceWithIfMatch };
}

it('reports idle export status and runs diagnosis without changing that status', async () => {
  const f = fixture();
  const status = f.tool('deployment_get_export_status');
  const idle = { status: 'idle', outputDir: null, startedAtIso: null, finishedAtIso: null };
  expect(await status(f.ctx({}))).toEqual(idle);
  expect(await f.tool('deployment_diagnose_static_export')(f.ctx({}))).toMatchObject({
    ok: false, counts: { routesSucceeded: 1, routesFailed: 1, assetsSucceeded: 1, assetsFailed: 0 },
    failedRoutes: [{ path: '/pricing', kind: 'page', reason: 'render error' }],
  });
  expect(await status(f.ctx({}))).toEqual(idle);
  expect(f.requireToolPermission.mock.calls).toEqual(Array.from({ length: 3 }, () => [
    { authorize: expect.any(Function), workspaceId: 'workspace-7', principalId: 'operator', permission: 'system.read' }, { entityType: 'site-export' },
  ]));
  expect(f.exportSiteBound).toHaveBeenCalledExactlyOnceWith({ outputDir: expect.stringMatching(/static-export-diagnostics-/), clean: false });
});

it('a stale Dockerfile write returns current bytes and a fresh etag, which can be used to retry', async () => {
  const f = fixture();
  const read = f.tool('deployment_get_dockerfile');
  const write = f.tool('deployment_set_dockerfile');
  const before = { contents: 'FROM scratch\n', etag: '"original"', exists: true };
  const replacement = { contents: 'FROM alpine\n', etag: '"updated"', exists: true };
  expect(await read(f.ctx({}))).toEqual(before);
  await expect(write(f.ctx({ contents: replacement.contents, ifMatch: 'stale' }))).rejects.toMatchObject({
    constructor: ToolInputError,
    message: expect.stringMatching(/current etag is now '"original"'.*\n\nFROM scratch\n\n\nReconcile/),
  });
  expect(await read(f.ctx({}))).toEqual(before);
  expect(await write(f.ctx({ contents: replacement.contents, ifMatch: '"original"' }))).toEqual(replacement);
  expect(await read(f.ctx({}))).toEqual(replacement);
  expect(f.writeDockerfileSourceWithIfMatch.mock.calls).toEqual([
    [{ contents: 'FROM alpine\n', ifMatch: 'stale' }], [{ contents: 'FROM alpine\n', ifMatch: '"original"' }],
  ]);
  expect(f.requireToolPermission.mock.calls).toEqual(['system.read', 'system.write', 'system.read', 'system.write', 'system.read'].map(permission => [
    { authorize: expect.any(Function), workspaceId: 'workspace-7', principalId: 'operator', permission }, { entityType: 'dockerfile-source' },
  ]));
});

it('an aborted Dockerfile request never writes even with a current etag', async () => {
  const f = fixture();
  const cause = new Error('caller disconnected');
  const input = { contents: 'FROM alpine\n', ifMatch: '"original"' };
  await expect(f.tool('deployment_set_dockerfile')(f.ctx(input, AbortSignal.abort(cause)))).rejects.toBe(cause);
  expect(f.writeDockerfileSourceWithIfMatch).not.toHaveBeenCalled();
});

it('omits unset export options and exposes independently classified deployment tools', () => {
  expect(pickExportSiteOptions({ outputDir: '/export', clean: undefined, basePath: undefined })).toEqual({ outputDir: '/export' });
  expect(pickExportSiteOptions({ outputDir: '/export', clean: false, basePath: '' })).toEqual({ outputDir: '/export', clean: false, basePath: '' });
  const contribution = contributeDeploymentsTools();
  expect(contribution.domain).toBe('deployments');
  expect(Object.fromEntries(contribution.risk)).toEqual({
    deployment_trigger_export: 'mutates-durable-state', deployment_get_export_status: 'none', deployment_diagnose_static_export: 'none',
    deployment_get_dockerfile: 'none', deployment_set_dockerfile: 'mutates-durable-state',
  });
});
