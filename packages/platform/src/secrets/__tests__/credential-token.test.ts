import { describe, expect, it } from 'vitest';
import {
  assertCredentialFreeField, assertCredentialToken, CREDENTIAL_MESSAGES, CREDENTIAL_TOKEN_LIMIT,
  CredentialInputError, credentialTokenHint, normalizeCredentialToken,
} from '../credential-token.js';

/** Build token-shaped values at runtime so no fixture looks like a real credential. */
const tokenOf = (length: number) => Array.from({ length }, (_, i) => String.fromCharCode(0x41 + (i % 26))).join('');

function ruleOf(run: () => void): { rule: string; field: string; message: string } {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(CredentialInputError);
    const { rule, field, message } = error as CredentialInputError;
    return { rule, field, message };
  }
  throw new Error('expected a CredentialInputError');
}

describe('CredentialInputError', () => {
  it('carries the rule, field and fixed message, never the submitted value', () => {
    const error = new CredentialInputError('ascii', 'apiToken');
    expect(error.name).toBe('CredentialInputError');
    expect(error).toMatchObject({ rule: 'ascii', field: 'apiToken', message: CREDENTIAL_MESSAGES.ascii });
  });
});

describe('assertCredentialToken', () => {
  it.each([undefined, 42, '', '   \t'])('refuses a missing or blank token (%j) under the default field name', (value) => {
    expect(ruleOf(() => assertCredentialToken({ value }))).toEqual({ rule: 'blank', field: 'token', message: CREDENTIAL_MESSAGES.blank });
  });

  it('measures the limit on the trimmed token, so edge whitespace does not count', () => {
    expect(() => assertCredentialToken({ value: `  ${tokenOf(CREDENTIAL_TOKEN_LIMIT)}\n` })).not.toThrow();
    expect(ruleOf(() => assertCredentialToken({ value: tokenOf(CREDENTIAL_TOKEN_LIMIT + 1), field: 'pat' })))
      .toMatchObject({ rule: 'limit', field: 'pat' });
  });

  it('requires visible ASCII for hosted tokens, but allows other printable text for self-hosted ones', () => {
    const value = `${tokenOf(8)}é${tokenOf(4)}`;
    expect(ruleOf(() => assertCredentialToken({ value }))).toMatchObject({ rule: 'ascii' });
    expect(ruleOf(() => assertCredentialToken({ value: `${tokenOf(4)} ${tokenOf(4)}` }))).toMatchObject({ rule: 'ascii' });
    expect(() => assertCredentialToken({ value, hosted: false })).not.toThrow();
  });

  it.each([
    ['a C0 control', `${tokenOf(4)}\u0007${tokenOf(4)}`],
    ['a C1 control', `${tokenOf(4)}\u0085${tokenOf(4)}`],
    ['a lone high surrogate', `${tokenOf(4)}\uD800${tokenOf(4)}`],
    ['a lone low surrogate', `${tokenOf(4)}\uDC00${tokenOf(4)}`],
  ])('refuses %s even when the token is self-hosted', (_name, value) => {
    expect(ruleOf(() => assertCredentialToken({ value, hosted: false }))).toMatchObject({ rule: 'control' });
  });

  it('accepts a well-formed surrogate pair in a self-hosted token', () => {
    expect(() => assertCredentialToken({ value: `${tokenOf(4)}😀${tokenOf(4)}`, hosted: false })).not.toThrow();
  });
});

describe('normalizeCredentialToken', () => {
  it('trims edge whitespace only and never rewrites interior characters', () => {
    const token = `${tokenOf(6)}-_.~${tokenOf(6)}`;
    expect(normalizeCredentialToken({ value: `\t ${token} \n` })).toBe(token);
  });

  it('applies the same validation before normalizing', () => {
    expect(ruleOf(() => normalizeCredentialToken({ value: '  ', field: 'secret' }))).toMatchObject({ rule: 'blank', field: 'secret' });
  });
});

describe('credentialTokenHint', () => {
  it('exposes no characters of a short token and only the last four of a long one', () => {
    expect(credentialTokenHint({ token: tokenOf(11) })).toEqual({ length: 11, last4: null });
    const long = tokenOf(12);
    expect(credentialTokenHint({ token: long })).toEqual({ length: 12, last4: long.slice(-4) });
  });
});

describe('assertCredentialFreeField', () => {
  const never = () => false;
  const refused = (value: string, containsSecret: (required: { text: string }) => boolean = never) =>
    ruleOf(() => assertCredentialFreeField({ value, field: 'args', containsSecret }));

  it('refuses whatever the injected detector flags', () => {
    expect(refused('ordinary label', ({ text }) => text === 'ordinary label')).toEqual({ rule: 'plain', field: 'args', message: CREDENTIAL_MESSAGES.plain });
  });

  it.each(['--api-key=value', 'serve --token value', '--db-password=x --verbose'])('refuses a secret-named CLI argument with a value: %s', (value) => {
    expect(refused(value)).toMatchObject({ rule: 'plain' });
  });

  it.each([
    'https://user@example.com/mcp', 'https://user:pass@example.com/mcp',
    'https://example.com/mcp?api_key=x', 'https://example.com/mcp?x=1&access-token=y', 'https://example.com/hook?sig=z',
  ])('refuses a URL carrying credentials: %s', (value) => {
    expect(refused(value)).toMatchObject({ rule: 'plain' });
  });

  it.each(['My MCP server', 'https://example.com/mcp?page=2', '--verbose --port 8080', '--token'])('accepts metadata without credentials: %s', (value) => {
    expect(() => assertCredentialFreeField({ value, field: 'args', containsSecret: never })).not.toThrow();
  });
});
