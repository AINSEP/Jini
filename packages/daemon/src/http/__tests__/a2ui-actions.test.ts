import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseRendererToAgentMessage } from '@jini-ai/protocol/a2ui';

import { a2uiNotPendingBody, deliverA2uiAction, readA2uiAction } from '../a2ui-actions.js';

const ACTION = { version: 'v1.0', action: { name: 'submit', surfaceId: 'ex-1', sourceComponentId: 'btn', timestamp: '2026-01-01T00:00:00Z', context: {} } };

test('rejects an invalid exchangeId even when a valid functionResponse has no surfaceId', () => {
  // A surface-scoped action would let the later surfaceId cross-check mask a missing ID guard.
  const message = { version: 'v1.0', functionResponse: { functionCallId: 'call-1', call: 'greetUser', value: 'hi' } };
  for (const exchangeId of [undefined, null, '', 42]) {
    assert.deepEqual(readA2uiAction({ parseRendererMessage: parseRendererToAgentMessage, rawBody: { exchangeId, message } }), {
      ok: false,
      error: { error: "'exchangeId' must be a non-empty string", code: 'VALIDATION_ERROR' },
    });
  }
});

test('rejects a null or absent A2UI body with a validation error', () => {
  for (const body of [null, undefined]) {
    assert.deepEqual(readA2uiAction({ parseRendererMessage: parseRendererToAgentMessage, rawBody: body }), {
      ok: false,
      error: { error: "'exchangeId' must be a non-empty string", code: 'VALIDATION_ERROR' },
    });
  }
});

test('refuses a schema-invalid message with the schema reason, and a mismatched declared surfaceId', () => {
  const invalid = readA2uiAction({ parseRendererMessage: parseRendererToAgentMessage, rawBody: { exchangeId: 'ex-1', message: { version: 'v1.0', action: { name: 'x' } } } });
  assert.equal(invalid.ok, false);
  assert.equal(!invalid.ok && invalid.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(readA2uiAction({ parseRendererMessage: parseRendererToAgentMessage, rawBody: { exchangeId: 'ex-2', message: ACTION } }), {
    ok: false,
    error: { error: 'message declares surfaceId "ex-1", which does not match exchangeId "ex-2"', code: 'VALIDATION_ERROR' },
  });
});

test('accepts a matching action and delivers it on the a2ui channel with no toolId', () => {
  const read = readA2uiAction({ parseRendererMessage: parseRendererToAgentMessage, rawBody: { exchangeId: 'ex-1', message: ACTION } });
  assert.equal(read.ok, true);
  const calls: unknown[] = [];
  const store = { deliver: (...args: unknown[]) => { calls.push(args); return { ok: true } as const; } };
  const result = deliverA2uiAction({ store: store as never, exchangeId: 'ex-1', principalId: 'p', message: read.ok ? read.message : ACTION as never });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [[{ exchangeId: 'ex-1', principalId: 'p', params: { message: read.ok ? read.message : null } }, { channel: 'a2ui' }]]);
  assert.deepEqual(a2uiNotPendingBody({ reason: 'unknown-or-closed' }),
    { error: 'that surface is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'unknown-or-closed' });
});

test('checks a renderer error’s declared surface but accepts errors correlated solely by function call', () => {
  const read = (message: unknown) => readA2uiAction({ parseRendererMessage: parseRendererToAgentMessage, rawBody: { exchangeId: 'ex-2', message } });
  const wrong = { version: 'v1.0', error: { code: 'VALIDATION_FAILED', surfaceId: 'ex-1', path: '/components/0', message: 'Missing label' } };
  assert.deepEqual(read(wrong), { ok: false, error: {
    error: 'message declares surfaceId "ex-1", which does not match exchangeId "ex-2"', code: 'VALIDATION_ERROR',
  } });
  const functionError = { version: 'v1.0', error: { code: 'CALL_FAILED', functionCallId: 'call-1', message: 'No result' } };
  assert.deepEqual(read(functionError), { ok: true, exchangeId: 'ex-2', message: functionError });
});
