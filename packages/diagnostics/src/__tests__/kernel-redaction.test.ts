import { expect, it } from 'vitest';
import { SECRET_SHAPE_PATTERNS } from '@jini-ai/core';
import { SECRET_PATTERNS, redactSecretShapes } from '../redaction/secrets-only.js';
import { redactText, redactJsonValue, redactJsonText } from '../redaction.js';

// PARITY: literal sources captured from diagnostics before kernel adoption.
it('pins all eleven credential regex sources byte for byte', () => {
  const expected = [
  "(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])",
  "(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{90,}",
  "(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{40,}",
  "(?<!\\w)ghp_\\w{36}(?!\\w)",
  "(?<!\\w)gho_\\w{36}(?!\\w)",
  "(?<!\\w)github_pat_\\w{80,}",
  "(?<!\\w)npm_\\w{36}(?!\\w)",
  "(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{12,}",
  "(?<![0-9A-Z])AKIA[0-9A-Z]{16}(?![0-9A-Z])",
  "(?<![A-Za-z0-9+/=])fm2_[A-Za-z0-9+/=]{20,}",
  "-----BEGIN [A-Z ]*PRIVATE KEY-----"
];
  expect(SECRET_SHAPE_PATTERNS.map(({ pattern }) => pattern.source)).toEqual(expected);
  expect(SECRET_PATTERNS.map(({ pattern }) => pattern.source)).toEqual(expected);

});

// REGRESSION: fails if diagnostics restores a private credential catalog.
it('shares the exact kernel catalog with scanner consumers', () => {
  expect(SECRET_PATTERNS).toBe(SECRET_SHAPE_PATTERNS);
});

// PARITY: diagnostics keeps identifiers and prose readable under its own policy.
it.each([
  '123e4567-e89b-12d3-a456-426614174000',
  '0123456789abcdef0123456789abcdef01234567',
  'claude-sonnet-4-5-20250929',
  '/Users/alice/project/0123456789abcdef0123456789abcdef01234567.log',
  'ERR-0123456789abcdef0123456789',
])('preserves non-secret context: %s', text => {
  expect(redactSecretShapes({ text, policy: {} })).toEqual({ text, redactions: 0 });
  expect(redactText({ text })).toBe(text);
  expect(redactJsonValue({ value: { context: text } })).toEqual({ context: text });
  expect(JSON.parse(redactJsonText({ text: JSON.stringify({ context: text }) }))).toEqual({ context: text });
});

// REGRESSION: fails if redactText stops applying SECRET_SHAPE_PATTERNS.
it('uses credential shapes throughout the text and JSON bundle policies', () => {
  const secret = 'AIza' + 'a'.repeat(35);
  expect(redactText({ text: 'credential ' + secret })).toBe('credential [REDACTED]');
  expect(redactJsonValue({ value: { context: secret } })).toEqual({ context: '[REDACTED]' });
  expect(JSON.parse(redactJsonText({ text: JSON.stringify({ context: secret }) }))).toEqual({ context: '[REDACTED]' });
});
