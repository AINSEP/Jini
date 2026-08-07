import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { attachAcpSession, type AttachAcpSessionOptions } from '../session.js';
import type { AccountFailureClassifier } from '../account-failure.js';

class FakeStdin extends EventEmitter {
  writes: string[] = [];
  ended = false;
  destroyed = false;
  get writableEnded() {
    return this.ended;
  }
  write(chunk: string) {
    if (this.failWith) throw this.failWith;
    this.writes.push(chunk);
    return true;
  }
  end() {
    if (this.failEndWith) throw this.failEndWith;
    this.ended = true;
  }
  failWith: Error | null = null;
  failEndWith: Error | null = null;
}

class FakeReadable extends EventEmitter {
  setEncoding = vi.fn();
}

class FakeAcpChild extends EventEmitter {
  stdin: FakeStdin | undefined = new FakeStdin();
  stdout: FakeReadable | undefined = new FakeReadable();
  stderr: FakeReadable | undefined = new FakeReadable();
  killed = false;
  kill(_signal?: string) {
    this.killed = true;
    return true;
  }
}

function writesOf(child: FakeAcpChild) {
  return child.stdin!.writes.map((w) => JSON.parse(w));
}

function lastWrite(child: FakeAcpChild) {
  const w = child.stdin!.writes.at(-1);
  return w ? JSON.parse(w) : null;
}

function emitLine(child: FakeAcpChild, obj: unknown) {
  child.stdout!.emit('data', `${JSON.stringify(obj)}\n`);
}

function emitResult(child: FakeAcpChild, id: number, result: unknown) {
  emitLine(child, { jsonrpc: '2.0', id, result });
}

function emitRpcError(child: FakeAcpChild, id: number, error: unknown) {
  emitLine(child, { jsonrpc: '2.0', id, error });
}

function emitUpdate(child: FakeAcpChild, update: Record<string, unknown>) {
  emitLine(child, { jsonrpc: '2.0', method: 'session/update', params: { update } });
}

function emitPermissionRequest(child: FakeAcpChild, id: number, options: unknown) {
  emitLine(child, { jsonrpc: '2.0', id, method: 'session/request_permission', params: { options } });
}

function baseOptions(child: FakeAcpChild, overrides: Partial<AttachAcpSessionOptions> = {}): AttachAcpSessionOptions {
  return {
    child: child as any,
    prompt: 'hello agent',
    send: vi.fn(),
    ...overrides,
  };
}

/** Drives initialize -> session/new to completion, returning the sessionId used. */
function handshakeToSessionNew(child: FakeAcpChild, sessionResult: Record<string, unknown> = { sessionId: 'sess-1' }) {
  emitResult(child, 1, {});
  emitResult(child, 2, sessionResult);
}

