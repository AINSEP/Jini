import { describe, expect, it } from 'vitest';

import { redactSecrets, redactSecretsWithCounts } from '../redact.js';

describe('@injini/core — redact — redactSecrets', () => {
  it('passes empty input through unchanged', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('redacts a langfuse key before the generic sk- rule can claim it', () => {
    expect(redactSecrets('key: sk-lf-abcdefghijklmnopqrstuvwx')).toBe('key: [REDACTED:langfuse_key]');
  });

  it('redacts a generic sk- style key', () => {
    expect(redactSecrets('key: sk-proj-abcdefghijklmnopqrstuvwxyz')).toBe('key: [REDACTED:sk_key]');
  });

  it('redacts a github token', () => {
    expect(redactSecrets(`token: ${'gho_' + 'a'.repeat(36)}`)).toBe('token: [REDACTED:github_token]');
  });

  it('redacts an AWS access key id', () => {
    expect(redactSecrets('AKIAABCDEFGHIJKLMNOP')).toBe('[REDACTED:aws_access_key]');
  });

  it('redacts both google api key shapes', () => {
    expect(redactSecrets(`AQ.${'a'.repeat(25)}`)).toBe('[REDACTED:google_api_key]');
    expect(redactSecrets(`AIza${'a'.repeat(35)}`)).toBe('[REDACTED:google_api_key]');
  });

  it('redacts a slack token', () => {
    expect(redactSecrets('xoxb-1234567890-abcdefg')).toBe('[REDACTED:slack_token]');
  });

  it('redacts a stripe key', () => {
    expect(redactSecrets(`sk_live_${'a'.repeat(20)}`)).toBe('[REDACTED:stripe_key]');
  });

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dGhpcyBpcyBhIGZha2Ugc2ln';
    expect(redactSecrets(jwt)).toBe('[REDACTED:jwt]');
  });

  it('redacts a bearer token value only, keeping the literal prefix', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwx')).toBe(
      'Authorization: Bearer [REDACTED:bearer_token]',
    );
  });

  it('redacts an email address', () => {
    expect(redactSecrets('contact me at person@example.com please')).toBe(
      'contact me at [REDACTED:email] please',
    );
  });

  it('redacts an IPv4 address', () => {
    expect(redactSecrets('connect to 10.20.30.40 now')).toBe('connect to [REDACTED:ipv4] now');
  });

  it('redacts a US phone number', () => {
    expect(redactSecrets('call me at (415) 555-1234')).toBe('call me at [REDACTED:phone]');
  });

  it('redacts a quoted x-api-key header value', () => {
    expect(redactSecrets('x-api-key: "abcd1234"')).toBe('x-api-key: "[REDACTED:api_key_header]"');
  });

  it('redacts an unquoted api-key header value', () => {
    expect(redactSecrets('api-key=abcd1234;')).toBe('api-key=[REDACTED:api_key_header];');
  });

  it('redacts an api key in a query string', () => {
    expect(redactSecrets('https://example.com/x?api_key=SECRETVALUE&other=1')).toBe(
      'https://example.com/x?api_key=[REDACTED:api_key_query]&other=1',
    );
  });

  it('redacts a Luhn-valid credit card number and leaves an invalid one unchanged', () => {
    expect(redactSecrets('card 5500 0000 0000 0004 on file')).toBe('card [REDACTED:credit_card] on file');
    expect(redactSecrets('card 5500 0000 0000 0005 on file')).toBe('card 5500 0000 0000 0005 on file');
  });

  it('is idempotent — re-running on already-redacted text only matches new tokens', () => {
    const once = redactSecrets('email person@example.com and key sk-lf-abcdefghijklmnopqrstuvwx');
    expect(redactSecrets(once)).toBe(once);
  });
});

describe('@injini/core — redact — redactSecretsWithCounts', () => {
  it('returns zero counts and unchanged text for empty input', () => {
    expect(redactSecretsWithCounts('')).toEqual({ redacted: '', counts: {} });
  });

  it('counts each category that fired, including header/query/card special cases', () => {
    const input = [
      'email a@example.com and b@example.com',
      'x-api-key: "abcd1234efgh"',
      'https://example.com/?api_key=SECRETVALUE',
      'card 5500 0000 0000 0004 here',
    ].join(' | ');
    const { redacted, counts } = redactSecretsWithCounts(input);
    expect(counts.email).toBe(2);
    expect(counts.api_key_header).toBe(1);
    expect(counts.api_key_query).toBe(1);
    expect(counts.credit_card).toBe(1);
    expect(redacted).toContain('[REDACTED:email]');
    expect(redacted).not.toContain('a@example.com');
  });

  it('omits a category key entirely when it never matched', () => {
    const { counts } = redactSecretsWithCounts('nothing sensitive here');
    expect(counts).toEqual({});
    expect(Object.keys(counts)).not.toContain('credit_card');
  });

  it('leaves a Luhn-invalid card candidate unredacted and uncounted', () => {
    const { redacted, counts } = redactSecretsWithCounts('card 4111 1111 1111 1112 on file');
    expect(redacted).toBe('card 4111 1111 1111 1112 on file');
    expect(counts.credit_card).toBeUndefined();
  });
});
