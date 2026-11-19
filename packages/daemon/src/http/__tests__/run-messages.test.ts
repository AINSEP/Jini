import { reportRouteInternalError } from '@jini-ai/http-kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingOriginPolicy } from '@jini-ai/core/contracts/server/testing';
import { createInMemoryEventLog, createRunLifecycle, type UserMessageDelivery } from '../../index.js';
import { runMessageRoute, runRoutes, type RunHttpDeps } from '../runs.js';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';

const testOriginPolicy = createRecordingOriginPolicy();

/** The run routes on an in-memory server, behind the recording origin policy. */
const serve = (deps: RunHttpDeps) => serveRoutes({ routes: runRoutes({ deps, host: fakeDaemonRouteHost({}, { originPolicy: testOriginPolicy }) }) });

function makeDeps(deliver?: (input: { runId: string; text: string }) => UserMessageDelivery): RunHttpDeps {
  return { reportInternalError: reportRouteInternalError, lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}) }), ...(deliver ? { deliverUserMessage: deliver, deliverUserMessageWithAttachments: deliver } : {}) };
}

beforeEach(() => {
  testOriginPolicy.set({ allow: true });
});

describe('POST /api/runs/:runId/messages — a message sent while the run is going', () => {
  it('does not send text alone when the host has no explicit attachment delivery', async () => {
    const deliver = vi.fn((): UserMessageDelivery => 'delivered');
    const deps = { lifecycle: makeDeps().lifecycle, deliverUserMessage: deliver, reportInternalError: reportRouteInternalError };
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx' });
    const result = await runMessageRoute.handle({ input: { runId: run.id, text: 'see screenshot', attachmentIds: ['attachment:1'] }, deps });
    expect(result).toMatchObject({ ok: false, error: { details: { delivery: 'unsupported' } } });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('passes the complete message, including attachment refs, to the host', async () => {
    const deliver = vi.fn((): UserMessageDelivery => 'delivered');
    const deps = makeDeps(deliver);
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx' });
    const parsed = runMessageRoute.parse({ body: { text: 'see screenshot', attachmentIds: ['attachment:1'] }, query: {}, params: { runId: run.id } } as never);
    expect(parsed).toEqual({ ok: true, value: { runId: run.id, text: 'see screenshot', attachmentIds: ['attachment:1'] } });
    if (!parsed.ok) throw new Error('message must parse');
    const accepted = await runMessageRoute.handle({ input: parsed.value, deps });
    if (!accepted.ok) throw new Error('message must be accepted');
    expect(deliver).toHaveBeenCalledWith({ ...parsed.value, id: accepted.value.id });
  });

  it('rejects malformed attachment lists instead of accepting their text alone', () => {
    for (const attachmentIds of ['attachment:1', [1], [''], ['../secret'], Array(11).fill('attachment:1')]) {
      expect(runMessageRoute.parse({ body: { text: 'see screenshot', attachmentIds }, query: {}, params: { runId: 'r' } } as never).ok).toBe(false);
    }
  });

  it('202_returns_id matching the queued message', async () => {
    const deliver = vi.fn((): UserMessageDelivery => 'delivered');
    const deps = makeDeps(deliver);
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx' });
    const response = await serve(deps)(jsonRequest({ path: `/api/runs/${run.id}/messages`, method: 'POST' }, { body: { text: 'also do the footer' } }));
    const body = await response.json() as { id: string; delivery: string };
    expect(body.id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(deliver).toHaveBeenCalledWith({ runId: run.id, text: 'also do the footer', id: body.id });
    expect([response.status, body]).toEqual([202, { delivery: 'delivered', id: body.id }]);
  });

  it('answers 409 with the delivery outcome when the run cannot take it, so the client can fall back', async () => {
    for (const delivery of ['unsupported', 'not-running'] as const) {
      const deps = makeDeps(() => delivery);
      const { run } = await deps.lifecycle.start({ contextRef: 'ctx' });
      const result = await runMessageRoute.handle({ input: { runId: run.id, text: 'x' }, deps });
      expect(result).toEqual({ ok: false, error: { code: 'CONFLICT', message: `run "${run.id}" did not take the message`, details: { delivery } } });
    }
  });

  it('reports unsupported when the host wired no live delivery at all', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx' });
    const result = await runMessageRoute.handle({ input: { runId: run.id, text: 'x' }, deps });
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT', details: { delivery: 'unsupported' } } });
  });

  it('answers NOT_FOUND for an unknown run without delivering', async () => {
    const deliver = vi.fn((): UserMessageDelivery => 'delivered');
    const result = await runMessageRoute.handle({ input: { runId: 'nope', text: 'x' }, deps: makeDeps(deliver) });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'run "nope" was not found' } });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('rejects a blank or missing text before reaching the run', () => {
    for (const body of [{}, { text: '   ' }, { text: 7 }, null]) {
      const parsed = runMessageRoute.parse({ body, query: {}, params: { runId: 'run-1' } } as never);
      expect(parsed.ok).toBe(false);
    }
  });

  it('requires same-origin like every other run write', async () => {
    testOriginPolicy.set({ allow: false });
    const response = await serve(makeDeps(() => 'delivered'))(jsonRequest({ path: '/api/runs/run-1/messages', method: 'POST' }, { body: { text: 'x' } }));
    expect(response.status).toBe(403);
  });
});
