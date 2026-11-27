import { describe, expect, it } from 'vitest';
import { isRouteReply, type JsonRouteSpec, type RouteReply } from '@jini-ai/core/contracts/server';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import { dockerfileReadRoute, dockerfileWriteRoute, type DockerfileSourcePrincipal, type DockerfileSourceRouteDeps, type DockerfileSourceSnapshot, type DockerfileWriteResult } from '../dockerfile-source.js';

const SNAPSHOT: DockerfileSourceSnapshot = { exists: true, contents: 'FROM node', etag: '"abc"' };
const CURRENT: DockerfileSourceSnapshot = { exists: true, contents: 'FROM bun', etag: '"cur"' };

function makeDeps(overrides: Partial<DockerfileSourceRouteDeps> = {}) {
  const log: string[] = [];
  const deps: DockerfileSourceRouteDeps = {
    read: () => { log.push('read'); return SNAPSHOT; },
    writeWithIfMatch: ({ contents, ifMatch }): DockerfileWriteResult => { log.push(`write:${contents}:${ifMatch}`); return { ok: true, snapshot: { exists: true, contents, etag: '"new"' } }; },
    ...overrides,
  };
  return { deps, log };
}

async function run(spec: JsonRouteSpec<any, RouteReply<any>, DockerfileSourceRouteDeps, DockerfileSourcePrincipal>, deps: DockerfileSourceRouteDeps, raw: { body?: unknown; headers?: Record<string, string> } = {}, { deny = false } = {}) {
  const asked: unknown[] = [];
  const authorize = async (...args: unknown[]) => { asked.push(args); if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } }); };
  const parsed = spec.parse({ body: 'body' in raw ? raw.body : {}, query: {}, params: { workspaceId: 'ws' }, ...(raw.headers ? { headers: raw.headers } : {}) });
  if (!parsed.ok) throw new Error('parse must be total');
  const result = await spec.handle({ input: parsed.value, deps, context: { id: 'p1' }, authorize }, {});
  if (!result.ok) throw new Error('handle never returns an error result');
  expect(isRouteReply(result.value)).toBe(true);
  return { asked, reply: result.value };
}

describe('dockerfile source routes', () => {
  it('pins method, path and no body cap', () => {
    expect([dockerfileReadRoute.method, dockerfileReadRoute.path]).toEqual(['get', '/api/admin/v1/workspaces/:workspaceId/system/dockerfile']);
    expect([dockerfileWriteRoute.method, dockerfileWriteRoute.path]).toEqual(['put', '/api/admin/v1/workspaces/:workspaceId/system/dockerfile']);
    expect(dockerfileWriteRoute.maxBodyBytes).toBeUndefined();
  });

  it('GET authorizes system.read on dockerfile-source, then answers {exists, contents} with the snapshot etag in the ETag header only', async () => {
    const { deps } = makeDeps();
    const { asked, reply } = await run(dockerfileReadRoute, deps);
    expect(asked).toEqual([[{ permission: 'system.read', entityType: 'dockerfile-source' }]]);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ exists: true, contents: 'FROM node' });
    expect(reply.headers).toEqual({ ETag: '"abc"' });
  });

  it('GET reads nothing when authorization is denied', async () => {
    const { deps, log } = makeDeps();
    await expect(run(dockerfileReadRoute, deps, {}, { deny: true })).rejects.toBeInstanceOf(RouteRefusalError);
    expect(log).toEqual([]);
  });

  it('PUT authorizes system.write before it looks at the If-Match header or the body', async () => {
    const { deps, log } = makeDeps();
    await expect(run(dockerfileWriteRoute, deps, { body: 'x' }, { deny: true })).rejects.toBeInstanceOf(RouteRefusalError);
    expect(log).toEqual([]);
    const { asked } = await run(dockerfileWriteRoute, deps, { body: { contents: 'a' }, headers: { 'if-match': '"abc"' } });
    expect(asked).toEqual([[{ permission: 'system.write', entityType: 'dockerfile-source' }]]);
  });

  it('PUT with no If-Match is a 400 naming the header, even when the body is also malformed, and never writes', async () => {
    const { deps, log } = makeDeps();
    const { reply } = await run(dockerfileWriteRoute, deps, { body: 'not-an-object' });
    expect(reply.status).toBe(400);
    expect((reply.body as { error: string }).error).toMatch(/^the 'If-Match' header is required on PUT/);
    expect((reply.body as { error: string }).error).toContain('Terra audit finding C5, 2026-08-15');
    expect(log).toEqual([]);
  });

  it('PUT with an empty If-Match is the same 400 as an absent one', async () => {
    const { deps, log } = makeDeps();
    const { reply } = await run(dockerfileWriteRoute, deps, { body: { contents: 'a' }, headers: { 'if-match': '' } });
    expect(reply.status).toBe(400);
    expect(log).toEqual([]);
  });

  it('PUT refuses a body that is not a JSON object, or lacks string contents, as a 400 before any write', async () => {
    const { deps, log } = makeDeps();
    const headers = { 'if-match': '"abc"' };
    for (const body of [['contents'], null, 'x', 3]) {
      expect((await run(dockerfileWriteRoute, deps, { body, headers })).reply).toMatchObject({ status: 400, body: { error: 'request body must be a JSON object' } });
    }
    for (const body of [{}, { contents: 5 }]) {
      expect((await run(dockerfileWriteRoute, deps, { body, headers })).reply).toMatchObject({ status: 400, body: { error: "'contents' (string) is required" } });
    }
    expect(log).toEqual([]);
  });

  it('PUT writes the contents against the If-Match value and answers the new snapshot with its ETag', async () => {
    const { deps, log } = makeDeps();
    const { reply } = await run(dockerfileWriteRoute, deps, { body: { contents: 'FROM deno', extra: 1 }, headers: { 'if-match': '"abc"' } });
    expect(log).toEqual(['write:FROM deno:"abc"']);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ exists: true, contents: 'FROM deno' });
    expect(reply.headers).toEqual({ ETag: '"new"' });
  });

  it('PUT with a stale If-Match is a 412 carrying the CURRENT {exists, contents} and the current ETag', async () => {
    const { deps } = makeDeps({ writeWithIfMatch: () => ({ ok: false, current: CURRENT }) });
    const { reply } = await run(dockerfileWriteRoute, deps, { body: { contents: 'a' }, headers: { 'if-match': '"abc"' } });
    expect(reply.status).toBe(412);
    expect(reply.headers).toEqual({ ETag: '"cur"' });
    expect(reply.body).toMatchObject({ code: 'DOCKERFILE_CONFLICT', current: { exists: true, contents: 'FROM bun' } });
    expect(JSON.stringify(reply.body)).not.toContain('"cur"');
    expect((reply.body as { error: string }).error).toMatch(/^the Dockerfile changed on the server since your 'If-Match' value was read/);
  });
});

it('fails closed before reading the Dockerfile when no authorizer is bound', async () => {
  const { deps, log } = makeDeps();
  await expect(dockerfileReadRoute.handle({ input: {}, deps })).rejects.toThrow('dockerfile-source route has no authorizer');
  expect(log).toEqual([]);
});
