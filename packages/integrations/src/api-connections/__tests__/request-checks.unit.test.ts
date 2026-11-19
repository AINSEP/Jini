/**
 * @file Unit tests for the request bounds checks: ids, plugin-resolved scopes, start parameters,
 * allowlisted callback fields and the raw callback. Each refusal is `request-invalid` naming the
 * bad part; malformed values are passed as `unknown` on purpose.
 */
import { realCallbackLimits } from './fixtures/real-capabilities.js';
import { describe, expect, it } from 'vitest';
import { ApiConnectionError } from '../errors.js';
import { assertId, checkCallbackParams, checkScopes, checkStartParams, pickBoundedFields } from '../request-checks.js';

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiConnectionError && error.code === 'request-invalid') return error.message;
    throw error;
  }
  throw new Error('expected request-invalid');
}

describe('assertId', () => {
  it('accepts an id of 256 characters', () => {
    expect(() => assertId({ value: 'w'.repeat(256), name: 'workspaceId' })).not.toThrow();
  });

  it('refuses an empty id, naming it', () => {
    expect(refusal(() => assertId({ value: '', name: 'actorId' }))).toContain('(actorId)');
  });

  it('refuses an id longer than 256 characters', () => {
    expect(refusal(() => assertId({ value: 'w'.repeat(257), name: 'workspaceId' }))).toContain('(workspaceId)');
  });

  it('refuses an id that is not a string', () => {
    expect(refusal(() => assertId({ value: 7, name: 'workspaceId' }))).toContain('(workspaceId)');
  });
});

describe('checkScopes', () => {
  it('removes duplicates and keeps the plugin order', () => {
    expect(checkScopes({ value: ['b.read', 'a.read', 'b.read'] })).toEqual(['b.read', 'a.read']);
  });

  it('refuses a value that is not a list', () => {
    expect(refusal(() => checkScopes({ value: 'a.read' }))).toContain('no valid scope set');
  });

  it('refuses an empty scope list', () => {
    expect(refusal(() => checkScopes({ value: [] }))).toContain('no valid scope set');
  });

  it('refuses more than 64 scopes', () => {
    expect(refusal(() => checkScopes({ value: Array.from({ length: 65 }, (_, index) => `s${index}`) }))).toContain('no valid scope set');
  });

  it('refuses a scope containing a space (two scopes smuggled into one)', () => {
    expect(refusal(() => checkScopes({ value: ['a.read b.write'] }))).toContain('no valid scope set');
  });

  it('refuses a scope containing a double quote or backslash', () => {
    expect([refusal(() => checkScopes({ value: ['a"b'] })), refusal(() => checkScopes({ value: ['a\\b'] }))].every(message => message.includes('no valid scope set')))
      .toBe(true);
  });

  it('refuses a non-string scope', () => {
    expect(refusal(() => checkScopes({ value: [42] }))).toContain('no valid scope set');
  });
});

describe('pickBoundedFields', () => {
  const fields = [{ name: 'picked', maxLength: 4 }];

  it('drops names the plugin did not declare', () => {
    expect(pickBoundedFields({ fields, values: { picked: 'abcd', other: 'x' }, where: 'callback field' })).toEqual({ picked: 'abcd' });
  });

  it('returns nothing for a declared field that is absent', () => {
    expect(pickBoundedFields({ fields, values: {}, where: 'callback field' })).toEqual({});
  });

  it('refuses a declared value over its limit instead of truncating it', () => {
    expect(refusal(() => pickBoundedFields({ fields, values: { picked: 'abcde' }, where: 'callback field' }))).toContain("callback field 'picked' is too large");
  });
});

describe('checkStartParams', () => {
  const fields = [{ name: 'mode', maxLength: 8 }];

  it('returns the declared values', () => {
    expect(checkStartParams({ fields, values: { mode: 'pick' } })).toEqual({ mode: 'pick' });
  });

  it('refuses an undeclared name rather than ignoring it', () => {
    expect(refusal(() => checkStartParams({ fields, values: { mode: 'pick', extra: '1' } }))).toContain("start parameter 'extra' is not declared");
  });
});

describe('checkCallbackParams', () => {
  it('keeps only the OAuth names and drops plugin fields', () => {
    expect(checkCallbackParams({ value: { state: 's', code: 'c', picked: 'p' }, limits: realCallbackLimits })).toEqual({ state: 's', code: 'c' });
  });

  it('passes a provider error through for the OAuth core to map', () => {
    expect(checkCallbackParams({ value: { state: 's', error: 'access_denied' }, limits: realCallbackLimits })).toEqual({ state: 's', error: 'access_denied' });
  });

  it('reads a missing state as empty so the core refuses it as an invalid attempt', () => {
    expect(checkCallbackParams({ value: { code: 'c' }, limits: realCallbackLimits })).toEqual({ state: '', code: 'c' });
  });

  it('refuses a callback with more than 64 fields', () => {
    const params = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`f${index}`, 'v']));
    expect(refusal(() => checkCallbackParams({ value: params, limits: realCallbackLimits }))).toContain('too many or oversized fields');
  });

  it('refuses an oversized field before any state is consumed', () => {
    expect(refusal(() => checkCallbackParams({ value: { state: 's', code: 'c'.repeat(100_000) }, limits: realCallbackLimits }))).toContain('too many or oversized fields');
  });
});
