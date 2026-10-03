import assert from 'node:assert/strict';
import { test } from 'vitest';

import { SECRET_PATTERNS } from '../redaction/secrets-only.js';

// F4.4/F5.2: valid length and alphabet isolate each lookaround guard; positive controls prove
// these negative checks cannot pass merely because the vendor expression matches nothing.
for (const { name, prefix, length, character } of [
  { name: 'Google API key (AIza)', prefix: 'AIza', length: 35, character: '_' },
  { name: 'GitHub personal access token (classic, ghp_)', prefix: 'ghp_', length: 36, character: '_' },
  { name: 'GitHub OAuth token (gho_)', prefix: 'gho_', length: 36, character: '_' },
  { name: 'npm access token', prefix: 'npm_', length: 36, character: '_' },
  { name: 'AWS access key ID', prefix: 'AKIA', length: 16, character: '9' },
]) {
  test(`${name}: matches the whole fixed-length value but rejects short, extended and identifier-prefixed values`, () => {
    const entry = SECRET_PATTERNS.find((entry) => entry.name === name);
    assert.ok(entry, `missing vendor pattern: ${name}`);
    const value = prefix + character.repeat(length);
    assert.equal(entry.pattern.exec(`key="${value}"`)?.[0], value);
    assert.equal(entry.pattern.exec(prefix + character.repeat(length - 1)), null);
    assert.equal(entry.pattern.exec(value + 'Z'), null, 'a longer identifier must not be truncated into a secret');
    assert.equal(entry.pattern.exec('Z' + value), null, 'a prefix inside an identifier is not a standalone credential');
  });
}

// F4.3/F4.4/F6.2: raising a minimum by one, removing the left boundary, or truncating
// a variable-length match must fail independently. These are assembled dummy credentials.
for (const { name, prefix, minimum, character, embeddedPrefix } of [
  { name: 'Anthropic API key (sk-ant-)', prefix: 'sk-ant-', minimum: 90, character: '_', embeddedPrefix: '-' },
  { name: 'generic sk- secret key (OpenAI-shaped)', prefix: 'sk-', minimum: 40, character: '7', embeddedPrefix: '_' },
  { name: 'GitHub fine-grained PAT', prefix: 'github_pat_', minimum: 80, character: '_', embeddedPrefix: '_' },
  { name: 'Slack token', prefix: 'xoxb-', minimum: 12, character: '-', embeddedPrefix: '-' },
  { name: 'Fastmail app password (fm2_)', prefix: 'fm2_', minimum: 20, character: '/', embeddedPrefix: '=' },
]) {
  test(`${name}: accepts the minimum and longer values in full, but rejects short and embedded values`, () => {
    const entry = SECRET_PATTERNS.find((entry) => entry.name === name);
    assert.ok(entry, `missing vendor pattern: ${name}`);
    const minimumValue = prefix + character.repeat(minimum);
    const longerValue = prefix + character.repeat(minimum + 7);
    assert.equal(entry.pattern.exec(`key="${minimumValue}"`)?.[0], minimumValue);
    assert.equal(entry.pattern.exec(`key="${longerValue}"`)?.[0], longerValue);
    assert.equal(entry.pattern.exec(prefix + character.repeat(minimum - 1)), null);
    assert.equal(entry.pattern.exec(embeddedPrefix + minimumValue), null);
  });
}

test('Slack recognizes each supported token subtype and rejects an unsupported subtype', () => {
  const entry = SECRET_PATTERNS.find((entry) => entry.name === 'Slack token');
  assert.ok(entry);
  for (const subtype of ['b', 'a', 'p', 'r', 's']) {
    const value = 'xox' + subtype + '-' + '7'.repeat(12);
    assert.equal(entry.pattern.exec(value)?.[0], value);
  }
  assert.equal(entry.pattern.exec('xoxz-' + '7'.repeat(12)), null);
});

test('PEM recognizes untyped, RSA, EC and encrypted private headers while ignoring public keys', () => {
  const entry = SECRET_PATTERNS.find((entry) => entry.name === 'PEM private key block');
  assert.ok(entry);
  for (const keyType of ['', 'RSA ', 'EC ', 'ENCRYPTED ']) {
    const header = '-----BEGIN ' + keyType + 'PRIVATE' + ' KEY-----';
    assert.equal(entry.pattern.exec('before\n' + header + '\nafter')?.[0], header);
  }
  assert.equal(entry.pattern.exec('-----BEGIN ' + 'PUBLIC' + ' KEY-----'), null);
});
