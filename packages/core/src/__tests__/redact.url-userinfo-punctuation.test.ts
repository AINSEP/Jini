import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string, redactPii = false) => redactSecretsWithCounts({ input }, { redactPii });

// The userinfo of a URL runs to the LAST `@` of its authority so a password holding an unencoded `@` is
// masked whole. Punctuation that ends a URL in prose (`,` `;` `)` `>` a quote) must stop that extension:
// otherwise a contact address written right after the URL pulls the real host into the credential span.
describe('URL userinfo does not run across punctuation to a later address', () => {
  it.each([
    ['https://user:pw@host.example.com,bob@example.com', 'https://[REDACTED:url_credentials]@host.example.com,bob@example.com'],
    ['https://user:pw@host.example.com;bob@example.com', 'https://[REDACTED:url_credentials]@host.example.com;bob@example.com'],
    ['(https://user:pw@host.example.com)bob@example.com', '(https://[REDACTED:url_credentials]@host.example.com)bob@example.com'],
    ['<https://user:pw@host.example.com>,bob@example.com', '<https://[REDACTED:url_credentials]@host.example.com>,bob@example.com'],
    ['"https://user:pw@host.example.com",bob@example.com', '"https://[REDACTED:url_credentials]@host.example.com",bob@example.com'],
  ])('%j', (input, expected) => {
    const first = run(input);
    expect(first.redacted).toBe(expected);
    expect(run(first.redacted).redacted).toBe(expected);
  });
  it('still reads a password holding unencoded @ signs whole', () => {
    expect(run('postgres://u:p@ss4@host/db').redacted).toBe('postgres://[REDACTED:url_credentials]@host/db');
    expect(run('https://u:p@ss@word@host:5432/db and x@y.example').redacted).toBe('https://[REDACTED:url_credentials]@host:5432/db and x@y.example');
    expect(run('//u:p,w@x@host/db').redacted).toBe('//[REDACTED:url_credentials]@host/db');
  });
  it('masks the contact address as an address when PII masking is on, and keeps the host readable', () => {
    expect(run('https://user:pw@host.example.com,bob@example.com', true).redacted)
      .toBe('https://[REDACTED:url_credentials]@host.example.com,[REDACTED:email]');
  });
});
