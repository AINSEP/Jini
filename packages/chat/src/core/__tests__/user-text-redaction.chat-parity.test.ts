import { describe, expect, it } from 'vitest';
import { redactUserText } from '../user-text-redaction.js';

// The one engine (core) must give chat's user text every answer chat's own rules gave before E2 moved it
// there. Each describe names the class of text in neutral words; the engine rule lives in core.
const kept = (text: string) => ({ text, secretRedacted: false, count: 0 });

describe('a name that only ends in a scheme word is prose', () => {
  it.each(['TokenBearer is a class', 'The TokenBearer pattern', 'TokenBearer abc'])('keeps %j', text => {
    expect(redactUserText({ text })).toEqual(kept(text));
  });
  it('still masks the word after a real Bearer', () => {
    expect(redactUserText({ text: 'Bearer x1' })).toEqual({ text: 'Bearer [token removed]', secretRedacted: true, count: 1 });
  });
});

describe('a password with @ inside a database connection URL', () => {
  it.each([
    ['postgres://user:p@ssw0rd@db.example.com:5432/app', 'postgres://[token removed]@db.example.com:5432/app'],
    ['connect to mysql://root:a@b@c@host/db?x=1 please', 'connect to mysql://[token removed]@host/db?x=1 please'],
  ])('removes the whole password in %j', (text, expected) => {
    expect(redactUserText({ text })).toEqual({ text: expected, secretRedacted: true, count: 1 });
  });
  it.each(['see https://example.com/@user/profile', 'https://example.com/path?email=a@b.com'])('keeps %j', text => {
    expect(redactUserText({ text })).toEqual(kept(text));
  });
});

describe('a URL query parameter whose name only ends in "code"', () => {
  it.each(['https://x.test/a?zipcode=90210', 'https://x.test/a?promo_code=SAVE10&page=2', 'https://x.test/a?error_code=42'])('keeps %j', text => {
    expect(redactUserText({ text })).toEqual(kept(text));
  });
  it('still removes an OAuth callback code', () => {
    expect(redactUserText({ text: 'https://x.test/cb?code=abc&state=1' })).toEqual({ text: 'https://x.test/cb?code=[token removed]&state=1', secretRedacted: true, count: 1 });
  });
});

describe('vendor key shapes chat once masked at any length', () => {
  const tail = (length: number) => 'aB3xK9'.repeat(Math.ceil(length / 6)).slice(0, length);
  it.each([
    ['a payment-provider webhook secret', `whsec_${tail(24)}`],
    ['a GitHub token with 30 characters', `ghs_${tail(30)}`],
    ['a temporary AWS key id', 'ASIAABCDEFGHIJKLMNOP'],
  ])('removes %s', (_name, key) => {
    expect(redactUserText({ text: `use ${key} now` })).toEqual({ text: 'use [token removed] now', secretRedacted: true, count: 1 });
  });
  it.each(['whsec_abc', `ghs_${tail(29)}`])('keeps %j', text => {
    expect(redactUserText({ text })).toEqual(kept(text));
  });
});

describe('custom auth headers and auth schemes other than Bearer', () => {
  it.each([
    ['x-auth-token: abc', 'x-auth-token: [token removed]'],
    ['curl -H "X-Auth-Token: abc123" https://x.test', 'curl -H "X-Auth-Token: [token removed]" https://x.test'],
    ['Authorization: Token abc123def456', 'Authorization: Token [token removed]'],
    ['Authorization: ApiKey abc123', 'Authorization: ApiKey [token removed]'],
    ['Authorization: Digest username="bob", response="abc"', 'Authorization: Digest [token removed]'],
    ['Basic dXNlcjpwYXNzd29yZDEy', 'Basic [token removed]'],
  ])('removes the value in %j', (text, expected) => {
    expect(redactUserText({ text })).toEqual({ text: expected, secretRedacted: true, count: 1 });
  });
  it.each(['Authorization: Bearer', 'Authorization: Basic', 'Basic authentication is not supported', 'Token expired at noon'])('keeps %j', text => {
    expect(redactUserText({ text })).toEqual(kept(text));
  });
});

describe('label aliases with short values', () => {
  it.each(['passwd', 'pwd', 'id_token', 'auth_token', 'signing_secret', 'webhook_secret'])('removes the value of %s', label => {
    expect(redactUserText({ text: `${label}=abc` })).toEqual({ text: `${label}=[token removed]`, secretRedacted: true, count: 1 });
    expect(redactUserText({ text: `{"${label}":"abc"}` })).toEqual({ text: `{"${label}":"[token removed]"}`, secretRedacted: true, count: 1 });
  });
  it.each([['DB_PASSWORD=abc', 'DB_PASSWORD=[token removed]'], ['my note: app_secret=abc ok', 'my note: app_secret=[token removed] ok']])(
    'removes the value of a prefixed name in %j', (text, expected) => {
      expect(redactUserText({ text })).toEqual({ text: expected, secretRedacted: true, count: 1 });
    });
  it.each(['pwd command prints the cwd', 'cd /home/user && pwd', 'passwd: hunter2', 'token_count=12'])('keeps %j', text => {
    expect(redactUserText({ text })).toEqual(kept(text));
  });
});
