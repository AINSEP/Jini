import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;
const TAIL = 'Zq8wPx3mK7vR2tL9';

// The userinfo of a connection URL runs to its last `@` so an unencoded `@` inside a password is masked whole. A `,` or
// `;` between two `@` signs stopped that extension (so `host.example.com,bob@example.com` keeps its host), but a password
// may hold those characters too: `p@ss,<tail>@host` then showed everything after the first `@`. The stop now applies only
// when the text before the punctuation is a host name, which a password fragment is not.
describe('URL userinfo with , or ; after an @ inside the password', () => {
  it.each([
    `postgres://admin:p@ss,${TAIL}@db.internal:5432/app`,
    `redis://admin:p@ss;${TAIL}@db.internal:6379`,
    `https://admin:x@y,z;${TAIL}@db.internal/app`,
    `mysql://u:p@ss,w0rd;${TAIL}@10.0.0.4:3306/db`,
  ])('masks the whole password in %j', input => {
    const out = run(input);
    expect(out).not.toContain(TAIL);
    expect(out).toMatch(/\[REDACTED:url_credentials\]@(?:db\.internal|10\.0\.0\.4)/);
  });

  it.each([
    ['https://user:pw@host.example.com,bob@example.com', 'https://[REDACTED:url_credentials]@host.example.com,bob@example.com'],
    ['https://user:pw@localhost:8080;bob@example.com', 'https://[REDACTED:url_credentials]@localhost:8080;bob@example.com'],
    ['(https://user:pw@host.example.com)bob@example.com', '(https://[REDACTED:url_credentials]@host.example.com)bob@example.com'],
  ])('keeps a host followed by a contact address in %j', (input, expected) => {
    expect(run(input)).toBe(expected);
  });
});
