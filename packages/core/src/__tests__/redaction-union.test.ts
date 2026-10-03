import { describe, expect, it } from 'vitest';
import { redactSecrets, redactSecretsWithCounts, SECRET_SHAPE_PATTERNS } from '../redact.js';
import { legacyCoreRedactSecrets, legacyCoreWithCounts, legacyCliRedactSecretLike, legacyProviderRedactSecrets } from './fixtures/legacy-redactors.js';
import { LEGACY_SECRET_SHAPE_PATTERNS } from './fixtures/legacy-secret-shapes.js';

// Inputs span every original rule plus collisions where a lexical rule could split a credential.
const conservativeVectors: Array<{ input: string; secrets: string[]; exactSecrets?: Array<string | null | undefined> }> = [
  ...[
    'sk-lf-abcdefghijklmnopqrstuvwx', 'pk-lf-abcdefghijklmnopqrstuvwx',
    'sk-proj-abcdefghijklmnopqrstuvwxyz', 'sk-ant-' + 'a'.repeat(100),
    'gho_' + 'a'.repeat(36), 'ghp_' + 'a'.repeat(36), 'ghs_' + 'a'.repeat(300),
    'github_pat_' + 'a'.repeat(80), 'npm_' + 'a'.repeat(36),
    'AKIAABCDEFGHIJKLMNOP', 'AQ.' + 'a'.repeat(25), 'AIza' + 'a'.repeat(35),
    'xoxb-1234567890-abcdefg', 'sk_live_' + 'a'.repeat(20), 'pk_test_' + 'a'.repeat(20),
    'fm2_' + 'a'.repeat(10) + '+' + 'b'.repeat(10) + '/',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dGhpcyBpcyBhIGZha2Ugc2ln',
    'person@example.com', '10.20.30.40', '(415) 555-1234', '5500 0000 0000 0004',
  ].map(secret => ({ input: `before ${secret} after`, secrets: [secret] })),
  { input: 'Authorization: Bearer abcdefghijklmnopqrstuvwx', secrets: ['abcdefghijklmnopqrstuvwx'] },
  { input: 'bearer short', secrets: ['short'] },
  { input: 'prefixbearer abc+/_-.= tail', secrets: ['abc+/_-.='] },
  { input: 'x-api-key: "abcd1234"', secrets: ['abcd1234'] },
  { input: 'api-key=abcd1234;', secrets: ['abcd1234'] },
  { input: 'x-goog-api-key: small', secrets: ['small'] },
  { input: 'https://example.com/x?api_key=SECRETVALUE&other=1', secrets: ['SECRETVALUE'] },
  { input: 'https://example.com/x?key=abc#tail&other=1', secrets: ['abc#tail'] },
  ...['authorization', 'bearer', 'api_key', 'access-token', 'refresh_token', 'client-secret', 'password', 'secret', 'cookie']
    .map(label => ({ input: `${label}=short-value`, secrets: ['short-value'] })),
  { input: 'arbitrary literal a.*+$?()[]{}|\\tail echo a.*+$?()[]{}|\\tail',
    secrets: ['a.*+$?()[]{}|\\tail'], exactSecrets: ['a.*+$?()[]{}|\\tail', '', null, undefined] },
  { input: 'known person@example.com-with-suffix credential', secrets: ['person@example.com-with-suffix'],
    exactSecrets: ['person@example.com', 'person@example.com-with-suffix'] },
];

const aggressiveVectors = [
  'A'.repeat(32), '1234567890'.repeat(4), 'abcd-1111-bbbb-2222-eee',
  'ERR-AAAA-1111-BBBB-2222ffff', 'delegated-tool-callz',
];

const nonSecretVectors = [
  'a3bb189e-8bf9-4888-9912-ace4e6543002',
  'da39a3ee5e6b4b0d3255bfef95601890afd80709',
  'claude-sonnet-4-5-20250929',
  '/opt/workspaces/abcdefghijklmnopqrstuv/src/main.ts',
  'ERR-incident-abcdefghijklmnopqrstuv',
];

