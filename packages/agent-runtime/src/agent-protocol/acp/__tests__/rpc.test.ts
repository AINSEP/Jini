import { describe, expect, it, vi } from 'vitest';
import {
  sendRpc,
  sendRpcResult,
  isJsonRpcId,
  rpcErrorMessage,
  rpcErrorData,
  rpcErrorRetryable,
  promotedOpenCodeSessionErrorPayload,
  formatUsage,
  choosePermissionOutcome,
} from '../rpc.js';

function fakeWritable() {
  const writes: string[] = [];
  return {
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
    end: vi.fn(),
    writes,
  };
}

describe('sendRpc', () => {
  it('writes a newline-terminated JSON-RPC 2.0 request frame', () => {
    const w = fakeWritable();
    sendRpc({ writable: w, id: 1, method: 'initialize', params: { a: 1 } });
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]!.endsWith('\n')).toBe(true);
    expect(JSON.parse(w.writes[0]!)).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { a: 1 } });
  });
});

describe('sendRpcResult', () => {
  it('writes a newline-terminated JSON-RPC 2.0 result frame', () => {
    const w = fakeWritable();
    sendRpcResult({ writable: w, id: 'req-1', result: { ok: true } });
    expect(JSON.parse(w.writes[0]!)).toEqual({ jsonrpc: '2.0', id: 'req-1', result: { ok: true } });
  });
});

describe('isJsonRpcId', () => {
  it('accepts numbers and strings', () => {
    expect(isJsonRpcId(1)).toBe(true);
    expect(isJsonRpcId('abc')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isJsonRpcId(null)).toBe(false);
    expect(isJsonRpcId(undefined)).toBe(false);
    expect(isJsonRpcId({})).toBe(false);
    expect(isJsonRpcId(true)).toBe(false);
  });
});

describe('rpcErrorMessage', () => {
  it('C36: returns a fallback for empty error messages with null or string ids', () => {
    const messages = [null, 'request-1'].map((id) =>
      rpcErrorMessage({ raw: { jsonrpc: '2.0', id, error: { code: -32000, message: '' } } }));
    expect(messages).toEqual(['-32000', '-32000']);
  });

  it('returns "" for a non-object', () => {
    expect(rpcErrorMessage({ raw: null })).toBe('');
    expect(rpcErrorMessage({ raw: 'x' })).toBe('');
  });

  it('returns "" when there is no error field', () => {
    expect(rpcErrorMessage({ raw: { result: {} } })).toBe('');
  });

  it('uses error.message when present, prefixed with the numeric id', () => {
    expect(rpcErrorMessage({ raw: { id: 5, error: { message: 'bad thing' } } })).toBe('json-rpc id 5: bad thing');
  });

  it('uses error.message without an id prefix when id is a string', () => {
    expect(rpcErrorMessage({ raw: { id: 'x', error: { message: 'bad thing' } } })).toBe('bad thing');
  });

  it('falls back to the numeric error code when message is absent', () => {
    expect(rpcErrorMessage({ raw: { error: { code: -32603 } } })).toBe('-32603');
  });

  it('falls back to a generic label when neither message nor numeric code is present', () => {
    expect(rpcErrorMessage({ raw: { error: {} } })).toBe('json-rpc error');
  });

  it('does not prefix with an id when the id field is absent', () => {
    expect(rpcErrorMessage({ raw: { error: { message: 'oops' } } })).toBe('oops');
  });
});

describe('rpcErrorData', () => {
  it('returns error.data when present', () => {
    expect(rpcErrorData({ raw: { error: { data: { retryable: true } } } })).toEqual({ retryable: true });
  });

  it('returns undefined when there is no error object', () => {
    expect(rpcErrorData({ raw: { result: {} } })).toBeUndefined();
  });

  it('returns undefined when the error object has no data field', () => {
    expect(rpcErrorData({ raw: { error: { message: 'x' } } })).toBeUndefined();
  });
});

describe('rpcErrorRetryable', () => {
  it('returns the boolean retryable field', () => {
    expect(rpcErrorRetryable({ data: { retryable: true } })).toBe(true);
    expect(rpcErrorRetryable({ data: { retryable: false } })).toBe(false);
  });

  it('returns undefined when retryable is missing or not a boolean', () => {
    expect(rpcErrorRetryable({ data: {} })).toBeUndefined();
    expect(rpcErrorRetryable({ data: { retryable: 'yes' } })).toBeUndefined();
    expect(rpcErrorRetryable({ data: null })).toBeUndefined();
  });
});

