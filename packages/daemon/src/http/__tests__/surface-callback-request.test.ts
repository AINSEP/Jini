import assert from 'node:assert/strict';
import { test } from 'vitest';
import { SURFACE_EXCHANGE_ID_PARAM, SURFACE_TYPED_ANSWER_PARAM } from '@jini-ai/core';

import {
  executeSurfaceRedemption, isTypedSurfaceAnswer, parseSurfaceCallbackRequest, surfaceCallbackExchangeId,
  surfaceCallbackRefusalBody, surfaceNotPendingBody, surfaceRedemptionReply, SURFACE_TYPED_ANSWER_REFUSAL,
} from '../surface-callback-request.js';
import type { ToolExecutionResult } from '../../tool-executor-types.js';

const admitAll = () => true;

test('isTypedSurfaceAnswer needs a non-blank string answer param and coerces nothing else', () => {
  assert.equal(isTypedSurfaceAnswer({ params: { [SURFACE_TYPED_ANSWER_PARAM]: ' yes ' } }), true);
  assert.equal(isTypedSurfaceAnswer({ params: { [SURFACE_TYPED_ANSWER_PARAM]: '   ' } }), false);
  assert.equal(isTypedSurfaceAnswer({ params: { [SURFACE_TYPED_ANSWER_PARAM]: 42 } }), false);
  assert.equal(isTypedSurfaceAnswer({ params: {} }), false);
});

test('surfaceCallbackExchangeId prefers the top-level id, falls back to the param carrier, ignores empty/non-string', () => {
  assert.equal(surfaceCallbackExchangeId({ bodyExchangeId: 'top', params: { [SURFACE_EXCHANGE_ID_PARAM]: 'param' } }), 'top');
  assert.equal(surfaceCallbackExchangeId({ bodyExchangeId: undefined, params: { [SURFACE_EXCHANGE_ID_PARAM]: 'param' } }), 'param');
  assert.equal(surfaceCallbackExchangeId({ bodyExchangeId: '', params: { [SURFACE_EXCHANGE_ID_PARAM]: 'param' } }), undefined);
  assert.equal(surfaceCallbackExchangeId({ bodyExchangeId: 7, params: { [SURFACE_EXCHANGE_ID_PARAM]: 8 } }), undefined);
});

test('parseSurfaceCallbackRequest refuses a missing/empty toolName with 400 before consulting the allowlist', () => {
  for (const body of [null, undefined, {}, { toolName: '' }, { toolName: 3 }]) {
    const parsed = parseSurfaceCallbackRequest({ body, admit: () => assert.fail('admit must not run') });
    assert.deepEqual(parsed, { ok: false, reply: { status: 400, body: { error: "'toolName' must be a non-empty string", code: 'VALIDATION_ERROR' } } });
  }
});

test('parseSurfaceCallbackRequest decides the answer shape before the allowlist and 403s with the matching copy', () => {
  const seen: unknown[] = [];
  const refuse = (input: unknown) => { seen.push(input); return false; };
  const plain = parseSurfaceCallbackRequest({ body: { toolName: 'writer', params: [] }, admit: refuse });
  assert.deepEqual(plain, { ok: false, reply: { status: 403, body: { error: "'writer' is not an MCP-UI-redeemable tool", code: 'TOOL_NOT_ALLOWLISTED' } } });
  const typed = parseSurfaceCallbackRequest({ body: { toolName: 'ask', params: { [SURFACE_TYPED_ANSWER_PARAM]: 'blue' } }, admit: refuse });
  assert.deepEqual(typed, { ok: false, reply: { status: 403, body: { error: SURFACE_TYPED_ANSWER_REFUSAL, code: 'TOOL_NOT_ALLOWLISTED' } } });
  parseSurfaceCallbackRequest({ body: { toolName: 'ask', exchangeId: 'ex-1' }, admit: refuse });
  assert.deepEqual(seen, [
    { toolName: 'writer', answersAnExchange: false, typedAnswer: false },
    { toolName: 'ask', answersAnExchange: true, typedAnswer: true },
    { toolName: 'ask', answersAnExchange: true, typedAnswer: false },
  ]);
});

