import { describe, expect, it } from 'vitest';

import { redactSecrets, redactSecretsWithCounts } from '../redact.js';
import { expectLinearTime } from './fixtures/linear-time.js';

// Build even the short fake values at runtime; no credential literals enter the repository.
const value = ['a', 'bc'].join('');
const other = ['d', 'ef'].join('');
const basic = Buffer.from(['test-user', 'test-password'].join(':')).toString('base64');

describe('@jini-ai/core — redact — leak follow-ups', () => {
  it.each([
    { name: 'a compact JSON api_key', input: `{"api_key":"${value}"}`, redacted: '{"api_key":"[REDACTED:labeled_secret]"}' },
    { name: 'a spaced JSON password', input: `{"password": "${value}"}`, redacted: '{"password": "[REDACTED:labeled_secret]"}' },
    { name: 'two JSON labels beside a harmless field', input: `{"api_key":"${value}","password":"${other}","page":2}`,
      redacted: '{"api_key":"[REDACTED:labeled_secret]","password":"[REDACTED:labeled_secret]","page":2}' },
    { name: 'a single-quoted object label', input: `{'password':'${value}'}`, redacted: "{'password':'[REDACTED:labeled_secret]'}" },
    { name: 'a Basic authorization credential', input: `Authorization: Basic ${basic}`, redacted: 'Authorization: [REDACTED:labeled_secret]' },
    { name: 'a mixed-case Basic authorization credential', input: `authorization: bAsIc ${basic}`, redacted: 'authorization: [REDACTED:labeled_secret]' },
    { name: 'a JSON Basic authorization credential', input: `{"Authorization":"Basic ${basic}"}`,
      redacted: '{"Authorization":"[REDACTED:labeled_secret]"}' },
    { name: 'labels chained with equals', input: `token=secret=${value}`, redacted: 'token=secret=[REDACTED:labeled_secret]' },
    { name: 'labels chained with colons and spaces', input: `key: token: ${value}`, redacted: 'key: token: [REDACTED:labeled_secret]' },
    { name: 'three chained labels', input: `api_key: token=secret=${value}`, redacted: 'api_key: token=secret=[REDACTED:labeled_secret]' },
    { name: 'a bare token label', input: `token=${value}`, redacted: 'token=[REDACTED:labeled_secret]' },
    { name: 'a bare key label', input: `key: ${value}`, redacted: 'key: [REDACTED:labeled_secret]' },
    { name: 'a newline in a double-quoted value', input: `password="${value}\n${other}" next`, redacted: 'password=[REDACTED:labeled_secret] next' },
    { name: 'a newline in a single-quoted value', input: `secret='${value}\r\n${other}' next`, redacted: 'secret=[REDACTED:labeled_secret] next' },
    { name: 'a newline in a quoted JSON value', input: `{"password":"${value}\n${other}","page":2}`,
      redacted: '{"password":"[REDACTED:labeled_secret]","page":2}' },
    { name: 'a double-quoted Bearer expression', input: `"Bearer ${value}"`, redacted: '"Bearer [REDACTED:bearer_token]"' },
    { name: 'a single-quoted Bearer expression', input: `'Bearer ${value}'`, redacted: "'Bearer [REDACTED:bearer_token]'" },
    { name: 'a separately quoted Bearer value', input: `Bearer "${value}"`, redacted: 'Bearer "[REDACTED:bearer_token]"' },
    { name: 'punctuation in a Bearer credential', input: `Bearer ${value}!${other}`, redacted: 'Bearer [REDACTED:bearer_token]' },
    { name: 'Unicode in a Bearer credential', input: `Bearer ${value}é${other}`, redacted: 'Bearer [REDACTED:bearer_token]' },
    { name: 'punctuation in a long Bearer credential', input: `Authorization: Bearer ${value.repeat(8)}!${other}`,
      redacted: 'Authorization: Bearer [REDACTED:bearer_token]' },
    { name: 'a marker with a glued Bearer suffix', input: `Bearer [REDACTED:bearer_token]!${other}`, redacted: 'Bearer [REDACTED:bearer_token]' },
    { name: 'the second Cookie pair after a space', input: `Cookie: first=${value}; second=${other}`, redacted: 'Cookie: [REDACTED:labeled_secret]' },
    { name: 'three Cookie pairs without spaces', input: `cOoKiE: first=${value};second=${other};third=${value}`,
      redacted: 'cOoKiE: [REDACTED:labeled_secret]' },
    { name: 'a Cookie header before another header', input: `Cookie: first=${value}; second=${other}\r\nAccept: text/plain`,
      redacted: 'Cookie: [REDACTED:labeled_secret]\r\nAccept: text/plain' },
    { name: 'scheme-relative URL credentials', input: `//user:${value}@host/path`, redacted: '//[REDACTED:url_credentials]@host/path' },
    { name: 'scheme-relative credentials before a dotted host', input: `//user:${value}@example.com/path`,
      redacted: '//[REDACTED:url_credentials]@example.com/path' },
  ])('masks $name and remains idempotent', ({ input, redacted }) => {
    expect(redactSecrets({ input })).toBe(redacted);
    expect(redactSecrets({ input }, { redactPii: false })).toBe(redacted);
    expect(redactSecretsWithCounts({ input: redacted })).toEqual({ redacted, counts: {} });
  });

  it('counts each JSON credential without swallowing its neighboring field', () => {
    expect(redactSecretsWithCounts({ input: `{"api_key":"${value}","password":"${other}","page":2}` })).toEqual({
      redacted: '{"api_key":"[REDACTED:labeled_secret]","password":"[REDACTED:labeled_secret]","page":2}',
      counts: { labeled_secret: 2 },
    });
  });

  it('preserves harmless names and URLs without userinfo', () => {
    const input = `{"monkey":"${value}","keynote":"${other}","page":2} //host/path`;
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted: input, counts: {} });
  });

  it.each(['token', 'key'])('leaves an empty URL %s value and its neighbor unchanged', (name) => {
    const input = `https://example.com/?${name}=&page=2`;
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted: input, counts: {} });
  });

  it('keeps rule precedence when equal-sized overlapping spans arrive in reverse start order', () => {
    expect(redactSecretsWithCounts({ input: value }, { extraPatterns: [
      { name: 'later_start', regex: /bc/ }, { name: 'earlier_start', regex: /ab/ },
    ] })).toEqual({ redacted: '[REDACTED:later_start]', counts: { later_start: 1 } });
  });

  it('orders dense spans across byte boundaries without changing counts or field separators', () => {
    const count = 8_192;
    expect(redactSecretsWithCounts({ input: `api-key=${value};`.repeat(count) })).toEqual({
      redacted: 'api-key=[REDACTED:api_key_header];'.repeat(count), counts: { api_key_header: count },
    });
  });

  it.each([
    { name: 'dense header labels', build: (count: number) => 'api-key=x;'.repeat(count) },
    { name: 'dense chained labels', build: (count: number) => 'key: token: x '.repeat(count) },
  ])('stays linear through 10 MiB of $name', ({ build }) => {
    expectLinearTime({ size: Math.floor(10 * 1024 * 1024 / build(1).length), prepare: (count) => {
      const input = build(count);
      return () => redactSecrets({ input });
    } });
  });
});
