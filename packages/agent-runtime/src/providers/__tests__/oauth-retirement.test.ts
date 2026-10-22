import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { generateCodeVerifier, deriveCodeChallenge } from '../pkce.js';
import { redactAntigravityAuthUrls } from '../../defs/antigravity.js';

test('provider adapters retain verifier length and enforce RFC verifier validation', () => {
  expect(generateCodeVerifier()).toHaveLength(86);
  // arch-03 delegates validation to OAuth; short verifiers must no longer be hashed.
  expect(() => deriveCodeChallenge({ verifier: 'abc' }))
    .toThrow('PKCE code verifier must be 43–128 characters (RFC 7636 §4.1)');
  expect(deriveCodeChallenge({ verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' }))
    .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('Antigravity retains host and credential URL redaction byte for byte', () => {
  expect(redactAntigravityAuthUrls({ fullText: 'Visit https://accounts.google.com/new-path?foo=1\nhttps://id.example.com/a?code_verifier=x\nhttps://docs.example.com/oauth' }))
    .toBe('Visit [redacted sign-in URL]\n[redacted sign-in URL]\nhttps://docs.example.com/oauth');
});
