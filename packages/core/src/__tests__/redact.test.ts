import { describe, expect, it } from 'vitest';

import { redactSecrets, redactSecretsWithCounts } from '../redact.js';

describe('@jini-ai/core — redact — redactSecrets', () => {
  it('passes empty input through unchanged', () => {
    expect(redactSecrets({ input: '' })).toBe('');
  });

  it('redacts a langfuse key before the generic sk- rule can claim it', () => {
    expect(redactSecrets({ input: 'key: sk-lf-abcdefghijklmnopqrstuvwx' })).toBe('key: [REDACTED:langfuse_key]');
  });

  it('redacts a generic sk- style key', () => {
    expect(redactSecrets({ input: 'key: sk-proj-abcdefghijklmnopqrstuvwxyz' })).toBe('key: [REDACTED:sk_key]');
  });

  it('redacts a github token', () => {
    expect(redactSecrets({ input: `token: ${'gho_' + 'a'.repeat(36)}` })).toBe('token: [REDACTED:github_token]');
  });

  it('redacts an AWS access key id', () => {
    expect(redactSecrets({ input: 'AKIAABCDEFGHIJKLMNOP' })).toBe('[REDACTED:aws_access_key]');
  });

  it('redacts both google api key shapes', () => {
    expect(redactSecrets({ input: `AQ.${'a'.repeat(25)}` })).toBe('[REDACTED:google_api_key]');
    expect(redactSecrets({ input: `AIza${'a'.repeat(35)}` })).toBe('[REDACTED:google_api_key]');
  });

  it('redacts a slack token', () => {
    expect(redactSecrets({ input: 'xoxb-1234567890-abcdefg' })).toBe('[REDACTED:slack_token]');
  });

  it('redacts a stripe key', () => {
    expect(redactSecrets({ input: `sk_live_${'a'.repeat(20)}` })).toBe('[REDACTED:stripe_key]');
  });

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dGhpcyBpcyBhIGZha2Ugc2ln';
    expect(redactSecrets({ input: jwt })).toBe('[REDACTED:jwt]');
  });

  it('redacts a bearer token value only, keeping the literal prefix', () => {
    expect(redactSecrets({ input: 'Authorization: Bearer abcdefghijklmnopqrstuvwx' })).toBe(
      'Authorization: Bearer [REDACTED:bearer_token]',
    );
  });

  it('redacts an email address', () => {
    expect(redactSecrets({ input: 'contact me at person@example.com please' })).toBe(
      'contact me at [REDACTED:email] please',
    );
  });

  it('redacts an IPv4 address', () => {
    expect(redactSecrets({ input: 'connect to 10.20.30.40 now' })).toBe('connect to [REDACTED:ipv4] now');
  });

  it('redacts a US phone number', () => {
    expect(redactSecrets({ input: 'call me at (415) 555-1234' })).toBe('call me at [REDACTED:phone]');
  });

  // Regression: the phone rule used to mask the UUID's final twelve digits.
  it.each([
    '550e8400-e29b-41d4-a716-446655440000',
    '550E8400-E29B-41D4-A716-446655440000',
    '{550e8400-e29b-41d4-a716-446655440000}',
  ])('preserves a UUID with a phone-shaped digit tail: %s', (input) => {
    expect(redactSecrets({ input })).toBe(input);
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted: input, counts: {} });
  });

  it.each([
    'abcdef0123456789abcdef0123456789abcdef0123',
    'ABCDEF446655440000ABCDEF',
    '0x446655440000',
    'deadbeef-446655440000',
    '446655440000-deadbeef',
    'deadbeef-415-555-2671',
    '415-555-2671-deadbeef',
    'run_446655440000',
    '446655440000_run',
    'job446655440000',
    '446655440000job',
  ])('preserves phone-shaped digits inside a hash or identifier: %s', (input) => {
    expect(redactSecrets({ input })).toBe(input);
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted: input, counts: {} });
  });

  it.each([
    '4155552671',
    '415-555-2671',
    '415.555.2671',
    '415 555 2671',
    '(415) 555-2671',
    '(415)5552671',
    '1-415-555-2671',
    '+14155552671',
    '+1 (415) 555-2671',
    '+44 207 555 2671',
  ])('redacts a standalone phone number in supported formats: %s', (phone) => {
    expect(redactSecrets({ input: phone })).toBe('[REDACTED:phone]');
    expect(redactSecretsWithCounts({ input: `call: ${phone}, please` })).toEqual({
      redacted: 'call: [REDACTED:phone], please', counts: { phone: 1 },
    });
  });

  it('redacts a quoted x-api-key header value', () => {
    expect(redactSecrets({ input: 'x-api-key: "abcd1234"' })).toBe('x-api-key: "[REDACTED:api_key_header]"');
  });

  it('redacts an unquoted api-key header value', () => {
    expect(redactSecrets({ input: 'api-key=abcd1234;' })).toBe('api-key=[REDACTED:api_key_header];');
  });

  it('redacts an api key in a query string', () => {
    expect(redactSecrets({ input: 'https://example.com/x?api_key=SECRETVALUE&other=1' })).toBe(
      'https://example.com/x?api_key=[REDACTED:api_key_query]&other=1',
    );
  });

  it('redacts a Luhn-valid credit card number and leaves an invalid one unchanged', () => {
    expect(redactSecrets({ input: 'card 5500 0000 0000 0004 on file' })).toBe('card [REDACTED:credit_card] on file');
    expect(redactSecrets({ input: 'card 5500 0000 0000 0005 on file' })).toBe('card 5500 0000 0000 0005 on file');
  });

  it('is idempotent — re-running on already-redacted text only matches new tokens', () => {
    const once = redactSecrets({ input: 'email person@example.com and key sk-lf-abcdefghijklmnopqrstuvwx' });
    expect(redactSecrets({ input: once })).toBe(once);
  });
});

