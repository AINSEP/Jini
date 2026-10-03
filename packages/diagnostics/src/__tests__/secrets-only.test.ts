import assert from "node:assert/strict";
import { test } from "vitest";

import { redactSecretShapes as redact } from "../redaction/secrets-only.js";
const policy = { additionalRules: [{ kind: "examplehost_api_key", pattern: /(examplehost_ak_[0-9a-f]{12}\.)[A-Za-z0-9_-]{20,}/g, replacement: ({ match: m }: { match: readonly (string | undefined)[] }) => `${m[1]}[REDACTED:examplehost_api_key]` }] };
const redactSecretShapes = (text: string) => redact({ text, policy });

/**
 * @file `redactSecretShapes` — the pure engine behind the tool-failure redactor
 * (`assistant/tool-failure-redaction.ts`).
 *
 * None of the strings below are real credentials. Every secret-shaped value is built at runtime
 * (string concatenation / `.repeat`), the same technique `secret-scan-guard.test.ts` uses for its
 * own fixtures — a real-length literal here would make `npm run check:secret-scan` go red on this
 * very file. See that file's header for the precedent.
 */

test("blanks every secret shape, and the secret substring is absent from the output", () => {
  const secrets: Record<string, readonly [input: string, expected: string, payload: string]> = {
    "Stripe live key": [["sk", "live", ""].join("_") + "Ab3".repeat(8), "[REDACTED:stripe_key]", "Ab3".repeat(8)],
    "Stripe test key": [["sk", "test", ""].join("_") + "Cd4".repeat(8), "[REDACTED:stripe_key]", "Cd4".repeat(8)],
    "Stripe restricted key": [["rk", "live", ""].join("_") + "Ef5".repeat(8), "[REDACTED:stripe_key]", "Ef5".repeat(8)],
    "Stripe webhook secret": [["whsec", ""].join("_") + "Gh6".repeat(10), "[REDACTED:stripe_key]", "Gh6".repeat(10)],
    "GitHub classic PAT (ghp_)": ["ghp_" + "a1".repeat(18), "[REDACTED:credential]", "a1".repeat(18)],
    "GitHub OAuth token (gho_)": ["gho_" + "b2".repeat(18), "[REDACTED:credential]", "b2".repeat(18)],
    "GitHub server token (ghs_)": ["ghs_" + "c3d4".repeat(8), "[REDACTED:github_token]", "c3d4".repeat(8)],
    "GitHub fine-grained PAT": ["github_pat_" + "x1".repeat(45), "[REDACTED:credential]", "x1".repeat(45)],
    "Authorization: Bearer": ["Authorization: Bearer " + "tok".repeat(20), "Authorization: Bearer [REDACTED:auth_header]", "tok".repeat(20)],
    "Authorization: Basic": ["Authorization: Basic " + "QWxhZGRpbjpvcGVuc2VzYW1l", "Authorization: Basic [REDACTED:auth_header]", "QWxhZGRpbjpvcGVuc2VzYW1l"],
    "x-api-key header": ["x-api-key: " + "sekret".repeat(6), "x-api-key: [REDACTED:auth_header]", "sekret".repeat(6)],
    "bare Bearer token with a digit": ["Use " + "Bearer " + "k3y".repeat(6), "Use Bearer [REDACTED:bearer_token]", "k3y".repeat(6)],
    "AWS AKIA key": ["AKIA" + "Q".repeat(16), "[REDACTED:credential]", "Q".repeat(16)],
    "AWS ASIA key": ["ASIA" + "Q".repeat(16), "[REDACTED:aws_access_key]", "Q".repeat(16)],
    JWT: ["eyJ" + "a".repeat(10) + "." + "eyJ" + "b".repeat(10) + "." + "c".repeat(10), "[REDACTED:jwt]", "c".repeat(10)],
    "Google AIza key": ["AIza" + "x".repeat(35), "[REDACTED:credential]", "x".repeat(35)],
    "Anthropic sk-ant- key": ["sk-ant-" + "x".repeat(95), "[REDACTED:credential]", "x".repeat(95)],
    "OpenAI sk-proj- key": [["sk", "proj", ""].join("-") + "Ab3".repeat(8), "[REDACTED:openai_key]", "Ab3".repeat(8)],
    "PEM block, multi-line": [[["-----BEGIN", "PRIVATE", "KEY-----"].join(" "), "MIIEv...", ["-----END", "PRIVATE", "KEY-----"].join(" ")].join("\n"), "[REDACTED:private_key]", "MIIEv..."],
    "PEM block, truncated (no END)": [[["-----BEGIN", "PRIVATE", "KEY-----"].join(" "), "MIIEv..."].join("\n"), "[REDACTED:private_key]", "MIIEv..."],
    "password= assignment": ["password=" + "Sw0rdFish!".repeat(2), "password=[REDACTED:labeled_secret]", "Sw0rdFish!".repeat(2)],
    'JSON "client_secret"': ['"client_secret":"' + "abc123XYZ".repeat(3) + '"', "\"client_secret\":\"[REDACTED:labeled_secret]\"", "abc123XYZ".repeat(3)],
    "?api_key= query param": ["?api_key=" + "q1w2e3r4t5".repeat(2), "?api_key=[REDACTED:labeled_secret]", "q1w2e3r4t5".repeat(2)],
  };

  for (const [label, [secret, expected, payload]] of Object.entries(secrets)) {
    const { text, redactions } = redactSecretShapes(secret);
    assert.ok(redactions >= 1, `${label}: expected at least one redaction`);
    assert.equal(text.includes(secret), false, `${label}: secret substring survived redaction: ${text}`);
    assert.equal(text, expected, `${label}: the complete value must be replaced`);
    assert.equal(text.includes(payload), false, `${label}: secret payload survived redaction`);
  }
});

