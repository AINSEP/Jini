import { describe, expect, it } from 'vitest';
import { formatErrorForLog } from '../index.js';

describe('formatErrorForLog', () => {
  it.each([
    ['null prototype', Object.assign(Object.create(null) as Record<string, unknown>, { code: 'UPSTREAM_FAILED' })],
    ['throwing coercion', { toString() { throw new Error('coercion failed'); } }],
    ['throwing primitive conversion', { [Symbol.toPrimitive]() { throw new Error('coercion failed'); } }],
    ['throwing property', { get message() { throw new Error('password=must-not-escape'); } }],
    ['throwing serialization', { toJSON() { throw new Error('password=must-not-escape'); } }],
  ])('never interrupts recovery for %s', (_label, error) => {
    let recovered = false;
    let diagnostic = '';
    try { throw error; } catch (caught) {
      diagnostic = formatErrorForLog({ error: caught });
      recovered = true;
    }
    expect(recovered).toBe(true);
    expect(typeof diagnostic).toBe('string');
    expect(diagnostic).not.toContain('must-not-escape');
  });

  it('uses fixed text when property access or coercion fails', () => {
    const propertyFailure = { get message() { throw new Error('unsafe getter'); } };
    const coercionFailure = () => {};
    coercionFailure.toString = () => { throw new Error('unsafe coercion'); };
    expect(formatErrorForLog({ error: propertyFailure })).toBe('[Unformattable error]');
    expect(formatErrorForLog({ error: coercionFailure })).toBe('[Unformattable error]');
    expect(formatErrorForLog({ get error() { throw new Error('unsafe argument getter'); } })).toBe('[Unformattable error]');
  });

  it('preserves message, stack, non-enumerable codes, request/correlation ids and structured fields while redacting', () => {
    const error = Object.assign(new Error('provider failed password=message-secret'), {
      correlationId: 'ERR-1234-ABCD-5678-EFAB', requestId: 'request-42',
      details: { status: 503, password: 'structured-secret', nested: { operation: 'send' } },
    });
    Object.defineProperty(error, 'code', { value: 'UPSTREAM_FAILED' });
    error.stack = 'Error: provider failed password=stack-secret\n    at send (/app/send.ts:7:3)';
    const diagnostic = formatErrorForLog({ error });
    for (const value of ['provider failed', '/app/send.ts:7:3', 'UPSTREAM_FAILED', error.correlationId, error.requestId, '503', 'send']) {
      expect(diagnostic).toContain(value);
    }
    for (const secret of ['message-secret', 'stack-secret', 'structured-secret']) expect(diagnostic).not.toContain(secret);
  });

  it('retains structured non-Error throws and handles cycles without losing diagnostic fields', () => {
    const error: Record<string, unknown> = Object.assign(Object.create(null) as Record<string, unknown>, {
      code: 'UPSTREAM_FAILED', requestId: 'request-42', details: { password: 'structured-secret', status: 503 },
    });
    error['cause'] = error;
    const diagnostic = formatErrorForLog({ error });
    for (const value of ['UPSTREAM_FAILED', 'request-42', '503', '[Circular]']) expect(diagnostic).toContain(value);
    expect(diagnostic).not.toContain('structured-secret');
  });
});
