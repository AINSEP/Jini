import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachAcpSession, type AttachAcpSessionOptions } from '../session.js';

function createFixture(optionalArgs: Omit<AttachAcpSessionOptions, 'child' | 'prompt' | 'send'> = {},
  { failInitialWrite = false }: { failInitialWrite?: boolean } = {}) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    killed: false,
    kill: vi.fn((_signal?: string) => true),
  });
  child.kill.mockImplementation(() => { child.killed = true; return true; });
  if (failInitialWrite) vi.spyOn(child.stdin, 'write').mockImplementation(() => { throw new Error('initial write failed'); });
  const send = vi.fn();
  const controller = attachAcpSession({ child: child as unknown as ChildProcess, prompt: 'hello', send }, {
    resumeSessionId: 'prior-session', stageTimeoutMs: 100, ...optionalArgs,
  });
  const frame = (value: unknown) => child.stdout.write(`${JSON.stringify(value)}\n`);
  const initialize = () => frame({ jsonrpc: '2.0', id: 1, result: {} });
  const errorPayloads = () => send.mock.calls.filter(([args]) => args.event === 'error').map(([args]) => args.payload);
  return { child, controller, frame, initialize, errorPayloads };
}

describe('ACP resume failure discriminator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('tags the error thrown when a resume child lacks required streams', () => {
    const child = new EventEmitter() as unknown as ChildProcess;
    expect(() => attachAcpSession({ child, prompt: 'hello', send: vi.fn() }, { resumeSessionId: 'prior-session' }))
      .toThrow(expect.objectContaining({
        message: 'ACP child process must expose stdin and stdout streams',
        details: { kind: 'resume_failed', sessionId: 'prior-session' },
      }));
  });

  it('marks failure to write the first initialize request', () => {
    const f = createFixture({}, { failInitialWrite: true });
    expect(f.errorPayloads()).toEqual([expect.objectContaining({
      message: 'stdin write failed: initial write failed',
      error: expect.objectContaining({ details: { kind: 'resume_failed', sessionId: 'prior-session' } }),
    })]);
    expect(f.controller.hasFatalError()).toBe(true);
  });

  it.each([
    'initialize error', 'load error', 'invalid load result', 'initialize timeout', 'load timeout',
    'malformed load result', 'child exit', 'child error', 'stdin error', 'stdin write error',
  ])('marks %s before resume acknowledgement', (failure) => {
    const f = createFixture();
    if (failure !== 'initialize error' && failure !== 'initialize timeout') f.initialize();
    switch (failure) {
      case 'initialize error': f.frame({ id: 1, error: { code: -32000, message: 'initialize failed' } }); break;
      case 'load error': f.frame({ id: 2, error: { code: -32000, message: 'session missing' } }); break;
      case 'invalid load result': f.frame({ id: 2, result: {} }); break;
      case 'initialize timeout':
      case 'load timeout': vi.advanceTimersByTime(100); break;
      case 'malformed load result': f.frame({ id: 2, result: null }); vi.advanceTimersByTime(100); break;
      case 'child exit': f.child.emit('close', 1, null); break;
      case 'child error': f.child.emit('error', new Error('process failed')); break;
      case 'stdin error': f.child.stdin.emit('error', new Error('stream failed')); break;
      case 'stdin write error': {
        const g = createFixture();
        vi.spyOn(g.child.stdin, 'write').mockImplementation(() => { throw new Error('write failed'); });
        g.initialize();
        expect(g.errorPayloads()).toEqual([expect.objectContaining({ error: expect.objectContaining({
          details: expect.objectContaining({ kind: 'resume_failed', sessionId: 'prior-session' }),
        }) })]);
        expect(g.controller.hasFatalError()).toBe(true);
        expect(g.child.kill).toHaveBeenCalledWith('SIGTERM');
        f.controller.abort();
        return;
      }
    }
    expect(f.errorPayloads()).toEqual([expect.objectContaining({ error: expect.objectContaining({
      code: 'AGENT_EXECUTION_FAILED',
      details: expect.objectContaining({ kind: 'resume_failed', sessionId: 'prior-session' }),
    }) })]);
    expect(f.controller.hasFatalError()).toBe(true);
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('retains upstream RPC details and retryability as the resume failure cause', () => {
    const f = createFixture();
    f.initialize();
    const cause = { kind: 'missing_session', retryable: true, vendorCode: 'SESSION_GONE' };
    f.frame({ id: 2, error: { code: -32000, message: 'session missing', data: cause } });
    expect(f.errorPayloads()).toEqual([{
      message: 'json-rpc id 2: session missing',
      error: {
        code: 'AGENT_EXECUTION_FAILED', message: 'json-rpc id 2: session missing', retryable: true,
        details: { kind: 'resume_failed', sessionId: 'prior-session', cause },
      },
    }]);
  });

  it('marks promoted RPC errors without losing their typed error code', () => {
    const f = createFixture();
    f.initialize();
    f.frame({ id: 2, error: { message: 'invalid output', data: {
      kind: 'opencode_session_error', source: 'opencode', code: 'ROLE_MARKER_HALLUCINATION',
    } } });
    expect(f.errorPayloads()).toEqual([expect.objectContaining({ error: expect.objectContaining({
      code: 'ROLE_MARKER_HALLUCINATION',
      details: { kind: 'resume_failed', sessionId: 'prior-session', cause: expect.objectContaining({
        kind: 'opencode_session_error', code: 'ROLE_MARKER_HALLUCINATION',
      }) },
    }) })]);
  });

  it('marks promoted stderr account errors before acknowledgement', () => {
    const f = createFixture({ modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE', accountFailureClassifier: {
      classify: () => ({ code: 'AUTH_REQUIRED', message: 'Sign in', action: 'sign_in' }),
    } });
    f.child.stderr.write('opencode_event_stream_failure: retry, authentication required');
    expect(f.errorPayloads()).toEqual([expect.objectContaining({ error: expect.objectContaining({
      code: 'AUTH_REQUIRED', details: {
        kind: 'resume_failed', sessionId: 'prior-session',
        cause: expect.objectContaining({ kind: 'account_failure', action: 'sign_in' }),
      },
    }) })]);
  });

  it('marks promoted retry updates before acknowledgement', () => {
    const f = createFixture({ modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE', accountFailureClassifier: {
      classify: () => ({ code: 'AUTH_REQUIRED', message: 'Sign in', action: 'sign_in' }),
    } });
    f.initialize();
    f.frame({ method: 'session/update', params: { update: {
      sessionUpdate: 'status_update', status: 'retry', message: 'authentication required',
    } } });
    expect(f.errorPayloads()).toEqual([expect.objectContaining({ error: expect.objectContaining({
      code: 'AUTH_REQUIRED', details: expect.objectContaining({ kind: 'resume_failed' }),
    }) })]);
  });

  it('keeps errors after a successful load out of the resume-failure category', () => {
    const f = createFixture();
    f.initialize();
    f.frame({ id: 2, result: { sessionId: 'loaded', openCodeSessionId: 'prior-session' } });
    f.frame({ id: 3, error: { message: 'prompt failed' } });
    expect(f.errorPayloads()).toEqual([{ message: 'json-rpc id 3: prompt failed' }]);
  });

  it('preserves fresh-session failures and caller cancellation', () => {
    const fresh = createFixture({ resumeSessionId: null });
    fresh.initialize();
    fresh.frame({ id: 2, error: { message: 'creation failed' } });
    expect(fresh.errorPayloads()).toEqual([{ message: 'json-rpc id 2: creation failed' }]);
    const resumed = createFixture();
    resumed.controller.abort();
    vi.advanceTimersByTime(100);
    expect(resumed.errorPayloads()).toEqual([]);
    expect(resumed.controller.hasFatalError()).toBe(false);
  });
});