test("a Postgres URL's user:pass is blanked; the host, port, path and IP are kept exactly", () => {
  const { text, redactions } = redactSecretShapes("postgres://u:p4ss@10.0.4.7:5432/db");
  assert.equal(text, "postgres://[REDACTED:url_credentials]@10.0.4.7:5432/db");
  assert.equal(redactions, 1);
});

test("an Authorization header inside a longer message is blanked without eating the IP or cause that follows it", () => {
  const token = "abc123DEF456ghi789";
  const { text, redactions } = redactSecretShapes(`request failed (Authorization: Bearer ${token}): connect ECONNREFUSED 10.0.4.7:443`);
  assert.equal(text, "request failed (Authorization: Bearer [REDACTED:auth_header]): connect ECONNREFUSED 10.0.4.7:443");
  assert.equal(redactions, 1);
});

test("a ExampleHost API key keeps its key-id prefix and blanks only the secret half", () => {
  const keyId = "0123456789ab";
  const secretHalf = "Zz9".repeat(15);
  const { text, redactions } = redactSecretShapes(`examplehost_ak_${keyId}.${secretHalf}`);
  assert.equal(text, `examplehost_ak_${keyId}.[REDACTED:examplehost_api_key]`);
  assert.equal(redactions, 1);
});

test("UNCHANGED: text with nothing secret-shaped in it is returned byte-for-byte, with redactions === 0", () => {
  const unchanged = [
    "MEMBERS_NOT_FOUND: member 'leona@example.com' was not found",
    "connect ECONNREFUSED 10.0.4.7:443",
    "ENOENT: no such file or directory, open '/Users/x/.examplehost/root.key'",
    "requires a Bearer token",
    "Basic authentication is not supported",
    "token expired at 1726500000123",
    "password: must be at least 8 characters",
    "custom_credential_make_request failed",
    "ERR-3F9A-1C2B-7D4E-8A60",
  ];

  for (const text of unchanged) {
    const result = redactSecretShapes(text);
    assert.equal(result.text, text, `expected no change to: ${text}`);
    assert.equal(result.redactions, 0, `expected zero redactions for: ${text}`);
  }
});

test("idempotent: redacting an already-redacted text a second time changes nothing further", () => {
  const secret = ["sk", "live", ""].join("_") + "Ab3".repeat(8);
  const first = redactSecretShapes(`Authorization: Bearer ${"tok".repeat(20)} stripe=${secret}`);
  assert.ok(first.redactions >= 1);

  const second = redactSecretShapes(first.text);
  assert.equal(second.text, first.text);
  assert.equal(second.redactions, 0);
});

