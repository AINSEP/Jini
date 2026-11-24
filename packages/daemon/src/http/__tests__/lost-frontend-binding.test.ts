import { describe, expect, it } from 'vitest';

import type { ToolExecutionContext, ToolRegistration } from '@jini-ai/core';

import { createLostFrontendBindings, FrontendDisconnectedError, type LostFrontendBindingMessages } from '../lost-frontend-binding.js';

/**
 * @file Certifies the clearer frontend-tool failure for a run whose tab bound with a token the
 * daemon no longer knows (the daemon — and so its in-memory session registry — restarted under an
 * open tab). Error texts are the EXACT upstream wordings from `frontend-session-registry.ts`
 * (`bindRunByToken` and `invoke`), so a change to either is caught here rather than silently
 * falling back to the bare message.
 */

const messages: LostFrontendBindingMessages = {
  lostBinding: 'The tab lost its connection after a server restart. Reload the page and try again.',
  unboundDetail: 'no tab is connected to this run, so nothing was changed. Reload the page, then retry.',
  detachedDetail: 'the tab disconnected before answering, so the outcome is unknown. Reload and check.',
};

const unknownTokenError = new Error('FrontendSessionRegistry: cannot bind run "run-1" — unknown or expired bind token');
const unboundError = new Error('no frontend is bound to run "run-1", so "app.publish" cannot be executed');

function ctx(runId: string): ToolExecutionContext {
  return { executionId: 'exec-1', principal: { id: 'principal-1' }, run: { id: runId }, input: {}, signal: new AbortController().signal };
}

function registration(handler: ToolRegistration['handler']): ToolRegistration {
  return { descriptor: { id: 'app.publish', description: 'fake' }, policy: { authorize: () => 'allow' }, handler } as ToolRegistration;
}

/** A run with no restart record whose tab is simply gone (closed, reloaded, socket dropped). */
function expectDisconnected(err: unknown, cause: Error, detail: string): void {
  expect(err).toBeInstanceOf(FrontendDisconnectedError);
  const error = err as FrontendDisconnectedError;
  expect(error.code).toBe('frontend_disconnected');
  expect(error.retryable).toBe(true);
  // The model only sees the message, so it carries the code.
  expect(error.message).toBe(`frontend_disconnected (retryable): ${detail}`);
  expect(error.cause).toBe(cause);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected a rejection'); }, (err: unknown) => err);
}

describe('createLostFrontendBindings', () => {
  it("gives a run whose bind token was unknown the host's reload message instead of the bare 'no frontend is bound'", async () => {
    const lost = createLostFrontendBindings({ messages });
    lost.noteBindError({ runId: 'run-1', error: unknownTokenError });
    const wrapped = lost.wrap({ registration: registration(async () => { throw unboundError; }) });

    const err = (await rejection(wrapped.handler(ctx('run-1')))) as Error;
    expect(err.message).toBe(messages.lostBinding);
    expect(err.cause).toBe(unboundError);
  });

  it("turns another run's 'no frontend is bound' into a recoverable frontend_disconnected error", async () => {
    const lost = createLostFrontendBindings({ messages });
    lost.noteBindError({ runId: 'run-1', error: unknownTokenError });
    const wrapped = lost.wrap({ registration: registration(async () => { throw unboundError; }) });

    expectDisconnected(await rejection(wrapped.handler(ctx('run-2'))), unboundError, messages.unboundDetail);
  });

  it('treats a tab that detaches mid-call as frontend_disconnected with the outcome-unknown detail', async () => {
    const lost = createLostFrontendBindings({ messages });
    const detached = new Error('frontend session "s-1" detached before answering');
    const wrapped = lost.wrap({ registration: registration(async () => { throw detached; }) });

    expectDisconnected(await rejection(wrapped.handler(ctx('run-1'))), detached, messages.detachedDetail);
  });

  it('does not record a bind error that is not about the token', async () => {
    const lost = createLostFrontendBindings({ messages });
    lost.noteBindError({ runId: 'run-1', error: new SyntaxError('Unexpected token } in JSON') });
    const wrapped = lost.wrap({ registration: registration(async () => { throw unboundError; }) });

    expectDisconnected(await rejection(wrapped.handler(ctx('run-1'))), unboundError, messages.unboundDetail);
  });

  it("passes other failures of a lost-binding run through unchanged, and leaves success untouched", async () => {
    const lost = createLostFrontendBindings({ messages });
    lost.noteBindError({ runId: 'run-1', error: unknownTokenError });
    const other = new Error('capability timed out');
    const failing = lost.wrap({ registration: registration(async () => { throw other; }) });
    const ok = lost.wrap({ registration: registration(async () => ({ done: true })) });

    expect(await rejection(failing.handler(ctx('run-1')))).toBe(other);
    expect(await ok.handler(ctx('run-1'))).toEqual({ done: true });
  });

  it('bounds the record: the oldest run is forgotten first', async () => {
    const lost = createLostFrontendBindings({ messages, maxRuns: 2 });
    for (const runId of ['run-a', 'run-b', 'run-c']) lost.noteBindError({ runId, error: unknownTokenError });
    const wrapped = lost.wrap({ registration: registration(async () => { throw unboundError; }) });

    expectDisconnected(await rejection(wrapped.handler(ctx('run-a'))), unboundError, messages.unboundDetail);
    expect(((await rejection(wrapped.handler(ctx('run-c')))) as Error).message).toBe(messages.lostBinding);
  });

  it('passes a non-Error rejection through untouched', async () => {
    const lost = createLostFrontendBindings({ messages });
    const wrapped = lost.wrap({ registration: registration(async () => { throw 'plain string'; }) });
    expect(await rejection(wrapped.handler(ctx('run-1')))).toBe('plain string');
  });
});
