import { describe, expect, it } from 'vitest';

import { createPrivateKeyLineRedactor, redactSecrets, redactSecretsWithCounts } from '../redact.js';

describe('private-key line redaction', () => {
  it('suppresses an open block, ignores a mismatched footer, and preserves following prose', () => {
    const redactor = createPrivateKeyLineRedactor({}, {});
    const output = [
      'before -----BEGIN RSA PRIVATE KEY-----', 'Ym9keS1vbmU=',
      '-----END EC PRIVATE KEY-----', 'Ym9keS10d28=',
      '-----END RSA PRIVATE KEY----- after',
    ].map(text => redactor.redact({ text }, {})).join('\n');
    expect(output).toContain('before');
    expect(output).toContain('after');
    expect(output).not.toMatch(/Ym9keS|PRIVATE KEY/);
  });

  it('keeps stream state independent and resets an unterminated block at EOF', () => {
    const first = createPrivateKeyLineRedactor({}, {});
    const second = createPrivateKeyLineRedactor({}, {});
    first.redact({ text: '-----BEGIN PRIVATE KEY-----' }, {});
    expect(first.redact({ text: 'Ym9keS1vbmU=' }, {})).toBe('');
    expect(second.redact({ text: 'other stream' }, {})).toBe('other stream');
    first.reset({}, {});
    expect(first.redact({ text: 'next child' }, {})).toBe('next child');
  });

  it('masks multiple blocks on one line while preserving public keys', () => {
    const redactor = createPrivateKeyLineRedactor({}, {});
    const block = '-----BEGIN EC PRIVATE KEY-----body-----END EC PRIVATE KEY-----';
    expect(redactor.redact({ text: `before ${block} between ${block} after` }, {}))
      .toBe('before [REDACTED:credential] between [REDACTED:credential] after');
    const publicKey = '-----BEGIN PUBLIC KEY----- public -----END PUBLIC KEY-----';
    expect(redactor.redact({ text: publicKey }, {})).toBe(publicKey);
  });
});

