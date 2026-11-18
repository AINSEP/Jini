import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

// Pinned 2026-11-18 on wave2/chat-deps BEFORE the chat-redaction-fix rules landed. Core's other callers
// (provider error text, daemon tool recovery, plugin connect errors, diagnostics, analytics, cli, mcp, cms)
// get exactly these answers today; the fixes that bring chat's old coverage into this one engine must not
// move any of them. The idempotence assertion also keeps a second pass from changing a marker.
const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

describe('answers the engine already gives its other callers', () => {
  it.each<[string, string]>([
  ["Error: connect ECONNREFUSED 10.0.4.7:443 at /Users/dev/app/src/server.ts:41:9", "Error: connect ECONNREFUSED 10.0.4.7:443 at /Users/dev/app/src/server.ts:41:9"],
  ["request failed (Authorization: Bearer abcdefghijklmnop12345): connect ECONNREFUSED 10.0.4.7:443", "request failed (Authorization: Bearer [REDACTED:bearer_token] connect ECONNREFUSED 10.0.4.7:443"],
  ["password=hunter2", "password=[REDACTED:labeled_secret]"],
  ["password: hunter2", "password: [REDACTED:labeled_secret]"],
  ["token: abcdefgh12345678", "token: [REDACTED:labeled_secret]"],
  ["api_key=SECRETVALUE&page=2", "api_key=[REDACTED:labeled_secret]&page=2"],
  ["Authorization: Bearer abcdefgh12345678", "Authorization: Bearer [REDACTED:bearer_token]"],
  ["Authorization: Basic QWxhZGRpbjpvcGVuc2VzYW1l", "Authorization: [REDACTED:labeled_secret]"],
  ["x-api-key: abcd1234", "x-api-key: [REDACTED:api_key_header]"],
  ["https://example.com/path?page=2&sort=asc&q=shoes", "https://example.com/path?page=2&sort=asc&q=shoes"],
  ["https://user:secret@example.com/repo.git", "https://[REDACTED:url_credentials]@example.com/repo.git"],
  ["postgres://app:s3cret@db.internal:5432/app", "postgres://[REDACTED:url_credentials]@db.internal:5432/app"],
  ["git clone https://github.com/org/repo.git", "git clone https://github.com/org/repo.git"],
  ["see https://example.com/@user/profile", "see https://example.com/@user/profile"],
  ["contact me@example.com or 555-123-4567", "contact me@example.com or 555-123-4567"],
  ["sha 0123456789abcdef0123456789abcdef01234567", "sha 0123456789abcdef0123456789abcdef01234567"],
  ["id 123e4567-e89b-12d3-a456-426614174000", "id 123e4567-e89b-12d3-a456-426614174000"],
  ["ERR-0A1B-2C3D-4E5F-6A7B failed", "ERR-0A1B-2C3D-4E5F-6A7B failed"],
  ["sk-abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED:sk_key]"],
  ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED:github_token]"],
  ["AKIAABCDEFGHIJKLMNOP", "[REDACTED:aws_access_key]"],
  ["xoxb-1234567890-abcdefghij", "[REDACTED:slack_token]"],
  ["Cookie: sid=abc; theme=dark", "Cookie: [REDACTED:labeled_secret]"],
  ["Set-Cookie: sid=abc; Path=/", "Set-Cookie: [REDACTED:labeled_secret]"],
  ["{\"password\":\"hunter2\",\"user\":\"bob\"}", "{\"password\":\"[REDACTED:labeled_secret]\",\"user\":\"bob\"}"],
  ["{ api_key: 'abcdefgh1234' }", "{ api_key: '[REDACTED:labeled_secret]' }"],
  ["Bearer token authentication is supported.", "Bearer token authentication is supported."],
  ["Basic authentication is not supported", "Basic authentication is not supported"],
  ["Token expired at noon", "Token expired at noon"],
  ["the keyword and author fields", "the keyword and author fields"],
  ["https://example.com/a?author=7&keyword=shoes&design=dark", "https://example.com/a?author=7&keyword=shoes&design=dark"],
  ["https://x.test/cb?access_token=abc&state=1", "https://x.test/cb?access_token=[REDACTED:signed_query]&state=1"],
  ["https://x.test/a?sig=abc&page=2", "https://x.test/a?sig=[REDACTED:signed_query]&page=2"],
  ["secret santa picks Bob", "secret santa picks Bob"],
  ["passwordless login is enabled", "passwordless login is enabled"],
  ["monkey=1 zipcode=90210", "monkey=1 zipcode=90210"],
  ["user_id=42 max_tokens=4096 token_count=12", "user_id=42 max_tokens=4096 token_count=12"],
  ["pwd command prints the cwd", "pwd command prints the cwd"],
  ["cd /home/user && pwd", "cd /home/user && pwd"],
  ["tokenizer=bpe", "tokenizer=bpe"],
  ["my.passwd.file is readable", "my.passwd.file is readable"],
  ["-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", "[REDACTED:credential]"],
  ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk", "[REDACTED:jwt]"],
  ["GET /v1/messages?key=AIzaSyA1234567890abcdefghijklmnopqrstuv 400", "GET /v1/messages?key=[REDACTED:google_api_key] 400"],
  ["at Object.<anonymous> (/app/node_modules/x/index.js:10:5)", "at Object.<anonymous> (/app/node_modules/x/index.js:10:5)"],
  ["build failed: exit code 1 (see logs at /tmp/build.log)", "build failed: exit code 1 (see logs at /tmp/build.log)"],
  ["Authorization: Bearer", "Authorization: [REDACTED:labeled_secret]"],
  ["curl -u admin:pw https://x.test", "curl -u admin:pw https://x.test"],
  ])('%j', (input, expected) => {
    const first = run(input);
    expect(first.redacted).toBe(expected);
    expect(run(first.redacted).redacted).toBe(expected);
  });
});
