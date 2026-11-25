import { describe, expect, it } from 'vitest';
import type { RouteBodyRead } from '@jini-ai/core/contracts/server';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import {
  SiteShareUploadRefusal, siteShareAcknowledgeRoute, siteShareArtifactDeleteRoute, siteShareArtifactUploadRoute, siteShareCreateRoute,
  siteShareListRoute, siteShareRevokeRoute, siteShareStaticCreateRoute, siteShareStaticOptionsRoute,
  type SiteShareFailureArgs, type SiteShareRoute, type SiteShareRouteDeps,
} from '../site-shares.js';

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]);

function harness({ trusted = false, available = true, allowed = true, read = { ok: true, value: ZIP } as RouteBodyRead<unknown> } = {}) {
  const calls: unknown[] = [], failures: SiteShareFailureArgs[] = [], permissions: string[] = [];
  const backend = {
    list: async (): Promise<unknown[]> => ['row'], create: async (input: Record<string, unknown>) => ({ ...input, signal: input.signal instanceof AbortSignal }),
    staticOptions: async () => ({ themes: [] }), acknowledge: async (input: { shareId: string }) => input, revoke: async (input: { shareId: string }) => input,
  };
  const deps: SiteShareRouteDeps = {
    workspaceId: 'ws', maxArchiveBytes: 10,
    backend: () => (available ? backend : undefined),
    isPublishTrusted: () => trusted,
    readCreateInput: ({ body }) => ({ body }),
    readStaticInput: ({ body }) => ({ static: body }),
    isArtifactIdentity: ({ token }) => token === 'good',
    invalidArtifact: () => new Error('invalid artifact'),
    receiveArtifact: async ({ token, file, archive }) => { calls.push(['receive', token, file, archive.length]); return { shareId: 's', bytes: archive.length, sha256: 'h', extra: 1 } as never; },
    removeArtifact: async ({ token }) => token === 'good',
    failureReply: (args) => { failures.push(args); return { status: 599, body: { step: args.step } }; },
  };
  const authorize = async ({ permission }: { permission: string }) => {
    permissions.push(permission);
    if (!allowed) throw new RouteRefusalError({ status: 403, body: { denied: true } });
  };
  const run = async (spec: SiteShareRoute, { params = {}, body, anonymous = false }: { params?: Record<string, string>; body?: unknown; anonymous?: boolean } = {}) => {
    const context = anonymous ? undefined : { id: 'owner' };
    const raw = { params, query: {}, headers: {}, body, readBody: async () => read } as never;
    const response = await spec.handle({ raw, deps, context, authorize: authorize as never }, { signal: new AbortController().signal });
    return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
  };
  return { run, calls, failures, permissions, deps, backend };
}

