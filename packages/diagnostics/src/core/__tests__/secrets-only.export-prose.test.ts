import { expect, test } from 'vitest';
import { redactSecretShapes } from '../secrets-only.js';

test.each([
  'Authorization: Bearer',
  'sent as `Authorization: Bearer`, the documented header.',
  '"Access token": "Token de acceso"',
  '"Access token": "访问令牌"',
  '"Personal access token": "Jeton d’accès personnel"',
  '"API token": "Token de API"',
  '"Access token": "アクセストークン"',
])('preserves instructional prose and translated labels: %s', text => {
  expect(redactSecretShapes({ text, policy: {} })).toEqual({ text, redactions: 0 });
});

test('prose cannot hide real keys in the same document', () => {
  const key = ['sk', 'proj', ''].join('-') + 'Ab3'.repeat(12);
  const text = `"Access token": "Token de acceso"\n${key}`;
  const result = redactSecretShapes({ text, policy: {} });
  expect(result.redactions).toBe(1);
  expect(result.text).not.toContain(key);
});

test.each([
  'token=opaque-secret-value', 'token=the', 'password=hunter2', 'Token = the access-policy token',
  'Authorization: Bearer abcdefgh12345678', 'Authorization: Basic QWxhZGRpbjpvcGVuc2VzYW1l',
  'x-api-key: abcdefgh12345678', '"token": "abcdefgh12345678"',
  '"x_api_key": "abcdefgh12345678"', '"x-api_key": "abcdefgh12345678"',
  'password=the trailing diagnostic text', 'token=the trailing diagnostic text',
  "{token: 'abcdefgh12345678'}", 'token: abcdefgh12345678',
  JSON.stringify(JSON.stringify({ api_key: 'abcdefgh12345678' })),
])('still redacts credential values: %s', text => {
  const result = redactSecretShapes({ text, policy: {} });
  expect(result.redactions).toBeGreaterThan(0);
  expect(result.text).not.toEqual(text);
  expect(redactSecretShapes({ text: result.text, policy: {} }).redactions).toBe(0);
});

test('private keys still warn beside translated token labels', () => {
  const pem = [['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '), 'MIIE' + 'Ab3'.repeat(12), ['-----END', 'PRIVATE', 'KEY-----'].join(' ')].join('\n');
  const result = redactSecretShapes({ text: `"API token": "Token de API"\n${pem}`, policy: {} });
  expect(result.redactions).toBe(1);
  expect(result.text).not.toContain(pem);
});

for (const label of ['Access token', 'Refresh Token', 'Client Secret', 'Admin Password']) {
  test(`redacts opaque credentials under a quoted multi-word key: ${label}`, () => {
    const secret = 'a1b2c3d4e5f6a7b8c9d0';
    const text = JSON.stringify({ [label]: secret });
    const result = redactSecretShapes({ text, policy: {} });
    expect(result.text).toBe(JSON.stringify({ [label]: '[REDACTED:labeled_secret]' }));
    expect(result.redactions).toBe(1);
    expect(redactSecretShapes({ text: result.text, policy: {} }).redactions).toBe(0);
  });
}

test('long dashed non-credential runs finish without changing their bytes', () => {
  const text = 'a-'.repeat(512 * 1024);
  expect(redactSecretShapes({ text, policy: {} })).toEqual({ text, redactions: 0 });
});

test.each([
  ['notes_http-custom', true],
  ['notes_9-http+v2', true],
  ['9-http', true],
  ['git+ssh.v2-custom', true],
  ['notes_http', false],
  ['9http', false],
])('keeps URL scheme boundary behavior for %s', (scheme, redacts) => {
  const text = `${scheme}://u:p@ss4@host:5432/db?mail=user@example.test`;
  const expected = redacts ? `${scheme}://[REDACTED:url_credentials]@host:5432/db?mail=user@example.test` : text;
  const result = redactSecretShapes({ text, policy: {} });
  expect(result).toEqual({ text: expected, redactions: redacts ? 1 : 0 });
  expect(redactSecretShapes({ text: result.text, policy: {} })).toEqual({ text: expected, redactions: 0 });
});

test('redacts credentials after a long dashed scheme without truncating the scheme', () => {
  const scheme = 'a-'.repeat(512 * 1024) + 'postgres';
  const text = `${scheme}://u:p@ss4@host/db`;
  const expected = `${scheme}://[REDACTED:url_credentials]@host/db`;
  expect(redactSecretShapes({ text, policy: {} })).toEqual({ text: expected, redactions: 1 });
  expect(redactSecretShapes({ text: expected, policy: {} })).toEqual({ text: expected, redactions: 0 });
});

test('backticks inside an authorization value do not leak its suffix', () => {
  const result = redactSecretShapes({ text: 'Authorization: Bearer abcdefgh`secret-suffix', policy: {} });
  expect(result.text).toBe('Authorization: Bearer [REDACTED:auth_header]');
});
