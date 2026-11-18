import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HARNESS_BEARER_TOKEN, startRouteHarness, type RouteHarness } from './harness.js';
import { jsonResponse } from '@jini-ai/core/contracts/server';
import type { AuthorizeToolRun } from '../../tool-execution-routes.js';
import { probe } from './probes.js';
import { openStream } from './stream-reader.js';

/**
 * The two routes that answer with one JSON value per line while a tool runs (tool execution for
 * a remote caller, and a page's own request), recorded from today's code on a real socket: when
 * the headers leave, which lines are written and in what order, what a keepalive looks like and
 * who gets one, and what the tool is told when the caller goes away.
 */

type ExecuteCall = { call: Record<string, unknown>; signal: AbortSignal; emitSurface: (emission: unknown) => Promise<void> };
type Outcome = { resolve(result: unknown): void; reject(error: unknown): void };

/** An executor whose every call waits until the test settles it. */
function pendingExecutor(): { execute: (call: Record<string, unknown>, options: { signal: AbortSignal; emitSurface: ExecuteCall['emitSurface'] }) => Promise<unknown>; calls: ExecuteCall[]; outcomes: Outcome[] } {
  const calls: ExecuteCall[] = [];
  const outcomes: Outcome[] = [];
  return {
    calls,
    outcomes,
    execute: (call, { signal, emitSurface }) => {
      calls.push({ call, signal, emitSurface });
      return new Promise((resolve, reject) => { outcomes.push({ resolve, reject }); });
    },
  };
}

const LINE_STREAM_HEADERS = { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' };
const line = (value: unknown): string => JSON.stringify(value);
const fakeIntervals = (): void => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); };
afterEach(() => { vi.useRealTimers(); });

describe('tool execution (POST /internal/tool-executions)', () => {
  const route = 'POST /internal/tool-executions';
  const headers = { authorization: `Bearer ${HARNESS_BEARER_TOKEN}` };
  const call = { executionId: 'exec-1', principal: { id: 'principal-1', roles: ['kept-as-sent'] }, run: { id: 'run-1', extra: 'dropped' }, toolId: 'tool.one', input: { n: 1 }, context: { trace: 't' } };
  const executor = pendingExecutor();
  let harness: RouteHarness;
  beforeAll(async () => { harness = await startRouteHarness({}, { familyDeps: { 'tool-execution-routes': { execute: executor.execute } } }); });
  afterAll(async () => { await harness.close(); });
  afterEach(() => { executor.calls.length = 0; executor.outcomes.length = 0; });

  const open = () => openStream({ harness, route }, { headers, body: line(call), separator: '\n' });

  it('the headers arrive while the tool is still running; the result is the only line and ends the answer', async () => {
    const stream = await open();
    expect(stream.response.status).toBe(200);
    for (const [name, value] of Object.entries(LINE_STREAM_HEADERS)) expect(stream.response.headers.get(name)).toBe(value);
    expect(executor.outcomes).toHaveLength(1);
    executor.outcomes[0]!.resolve({ ok: true, output: { text: 'done' } });
    expect(await stream.rest()).toEqual([line({ type: 'result', result: { ok: true, output: { text: 'done' } } })]);
  });

  it('the tool receives the principal as sent, the run reduced to its id, the tool id and the input', async () => {
    const stream = await open();
    expect(executor.calls[0]?.call).toEqual({ principal: call.principal, run: { id: 'run-1' }, toolId: 'tool.one', input: { n: 1 } });
    executor.outcomes[0]!.resolve(null);
    await stream.rest();
  });

  it('surface lines are written as they are emitted, before the result; an emission after the result is dropped', async () => {
    const stream = await open();
    const { emitSurface } = executor.calls[0]!;
    await emitSurface({ surfaceId: 's-1' });
    expect(await stream.next()).toEqual([line({ type: 'surface', emission: { surfaceId: 's-1' } })]);
    await emitSurface({ surfaceId: 's-2' });
    executor.outcomes[0]!.resolve({ ok: true });
    expect(await stream.next(2)).toEqual([line({ type: 'surface', emission: { surfaceId: 's-2' } }), line({ type: 'result', result: { ok: true } })]);
    await emitSurface({ surfaceId: 'too-late' });
    expect(await stream.rest()).toEqual([]);
  });

  it.each([
    ['an error with a code', Object.assign(new TypeError('tool broke'), { code: 'E_TOOL' }), { name: 'TypeError', message: 'tool broke', code: 'E_TOOL' }],
    ['an error without a code', new RangeError('out of range'), { name: 'RangeError', message: 'out of range' }],
    ['a thrown value that is not an error', 'plain text', { name: 'Error', message: 'plain text' }],
  ])('a tool that throws %s still answers 200, with one throw line', async (_label, thrown, error) => {
    const stream = await open();
    executor.outcomes[0]!.reject(thrown);
    expect(stream.response.status).toBe(200);
    expect(await stream.rest()).toEqual([line({ type: 'throw', error })]);
  });

  it('a caller that goes away aborts the signal the tool was given', async () => {
    const stream = await open();
    const { signal } = executor.calls[0]!;
    expect(signal.aborted).toBe(false);
    stream.abort();
    await vi.waitFor(() => { expect(signal.aborted).toBe(true); });
    executor.outcomes[0]!.resolve(null);
  });

  it('sends no keepalive: no timer is scheduled while the tool runs', async () => {
    fakeIntervals();
    const stream = await open();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    executor.outcomes[0]!.resolve('late');
    expect(await stream.rest()).toEqual([line({ type: 'result', result: 'late' })]);
  });

  it('a call without its required fields is answered as a JSON 400 and the tool is not run', async () => {
    const answer = await probe({ harness, route }, { headers, body: line({ ...call, toolId: '' }) });
    expect(answer.status).toBe(400);
    expect(answer.json).toEqual({ error: { code: 'BAD_REQUEST', message: 'body must be { executionId, principal: { id }, run: { id }, toolId, input, context? }' } });
    expect(executor.calls).toHaveLength(0);
  });
});