describe('site-share specs', () => {
  it('declare the pinned paths, methods and the no-store header', () => {
    const table = [siteShareListRoute, siteShareCreateRoute, siteShareStaticOptionsRoute, siteShareStaticCreateRoute, siteShareAcknowledgeRoute, siteShareRevokeRoute, siteShareArtifactUploadRoute, siteShareArtifactDeleteRoute]
      .map((spec) => `${spec.method} ${spec.path.replace('/api/admin/v1/workspaces/:workspaceId/site-shares', '~')}`);
    expect(table).toEqual(['get ~', 'post ~', 'get ~/static/options', 'post ~/static', 'post ~/:shareId/acknowledge', 'delete ~/:shareId', 'put ~/artifacts/:token/:file', 'delete ~/artifacts/:token/:file']);
    expect(siteShareListRoute.responseHeaders).toEqual({ 'Cache-Control': 'no-store' });
  });

  it('answer each admin operation from the backend', async () => {
    const { run, permissions } = harness();
    expect(JSON.parse((await run(siteShareListRoute)).text)).toEqual({ shares: ['row'], expiryChoices: [null] });
    expect(JSON.parse((await run(siteShareCreateRoute, { body: { jobId: 'j' } })).text)).toEqual({ principalId: 'owner', signal: true, body: { jobId: 'j' } });
    expect(JSON.parse((await run(siteShareStaticOptionsRoute)).text)).toEqual({ themes: [] });
    expect(JSON.parse((await run(siteShareStaticCreateRoute, { body: 'b' })).text)).toEqual({ principalId: 'owner', signal: true, format: 'static', static: 'b' });
    expect(JSON.parse((await run(siteShareAcknowledgeRoute, { params: { shareId: 'x' } })).text)).toEqual({ shareId: 'x' });
    expect(JSON.parse((await run(siteShareRevokeRoute, { params: { shareId: 'y' } })).text)).toEqual({ shareId: 'y' });
    expect(permissions.every((permission) => permission === 'site-backup.push')).toBe(true);
  });

  it('refuse a connected computer on admin operations but authorize it by publish permission on artifacts', async () => {
    const { run, permissions } = harness({ trusted: true });
    expect(await run(siteShareListRoute)).toEqual({ status: 403, type: 'application/json; charset=utf-8', text: JSON.stringify({ code: 'FORBIDDEN', message: 'Export history requires an authorized admin session.' }) });
    expect((await run(siteShareArtifactUploadRoute, { params: { token: 'good', file: 'f' } })).status).toBe(201);
    expect(permissions).toEqual(['publish_content.apply']);
  });

  it('let the mount write an RBAC denial, then answer the missing backend with 503', async () => {
    await expect(harness({ allowed: false }).run(siteShareRevokeRoute)).rejects.toBeInstanceOf(RouteRefusalError);
    const missing = await harness({ available: false }).run(siteShareArtifactDeleteRoute);
    expect(missing.status).toBe(503);
    expect(JSON.parse(missing.text)).toEqual({ code: 'UNAVAILABLE', message: 'Share artifact deletion requires a site folder and private artifact storage.' });
  });

  it('hand every other failure to the host with the step and request facts', async () => {
    const { run, failures } = harness();
    expect((await run(siteShareCreateRoute, { anonymous: true })).status).toBe(599);
    expect(failures[0]).toMatchObject({ step: 'Export creation', method: 'POST', path: siteShareCreateRoute.path, authenticated: false });
  });

  it('upload: validates identity and ZIP bytes after reading the body, maps parser refusals, keeps a pre-read buffer', async () => {
    const ok = harness();
    expect(await ok.run(siteShareArtifactUploadRoute, { params: { token: 'good', file: 'f' } })).toEqual({ status: 201, type: 'application/json; charset=utf-8', text: JSON.stringify({ shareId: 's', bytes: 6, sha256: 'h' }) });
    const bad = harness();
    await bad.run(siteShareArtifactUploadRoute, { params: { token: 'bad', file: 'f' } });
    expect((bad.failures[0]?.error as Error).message).toBe('invalid artifact');
    const tooLarge = harness({ read: { ok: false, refusal: { reason: 'too-large', limit: 10 } } });
    await tooLarge.run(siteShareArtifactUploadRoute, { params: { token: 'good', file: 'f' } });
    expect(tooLarge.failures[0]?.error).toBeInstanceOf(SiteShareUploadRefusal);
    const preRead = harness({ read: { ok: false, refusal: { reason: 'media-type' } } });
    expect((await preRead.run(siteShareArtifactUploadRoute, { params: { token: 'good', file: 'f' }, body: ZIP })).status).toBe(201);
    const notZip = harness({ read: { ok: true, value: new Uint8Array([1, 2, 3, 4]) } });
    await notZip.run(siteShareArtifactUploadRoute, { params: { token: 'good', file: 'f' } });
    expect((notZip.failures[0]?.error as Error).message).toBe('invalid artifact');
  });

  it('artifact deletion: 404 for an unknown artifact, bodiless 204 once removed', async () => {
    const { run } = harness();
    expect(JSON.parse((await run(siteShareArtifactDeleteRoute, { params: { token: 'nope', file: 'f' } })).text)).toEqual({ code: 'NOT_FOUND', message: 'Share artifact deletion failed: this export was not found.' });
    expect(await run(siteShareArtifactDeleteRoute, { params: { token: 'good', file: 'f' } })).toEqual({ status: 204, type: null, text: '' });
  });
});

it('no expiry by default', async () => {
  const h = harness();
  h.deps.readCreateInput = () => ({});
  h.deps.readStaticInput = () => ({});
  expect(JSON.parse((await h.run(siteShareCreateRoute)).text)).toEqual({ principalId: 'owner', signal: true });
  expect(JSON.parse((await h.run(siteShareStaticCreateRoute)).text)).toEqual({ principalId: 'owner', signal: true, format: 'static' });
});
it('list passes a row with url:null and no storage through unchanged', async () => {
  const h = harness();
  const row = { shareId: 'peer', url: null };
  h.backend.list = async () => [row];
  expect(JSON.parse((await h.run(siteShareListRoute)).text)).toEqual({ shares: [row], expiryChoices: [null] });
});
it('list answers expiryChoices with Never first', async () => {
  const h = harness();
  Object.assign(h.backend, { expiryChoices: async () => [7, 30, 90] });
  expect(JSON.parse((await h.run(siteShareListRoute)).text)).toEqual({ shares: ['row'], expiryChoices: [null, 7, 30, 90] });
});
it('list keeps Never the only default when the host offers nothing usable', async () => {
  const h = harness();
  Object.assign(h.backend, { expiryChoices: async () => [null, 0, -7, 1.5, 30] });
  expect(JSON.parse((await h.run(siteShareListRoute)).text)).toEqual({ shares: ['row'], expiryChoices: [null, 30] });
  Object.assign(h.backend, { expiryChoices: async () => [] });
  expect(JSON.parse((await h.run(siteShareListRoute)).text)).toEqual({ shares: ['row'], expiryChoices: [null] });
});
it('poll cannot revise the initial choice', async () => {
  const h = harness();
  h.deps.readCreateInput = () => ({ expiresInDays: 7 });
  expect(JSON.parse((await h.run(siteShareCreateRoute)).text)).toEqual({ principalId: 'owner', signal: true, expiresInDays: 7 });
  h.deps.readStaticInput = () => ({ expiresInDays: 90 });
  expect(JSON.parse((await h.run(siteShareStaticCreateRoute)).text)).toEqual({ principalId: 'owner', signal: true, format: 'static', expiresInDays: 90 });
  h.deps.readCreateInput = () => ({ jobId: 'j', expiresInDays: 30 });
  expect(JSON.parse((await h.run(siteShareCreateRoute)).text)).toEqual({ principalId: 'owner', signal: true, jobId: 'j' });
});
