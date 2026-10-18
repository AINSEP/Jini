import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '@jini-ai/core';
import { createInMemoryEventLog, createRunLifecycle, type UserMessageDelivery } from '../../index.js';
import { registerRunRoutes, runMessageRoute, type RunHttpDeps } from '../runs.js';

vi.mock('@jini-ai/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@jini-ai/core')>(),
  isLocalSameOrigin: vi.fn(() => true),
}));

const adapter = { allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS', webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST', env: {}, resolvedPortRef: { current: 7456 } };

function makeDeps(deliver?: (input: { runId: string; text: string }) => UserMessageDelivery): RunHttpDeps {
  return { lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}) }), ...(deliver ? { deliverUserMessage: deliver, deliverUserMessageWithAttachments: deliver } : {}) };
}

function makeJsonRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

describe('POST /api/runs/:runId/messages — a message sent while the run is going', () => {
  it('does not send text alone when the host has no explicit attachment delivery', async () => {
    const deliver = vi.fn((): UserMessageDelivery => 'delivered');
    const deps = { lifecycle: makeDeps().lifecycle, deliverUserMessage: deliver };
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
    await runMessageRoute.handle({ input: parsed.value, deps });
    expect(deliver).toHaveBeenCalledWith(parsed.value);
  });

  it('rejects malformed attachment lists instead of accepting their text alone', () => {
    for (const attachmentIds of ['attachment:1', [1], [''], ['../secret'], Array(11).fill('attachment:1')]) {
      expect(runMessageRoute.parse({ body: { text: 'see screenshot', attachmentIds }, query: {}, params: { runId: 'r' } } as never).ok).toBe(false);
    }
  });

  it('hands the text to the live run and answers 202 delivered', async () => {
    const deliver = vi.fn((): UserMessageDelivery => 'delivered');
    const deps = makeDeps(deliver);
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx' });
    const app = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() };
    registerRunRoutes({ app: app as never, deps, adapter });
    const handler = app.post.mock.calls.find(([path]) => path === '/api/runs/:runId/messages')![1];
    const res = makeJsonRes();

    await handler({ body: { text: 'also do the footer' }, query: {}, params: { runId: run.id } }, res);

    expect(deliver).toHaveBeenCalledWith({ runId: run.id, text: 'also do the footer' });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ delivery: 'delivered' });
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
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() };
    registerRunRoutes({ app: app as never, deps: makeDeps(() => 'delivered'), adapter });
    const handler = app.post.mock.calls.find(([path]) => path === '/api/runs/:runId/messages')![1];
    const res = makeJsonRes();
    await handler({ body: { text: 'x' }, query: {}, params: { runId: 'run-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