describe('attachAcpSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when the child process has no stdin/stdout', () => {
    const child = new FakeAcpChild();
    child.stdin = undefined;
    expect(() => attachAcpSession(baseOptions(child))).toThrow(
      'ACP child process must expose stdin and stdout streams',
    );
  });

  it('sends an initialize request immediately with the default client info', () => {
    const child = new FakeAcpChild();
    attachAcpSession(baseOptions(child));
    expect(writesOf(child)[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { terminal: false },
        clientInfo: { name: 'agent-runtime', version: 'runtime-adapter' },
      },
    });
  });

  it('honors a caller-supplied clientName/clientVersion', () => {
    const child = new FakeAcpChild();
    attachAcpSession(baseOptions(child, { clientName: 'custom', clientVersion: '9.9.9' }));
    expect(writesOf(child)[0].params.clientInfo).toEqual({ name: 'custom', version: '9.9.9' });
  });

  describe('happy path', () => {
    it('drives initialize -> session/new -> session/prompt -> text_delta -> clean completion', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const onCliReady = vi.fn();
      const onSessionInit = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send, onCliReady, onSessionInit }));

      emitResult(child, 1, {});
      expect(onCliReady).toHaveBeenCalledTimes(1);
      expect(writesOf(child)[1]).toMatchObject({ id: 2, method: 'session/new' });

      emitResult(child, 2, { sessionId: 'sess-1' });
      expect(onSessionInit).toHaveBeenCalledTimes(1);
      expect(writesOf(child)[2]).toMatchObject({
        id: 3,
        method: 'session/prompt',
        params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'hello agent' }] },
      });
      expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'waiting_for_first_output', elapsedMs: expect.any(Number) });

      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'Hello there' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'streaming', ttftMs: expect.any(Number) });
      expect(send).toHaveBeenCalledWith('agent', { type: 'text_delta', delta: 'Hello there' });

      emitResult(child, 3, { usage: { inputTokens: 10, outputTokens: 5 } });
      expect(controller.completedSuccessfully()).toBe(true);
      expect(controller.hasFatalError()).toBe(false);
      expect(send).toHaveBeenCalledWith('agent', {
        type: 'usage',
        usage: { input_tokens: 10, output_tokens: 5 },
        durationMs: expect.any(Number),
      });
      expect(child.stdin!.ended).toBe(true);

      // The clean-exit fallback timer fires SIGTERM if the child doesn't
      // close on its own within 500ms.
      vi.advanceTimersByTime(500);
      expect(child.killed).toBe(true);
    });

    it('does not SIGTERM the clean-exit fallback if the child already closed', () => {
      const child = new FakeAcpChild();
      attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      emitResult(child, 3, {});
      child.emit('close', 0, null);
      vi.advanceTimersByTime(500);
      // killed stays whatever it was at close time (false, since a clean
      // stdin.end()-driven exit doesn't itself call kill()).
      expect(child.killed).toBe(false);
    });
  });

  describe('resume flow (resumeSessionId)', () => {
    it('sends session/load instead of session/new when resumeSessionId is set', () => {
      const child = new FakeAcpChild();
      attachAcpSession(baseOptions(child, { resumeSessionId: 'prior-session', cwd: '/work' }));
      emitResult(child, 1, {});
      expect(writesOf(child)[1]).toEqual({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/load',
        params: { sessionId: 'prior-session', cwd: '/work' },
      });
    });

    it('captures the durable session id and exposes it via getDurableSessionId()', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child, { resumeSessionId: 'prior-session' }));
      emitResult(child, 1, {});
      emitResult(child, 2, { sessionId: 'sess-1', openCodeSessionId: 'durable-1' });
      expect(controller.getDurableSessionId()).toBe('durable-1');
    });

    it('getDurableSessionId returns null when the agent reports none', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child, { sessionId: 'sess-1' });
      expect(controller.getDurableSessionId()).toBeNull();
    });
  });

  describe('model selection', () => {
    it('sends session/set_model when a non-default model is requested and no configId is known', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { model: 'gpt-4', send }));
      emitResult(child, 1, {});
      emitResult(child, 2, { sessionId: 'sess-1' });
      expect(writesOf(child)[2]).toEqual({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/set_model',
        params: { sessionId: 'sess-1', modelId: 'gpt-4' },
      });
    });

    it('uses session/set_config_option when a modelConfigId was discovered', () => {
      const child = new FakeAcpChild();
      attachAcpSession(baseOptions(child, { model: 'gpt-4' }));
      emitResult(child, 1, {});
      emitResult(child, 2, {
        sessionId: 'sess-1',
        configOptions: [{ id: 'model', category: 'model', options: [] }],
      });
      expect(writesOf(child)[2]).toMatchObject({
        method: 'session/set_config_option',
        params: { sessionId: 'sess-1', configId: 'model', value: 'gpt-4' },
      });
    });

    it('sends session/prompt after a successful model switch', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { model: 'gpt-4', send }));
      emitResult(child, 1, {});
      emitResult(child, 2, { sessionId: 'sess-1' });
      emitResult(child, 3, {});
      expect(writesOf(child)[3]).toMatchObject({ id: 4, method: 'session/prompt' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'model', model: 'gpt-4' });
    });

    it('emits an initial model status right after session/new when a model is already active', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      emitResult(child, 1, {});
      emitResult(child, 2, { sessionId: 'sess-1', models: { currentModelId: 'default-model' } });
      expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'model', model: 'default-model' });
    });

    it('fails when session/new resolves without a sessionId', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      emitResult(child, 1, {});
      emitResult(child, 2, {});
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('invalid session/new response') }));
    });

    it('recovers from a recoverable model-selection RPC error by falling back to default and prompting', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { model: 'gpt-4', send }));
      emitResult(child, 1, {});
      emitResult(child, 2, { sessionId: 'sess-1' });
      // id 3 = set_model request; respond with a recoverable error.
      emitRpcError(child, 3, { code: -32602, message: 'unknown model' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'model', model: 'default' });
      expect(writesOf(child)[3]).toMatchObject({ id: 4, method: 'session/prompt' });
    });

    it('falls back to "default" label when activeModel was never established before a recoverable error', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { model: 'gpt-4', send }));
      emitResult(child, 1, {});
      // session/new result carries no models/configOptions at all, so
      // activeModel stays null going into the set_model attempt.
      emitResult(child, 2, { sessionId: 'sess-1' });
      emitRpcError(child, 3, { code: -32601 });
      expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'model', model: 'default' });
    });
  });

  describe('RPC error handling', () => {
    it('fails with the rpc error message for a non-recoverable error on the expected id', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      emitRpcError(child, 1, { message: 'bad handshake' });
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith('error', { message: 'json-rpc id 1: bad handshake' });
    });

    it('ignores an unexpected-id -32603 error as cleanup noise', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      emitRpcError(child, 999, { code: -32603, message: 'noise' });
      expect(controller.hasFatalError()).toBe(false);
      expect(send).not.toHaveBeenCalledWith('error', expect.anything());
    });

    it('ignores a late RPC error that arrives after the session already finished', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitResult(child, 3, {});
      send.mockClear();
      expect(() => emitRpcError(child, 3, { message: 'too late' })).not.toThrow();
      expect(send).not.toHaveBeenCalled();
    });

    it('promotes an opencode ROLE_MARKER_HALLUCINATION error via failWithPayload', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      emitRpcError(child, 1, {
        message: 'role marker seen',
        data: { kind: 'opencode_session_error', source: 'opencode', code: 'ROLE_MARKER_HALLUCINATION' },
      });
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ error: expect.objectContaining({ code: 'ROLE_MARKER_HALLUCINATION' }) }),
      );
    });

    it('includes retryable from error.data when present on a generic failure', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      emitRpcError(child, 1, { message: 'quota', data: { retryable: true } });
      expect(send).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ error: expect.objectContaining({ retryable: true, details: { retryable: true } }) }),
      );
    });

    it('kills the child on a fatal error, unless already killed', () => {
      const child = new FakeAcpChild();
      attachAcpSession(baseOptions(child));
      emitRpcError(child, 1, { message: 'bad' });
      expect(child.killed).toBe(true);
    });

    it('does not call kill() again when the child is already killed', () => {
      const child = new FakeAcpChild();
      child.killed = true;
      attachAcpSession(baseOptions(child));
      const killSpy = vi.spyOn(child, 'kill');
      emitRpcError(child, 1, { message: 'bad' });
      expect(killSpy).not.toHaveBeenCalled();
    });

    it('ignores a raw stdout line that parses to valid JSON but is not an object (e.g. a bare number)', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      expect(() => child.stdout!.emit('data', '42\n')).not.toThrow();
      expect(controller.hasFatalError()).toBe(false);
    });

    it('defaults retryable to false when error.data is present but has no retryable field', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      emitRpcError(child, 1, { message: 'quota-ish', data: {} });
      expect(send).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          error: expect.objectContaining({ retryable: false, details: {} }),
        }),
      );
    });

    it('calling fail() a second time via an ungated event source (child error after stdin error) is a safe no-op', () => {
      // Both `child.on('error', ...)` and `stdin.on('error', ...)` call
      // fail() with no pre-check of their own — fail()'s own internal `if
      // (finished) return;` guard is what prevents a double 'error' send
      // when both fire. This is the one `if (finished) return;` guard in
      // this file that IS genuinely reachable (see source-map.md for the
      // contrast with the ones that were removed as dead).
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      child.stdin!.emit('error', new Error('first failure'));
      expect(controller.hasFatalError()).toBe(true);
      const sendCallsBefore = send.mock.calls.filter((c) => c[0] === 'error').length;
      expect(() => child.emit('error', new Error('second failure'))).not.toThrow();
      const sendCallsAfter = send.mock.calls.filter((c) => c[0] === 'error').length;
      expect(sendCallsAfter).toBe(sendCallsBefore);
    });
  });

  describe('AMR model-unavailable / account-failure promotion', () => {
    const matchingClassifier: AccountFailureClassifier = {
      classify: (text) =>
        text.includes('insufficient')
          ? { code: 'INSUFFICIENT_BALANCE', message: 'Recharge please.', action: 'recharge' }
          : null,
    };

    it('does not promote a retry-status update under the default no-op classifier', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(
        baseOptions(child, { send, modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' }),
      );
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'status_update', status: 'retry', message: 'insufficient balance' });
      expect(controller.hasFatalError()).toBe(false);
    });

    it('promotes a retry-status update to a fatal error when an injected classifier matches', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(
        baseOptions(child, {
          send,
          modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE',
          accountFailureClassifier: matchingClassifier,
        }),
      );
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'status_update', status: 'retry', message: 'insufficient balance here' });
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ error: expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }) }),
      );
    });

    it('promotes a matching AMR stderr chunk to a fatal error via the injected classifier', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(
        baseOptions(child, {
          send,
          modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE',
          accountFailureClassifier: matchingClassifier,
        }),
      );
      handshakeToSessionNew(child);
      child.stderr!.emit('data', 'opencode_event_stream_failure: retry, insufficient balance detected');
      expect(controller.hasFatalError()).toBe(true);
    });

    it('does not act on stderr once the session has already finished', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(
        baseOptions(child, { modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE', accountFailureClassifier: matchingClassifier }),
      );
      handshakeToSessionNew(child);
      emitResult(child, 3, {});
      expect(() =>
        child.stderr!.emit('data', 'opencode_event_stream_failure: retry, insufficient balance'),
      ).not.toThrow();
    });

    it('ignores stderr data entirely when modelUnavailableErrorCode is not set', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child, { accountFailureClassifier: matchingClassifier }));
      handshakeToSessionNew(child);
      child.stderr!.emit('data', 'opencode_event_stream_failure: retry, insufficient balance');
      expect(controller.hasFatalError()).toBe(false);
    });

    it('fails with a model-unavailable payload when the prompt completes with no visible output after model activity', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(
        baseOptions(child, { send, modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' }),
      );
      handshakeToSessionNew(child);
      emitResult(child, 3, { usage: { outputTokens: 5 } });
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          error: expect.objectContaining({ code: 'AGENT_EXECUTION_FAILED', details: expect.objectContaining({ kind: 'acp_no_visible_output' }) }),
        }),
      );
    });

    it('fails with a forced model-unavailable payload when there was no model activity at all', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(
        baseOptions(child, { send, modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' }),
      );
      handshakeToSessionNew(child);
      emitResult(child, 3, {});
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ error: expect.objectContaining({ code: 'AMR_MODEL_UNAVAILABLE' }) }),
      );
    });

    it('uses the model-unavailable payload shape when a failure message matches a model-not-found pattern', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send, modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' }));
      emitRpcError(child, 1, { message: 'Model not found: xyz' });
      expect(send).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ error: expect.objectContaining({ code: 'AMR_MODEL_UNAVAILABLE' }) }),
      );
    });

    it('recognises each model-not-found phrasing variant', () => {
      for (const phrase of ['ProviderModelNotFoundError', 'unknown model requested', 'invalid model id']) {
        const child = new FakeAcpChild();
        const send = vi.fn();
        attachAcpSession(baseOptions(child, { send, modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' }));
        emitRpcError(child, 1, { message: phrase });
        expect(send).toHaveBeenCalledWith(
          'error',
          expect.objectContaining({ error: expect.objectContaining({ code: 'AMR_MODEL_UNAVAILABLE' }) }),
        );
      }
    });

    it('emits acp_raw_event_shape diagnostics up to the configured limit when modelUnavailableErrorCode is set', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send, modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' }));
      handshakeToSessionNew(child);
      for (let i = 0; i < 10; i++) {
        emitUpdate(child, { sessionUpdate: 'plan', status: `step-${i}` });
      }
      const diagnosticCalls = send.mock.calls.filter(
        (c) => c[0] === 'agent' && (c[1] as any).name === 'acp_raw_event_shape',
      );
      expect(diagnosticCalls.length).toBe(8);
    });

    it('does not emit acp_raw_event_shape diagnostics when modelUnavailableErrorCode is unset', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'plan' });
      const diagnosticCalls = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).name === 'acp_raw_event_shape');
      expect(diagnosticCalls.length).toBe(0);
    });
  });

  describe('session/update: status and thinking events', () => {
    it('emits a status event with the raw sessionUpdate label for unknown update kinds', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'plan' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'plan', elapsedMs: expect.any(Number) });
    });

    it('falls back to "session_update" label when sessionUpdate is missing', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, {});
      expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'session_update', elapsedMs: expect.any(Number) });
    });

    it('emits thinking_start once, then thinking_delta for subsequent thought chunks', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'agent_thought_chunk', text: 'first thought' });
      emitUpdate(child, { sessionUpdate: 'agent_thought_chunk', text: 'second thought' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'thinking_start' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'thinking_delta', delta: 'first thought' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'thinking_delta', delta: 'second thought' });
    });

    it('sends no thinking_delta when the thought chunk carries no text', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      send.mockClear();
      emitUpdate(child, { sessionUpdate: 'agent_thought_chunk' });
      expect(send).not.toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'thinking_delta' }));
    });

    it('ignores an update with no method/params.update shape (falls through silently)', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      send.mockClear();
      emitLine(child, { jsonrpc: '2.0', method: 'session/update', params: {} });
      expect(controller.hasFatalError()).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('handles a cumulative-snapshot text update (delta computed from the shared prefix)', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'Hello' });
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'Hello world' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'text_delta', delta: 'Hello' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'text_delta', delta: ' world' });
    });

    it('treats a non-cumulative chunk as a delta directly', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'chunk one' });
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'chunk two' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'text_delta', delta: 'chunk one' });
      expect(send).toHaveBeenCalledWith('agent', { type: 'text_delta', delta: 'chunk two' });
    });

    it('sends nothing for an agent_message_chunk update with no extractable text', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      send.mockClear();
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk' });
      expect(send).not.toHaveBeenCalled();
    });

    it('sends nothing for a cumulative snapshot that repeats with no new characters', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'Hello' });
      send.mockClear();
      // Same cumulative snapshot resent verbatim: startsWith matches, but the
      // sliced delta is empty, so no text_delta should be emitted.
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'Hello' });
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('tool_call artifact-write mirroring', () => {
    it('mirrors a completed artifact-write tool call into tool_use/tool_result', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'Write file.html',
        status: 'completed',
        locations: [{ path: 'file.html' }],
      });
      expect(send).toHaveBeenCalledWith('agent', { type: 'tool_use', id: 'tc-1', name: 'Write', input: { file_path: 'file.html' } });
      expect(send).toHaveBeenCalledWith('agent', { type: 'tool_result', toolUseId: 'tc-1', isError: false });
    });

    it('mirrors a failed artifact-write tool call with isError: true', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'Write file.html', status: 'failed' });
      expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'tool_result', isError: true }));
    });

    it('falls back to the toolCallId as the file_path when no concrete path is found', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-9', title: 'edit', status: 'completed' });
      expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ input: { file_path: 'tc-9' } }));
    });

    it('does not double-emit tool_use/tool_result for the same toolCallId across multiple frames', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'in_progress' });
      emitUpdate(child, { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      emitUpdate(child, { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      const toolResultCalls = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'tool_result');
      expect(toolResultCalls).toHaveLength(1);
    });

    it('does not mirror a non-write tool call', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'read x.html', status: 'completed' });
      expect(send).not.toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'tool_use' }));
    });

    it('does not mirror a tool call with no toolCallId', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', title: 'write x.html', status: 'completed' });
      expect(send).not.toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'tool_use' }));
    });

    it('tracks a write toolCallId announced on an earlier frame and mirrors on the later completing frame', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      // First frame declares the write label; second frame (no label) completes it.
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'in_progress' });
      emitUpdate(child, { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'completed' });
      expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'tool_use', id: 'tc-1' }));
    });

    it('a subsequent tool_call frame prefers an already-known path over a later-arriving null', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'write x.html',
        status: 'in_progress',
        locations: [{ path: 'x.html' }],
      });
      emitUpdate(child, { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'completed' });
      expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ input: { file_path: 'x.html' } }));
    });
  });

  describe('DSML artifact + tool-call text suppression interplay', () => {
    it('arms the DSML suppressor on a completed artifact-write update and suppresses subsequent artifact echo text', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      send.mockClear();
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: '<artifact>hidden file body</artifact>' });
      const textDeltas = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'text_delta');
      expect(textDeltas).toHaveLength(0);
    });

    it('lets visible prose survive after the artifact echo block closes', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: '<artifact>hidden</artifact>Done!' });
      const textDeltas = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'text_delta');
      expect(textDeltas.some((c) => (c[1] as any).delta.includes('Done!'))).toBe(true);
    });

    it('suppresses tool_call XML echoed inline in message text', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'before <tool_call>hidden</tool_call> after' });
      const textDeltas = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'text_delta');
      const combined = textDeltas.map((c) => (c[1] as any).delta).join('');
      expect(combined).not.toContain('hidden');
      expect(combined).toContain('before');
      expect(combined).toContain('after');
    });

    it('flushes any buffered tool-call suppressor text on clean completion', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      // A dangling "<tool_c" candidate never resolves into a real tag before
      // the prompt completes; flush() at completion should surface it as
      // plain text rather than losing it silently.
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'trailing <tool_c' });
      emitResult(child, 3, {});
      const textDeltas = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'text_delta');
      const combined = textDeltas.map((c) => (c[1] as any).delta).join('');
      expect(combined).toContain('<tool_c');
    });

    it('disarms the DSML suppressor when its owning write tool call later fails', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      emitUpdate(child, { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'failed' });
      send.mockClear();
      // Suppression should no longer be armed, so plain artifact-shaped text
      // now streams through unsuppressed (module-level `<artifact>` text is
      // no longer intercepted once its owning write call failed after arming
      // — this exercises the disarm-on-terminal-failure branch).
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'unrelated text' });
      expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'text_delta', delta: 'unrelated text' }));
    });

    it('leaves the DSML suppressor untouched when an unrelated, never-armed tool call fails', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      // Arm the suppressor via tc-1's completed write, then fail an entirely
      // different tool call (tc-2) that never owned the pending suppression
      // or a pending write registration — the disarm guard must be a no-op.
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      emitUpdate(child, { sessionUpdate: 'tool_call_update', toolCallId: 'tc-2', title: 'run tests', status: 'failed' });
      send.mockClear();
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: '<artifact>still hidden</artifact>' });
      const textDeltas = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'text_delta');
      expect(textDeltas).toHaveLength(0);
    });

    it('fully suppresses a delta entirely consumed by tool-call XML, leaving nothing for the DSML stage', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      send.mockClear();
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: '<tool_call>entirely hidden</tool_call>' });
      const textDeltas = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'text_delta');
      expect(textDeltas).toHaveLength(0);
    });

    it('passes plain text through unchanged once the DSML suppressor is armed but the text has no tag markers at all', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      send.mockClear();
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'nothing special here at all' });
      expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'text_delta', delta: 'nothing special here at all' }));
    });

    it('flushes both a dangling tool-call candidate and an armed DSML suppressor together on clean completion', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      // Leave a dangling "<tool_c" candidate BEFORE the DSML suppressor is
      // armed, so arming (from the tool_call completion below) never
      // reprocesses that text through the DSML suppressor — which would
      // otherwise immediately disarm it again (strippedDelta compares
      // against the *pre-tool-call-stripping* original delta, so any
      // tool-call suppression in the same chunk looks like "artifact text
      // was consumed" and disarms it). This ordering keeps the DSML
      // suppressor genuinely still armed by the time finishCleanPrompt's
      // flush() runs, so its `?.strip(...)` call is actually exercised
      // rather than short-circuited.
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'trailing <tool_c' });
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      expect(() => emitResult(child, 3, {})).not.toThrow();
      const textDeltas = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'text_delta');
      const combined = textDeltas.map((c) => (c[1] as any).delta).join('');
      expect(combined).toContain('<tool_c');
    });

    it('caps acp_artifact_text_suppression / acp_tool_call_text_suppression diagnostics at the shared limit', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      for (let i = 0; i < 10; i++) {
        emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: `<tool_call>hidden ${i}</tool_call>` });
      }
      const suppressionDiagnostics = send.mock.calls.filter(
        (c) =>
          c[0] === 'agent' &&
          ((c[1] as any).name === 'acp_tool_call_text_suppression' || (c[1] as any).name === 'acp_artifact_text_suppression'),
      );
      expect(suppressionDiagnostics.length).toBeLessThanOrEqual(8);
      expect(suppressionDiagnostics.length).toBeGreaterThan(0);
    });

    it('preserves incremental prose preceding a self-contained artifact tag when the suppressor was armed before any text (not armed-after-text)', () => {
      // This exercises the "preserve incremental prose" heuristic branch
      // (session.ts's `shouldPreserveIncrementalProse`): when the DSML
      // suppressor was armed before any visible text, a prior delta already
      // passed through cleanly, and a *later*, non-cumulative delta both
      // opens and closes a self-contained artifact tag that does not start
      // at position 0 (so it doesn't look like a real artifact echo start),
      // the heuristic deliberately preserves the raw (unstripped) delta
      // rather than suppressing it — a known, documented trade-off of the
      // heuristic, not a bug.
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      // Arm the suppressor before any text has been emitted at all, so
      // `dsmlArtifactSuppressorArmedAfterText` is false.
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      // A clean pass-through delta (no tag markers) sets
      // `dsmlArtifactSuppressorSawIncrementalProse = true`.
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'note: ' });
      send.mockClear();
      // A fresh, non-cumulative delta (does not start with the prior
      // 'note: ' buffer) containing a self-contained artifact tag preceded
      // by prose.
      emitUpdate(child, {
        sessionUpdate: 'agent_message_chunk',
        text: 'extra <artifact>hidden</artifact>',
      });
      const textDeltas = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'text_delta');
      expect(textDeltas.length).toBeGreaterThan(0);
      const combined = textDeltas.map((c) => (c[1] as any).delta).join('');
      // The heuristic preserves the raw delta here rather than stripping it.
      expect(combined).toContain('extra');
    });

    it('caps acp_artifact_text_suppression diagnostics even when the shared counter was already exhausted by tool-call suppressions', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      // Exhaust the shared diagnostic counter via tool-call suppressions.
      for (let i = 0; i < 8; i++) {
        emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: `<tool_call>hidden ${i}</tool_call>` });
      }
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      send.mockClear();
      // Now trigger DSML artifact suppression — the counter is already at
      // the cap, so acp_artifact_text_suppression must not fire again.
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: '<artifact>hidden artifact</artifact>' });
      const artifactDiagnostics = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).name === 'acp_artifact_text_suppression');
      expect(artifactDiagnostics).toHaveLength(0);
    });

    it('an artifact echo that begins immediately after prior visible text is fully suppressed (armed-after-text)', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'Some prose first. ' });
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      send.mockClear();
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: '<artifact>body</artifact>' });
      const textDeltas = send.mock.calls.filter((c) => c[0] === 'agent' && (c[1] as any).type === 'text_delta');
      expect(textDeltas).toHaveLength(0);
    });

    it('passes a fresh, non-cumulative, tag-free delta through unchanged once armed after prior text', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'Some prose first. ' });
      // Arms the suppressor after visible text has already been sent
      // (dsmlArtifactSuppressorArmedAfterText = true).
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      send.mockClear();
      // A fresh, non-cumulative delta (does not start with the prior buffer)
      // with no tag markers at all: stripping is a no-op, so the delta
      // qualifies as plain prose directly, without needing the
      // sawIncrementalProse heuristic.
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'totally unrelated text' });
      expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'text_delta', delta: 'totally unrelated text' }));
    });
  });

  describe('permission requests', () => {
    it('fails closed when no permission handler was configured', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      emitPermissionRequest(child, 10, [
        { optionId: 'once', kind: 'allow_once' },
        { optionId: 'approve_for_session' },
      ]);
      expect(controller.hasFatalError()).toBe(true);
    });

    it('delegates a permission choice to an auditable injected handler', async () => {
      const child = new FakeAcpChild();
      const onPermissionRequest = vi.fn((request) => {
        expect(request).toMatchObject({
          requestId: 13,
          sessionId: 'sess-1',
          toolCall: { toolCallId: 'call-1', title: 'write file' },
          options: [{ optionId: 'reject', kind: 'reject_once' }],
        });
        return { outcome: 'selected' as const, optionId: 'reject' };
      });
      attachAcpSession(baseOptions(child, { onPermissionRequest }));
      handshakeToSessionNew(child);
      emitLine(child, {
        jsonrpc: '2.0',
        id: 13,
        method: 'session/request_permission',
        params: {
          sessionId: 'sess-1',
          toolCall: { toolCallId: 'call-1', title: 'write file' },
          options: [{ optionId: 'reject', kind: 'reject_once' }],
        },
      });
      expect(onPermissionRequest).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      expect(lastWrite(child)).toEqual({
        jsonrpc: '2.0',
        id: 13,
        result: { outcome: { outcome: 'selected', optionId: 'reject' } },
      });
    });

    it('defaults options to an empty list and replies with a cancelled outcome when the handler declines', async () => {
      const child = new FakeAcpChild();
      const onPermissionRequest = vi.fn((request) => {
        expect(request.options).toEqual([]);
        return { outcome: 'cancelled' as const };
      });
      attachAcpSession(baseOptions(child, { onPermissionRequest }));
      handshakeToSessionNew(child);
      emitLine(child, {
        jsonrpc: '2.0',
        id: 18,
        method: 'session/request_permission',
        params: { sessionId: 'sess-1', toolCall: { toolCallId: 'call-x' } },
      });
      expect(onPermissionRequest).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      expect(lastWrite(child)).toEqual({
        jsonrpc: '2.0',
        id: 18,
        result: { outcome: { outcome: 'cancelled' } },
      });
    });

    it('ignores a permission decision that resolves after the session has already aborted', async () => {
      const child = new FakeAcpChild();
      let resolveDecision: (decision: { outcome: 'selected'; optionId: string }) => void = () => {};
      const onPermissionRequest = () =>
        new Promise<{ outcome: 'selected'; optionId: string }>((resolve) => {
          resolveDecision = resolve;
        });
      const controller = attachAcpSession(baseOptions(child, { onPermissionRequest }));
      handshakeToSessionNew(child);
      emitPermissionRequest(child, 19, [{ optionId: 'allow', kind: 'allow_once' }]);
      controller.abort();
      const writesBeforeDecision = child.stdin!.writes.length;
      resolveDecision({ outcome: 'selected', optionId: 'allow' });
      await Promise.resolve();
      // respond() must see the session as already aborted/finished and bail
      // out without writing a second (now-meaningless) reply.
      expect(child.stdin!.writes.length).toBe(writesBeforeDecision);
    });

    it('awaits an asynchronous permission decision before replying', async () => {
      const child = new FakeAcpChild();
      attachAcpSession(
        baseOptions(child, {
          onPermissionRequest: async () => ({ outcome: 'selected', optionId: 'allow' }),
        }),
      );
      handshakeToSessionNew(child);
      emitPermissionRequest(child, 14, [{ optionId: 'allow', kind: 'allow_once' }]);
      expect(lastWrite(child)?.id).not.toBe(14);
      await Promise.resolve();
      expect(lastWrite(child)).toEqual({
        jsonrpc: '2.0',
        id: 14,
        result: { outcome: { outcome: 'selected', optionId: 'allow' } },
      });
    });

    it('fails when an injected handler selects an unavailable option', async () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(
        baseOptions(child, {
          send,
          onPermissionRequest: () => ({ outcome: 'selected', optionId: 'allow' }),
        }),
      );
      handshakeToSessionNew(child);
      emitPermissionRequest(child, 11, [{ optionId: 'deny', kind: 'reject_once' }]);
      await Promise.resolve();
      expect(controller.hasFatalError()).toBe(true);
    });

    it('fails when the permission request has a non-JSON-RPC-id id', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(
        baseOptions(child, {
          send,
          onPermissionRequest: () => ({ outcome: 'selected', optionId: 'approve_for_session' }),
        }),
      );
      handshakeToSessionNew(child);
      emitLine(child, {
        jsonrpc: '2.0',
        id: null,
        method: 'session/request_permission',
        params: { options: [{ optionId: 'approve_for_session' }] },
      });
      expect(controller.hasFatalError()).toBe(true);
    });

    it('fails when the stdin write for the permission reply throws', async () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(
        baseOptions(child, {
          send,
          onPermissionRequest: () => ({ outcome: 'selected', optionId: 'approve_for_session' }),
        }),
      );
      handshakeToSessionNew(child);
      child.stdin!.failWith = new Error('EPIPE');
      emitPermissionRequest(child, 12, [{ optionId: 'approve_for_session' }]);
      await Promise.resolve();
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('stdin write failed') }));
    });

    it('fails when the injected handler throws synchronously instead of returning or rejecting a promise', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(
        baseOptions(child, {
          send,
          onPermissionRequest: () => {
            throw new Error('sync handler boom');
          },
        }),
      );
      handshakeToSessionNew(child);
      emitPermissionRequest(child, 16, [{ optionId: 'allow', kind: 'allow_once' }]);
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('ACP permission handler failed') }),
      );
    });
  });

  describe('abort', () => {
    it('cancels a pending asynchronous permission request before closing stdin', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(
        baseOptions(child, {
          onPermissionRequest: () => new Promise(() => {}),
        }),
      );
      handshakeToSessionNew(child);
      emitPermissionRequest(child, 15, [{ optionId: 'allow', kind: 'allow_once' }]);
      controller.abort();
      expect(writesOf(child)).toContainEqual({
        jsonrpc: '2.0',
        id: 15,
        result: { outcome: { outcome: 'cancelled' } },
      });
      expect(child.stdin!.ended).toBe(true);
    });

    it('swallows a failure cancelling a pending permission request during abort and still closes stdin', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(
        baseOptions(child, {
          onPermissionRequest: () => new Promise(() => {}),
        }),
      );
      handshakeToSessionNew(child);
      emitPermissionRequest(child, 17, [{ optionId: 'allow', kind: 'allow_once' }]);
      child.stdin!.failWith = new Error('EPIPE on cancel reply');
      expect(() => controller.abort()).not.toThrow();
      expect(child.stdin!.ended).toBe(true);
    });

    it('sends session/cancel and closes stdin when a session is already established', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      controller.abort();
      const cancelCall = writesOf(child).find((w) => w.method === 'session/cancel');
      expect(cancelCall).toMatchObject({ params: { sessionId: 'sess-1' } });
      expect(child.stdin!.ended).toBe(true);
    });

    it('closes stdin without a session/cancel call when aborted before session/new resolves', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      controller.abort();
      const cancelCall = writesOf(child).find((w) => w.method === 'session/cancel');
      expect(cancelCall).toBeUndefined();
      expect(child.stdin!.ended).toBe(true);
    });

    it('is idempotent — a second abort() call is a no-op', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      controller.abort();
      const writesBefore = child.stdin!.writes.length;
      controller.abort();
      expect(child.stdin!.writes.length).toBe(writesBefore);
    });

    it('is a no-op once the session already finished', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      emitResult(child, 3, {});
      const writesBefore = child.stdin!.writes.length;
      controller.abort();
      expect(child.stdin!.writes.length).toBe(writesBefore);
    });

    it('returns early when stdin is already destroyed/ended, without throwing', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      child.stdin!.destroyed = true;
      expect(() => controller.abort()).not.toThrow();
    });

    it('swallows a session/cancel write failure and still closes stdin', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      child.stdin!.failWith = new Error('write failed');
      expect(() => controller.abort()).not.toThrow();
    });

    it('swallows a stdin.end() failure during abort()', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      child.stdin!.failEndWith = new Error('already closing');
      expect(() => controller.abort()).not.toThrow();
    });

    it('marks completedSuccessfully() false after an abort', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      controller.abort();
      expect(controller.completedSuccessfully()).toBe(false);
    });
  });

  describe('unexpected exit and stage timeout', () => {
    it('fails when the child exits before completion', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      child.emit('close', 1, null);
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('exited before completion') }));
    });

    it('includes a literal "null" in the failure message when the exit code itself is null', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      child.emit('close', null, null);
      expect(send).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('code=null, signal=none') }),
      );
    });

    it('does not double-fail on close after a clean finish', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      emitResult(child, 3, {});
      expect(() => child.emit('close', 0, null)).not.toThrow();
      expect(controller.hasFatalError()).toBe(false);
    });

    it('does not fail on close after an abort', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      controller.abort();
      expect(() => child.emit('close', null, 'SIGTERM')).not.toThrow();
      expect(controller.hasFatalError()).toBe(false);
    });

    it('fails when the stage watchdog times out with no activity', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send, stageTimeoutMs: 1000 }));
      vi.advanceTimersByTime(1001);
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('timed out after') }));
    });

    it('resets the stage watchdog on each received line, so steady activity never times out', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child, { stageTimeoutMs: 1000 }));
      emitResult(child, 1, {});
      vi.advanceTimersByTime(900);
      emitResult(child, 2, { sessionId: 'sess-1' });
      vi.advanceTimersByTime(900);
      expect(controller.hasFatalError()).toBe(false);
    });

    it('disables the stage watchdog entirely when stageTimeoutMs <= 0', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child, { stageTimeoutMs: 0 }));
      vi.advanceTimersByTime(10_000_000);
      expect(controller.hasFatalError()).toBe(false);
    });
  });

  describe('transport-level failures', () => {
    it('fails when the child process itself errors', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      child.emit('error', new Error('spawn exploded'));
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith('error', { message: 'spawn exploded' });
    });

    it('fails when stdin itself errors', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      child.stdin!.emit('error', new Error('EPIPE'));
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith('error', { message: 'stdin error: EPIPE' });
    });

    it('fails when the initial stdin write throws', () => {
      const child = new FakeAcpChild();
      child.stdin!.failWith = new Error('cannot write');
      const send = vi.fn();
      const controller = attachAcpSession(baseOptions(child, { send }));
      expect(controller.hasFatalError()).toBe(true);
      expect(send).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('stdin write failed') }));
    });

    it('ignores stdout data once aborted', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      handshakeToSessionNew(child);
      controller.abort();
      expect(() => emitResult(child, 999, {})).not.toThrow();
    });

    it('flushes the parser on stdout close', () => {
      const child = new FakeAcpChild();
      const controller = attachAcpSession(baseOptions(child));
      child.stdout!.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
      child.stdout!.emit('close');
      expect(controller.hasFatalError()).toBe(false);
    });
  });

  describe('executionProfile diagnostics', () => {
    it('emits an unexpected_text_artifact_in_filesystem_run diagnostic when suppression occurs under the default filesystem profile', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: '<artifact>hidden</artifact>' });
      emitResult(child, 3, {});
      const names = send.mock.calls.filter((c) => c[0] === 'agent').map((c) => (c[1] as any).name);
      expect(names).toContain('unexpected_text_artifact_in_filesystem_run');
      expect(names).toContain('acp_artifact_text_suppression_summary');
    });

    it('does not emit the filesystem-run diagnostic under the text_artifact execution profile', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send, executionProfile: 'text_artifact' }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'write x.html', status: 'completed' });
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: '<artifact>hidden</artifact>' });
      emitResult(child, 3, {});
      const names = send.mock.calls.filter((c) => c[0] === 'agent').map((c) => (c[1] as any).name);
      expect(names).not.toContain('unexpected_text_artifact_in_filesystem_run');
    });

    it('emits a tool-call-suppression summary when tool_call/edit-tagged text was actually suppressed during the run', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'before <tool_call>hidden</tool_call> after' });
      emitResult(child, 3, {});
      const names = send.mock.calls.filter((c) => c[0] === 'agent').map((c) => (c[1] as any).name);
      expect(names).toContain('acp_tool_call_text_suppression_summary');
    });

    it('does not emit a tool-call-suppression summary when nothing was suppressed', () => {
      const child = new FakeAcpChild();
      const send = vi.fn();
      attachAcpSession(baseOptions(child, { send }));
      handshakeToSessionNew(child);
      emitUpdate(child, { sessionUpdate: 'agent_message_chunk', text: 'plain text, nothing suppressed' });
      emitResult(child, 3, {});
      const names = send.mock.calls.filter((c) => c[0] === 'agent').map((c) => (c[1] as any).name);
      expect(names).not.toContain('acp_tool_call_text_suppression_summary');
    });
  });

  describe('MCP servers and env format passthrough', () => {
    it('forwards mcpServers into the session/new params', () => {
      const child = new FakeAcpChild();
      attachAcpSession(
        baseOptions(child, {
          mcpServers: [{ name: 'srv', command: 'cmd' }],
          envFormat: 'map',
        }),
      );
      emitResult(child, 1, {});
      expect(writesOf(child)[1].params.mcpServers).toEqual([
        { type: 'stdio', name: 'srv', command: 'cmd', args: [], env: {} },
      ]);
    });

    it('omits mcpServers key from options when not provided (still passes envFormat through)', () => {
      const child = new FakeAcpChild();
      attachAcpSession(baseOptions(child, { envFormat: 'map' }));
      emitResult(child, 1, {});
      expect(writesOf(child)[1].params.mcpServers).toEqual([]);
    });
  });

  describe('cwd resolution', () => {
    it('defaults to process.cwd() when cwd is not provided', () => {
      const child = new FakeAcpChild();
      attachAcpSession(baseOptions(child));
      emitResult(child, 1, {});
      expect(writesOf(child)[1].params.cwd).toBe(process.cwd());
    });
  });

  describe('image paths in the prompt', () => {
    it('includes resource_link blocks for provided imagePaths', () => {
      const child = new FakeAcpChild();
      attachAcpSession(baseOptions(child, { imagePaths: ['/tmp/a.png'] }));
      handshakeToSessionNew(child);
      expect(writesOf(child)[2].params.prompt).toEqual([
        { type: 'text', text: 'hello agent' },
        { type: 'resource_link', uri: '/tmp/a.png' },
      ]);
    });
  });
});