describe('promotedOpenCodeSessionErrorPayload', () => {
  it('returns null when the data payload does not match the expected shape', () => {
    expect(promotedOpenCodeSessionErrorPayload({ data: null, fallbackMessage: 'fallback' })).toBeNull();
    expect(promotedOpenCodeSessionErrorPayload({ data: { kind: 'other' }, fallbackMessage: 'fallback' })).toBeNull();
    expect(
      promotedOpenCodeSessionErrorPayload(
        { data: { kind: 'opencode_session_error', source: 'other', code: 'ROLE_MARKER_HALLUCINATION' }, fallbackMessage: 'fallback' },
      ),
    ).toBeNull();
    expect(
      promotedOpenCodeSessionErrorPayload(
        { data: { kind: 'opencode_session_error', source: 'opencode', code: 'OTHER' }, fallbackMessage: 'fallback' },
      ),
    ).toBeNull();
  });

  it('promotes a matching payload, using the fallback message when data.message is blank', () => {
    const payload = promotedOpenCodeSessionErrorPayload(
      { data: { kind: 'opencode_session_error', source: 'opencode', code: 'ROLE_MARKER_HALLUCINATION' }, fallbackMessage: 'fallback message' },
    );
    expect(payload).toEqual({
      message: 'fallback message',
      error: {
        code: 'ROLE_MARKER_HALLUCINATION',
        message: 'fallback message',
        retryable: true,
        details: {
          kind: 'opencode_session_error',
          source: 'opencode',
          code: 'ROLE_MARKER_HALLUCINATION',
          promoted_by: 'agent_runtime_acp',
        },
      },
    });
  });

  it('uses data.message when present, and honors an explicit retryable: false', () => {
    const payload = promotedOpenCodeSessionErrorPayload(
      { data: {
        kind: 'opencode_session_error',
        source: 'opencode',
        code: 'ROLE_MARKER_HALLUCINATION',
        message: '  real message  ',
        retryable: false,
      }, fallbackMessage: 'fallback' },
    );
    expect(payload?.message).toBe('real message');
    expect(payload?.error.retryable).toBe(false);
  });
});

describe('formatUsage', () => {
  it('returns null for a non-object', () => {
    expect(formatUsage({ usage: null })).toBeNull();
    expect(formatUsage({ usage: 'x' })).toBeNull();
  });

  it('returns null when no known numeric fields are present', () => {
    expect(formatUsage({ usage: {} })).toBeNull();
    expect(formatUsage({ usage: { inputTokens: 'not a number' } })).toBeNull();
  });

  it('maps all known camelCase fields to their snake_case equivalents', () => {
    expect(
      formatUsage({ usage: {
        inputTokens: 1,
        outputTokens: 2,
        cachedReadTokens: 3,
        thoughtTokens: 4,
        totalTokens: 5,
      } }),
    ).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      cached_read_tokens: 3,
      thought_tokens: 4,
      total_tokens: 5,
    });
  });

  it('includes only the fields that are present', () => {
    expect(formatUsage({ usage: { inputTokens: 1 } })).toEqual({ input_tokens: 1 });
  });
});

describe('choosePermissionOutcome', () => {
  it('returns null for a non-array', () => {
    expect(choosePermissionOutcome({ options: null })).toBeNull();
    expect(choosePermissionOutcome({ options: undefined })).toBeNull();
  });

  it('uses allow_once in bypass mode rather than a session-wide approval', () => {
    expect(
      choosePermissionOutcome({ options: [
        { optionId: 'allow_once', kind: 'allow_once' },
        { optionId: 'approve_for_session' },
      ] }, { permissionMode: 'bypass' }),
    ).toBe('allow_once');
  });

  it('prefers allow_once over allow_always in bypass mode', () => {
    expect(
      choosePermissionOutcome({ options: [
        { optionId: 'allow_once', kind: 'allow_once' },
        { optionId: 'always-id', kind: 'allow_always' },
      ] }, { permissionMode: 'bypass' }),
    ).toBe('allow_once');
  });

  it('selects allow_once when bypass is explicit', () => {
    expect(choosePermissionOutcome({ options: [{ optionId: 'once-id', kind: 'allow_once' }] }, { permissionMode: 'bypass' })).toBe('once-id');
  });

  it('rejects once by default', () => {
    expect(choosePermissionOutcome({ options: [{ optionId: 'deny', kind: 'reject_once' }] })).toBe('deny');
  });

  it('returns null when an allow_always option has no optionId', () => {
    expect(choosePermissionOutcome({ options: [{ kind: 'allow_always' }] })).toBeNull();
  });

  it('returns null when an allow_once option has no optionId', () => {
    expect(choosePermissionOutcome({ options: [{ kind: 'allow_once' }] }, { permissionMode: 'bypass' })).toBeNull();
  });

  it('rejects rather than broadening a bypass approval when allow_once is absent', () => {
    expect(choosePermissionOutcome({ options: [{ optionId: 'always', kind: 'allow_always' }, { optionId: 'deny', kind: 'reject_once' }] }, { permissionMode: 'bypass' })).toBe('deny');
  });

  it('falls back to reject_always when reject_once is absent', () => {
    expect(choosePermissionOutcome({ options: [{ optionId: 'deny-all', kind: 'reject_always' }] })).toBe('deny-all');
  });

  it('does not authorize an unknown kind, empty id, or malformed option', () => {
    expect(choosePermissionOutcome({ options: [null, 7, { optionId: '', kind: 'reject_once' }, { optionId: 'unknown', kind: 'approve' }] })).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(choosePermissionOutcome({ options: [] })).toBeNull();
  });
});
