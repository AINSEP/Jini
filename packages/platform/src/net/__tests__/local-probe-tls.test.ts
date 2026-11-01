import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { LEAF_CERT, LEAF_KEY, OTHER_CERT, OTHER_KEY, ROOT_CERT, SELF_CERT, SELF_KEY, WRONGHOST_CERT, WRONGHOST_KEY } from './fixtures/local-probe-tls.js';

it('keeps private keys out of the committed TLS fixture', () => {
  const source = readFileSync(new URL('./fixtures/local-probe-tls.ts', import.meta.url), 'utf8');
  expect(/-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/.test(source)).toBe(false);
});

it('preserves the shared CA, distinct non-CA leaves, hostnames and matching private keys', () => {
  const root = new X509Certificate(ROOT_CERT);
  expect(root.ca).toBe(true);
  expect(root.verify(root.publicKey)).toBe(true);
  for (const [pem, key, hostname] of [
    [LEAF_CERT, LEAF_KEY, 'localhost'], [OTHER_CERT, OTHER_KEY, 'localhost'],
    [WRONGHOST_CERT, WRONGHOST_KEY, 'wrong.example'], [SELF_CERT, SELF_KEY, 'localhost'],
  ]) {
    const certificate = new X509Certificate(pem!);
    expect(certificate.ca).toBe(false);
    expect(certificate.checkHost(hostname!)).toBe(hostname);
    expect(certificate.checkPrivateKey(createPrivateKey(key!))).toBe(true);
    expect(certificate.verify(pem === SELF_CERT ? certificate.publicKey : root.publicKey)).toBe(true);
    expect(certificate.verify(createPublicKey(OTHER_KEY))).toBe(false);
  }
  expect(new X509Certificate(WRONGHOST_CERT).checkHost('localhost')).toBeUndefined();
  expect(new Set([LEAF_CERT, OTHER_CERT, WRONGHOST_CERT, SELF_CERT]).size).toBe(4);
});