describe('@jini-ai/core — redact — redactSecretsWithCounts', () => {
  it('returns zero counts and unchanged text for empty input', () => {
    expect(redactSecretsWithCounts({ input: '' })).toEqual({ redacted: '', counts: {} });
  });

  it('counts each category that fired, including header/query/card special cases', () => {
    const input = [
      'email a@example.com and b@example.com',
      'x-api-key: "abcd1234efgh"',
      'https://example.com/?api_key=SECRETVALUE',
      'card 5500 0000 0000 0004 here',
    ].join(' | ');
    const { redacted, counts } = redactSecretsWithCounts({ input });
    expect(counts.email).toBe(2);
    expect(counts.api_key_header).toBe(1);
    expect(counts.api_key_query).toBe(1);
    expect(counts.credit_card).toBe(1);
    expect(redacted).toContain('[REDACTED:email]');
    expect(redacted).not.toContain('a@example.com');
  });

  it('omits a category key entirely when it never matched', () => {
    const { counts } = redactSecretsWithCounts({ input: 'nothing sensitive here' });
    expect(counts).toEqual({});
    expect(Object.keys(counts)).not.toContain('credit_card');
  });

  it('counts real phones beside identifiers without changing the identifiers', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const input = `${uuid} | deadbeef-446655440000 | (415) 555-2671 | +1-212-555-1234`;
    const redacted = `${uuid} | deadbeef-446655440000 | [REDACTED:phone] | [REDACTED:phone]`;
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted, counts: { phone: 2 } });
    expect(redactSecretsWithCounts({ input: redacted })).toEqual({ redacted, counts: {} });
  });

  it('leaves a Luhn-invalid card candidate unredacted and uncounted', () => {
    const { redacted, counts } = redactSecretsWithCounts({ input: 'card 4111 1111 1111 1112 on file' });
    expect(redacted).toBe('card 4111 1111 1111 1112 on file');
    expect(counts.credit_card).toBeUndefined();
  });
});
