import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string, redactPii = false) => redactSecretsWithCounts({ input }, { redactPii });

// A database password that was never percent-encoded can contain `@`. Reading the userinfo only up to its
// FIRST `@` left the rest of the password in the output next to the host, so the credential span now runs
// to the LAST `@` of the authority (it ends at `/`, `?`, `#` or whitespace).
describe('URL userinfo whose password contains @', () => {
  it.each([
    ['postgres://user:p@ssw0rd@db.example.com:5432/app', 'postgres://[REDACTED:url_credentials]@db.example.com:5432/app'],
    ['postgres://u:p@ss4@host/db', 'postgres://[REDACTED:url_credentials]@host/db'],
    ['mysql://root:a@b@c@host/db?x=1', 'mysql://[REDACTED:url_credentials]@host/db?x=1'],
    ['redis://:p@ss@host:6379', 'redis://[REDACTED:url_credentials]@host:6379'],
    ['see //u:p@ss@host/x now', 'see //[REDACTED:url_credentials]@host/x now'],
  ])('masks every character of the password in %j', (input, redacted) => {
    expect(run(input)).toEqual({ redacted, counts: { url_credentials: 1 } });
  });
  it('keeps the host readable when the password looks like an address and PII masking is on', () => {
    const { redacted } = run('postgres://u:p@ss.com@host/db', true);
    expect(redacted).toContain('@host/db');
    expect(redacted).not.toContain('ss.com');
  });
  it.each([
    'see https://example.com/@user/profile', 'https://example.com/path?email=a@b.com', 'mail a@b.example about //docs and c@d.example',
    'https://example.com/a#frag@x',
  ])('does not extend the userinfo past the authority or whitespace: %j', input => {
    expect(run(input).redacted).toBe(input);
  });
  it('is idempotent', () => {
    const once = run('postgres://u:p@ss4@host/db').redacted;
    expect(run(once)).toEqual({ redacted: once, counts: {} });
  });
  it('scans a run of at-signs in linear time', () => {
    const input = `//${'a@'.repeat(100_000)} tail`;
    const started = performance.now();
    run(input);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
