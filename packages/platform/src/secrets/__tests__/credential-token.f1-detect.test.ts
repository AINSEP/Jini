import { describe, expect, it } from 'vitest';
import { assertCredentialFreeField, CredentialInputError } from '../credential-token.js';

// F1 fix wave (Stryker L1 §4 credential-token.ts:71,72,81 — SECRET_NAME / SECRET_ARG character
// classes, `?` quantifiers and the URL userinfo/secret-param branch survived). One row per
// alternation branch and per separator, plus near-miss negatives, with the detector port disabled
// so only the structural rules are under test.
const noDetector = () => false;
const check = (value: string) => () => assertCredentialFreeField({ value, field: 'label', containsSecret: noDetector });
function expectRefused(value: string) {
  let caught: unknown;
  try { check(value)(); } catch (error) { caught = error; }
  expect(caught, value).toBeInstanceOf(CredentialInputError);
  expect((caught as CredentialInputError).rule).toBe('plain');
  expect((caught as CredentialInputError).field).toBe('label');
}

describe('URL query keys that name a secret', () => {
  it.each([
    'key', 'api_key', 'api-key', 'apikey', 'token', 'access_token', 'access-token', 'accesstoken', 'secret', 'password', 'auth', 'sig',
    'x_token', 'x-token', 'client_secret', 'TOKEN', 'Api_Key',
  ])('?%s=… is refused', (key) => {
    expectRefused(`https://api.example.com/v1?${key}=abc`);
  });
  it('a secret key among several harmless ones (first, middle, last) is refused', () => {
    for (const q of ['token=a&page=1&q=x', 'page=1&token=a&q=x', 'page=1&q=x&token=a']) expectRefused(`https://e.example.com/?${q}`);
  });
  it.each(['tokenizer', 'keys', 'monkey', 'signature', 'author', 'xtoken', 'secretary', 'page'])('?%s=… is allowed (no separator / suffix boundary)', (key) => {
    expect(check(`https://api.example.com/v1?${key}=abc`)).not.toThrow();
  });
});

describe('URL userinfo', () => {
  it.each(['https://user@e.example.com/', 'https://:pw@e.example.com/', 'https://user:pw@e.example.com/'])('%s is refused', (url) => {
    expectRefused(url);
  });
  it('a plain URL with neither is allowed', () => {
    expect(check('https://e.example.com/path?page=2')).not.toThrow();
  });
});

describe('CLI-style secret arguments', () => {
  it.each([
    '--api-key=abc', '--api_key=abc', '--apikey=abc', '--token abc', '--token=abc', '--my-secret=abc', '--db-password  hunter2',
    'run --TOKEN=abc', 'cmd\t--secret=x',
  ])('%j is refused', (value) => {
    expectRefused(value);
  });
  it.each(['--token=', '--token   ', 'x--token=abc', '-token=abc', '--tokens', 'token=abc', '--page=2'])('%j is allowed', (value) => {
    expect(check(value)).not.toThrow();
  });
});

it('the injected detector is consulted and its verdict alone refuses', () => {
  const seen: string[] = [];
  expect(() => assertCredentialFreeField({ value: 'plain words', field: 'f', containsSecret: ({ text }) => { seen.push(text); return true; } })).toThrow(CredentialInputError);
  expect(seen).toEqual(['plain words']);
});
