import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDiskAttachmentStore } from '../../disk-attachment-store.js';
import { type AttachmentStore } from '../../attachment-store-types.js';
import { HARNESS_BEARER_TOKEN, startRouteHarness, type RouteHarness } from './harness.js';
import { probe } from './probes.js';

/**
 * Three things a route never states but a caller can depend on, recorded from today's code:
 * which spellings of a path reach a route, what each query-reading route makes of a repeated,
 * bracketed, nested or empty value, and which state two mounts of the same route group share
 * (none).
 */

describe('path matching', () => {
  let harness: RouteHarness;
  beforeAll(async () => { harness = await startRouteHarness(); });
  afterAll(async () => { await harness.close(); });

  // With every dependency throwing, a request that reaches the agent list answers this.
  const REACHED = '500 INTERNAL_ERROR';

  it('GET /api/agents reaches the route (the baseline the rows below are compared with)', async () => {
    expect((await probe({ harness, route: 'GET /api/agents' })).summary).toBe(REACHED);
  });

  it('HEAD on a GET route runs the route and answers its status and headers with no body', async () => {
    const answer = await probe({ harness, route: 'HEAD /api/agents' });
    expect(answer.status).toBe(500);
    expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(answer.text).toBe('');
  });

  it.each([
    ['a trailing slash', 'GET /api/agents/'],
    ['another letter case', 'GET /API/Agents'],
    ['a trailing slash after a parameter', 'GET /api/runs/x1/'],
  ])('%s still reaches the route', async (_label, route) => {
    expect((await probe({ harness, route })).summary).toBe(REACHED);
  });

  it.each([
    ['GET /api/runs/%E0%A4%A/events'],
    ['GET /api/runs/%E0%A4%A'],
  ])('a parameter that is not valid percent-encoding (%s) is refused by the framework with its own 400 page', async (route) => {
    const answer = await probe({ harness, route });
    expect(answer.status).toBe(400);
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it.each([
    ['OPTIONS /api/agents', 'GET,HEAD'],
    ['OPTIONS /api/agents/rescan', 'POST'],
  ])('%s is answered by the framework: 200 with Allow: %s', async (route, allow) => {
    const answer = await probe({ harness, route });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('allow')).toBe(allow);
    expect(answer.text).toBe(allow);
  });

  it.each([
    ['a method the path does not have', 'PUT /api/agents'],
    ['a doubled slash', 'GET /api//agents'],
  ])('%s matches nothing and gets the framework 404 page', async (_label, route) => {
    const answer = await probe({ harness, route });
    expect(answer.status).toBe(404);
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });
});

describe('query shapes, per route that reads a query value', () => {
  let harness: RouteHarness;
  beforeAll(async () => { harness = await startRouteHarness(); });
  afterAll(async () => { await harness.close(); });

  // `reads`: the value was accepted and the route went on to its (throwing) dependency.
  // `refuses`: the route's own input check answered 400.
  const ANSWER = { reads: '500 INTERNAL_ERROR', refuses: '400 BAD_REQUEST' } as const;
  type Verdict = keyof typeof ANSWER;
  type Row = readonly [path: string, key: string, value: string, single: Verdict, repeated: Verdict, bracket: Verdict, nested: Verdict, empty: Verdict, absent: Verdict, fixed?: string];

  const rows: readonly Row[] = [
    //  path                        key            value       k=v        k=v&k=v    k[]=v      k[b]=v     k=         (no k)
    ['/api/runs',                 'contextRef',  'ctx',      'reads',   'refuses', 'refuses', 'refuses', 'refuses', 'reads'],
    ['/api/terminals',            'resourceRef', 'res',      'reads',   'refuses', 'refuses', 'refuses', 'refuses', 'reads'],
    ['/api/routines/x1/runs',     'limit',       '5',        'reads',   'reads',   'reads',   'reads',   'reads',   'reads'],
    ['/api/routines/x1/runs',     'cursor',      'c1',       'reads',   'reads',   'reads',   'refuses', 'refuses', 'reads'],
    ['/api/connectors/storage',   'prefix',      'p',        'reads',   'reads',   'reads',   'reads',   'reads',   'reads'],
    ['/api/connectors/db/x1',     'where',       '{"a":1}',  'reads',   'reads',   'reads',   'reads',   'refuses', 'reads'],
    ['/api/media/tasks',          'ownerRef',    'o1',       'reads',   'reads',   'reads',   'refuses', 'refuses', 'refuses'],
    ['/api/tools/search',         'q',           'find',     'reads',   'refuses', 'refuses', 'refuses', 'refuses', 'refuses'],
    ['/api/tools/search',         'limit',       '3',        'reads',   'refuses', 'refuses', 'refuses', 'refuses', 'reads', 'q=find&'],
    ['/api/components/search',    'q',           'find',     'reads',   'refuses', 'refuses', 'refuses', 'refuses', 'refuses'],
    ['/internal/tool-catalog',    'principalId', 'p1',       'reads',   'refuses', 'refuses', 'refuses', 'refuses', 'refuses'],
  ];

  it.each(rows.map((row) => [row[0], row[1], row] as const))('%s reads %s', async (path, key, row) => {
    const [, , value, single, repeated, bracket, nested, empty, absent, fixed = ''] = row;
    const v = encodeURIComponent(value);
    const shapes: Record<string, [string, Verdict]> = {
      single: [`${key}=${v}`, single], repeated: [`${key}=${v}&${key}=${v}`, repeated], bracket: [`${key}[]=${v}`, bracket],
      nested: [`${key}[b]=${v}`, nested], empty: [`${key}=`, empty], absent: ['', absent],
    };
    const seen: Record<string, string> = {};
    const expected: Record<string, string> = {};
    for (const [shape, [query, verdict]] of Object.entries(shapes)) {
      seen[shape] = (await probe({ harness, route: `GET ${path}?${fixed}${query}` }, { headers: { authorization: `Bearer ${HARNESS_BEARER_TOKEN}` } })).summary;
      expected[shape] = ANSWER[verdict];
    }
    expect(seen).toEqual(expected);
  });
});

describe('state is per mount: two mounts of the same route group share nothing', () => {
  it('the active context set through one mount is not visible through another', async () => {
    const deps = { 'active-context': { now: () => 1_000, resolveResource: () => ({ name: 'Resource one' }) } };
    const first = await startRouteHarness({}, { familyDeps: deps });
    const second = await startRouteHarness({}, { familyDeps: deps });
    try {
      const set = await probe({ harness: first, route: 'POST /api/active' }, { body: JSON.stringify({ resourceRef: 'resource-1' }) });
      expect(set.json).toEqual({ active: true, resourceRef: 'resource-1', detail: null, ts: 1_000 });
      expect((await probe({ harness: first, route: 'GET /api/active' })).json).toEqual({ active: true, resourceRef: 'resource-1', resourceName: 'Resource one', detail: null, ts: 1_000, ageMs: 0 });
      expect((await probe({ harness: second, route: 'GET /api/active' })).json).toEqual({ active: false });
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('an upload in progress on one mount does not use up the upload slots of another, even over the same store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jini-upload-isolation-'));
    const disk = await createDiskAttachmentStore({ uploadDirectory: root });
    let letThrough: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { letThrough = resolve; });
    let waiting = 0;
    const store: AttachmentStore = { ...disk, pruneExpired: async (...args: Parameters<AttachmentStore['pruneExpired']>) => { waiting += 1; if (waiting === 1) await gate; return disk.pruneExpired(...args); } };
    const deps = { attachments: { store, maxConcurrentUploads: 1, maxAttachmentBytes: undefined, maxCleanupPaths: undefined, requireSameOrigin: undefined, resolveOwnerId: undefined } };
    const first = await startRouteHarness({}, { familyDeps: deps });
    const second = await startRouteHarness({}, { familyDeps: deps });
    const upload = (harness: RouteHarness, name: string): Promise<Response> => harness.fetch(new Request(`http://harness.invalid/api/attachments?batch=batch-upload-1&name=${name}`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'contents',
    }));
    try {
      const held = upload(first, 'held.txt');
      await vi.waitFor(() => { expect(waiting).toBe(1); });
      expect((await upload(first, 'same-mount.txt')).status).toBe(429);
      expect((await upload(second, 'other-mount.txt')).status).toBe(201);
      letThrough();
      expect((await held).status).toBe(201);
    } finally {
      letThrough();
      await first.close();
      await second.close();
      await disk.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
