/**
 * @file Unit tests for the loopback receiver's pure decisions: the callback-field name rule and
 * configuration bounds, which request is routed as the callback, and how one callback query is
 * read (state first, provider error second, code third, declared fields last). No listener is
 * opened here; the socket-level behaviour lives in loopback-receiver.security.test.ts.
 */
import { describe, expect, test } from 'vitest';
import {
  MAX_CALLBACK_FIELDS,
  MAX_CALLBACK_FIELD_LENGTH,
  assertLoopbackConfiguration,
  isCallbackFieldName,
  readLoopbackCallback,
  routeLoopbackRequest,
  type LoopbackRequestFacts,
} from '../src/loopback-callback.js';
import { MAX_CODE_LENGTH } from '../src/authorization-code.js';
import { MAX_AUTHORIZATION_STATE_LENGTH } from '../src/sealed-state.js';

const HOST = '127.0.0.1:43210';
const STATE = 's'.repeat(32);

function facts(optionalArgs: Partial<LoopbackRequestFacts> = {}): LoopbackRequestFacts {
  return { method: 'GET', rawUrl: '/callback?state=x', host: HOST, hasBody: false, ...optionalArgs };
}

function route(request: LoopbackRequestFacts, optionalArgs: { readonly armed?: boolean } = {}) {
  return routeLoopbackRequest({ request, expectedHost: HOST, path: '/callback', armed: optionalArgs.armed ?? true });
}

function read(query: string, optionalArgs: { readonly callbackFields?: readonly string[] } = {}) {
  return readLoopbackCallback({ query: new URLSearchParams(query), expectedState: STATE, callbackFields: optionalArgs.callbackFields ?? [] });
}

describe('isCallbackFieldName', () => {
  test('accepts a short identifier that starts with a letter', () => {
    expect(isCallbackFieldName('picked_ids')).toBe(true);
  });

  test('accepts the longest allowed name of 64 characters', () => {
    expect(isCallbackFieldName(`a${'b'.repeat(63)}`)).toBe(true);
  });

  test('refuses a 65-character name', () => {
    expect(isCallbackFieldName(`a${'b'.repeat(64)}`)).toBe(false);
  });

  test.each(['code', 'state', 'error', 'error_description', 'error_uri', 'iss'])('refuses the protocol parameter %s', (name) => {
    expect(isCallbackFieldName(name)).toBe(false);
  });

  test('refuses a name with characters outside the identifier set', () => {
    expect(isCallbackFieldName('picked ids')).toBe(false);
  });
});

describe('assertLoopbackConfiguration', () => {
  test('accepts exactly the maximum number of declared fields', () => {
    const fields = Array.from({ length: MAX_CALLBACK_FIELDS }, (_, index) => `field_${index}`);
    expect(() => assertLoopbackConfiguration({ callbackFields: fields })).not.toThrow();
  });

  test('refuses one field over the maximum with the bound in the message', () => {
    const fields = Array.from({ length: MAX_CALLBACK_FIELDS + 1 }, (_, index) => `field_${index}`);
    expect(() => assertLoopbackConfiguration({ callbackFields: fields })).toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_REQUEST', message: 'at most 16 callback fields may be declared' }));
  });

  test('names a refused field, truncated to 64 characters', () => {
    const name = `_${'x'.repeat(100)}`;
    expect(() => assertLoopbackConfiguration({ callbackFields: ['ok_field', name] })).toThrow(expect.objectContaining({
      code: 'OAUTH_INVALID_REQUEST', message: `'${name.slice(0, 64)}' cannot be declared as a callback field`, operatorAction: "Fix the connection's declared callback fields.",
    }));
  });
});