describe('@jini-ai/core — redact — redactSecrets', () => {

  it.each(['', 'RSA ', 'EC ', 'ENCRYPTED '])('masks the complete %sprivate-key block before header masking', prefix => {
    const input = `before\n-----BEGIN ${prefix}PRIVATE KEY-----\nYm9keS1vbmU=\nYm9keS10d28=\n-----END ${prefix}PRIVATE KEY-----\nafter`;
    const redacted = redactSecrets({ input }, { redactPii: false });
    expect(redacted).not.toMatch(/Ym9keS|PRIVATE KEY/);
    expect(redacted).toContain('before');
    expect(redacted).toContain('after');
  });

  it('masks an unterminated private key through the end of input', () => {
    const redacted = redactSecrets({ input: 'failure\n-----BEGIN PRIVATE KEY-----\nYm9keS1vbmU=\nYm9keS10d28=' }, { redactPii: false });
    expect(redacted).not.toMatch(/Ym9keS|PRIVATE KEY/);
    expect(redacted).toContain('failure');
  });

  it('masks PEM before another credential rule can split its header or footer', () => {
    const input = 'before -----BEGIN RSA PRIVATE KEY-----\npassword=short\n-----END RSA PRIVATE KEY----- after';
    const result = redactSecretsWithCounts({ input }, { exactSecrets: ['RSA'], redactPii: false });
    expect(result).toEqual({ redacted: 'before [REDACTED:credential] after', counts: { credential: 1 } });
    expect(redactSecretsWithCounts({ input: result.redacted }, { redactPii: false }))
      .toEqual({ redacted: result.redacted, counts: {} });
  });

  it.each(['password', 'client_secret', 'token', 'api key'])(
    "keeps the next field's secret private after an empty credential hint: %s", (key) => {
      for (const quote of ['"', "'"]) {
        for (const keyQuote of [quote, '']) {
          for (const hint of ['password=', 'x-api-key=']) {
            const input = `{${quote}hint${quote}: ${quote}${hint}${quote}, ${keyQuote}${key}${keyQuote}: ${quote}secret123${quote}}`;
            const redacted = redactSecrets({ input }, { redactPii: false });
            expect(redacted).not.toContain('secret123');
            expect(redacted).toContain(`${keyQuote}${key}${keyQuote}: ${quote}[REDACTED:labeled_secret]${quote}`);
            expect(redacted).toContain(`${quote}hint${quote}: ${quote}[REDACTED:labeled_secret]${quote}`);
            expect(redactSecretsWithCounts({ input: redacted }, { redactPii: false }))
              .toEqual({ redacted, counts: {} });
          }
        }
      }
    },
  );

  it('keeps truncated quoted credentials private', () => {
    for (const quote of ['"', "'"]) {
      expect(redactSecrets({ input: `password=${quote}secret123` }, { redactPii: false }))
        .toBe(`password=${quote}[REDACTED:labeled_secret]${quote}`);
    }
  });

  it('keeps quoted credentials private before diagnostic punctuation', () => {
    for (const punctuation of ['.', '!', ')', ']', '}', ',', ';']) {
      expect(redactSecrets({ input: `password="secret123"${punctuation}` }, { redactPii: false }))
        .toBe(`password="[REDACTED:labeled_secret]"${punctuation}`);
    }
  });

  it('keeps quoted secrets starting with punctuation private', () => {
    for (const value of [', secret123', '; secret123', '} secret123', 'secret123', '']) {
      const input = JSON.stringify({ password: value, code: 'UPSTREAM_FAILED' });
      const redacted = redactSecrets({ input }, { redactPii: false });
      expect(redacted).toBe('{"password":"[REDACTED:labeled_secret]","code":"UPSTREAM_FAILED"}');
    }
  });

  it.each([',', ';', '&', '}', '"', "'"])(
    'retains complete unquoted credential masking when a value contains %s', (separator) => {
      expect(redactSecrets({ input: `password=first${separator}second` }, { redactPii: false }))
        .toBe('password=[REDACTED:labeled_secret]');
    },
  );

  it('preserves quoted credential labels and scans successive values', () => {
    const input = `{"apiKey":"opaque two words","x-api-key":"another value","private_key":"last value","code":"UPSTREAM_FAILED"}`;
    const redacted = redactSecrets({ input }, { redactPii: false });
    for (const word of ['opaque', 'two words', 'another', 'last value']) expect(redacted).not.toContain(word);
    for (const key of ['apiKey', 'x-api-key', 'private_key']) expect(redacted).toContain(`"${key}"`);
    expect(redacted).toContain('"code":"UPSTREAM_FAILED"');
    expect(redactSecretsWithCounts({ input: redacted }, { redactPii: false }))
      .toEqual({ redacted, counts: {} });
  });


  it.each([
    "'x-api-key': 'synthetic-opaque-value'",
    "password: 'synthetic two words'",
    '"apiKey":"synthetic-opaque-value"',
  ])('redacts complete serialized credential keys and values: %s', (input) => {
    const redacted = redactSecrets({ input }, { redactPii: false });
    expect(redacted).not.toContain('synthetic');
    expect(redacted).not.toContain('two words');
    expect(redacted).toContain('[REDACTED:');
    expect(redactSecretsWithCounts({ input: redacted }, { redactPii: false }))
      .toEqual({ redacted, counts: {} });
  });

  it.each([
    'apiKey', 'api_key', 'api-key', 'api key', 'x-api-key', 'x-goog-api-key',
    'authorization', 'password', 'secret', 'token', 'access_token', 'refresh-token',
    'cookie', 'set-cookie', 'client_secret', 'private_key',
  ])('masks %s across JSON and inspect quoting without losing neighboring diagnostics', (key) => {
    for (const quote of ["'", '"']) {
      const input = `{ ${quote}${key}${quote} : ${quote}first \\${quote}second\\${quote} last${quote}, code: 'UPSTREAM_FAILED' }`;
      const redacted = redactSecrets({ input }, { redactPii: false });
      for (const word of ['first', 'second', 'last']) expect(redacted).not.toContain(word);
      expect(redacted).toContain(`${quote}${key}${quote}`);
      expect(redacted).toContain("code: 'UPSTREAM_FAILED'");
      expect(redactSecretsWithCounts({ input: redacted }, { redactPii: false }))
        .toEqual({ redacted, counts: {} });
    }
  });

  it('preserves versioned paths while redacting email addresses with alphabetic TLDs', () => {
    const stack = 'at run (/workspace/node_modules/.pnpm/vitest@4.0.1/node_modules/vitest/runner.js:42:7)\nat load (/workspace/pkg@1.2.3/index.js:8:2)';
    expect(redactSecrets({ input: stack })).toBe(stack);
    expect(redactSecrets({ input: 'person@example.com person@sub.example.co.uk' }))
      .toBe('[REDACTED:email] [REDACTED:email]');
  });
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

  it.each([
    '?token', '#access_token', '?api_key', '?X-Amz-Signature', '&client_secret',
    ';signature', '#sig', '?code', '#password', '?pwd', '&auth', '?custom.Token-value',
  ])('masks the complete URL secret value, including its fragment: %s', (parameter) => {
    const input = `https://example.com/x${parameter}=short#private&page=2`;
    const redacted = redactSecrets({ input });
    expect(redacted).not.toContain('short');
    expect(redacted).not.toContain('private');
    expect(redacted).toContain(`${parameter}=[REDACTED:`);
    expect(redacted).toMatch(/\]&page=2$/);
    expect(redactSecretsWithCounts({ input: redacted })).toEqual({ redacted, counts: {} });
  });

  it('masks URL parameters without PII redaction and retains harmless neighbors', () => {
    const input = 'https://example.com/?page=2&token=one&auth=two#private&sort=asc';
    expect(redactSecretsWithCounts({ input }, { redactPii: false })).toEqual({
      redacted: 'https://example.com/?page=2&token=[REDACTED:url_secret_param]&auth=[REDACTED:url_secret_param]&sort=asc',
      counts: { url_secret_param: 2 },
    });
  });

  it.each([
    'https://example.com/?page=2&sort=asc#section=overview',
    'https://example.com/?token=&page=2',
  ])('preserves non-secret URL values and empty parameters: %s', (input) => {
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted: input, counts: {} });
  });

  // A secret word must end a name segment, so a parameter that only contains one stays readable.
  it.each(['?author=7', '?keyword=shoes', '?design=dark', '?signup=1', '?author_id=3', '?keywords=a'])(
    'leaves parameters that only contain a secret word readable: %s',
    (query) => {
      const input = `https://example.com/${query}&page=2`;
      expect(redactSecretsWithCounts({ input })).toEqual({ redacted: input, counts: {} });
    },
  );

  it.each(['?sessionKey', '?authtoken', '?zipcode', '?x_pwd', '?keys'])('masks names whose segment ends in a secret word: %s', (name) => {
    expect(redactSecrets({ input: `https://example.com/${name}=v1&page=2` }))
      .toBe(`https://example.com/${name}=[REDACTED:url_secret_param]&page=2`);
  });

  it('keeps labeled_secret for URL parameters the labeled rule names, and their neighbors', () => {
    expect(redactSecretsWithCounts({ input: 'https://example.com/?password=pw&page=2&client_secret=cs' })).toEqual({
      redacted: 'https://example.com/?password=[REDACTED:labeled_secret]&page=2&client_secret=[REDACTED:labeled_secret]',
      counts: { labeled_secret: 2 },
    });
  });

  // `key_` isolates this rule; a `key-` run is slow in an older rule and is not covered here.
  it('scans a long separator-free secret-word run in linear time', () => {
    const input = `?${'key_'.repeat(50_000)}`;
    const started = performance.now();
    expect(redactSecrets({ input })).toBe(input);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('stops URL secret values at surrounding quotes and text', () => {
    expect(redactSecrets({ input: 'failed "https://example.com/?token=short#private" next' }))
      .toBe('failed "https://example.com/?token=[REDACTED:url_secret_param]" next');
  });

  it.each([
    ['?token', 'url_secret_param'], ['&password', 'labeled_secret'],
    ['#client_secret', 'labeled_secret'],
  ])('preserves the enclosing URL quote after %s and still masks a following credential', (parameter, category) => {
    const input = `failed "https://example.com/${parameter}=short#private" next password=another`;
    const redacted = `failed "https://example.com/${parameter}=[REDACTED:${category}]" next password=[REDACTED:labeled_secret]`;
    expect(redactSecretsWithCounts({ input })).toEqual({
      redacted,
      counts: category === 'labeled_secret' ? { labeled_secret: 2 } : { url_secret_param: 1, labeled_secret: 1 },
    });
    expect(redactSecrets({ input: redacted })).toBe(redacted);
  });

  it('still masks a quoted label value in a URL when it has no unquoted URL value', () => {
    const input = 'https://example.com/?token="private value"';
    expect(redactSecrets({ input })).toBe('https://example.com/?token="[REDACTED:labeled_secret]"');
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

it('aggressive redaction preserves diagnostic codes and exact registered tool ids after masking credentials', () => {
  const id = 'content_read.backup_restore_point';
  const opaque = 'x7Qm2Pz9Vb4Nc8Ld1Rf6Yt3Wk5';
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123';
  const text = `TOOL_OPERATION_DENIED DEFINITION_NOT_FOUND ${id} ${id}_${opaque} ${opaque} api_key=TOOL_OPERATION_DENIED Bearer DEFINITION_NOT_FOUND sk-proj-${opaque} ${jwt}`;
  const result = redactSecrets({ input: text }, { policy: 'aggressive', diagnosticToolIds: [id, `sk-proj-${opaque}`, jwt], redactPii: false });
  expect(result).toContain(`TOOL_OPERATION_DENIED DEFINITION_NOT_FOUND ${id}`);
  expect(result).not.toContain(opaque);
  expect(result).not.toContain(jwt);
  expect(result).not.toContain('api_key=TOOL_OPERATION_DENIED');
  expect(result).not.toContain('Bearer DEFINITION_NOT_FOUND');
});