describe('page request (POST /api/frontend-requests)', () => {
  const route = 'POST /api/frontend-requests';
  const body = line({ capabilityId: 'characterization.capability', input: { q: 'x' }, bindToken: 'bind-1' });
  const owner = { principalId: 'visitor-1', scope: 'guest' };
  const executor = pendingExecutor();
  const release = vi.fn();
  const bindRequest = vi.fn((_required: Record<string, unknown>) => release);
  let resolveOwner: () => Promise<unknown> = async () => owner;
  let harness: RouteHarness;
  beforeAll(async () => {
    harness = await startRouteHarness({}, { familyDeps: { 'frontend-request-route': { execute: executor.execute, bindRequest, resolveOwner: () => resolveOwner() } } });
  });
  afterAll(async () => { await harness.close(); });
  afterEach(() => { executor.calls.length = 0; executor.outcomes.length = 0; release.mockClear(); bindRequest.mockClear(); resolveOwner = async () => owner; });

  it('runs the capability as the resolved owner, bound to the page for exactly as long as it runs', async () => {
    const stream = await openStream({ harness, route }, { body, separator: '\n' });
    expect(stream.response.status).toBe(200);
    for (const [name, value] of Object.entries(LINE_STREAM_HEADERS)) expect(stream.response.headers.get(name)).toBe(value);
    const runId = (executor.calls[0]!.call.run as { id: string }).id;
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(executor.calls[0]!.call).toEqual({ principal: { id: 'visitor-1' }, run: { id: runId }, toolId: 'characterization.capability', input: { q: 'x' } });
    expect(bindRequest).toHaveBeenCalledWith({ runId, bindToken: 'bind-1', owner, signal: executor.calls[0]!.signal });
    expect(release).not.toHaveBeenCalled();
    executor.outcomes[0]!.resolve({ ok: true });
    expect(await stream.rest()).toEqual([line({ type: 'result', result: { ok: true } })]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('writes a keepalive line every 15 seconds while the capability runs, and none after it settles', async () => {
    fakeIntervals();
    const stream = await openStream({ harness, route }, { body, separator: '\n' });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(15_000);
    expect(await stream.next()).toEqual(['{"type":"keepalive"}']);
    vi.advanceTimersByTime(15_000);
    expect(await stream.next()).toEqual(['{"type":"keepalive"}']);
    executor.outcomes[0]!.resolve('done');
    expect(await stream.rest()).toEqual([line({ type: 'result', result: 'done' })]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['whose owner cannot be resolved', async () => { throw new Error('resolver failed'); }, '{"error":"The browser session could not be verified for this page action."}'],
    ['that has no owner', async () => null, '{"error":"This page request has no authenticated browser owner."}'],
  ])('a request %s is refused with a plain-string 403, byte for byte, and nothing runs', async (_label, resolver, expected) => {
    resolveOwner = resolver;
    const answer = await probe({ harness, route }, { body });
    expect(answer.status).toBe(403);
    expect(answer.text).toBe(expected);
    expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(executor.calls).toHaveLength(0);
    expect(bindRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['a capability that is not on the list', { capabilityId: 'other.capability', input: {}, bindToken: 'b' }],
    ['an extra field', { capabilityId: 'characterization.capability', input: {}, bindToken: 'b', extra: 1 }],
    ['an empty bind token', { capabilityId: 'characterization.capability', input: {}, bindToken: '' }],
    ['an input that is not an object', { capabilityId: 'characterization.capability', input: [], bindToken: 'b' }],
  ])('%s is refused with the envelope 400 before the owner is asked', async (_label, envelope) => {
    const asked = vi.fn(async () => owner);
    resolveOwner = asked;
    const answer = await probe({ harness, route }, { body: line(envelope) });
    expect(answer.status).toBe(400);
    expect(answer.text).toBe('{"error":"Expected an allowed capabilityId, object input and frontend bindToken."}');
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('tool execution with a host run check (authorizeRun)', () => {
  const headers = { authorization: `Bearer ${HARNESS_BEARER_TOKEN}` };
  const call = { executionId: 'exec-1', principal: { id: 'as-sent', roles: ['admin'] }, run: { id: 'run-1' }, toolId: 'tool.one', input: {} };
  const executor = pendingExecutor();
  /** What the host check saw, in order: the parsed body for an execution, the query for the catalog. */
  const seen: unknown[] = [];
  let verdict: 'allow' | 'refuse' | 'narrow' = 'allow';
  const listToolsFor = vi.fn(async () => []);
  let harness: RouteHarness;
  beforeAll(async () => {
    harness = await startRouteHarness({}, { familyDeps: { 'tool-execution-routes': {
      execute: executor.execute,
      listToolsFor,
      authorizeRun: async (request: Parameters<AuthorizeToolRun>[0]) => {
        seen.push(request.kind === 'execute' ? structuredClone(request.body) : request.query);
        if (verdict === 'refuse') return { allowed: false, response: jsonResponse({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'host says no' } } }) };
        if (verdict === 'narrow') return { allowed: true, principal: { id: 'as-recorded' } };
        return { allowed: true };
      },
    } } });
  });
  afterAll(async () => { await harness.close(); });
  afterEach(() => { seen.length = 0; verdict = 'allow'; executor.calls.length = 0; executor.outcomes.length = 0; listToolsFor.mockClear(); });

  it('the check sees the parsed body, and the tool runs as whatever principal the check left on it', async () => {
    verdict = 'narrow';
    const stream = await openStream({ harness, route: 'POST /internal/tool-executions' }, { headers, body: line(call), separator: '\n' });
    expect(seen).toEqual([call]);
    expect(executor.calls[0]?.call.principal).toEqual({ id: 'as-recorded' });
    executor.outcomes[0]!.resolve(null);
    await stream.rest();
  });

  it('a refusal by the check comes before the shape of the call is looked at: a malformed call is answered 403, not 400', async () => {
    verdict = 'refuse';
    const answer = await probe({ harness, route: 'POST /internal/tool-executions' }, { headers, body: line({ ...call, toolId: '' }) });
    expect(answer.summary).toBe('403 FORBIDDEN');
    expect(answer.json).toEqual({ error: { code: 'FORBIDDEN', message: 'host says no' } });
    expect(executor.calls).toHaveLength(0);
  });

  it('the check is asked only after the caller gate and the body parser: no token is 401 and bad JSON is 400, both without asking it', async () => {
    verdict = 'refuse';
    expect((await probe({ harness, route: 'POST /internal/tool-executions' }, { body: line(call) })).summary).toBe('401 UNAUTHORIZED');
    expect((await probe({ harness, route: 'POST /internal/tool-executions' }, { headers, body: '{"broken"' })).summary).toBe('400 BAD_REQUEST');
    expect(seen).toEqual([]);
  });

  it('the catalog route asks the same check, with the query, and lists nothing when it refuses', async () => {
    verdict = 'refuse';
    expect((await probe({ harness, route: 'GET /internal/tool-catalog?runId=run-1&principalId=p-1' }, { headers })).summary).toBe('403 FORBIDDEN');
    expect(seen).toEqual([{ runId: 'run-1', principalId: 'p-1' }]);
    expect(listToolsFor).not.toHaveBeenCalled();
    verdict = 'allow';
    expect((await probe({ harness, route: 'GET /internal/tool-catalog?runId=run-1&principalId=p-1' }, { headers })).json).toEqual({ tools: [] });
    expect(listToolsFor).toHaveBeenCalledWith({ principalId: 'p-1' });
  });
});