describe('routeLoopbackRequest', () => {
  test('routes an armed GET to the callback path with its query', () => {
    const routed = route(facts());
    expect(routed.kind).toBe('callback');
    expect(routed.kind === 'callback' && routed.query.get('state')).toBe('x');
  });

  test('ignores a foreign Host with 400', () => {
    expect(route(facts({ host: 'evil.example:43210' }))).toEqual({ kind: 'ignore', status: 400 });
  });

  test('ignores a missing Host with 400', () => {
    expect(route(facts({ host: undefined }))).toEqual({ kind: 'ignore', status: 400 });
  });

  test('ignores an absolute-form request target with 400', () => {
    expect(route(facts({ rawUrl: `http://${HOST}/callback` }))).toEqual({ kind: 'ignore', status: 400 });
  });

  test('ignores a request with no URL with 400', () => {
    expect(route(facts({ rawUrl: undefined }))).toEqual({ kind: 'ignore', status: 400 });
  });

  test('ignores another path with 404', () => {
    expect(route(facts({ rawUrl: '/callback/extra?state=x' }))).toEqual({ kind: 'ignore', status: 404 });
  });

  test('ignores the callback path with 404 while not armed', () => {
    expect(route(facts(), { armed: false })).toEqual({ kind: 'ignore', status: 404 });
  });

  test('ignores a HEAD on the callback path with 405', () => {
    expect(route(facts({ method: 'HEAD' }))).toEqual({ kind: 'ignore', status: 405 });
  });

  test('ignores a GET carrying a body with 400', () => {
    expect(route(facts({ hasBody: true }))).toEqual({ kind: 'ignore', status: 400 });
  });
});

describe('readLoopbackCallback', () => {
  test('returns the code and no fields when none are declared', () => {
    expect(read(`state=${STATE}&code=abc&extra=1`)).toEqual({ code: 'abc', fields: {} });
  });

  test('a missing state is an invalid state', () => {
    expect(() => read('code=abc')).toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_STATE' }));
  });

  test('a state longer than the sealed-state bound is refused before comparison', () => {
    const long = 's'.repeat(MAX_AUTHORIZATION_STATE_LENGTH + 1);
    expect(() => readLoopbackCallback({ query: new URLSearchParams({ state: long, code: 'abc' }), expectedState: long, callbackFields: [] }))
      .toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_STATE' }));
  });

  test('a repeated state is refused and names the parameter', () => {
    expect(() => read(`state=${STATE}&state=${STATE}&code=abc`)).toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_REQUEST', message: "the authorization callback repeated the 'state' parameter" }));
  });

  test('a provider error other than access_denied is a provider rejection', () => {
    expect(() => read(`state=${STATE}&error=server_error`)).toThrow(expect.objectContaining({ code: 'OAUTH_PROVIDER_REJECTED', providerErrorCode: 'server_error' }));
  });

  test('a missing code is an invalid request that says to start again', () => {
    expect(() => read(`state=${STATE}`)).toThrow(expect.objectContaining({
      code: 'OAUTH_INVALID_REQUEST', message: 'the authorization callback carried no usable code', operatorAction: 'Start the connection again from the connection settings.',
    }));
  });

  test('an empty code is an invalid request', () => {
    expect(() => read(`state=${STATE}&code=`)).toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_REQUEST', message: 'the authorization callback carried no usable code' }));
  });

  test('a code at the exchange bound is accepted', () => {
    const code = 'c'.repeat(MAX_CODE_LENGTH);
    expect(read(`state=${STATE}&code=${code}`).code).toBe(code);
  });

  test('a code one over the exchange bound is refused at the edge', () => {
    expect(() => read(`state=${STATE}&code=${'c'.repeat(MAX_CODE_LENGTH + 1)}`)).toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_REQUEST', message: 'the authorization callback carried no usable code' }));
  });

  test('a declared field at the length bound is returned', () => {
    const value = 'v'.repeat(MAX_CALLBACK_FIELD_LENGTH);
    expect(read(`state=${STATE}&code=abc&picked=${value}`, { callbackFields: ['picked'] }).fields).toEqual({ picked: value });
  });

  test('a repeated declared field is refused and names the field', () => {
    expect(() => read(`state=${STATE}&code=abc&picked=a&picked=b`, { callbackFields: ['picked'] }))
      .toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_REQUEST', message: "the authorization callback repeated the 'picked' parameter" }));
  });
});