test('parseSurfaceCallbackRequest returns the shaped request; non-object params become {}', () => {
  assert.deepEqual(parseSurfaceCallbackRequest({ body: { toolName: 't', params: 'x', exchangeId: 'ex' }, admit: admitAll }),
    { ok: true, request: { toolName: 't', params: {}, exchangeId: 'ex' } });
  assert.deepEqual(parseSurfaceCallbackRequest({ body: { toolName: 't', params: { a: 1 } }, admit: admitAll }),
    { ok: true, request: { toolName: 't', params: { a: 1 }, exchangeId: undefined } });
});

test('refusal and not-pending bodies keep their wire shape', () => {
  assert.deepEqual(surfaceCallbackRefusalBody({ toolId: 'x', typedAnswer: false }), { error: "'x' is not an MCP-UI-redeemable tool", code: 'TOOL_NOT_ALLOWLISTED' });
  assert.deepEqual(surfaceNotPendingBody({ reason: 'unknown-or-closed' }),
    { error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'unknown-or-closed' });
});

test('surfaceRedemptionReply maps every execution status onto its status + body', () => {
  const reply = (result: Partial<ToolExecutionResult>) => surfaceRedemptionReply({ toolName: 't', principalId: 'p', result: { executionId: 'e', ...result } as ToolExecutionResult });
  assert.deepEqual(reply({ status: 'completed', output: { a: 1 } }), { status: 200, body: { a: 1 } });
  assert.deepEqual(reply({ status: 'completed' }), { status: 200, body: {} });
  assert.deepEqual(reply({ status: 'denied' }), { status: 403, body: { error: "principal 'p' is not authorized to call 't'", code: 'FORBIDDEN' } });
  assert.deepEqual(reply({ status: 'confirmation-denied' }), { status: 409, body: { error: "'t' declined to run without a further confirmation this endpoint cannot supply", code: 'CONFLICT' } });
  assert.deepEqual(reply({ status: 'timed-out' }), { status: 504, body: { error: "'t' timed out", code: 'GATEWAY_TIMEOUT' } });
  assert.deepEqual(reply({ status: 'cancelled' }), { status: 500, body: { error: "'t' was cancelled before it completed", code: 'INTERNAL_ERROR' } });
  assert.deepEqual(reply({ status: 'failed', error: 'boom' }), { status: 400, body: { error: 'boom', code: 'TOOL_CALL_FAILED' } });
  assert.deepEqual(reply({ status: 'failed' }), { status: 400, body: { error: "'t' failed", code: 'TOOL_CALL_FAILED' } });
});

test('executeSurfaceRedemption runs under a fresh synthetic run and turns a throw into a 500', async () => {
  const calls: unknown[] = [];
  const idGenerator = { newId: () => 'id-1' };
  const ok = await executeSurfaceRedemption({ idGenerator, toolName: 't', params: { a: 1 }, principalId: 'p',
    toolExecutor: { execute: async (input) => { calls.push(input); return { executionId: 'e', status: 'completed', output: { done: true } }; } } });
  assert.deepEqual(ok, { status: 200, body: { done: true } });
  assert.deepEqual(calls, [{ principal: { id: 'p' }, run: { id: 'mcp-ui-redemption:id-1' }, toolId: 't', input: { a: 1 } }]);
  const thrown = await executeSurfaceRedemption({ idGenerator, toolName: 't', params: {}, principalId: 'p',
    toolExecutor: { execute: async () => { throw new Error('unregistered'); } } });
  assert.deepEqual(thrown, { status: 500, body: { error: 'unregistered', code: 'INTERNAL_ERROR' } });
});