describe('redaction union', () => {
  // PARITY: known secrets and PII retain the original positive corpus under both policies.
  it.each(conservativeVectors)('covers known-format and exact-secret matches in $input', ({ input, secrets, exactSecrets }) => {
    const options = exactSecrets === undefined ? {} : { exactSecrets };
    const oldResults = [
      legacyCoreRedactSecrets({ input }), legacyCliRedactSecretLike({ text: input }),
      legacyProviderRedactSecrets({ text: input }, options),
      ...LEGACY_SECRET_SHAPE_PATTERNS.map(({ pattern }) => input.replace(pattern, '[REDACTED:credential]')),
    ];
    // This is a parity corpus, not a list of guesses: at least one original must recognize it.
    expect(oldResults.some(result => result !== input)).toBe(true);
    const result = redactSecrets({ input }, options);
    expect(result).toContain('[REDACTED:');
    for (const secret of secrets) expect(result).not.toContain(secret);
    expect(redactSecretsWithCounts({ input }, options).redacted).toBe(result);
    expect(redactSecrets({ input: result }, options)).toBe(result);
    expect(redactSecrets({ input }, { ...options, policy: 'conservative' })).toBe(result);
    expect(redactSecrets({ input }, { ...options, policy: 'aggressive' })).toBe(result);
  });

  // PARITY: the frozen CLI opaque rule maps to aggressive, never to the default telemetry policy.
  it.each(aggressiveVectors)('keeps CLI opaque coverage opt-in for %s', (secret) => {
    const input = `before ${secret} after`;
    expect(legacyCliRedactSecretLike({ text: input })).not.toContain(secret);
    const options = { policy: 'aggressive' } satisfies Parameters<typeof redactSecrets>[1];
    const result = redactSecrets({ input }, options);
    expect(result).toBe('before [REDACTED:opaque_token] after');
    expect(redactSecretsWithCounts({ input }, options)).toEqual({
      redacted: result, counts: { opaque_token: 1 },
    });
    expect(redactSecrets({ input: result }, options)).toBe(result);
  });

  // REGRESSION: fails if OPAQUE_TOKEN_RE runs without checking options.policy === 'aggressive'.
  it.each(nonSecretVectors)('preserves ordinary identifiers and paths by default: %s', (input) => {
    expect(redactSecrets({ input })).toBe(input);
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted: input, counts: {} });
    expect(redactSecrets({ input }, { policy: 'conservative' })).toBe(input);
    expect(redactSecretsWithCounts({ input }, { policy: 'conservative' }))
      .toEqual({ redacted: input, counts: {} });
    expect(redactSecrets({ input }, { policy: 'aggressive' })).not.toBe(input);
    expect(redactSecrets({ input }, { exactSecrets: [input] })).toBe('[REDACTED:exact_secret]');
  });

  // PARITY: frozen core telemetry rules map to conservative (the default), including counts.
  it.each(['person@example.com', '10.20.30.40', '(415) 555-1234',
    '5500 0000 0000 0004', 'sk-lf-abcdefghijklmnopqrstuvwx'])
    ('maps legacy core to conservative for %s', (input) => {
      expect(redactSecrets({ input })).toBe(legacyCoreRedactSecrets({ input }));
      expect(redactSecretsWithCounts({ input })).toEqual(legacyCoreWithCounts({ input }));
    });

  // PARITY: provider header/query/exact-secret coverage maps to conservative, without opaque runs.
  it.each(['Bearer short', 'x-api-key: short', 'https://example.com/?key=short', 'literal a.*+$'])
    ('maps legacy provider to conservative for %s', (input) => {
      const options = { exactSecrets: ['a.*+$'] };
      const normalize = (text: string): string => text.replace(/\[REDACTED(?::[^\]]+)?\]/g, '[REDACTED]');
      expect(normalize(redactSecrets({ input }, options)))
        .toBe(normalize(legacyProviderRedactSecrets({ text: input }, options)));
    });

  // REGRESSION: fails if URL_CREDENTIALS_RE replacement is removed.
  it('masks URL userinfo under either policy and counts it once', () => {
    const input = 'https://user:short-pw@example.com/path';
    const redacted = 'https://[REDACTED:url_credentials]@example.com/path';
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted, counts: { url_credentials: 1 } });
    expect(redactSecrets({ input }, { policy: 'aggressive' })).toBe(redacted);
    expect(redactSecretsWithCounts({ input: redacted })).toEqual({ redacted, counts: {} });
  });

  // REGRESSION: fails if SIGNED_QUERY_RE replacement is removed.
  it('masks signed query credentials while retaining harmless query values', () => {
    const input = 'https://example.com/path?X-Amz-Signature=short&X-Goog-Signature=other&sig=last&page=2';
    const redacted = 'https://example.com/path?X-Amz-Signature=[REDACTED:signed_query]&X-Goog-Signature=[REDACTED:signed_query]&sig=[REDACTED:signed_query]&page=2';
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted, counts: { signed_query: 3 } });
    expect(redactSecrets({ input }, { policy: 'aggressive' })).toBe(redacted);
    expect(redactSecretsWithCounts({ input: redacted })).toEqual({ redacted, counts: {} });
  });

  // PARITY: diagnostics patterns stay byte-identical.
  it('pins the eleven diagnostics regex sources, flags, names and credential coverage', () => {
    expect(SECRET_SHAPE_PATTERNS).toHaveLength(11);
    expect(SECRET_SHAPE_PATTERNS.map(({ name, pattern }) => [name, pattern.source, pattern.flags]))
      .toEqual(LEGACY_SECRET_SHAPE_PATTERNS.map(({ name, pattern }) => [name, pattern.source, pattern.flags]));
    const vendorValues = [
      'AIza' + 'a'.repeat(35), 'sk-ant-' + 'a'.repeat(100), 'sk-' + 'a'.repeat(40),
      'ghp_' + 'a'.repeat(36), 'gho_' + 'a'.repeat(36), 'github_pat_' + 'a'.repeat(80),
      'npm_' + 'a'.repeat(36), 'xoxb-' + 'a'.repeat(12), 'AKIAABCDEFGHIJKLMNOP',
      'fm2_' + 'a'.repeat(25), '-----BEGIN RSA PRIVATE KEY-----',
    ];
    vendorValues.forEach((value, i) => {
      expect(LEGACY_SECRET_SHAPE_PATTERNS[i]!.pattern.test(value)).toBe(true);
      expect(redactSecrets({ input: value })).not.toContain(value);
    });
  });

  // PARITY: exact secrets and caller-owned patterns keep their precedence and regex isolation.
  it('counts exact matches and extra rules, and ignores empty/non-string exact secrets', () => {
    const regex = /host-private:[a-z]+/g;
    regex.lastIndex = 100;
    const input = 'small-value small-value host-private:alpha';
    const options = { exactSecrets: ['small-value', '', null, undefined, 'small-value'],
      extraPatterns: [{ name: 'host_secret', regex }] };
    expect(redactSecretsWithCounts({ input }, options)).toEqual({
      redacted: '[REDACTED:exact_secret] [REDACTED:exact_secret] [REDACTED:host_secret]',
      counts: { exact_secret: 2, host_secret: 1 },
    });
    expect(regex.lastIndex).toBe(100);
  });

  // PARITY: marker-like substrings never preserve a credential suffix.
  it('masks complete credential values even when a marker-like substring is glued inside them', () => {
    expect(redactSecrets({ input: 'x-api-key: known[REDACTED:credential]suffix' }))
      .toBe('x-api-key: [REDACTED:api_key_header]');
    expect(redactSecrets({ input: 'https://example.com/?key=known[REDACTED:credential]suffix' }))
      .toBe('https://example.com/?key=[REDACTED:api_key_query]');
    expect(redactSecrets({ input: 'password=known[REDACTED:credential]suffix' }))
      .toBe('password=[REDACTED:labeled_secret]');
  });

  // REGRESSION: skipping a masked value must not swallow the next labeled credential.
  it.each([
    {
      input: 'https://example.com/?api_key=short&password=other',
      redacted: 'https://example.com/?api_key=[REDACTED:api_key_query]&password=[REDACTED:labeled_secret]',
      counts: { api_key_query: 1, labeled_secret: 1 },
    },
    {
      input: 'api-key=short;password=other',
      redacted: 'api-key=[REDACTED:api_key_header];password=[REDACTED:labeled_secret]',
      counts: { api_key_header: 1, labeled_secret: 1 },
    },
    {
      input: 'password=[REDACTED:labeled_secret]&secret=other',
      redacted: 'password=[REDACTED:labeled_secret]&secret=[REDACTED:labeled_secret]',
      counts: { labeled_secret: 1 },
    },
  ])('redacts subsequent credentials after a masked value in $input', ({ input, redacted, counts }) => {
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted, counts });
    expect(redactSecretsWithCounts({ input: redacted })).toEqual({ redacted, counts: {} });
  });

  // PARITY: aggressive preserves the CLI's complete correlation ID and route exceptions.
  it('keeps whole correlation IDs and the delegated-tool route under the opaque-token rule', () => {
    const input = 'ERR-AAAA-1111-BBBB-2222 delegated-tool-calls';
    expect(redactSecrets({ input })).toBe(input);
    expect(redactSecretsWithCounts({ input })).toEqual({ redacted: input, counts: {} });
    expect(redactSecrets({ input }, { policy: 'aggressive' })).toBe(input);
    expect(redactSecretsWithCounts({ input }, { policy: 'aggressive' }))
      .toEqual({ redacted: input, counts: {} });
  });
});