test("redactions counts every value blanked, not just whether any were found", () => {
  const first = ["sk", "live", ""].join("_") + "Ab3".repeat(8);
  const second = "ghp_" + "a1".repeat(18);
  const { redactions } = redactSecretShapes(`first=${first} second=${second}`);
  assert.equal(redactions, 2);
});

test("an empty string is returned unchanged, with redactions === 0", () => {
  assert.deepEqual(redactSecretShapes(""), { text: "", redactions: 0 });
});

// 2026-09-16 security review: the shapes below all LEAKED their secret verbatim before this
// commit. Each one is a form a real tool-failure message reaches us in — `util.inspect` of a
// request config, a YAML/pretty-printed body, a JSON error body embedded inside another JSON
// string, a DSN whose password was never percent-encoded.

test("a `label: value` colon form is blanked for every secret label, quoted or bare", () => {
  const value = "abcd1234efgh5678ijkl";
  const cases: [string, string][] = [
    [`api_key: ${value}`, `api_key: [REDACTED:labeled_secret]`],
    [`access_token: ${value}`, `access_token: [REDACTED:labeled_secret]`],
    [`password: ${value}`, `password: [REDACTED:labeled_secret]`],
    // `util.inspect` / a single-quoted JS or Python literal.
    [`{ api_key: '${value}' }`, `{ api_key: '[REDACTED:labeled_secret]' }`],
    [`{'client_secret': '${value}'}`, `{'client_secret': '[REDACTED:labeled_secret]'}`],
    // A header-ish label the auth_header rule's hyphenated list does not spell.
    [`x_api_key: ${value}`, `x_api_key: [REDACTED:labeled_secret]`],
  ];

  for (const [input, expected] of cases) {
    const { text, redactions } = redactSecretShapes(input);
    assert.equal(text.includes(value), false, `secret survived: ${text}`);
    assert.equal(text, expected);
    assert.equal(redactions, 1, `expected exactly one redaction for: ${input}`);
  }
});

test("a JSON error body embedded inside another JSON string still has its escaped-quote value blanked", () => {
  const value = "abcd1234efgh5678ijkl";
  const nested = JSON.stringify(JSON.stringify({ api_key: value }));

  const { text } = redactSecretShapes(`upstream said ${nested}`);

  assert.equal(text.includes(value), false, `secret survived: ${text}`);
});

test("a DSN password containing an un-encoded @ is blanked WHOLE, not up to its first @", () => {
  const { text, redactions } = redactSecretShapes("connect failed: postgres://u:p@ss4@10.0.4.7:5432/db");

  assert.equal(text, "connect failed: postgres://[REDACTED:url_credentials]@10.0.4.7:5432/db");
  assert.equal(redactions, 1);
});

test("a truncated Anthropic key — too short for SECRET_PATTERNS' 90-char rule — is still blanked", () => {
  const truncated = ["sk", "ant", "api03", ""].join("-") + "x".repeat(50);

  const { text } = redactSecretShapes(`upstream 401 for ${truncated}`);

  assert.equal(text.includes(truncated), false, `secret survived: ${text}`);
});

test("every newly covered shape is still idempotent, including the DSN one", () => {
  const value = "abcd1234efgh5678ijkl";
  const inputs = [
    `api_key: ${value}`,
    `{ api_key: '${value}' }`,
    `postgres://u:p@ss4@10.0.4.7:5432/db`,
    JSON.stringify(JSON.stringify({ api_key: value })),
    ["sk", "ant", "api03", ""].join("-") + "x".repeat(50),
  ];

  for (const input of inputs) {
    const first = redactSecretShapes(input);
    const second = redactSecretShapes(first.text);
    assert.equal(second.text, first.text, `not stable: ${input}`);
    assert.equal(second.redactions, 0, `re-redacted on a second pass: ${first.text}`);
  }
});

test('vendor rules retain precedence over an injected application-key format', () => {
 const prefix = 'examplehost_ak_0123456789ab.';
 const secret = ['sk', 'proj', ''].join('-') + 'x'.repeat(24);
 assert.deepEqual(redactSecretShapes(prefix + secret), { text: prefix + '[REDACTED:openai_key]', redactions: 1 });
});
