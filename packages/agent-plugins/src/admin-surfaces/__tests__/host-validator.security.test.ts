/**
 * @file Negative tests for the host page's postMessage gate (`host-validator.ts`): every field of the
 * action-request and resize envelopes is broken ONE AT A TIME against an otherwise valid message, so
 * removing or weakening any single check (protocol, version, kind, mountId type, requestId type and
 * pattern, action type, payload presence, non-object data) makes a test fail. Closes Stryker run-2
 * survivors at host-validator.ts:42-50 and :97, :112, :114. Frames and events are plain fakes.
 */
import { describe, expect, test } from 'vitest';
import {
  REQUEST_ID_PATTERN, frameTransportRefusal, readAdminSurfaceResize, validateAdminSurfaceMessage,
  type AdminSurfaceMountRecord,
} from '../host-validator.js';

const frame = {};
const descriptor: AdminSurfaceMountRecord['descriptor'] = {
  actions: [{ name: 'save', effect: 'write', input: { type: 'object', properties: { title: { type: 'string', maxLength: 5 } }, required: ['title'], additionalProperties: false } }],
} as unknown as AdminSurfaceMountRecord['descriptor'];
const mount: AdminSurfaceMountRecord = { mountId: 'm-1', frame, descriptor };
const valid = { protocol: 'jini.admin-surface', version: 1, kind: 'action-request', mountId: 'm-1', requestId: 'r-1', action: 'save', payload: { title: 'ok' } };
const judge = (data: unknown, overrides: Record<string, unknown> = {}) =>
  validateAdminSurfaceMessage({ event: { origin: 'null', source: frame, data, ...overrides }, mount });

describe('validateAdminSurfaceMessage: envelope fields, each broken alone', () => {
  test('the valid baseline is accepted and returns the request itself', () => {
    expect(judge(valid)).toEqual({ ok: true, request: valid });
  });

  test.each<[string, Record<string, unknown>]>([
    ['wrong protocol', { protocol: 'jini.admin-surfacE' }],
    ['missing protocol', { protocol: undefined }],
    ['wrong version', { version: 2 }],
    ['version as a string', { version: '1' }],
    ['wrong kind', { kind: 'resize' }],
    ['open-link kind', { kind: 'open-link-request' }],
    ['non-string mountId', { mountId: 1 }],
    ['non-string requestId', { requestId: 7 }],
    ['requestId failing the pattern', { requestId: 'r 1' }],
    ['empty requestId', { requestId: '' }],
    ['non-string action', { action: ['save'] }],
  ])('%s is ignored as not-an-action-request', (_name, override) => {
    expect(judge({ ...valid, ...override })).toEqual({ ok: false, ignored: 'not-an-action-request' });
  });

  test('a payload key that is only inherited (not own) is not a request', () => {
    const { payload: _payload, ...rest } = valid;
    expect(judge(Object.assign(Object.create({ payload: {} }), rest))).toEqual({ ok: false, ignored: 'not-an-action-request' });
  });

  test.each([[null], [undefined], ['action-request'], [0], [true]])('non-object data %j is ignored, never thrown on', (data) => {
    expect(judge(data)).toEqual({ ok: false, ignored: 'not-an-action-request' });
  });

  test('another mount\'s well-formed request is ignored as mount-mismatch, not refused', () => {
    expect(judge({ ...valid, mountId: 'm-2' })).toEqual({ ok: false, ignored: 'mount-mismatch' });
  });

  test('transport is checked before the envelope: wrong origin or window wins over a bad body', () => {
    expect(judge(null, { origin: 'https://evil.example' })).toEqual({ ok: false, ignored: 'origin-mismatch' });
    expect(judge(valid, { source: {} })).toEqual({ ok: false, ignored: 'source-mismatch' });
    expect(frameTransportRefusal({ event: { origin: 'null', source: frame, data: null }, mount })).toBeNull();
  });
});

describe('validateAdminSurfaceMessage: refusals answer the surface with a non-retryable error', () => {
  const refusal = (code: string) => ({
    ok: false, refused: code,
    response: expect.objectContaining({ kind: 'action-response', mountId: 'm-1', requestId: 'r-1', ok: false, error: expect.objectContaining({ code, retryable: false }) }),
  });

  test('an undeclared action is refused as action-undeclared', () => {
    expect(judge({ ...valid, action: 'delete' })).toEqual(refusal('action-undeclared'));
  });

  test('an oversized payload is refused before its schema is walked', () => {
    expect(judge({ ...valid, payload: { title: 'x'.repeat(70_000) } })).toEqual(refusal('invalid-payload'));
    expect((judge({ ...valid, payload: { title: 'x'.repeat(70_000) } }) as { response: { error: { message: string } } }).response.error.message).toBe('The request is too large.');
  });

  test('a payload not matching the input schema is refused, naming the violation', () => {
    const verdict = judge({ ...valid, payload: { title: 'too long' } }) as { refused: string; response: { error: { message: string } } };
    expect(verdict).toEqual(refusal('invalid-payload'));
    expect(verdict.response.error.message).toMatch(/^The request does not match the action's input: .+\.$/);
  });
});

describe('REQUEST_ID_PATTERN', () => {
  test.each([
    ['a', true], ['A-z_9', true], ['x'.repeat(64), true],
    ['', false], ['x'.repeat(65), false], [' r1', false], ['r1 ', false], ['r1\n', false], ['r.1', false], ['r/1', false],
  ])('%j -> %s', (id, ok) => {
    expect(REQUEST_ID_PATTERN.test(id)).toBe(ok);
  });
});

describe('readAdminSurfaceResize: envelope fields, each broken alone', () => {
  const resize = { protocol: 'jini.admin-surface', version: 1, kind: 'resize', mountId: 'm-1', height: 300 };
  const read = (data: unknown) => readAdminSurfaceResize({ event: { origin: 'null', source: frame, data }, mount });

  test('the valid baseline returns its height', () => {
    expect(read(resize)).toBe(300);
  });

  test.each<[string, Record<string, unknown>]>([
    ['wrong protocol', { protocol: 'other' }],
    ['wrong version', { version: 2 }],
    ['wrong kind', { kind: 'action-request' }],
    ['other mount', { mountId: 'm-2' }],
    ['missing height', { height: undefined }],
    ['NaN height', { height: Number.NaN }],
    ['negative infinity height', { height: Number.NEGATIVE_INFINITY }],
  ])('%s -> null', (_name, override) => {
    expect(read({ ...resize, ...override })).toBeNull();
  });

  test.each([[undefined], ['resize'], [42]])('non-object data %j -> null, never thrown on', (data) => {
    expect(read(data)).toBeNull();
  });
});
