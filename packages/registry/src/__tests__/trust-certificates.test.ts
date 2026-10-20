import { X509Certificate, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { certIssuedAndSignedBy, chainToTrustedRoot, parseCertificateBundle, parseSanUris } from '../trust-certificates.js';

// Typed fakes for the certificate under test; the issuer only needs a real
// public key (generated at runtime, so no key/certificate text is committed).
function anyCertificateLike(): Pick<X509Certificate, 'checkIssued' | 'verify'> {
  return { checkIssued: () => true, verify: () => true };
}

describe('certIssuedAndSignedBy', () => {
  it('returns false instead of throwing when checkIssued throws (the never-throw contract)', () => {
    const throwing: Pick<X509Certificate, 'checkIssued' | 'verify'> = {
      checkIssued: () => {
        throw new TypeError('exotic certificate');
      },
      verify: () => true,
    };
    const issuer = { publicKey: generateKeyPairSync('ed25519').publicKey } as X509Certificate; // malformed-input fixture: only publicKey is read
    expect(certIssuedAndSignedBy(throwing, issuer)).toBe(false);
  });

  it('returns false instead of throwing when verify throws', () => {
    const throwing: Pick<X509Certificate, 'checkIssued' | 'verify'> = {
      checkIssued: () => true,
      verify: () => {
        throw new TypeError('bad key');
      },
    };
    const issuer = { publicKey: generateKeyPairSync('ed25519').publicKey } as X509Certificate; // malformed-input fixture: only publicKey is read
    expect(certIssuedAndSignedBy(throwing, issuer)).toBe(false);
  });

  it('requires BOTH the DN link and the cryptographic signature', () => {
    const issuer = { publicKey: generateKeyPairSync('ed25519').publicKey } as X509Certificate; // malformed-input fixture: only publicKey is read
    expect(certIssuedAndSignedBy({ ...anyCertificateLike(), verify: () => false }, issuer)).toBe(false);
    expect(certIssuedAndSignedBy({ ...anyCertificateLike(), checkIssued: () => false }, issuer)).toBe(false);
    expect(certIssuedAndSignedBy(anyCertificateLike(), issuer)).toBe(true);
  });
});

describe('chainToTrustedRoot', () => {
  it('refuses an empty chain', () => {
    expect(chainToTrustedRoot([], [])).toBe(false);
  });
});

describe('parseCertificateBundle', () => {
  it('returns no certificates for text without PEM markers', () => {
    expect(parseCertificateBundle('no markers here')).toEqual([]);
  });
});

describe('parseSanUris', () => {
  it('returns the URI entries only, trimmed, in order', () => {
    expect(parseSanUris('DNS:example.com, URI:https://a, email:x@y, URI:https://b')).toEqual(['https://a', 'https://b']);
  });

  it('returns nothing for a missing SAN', () => {
    expect(parseSanUris(undefined)).toEqual([]);
    expect(parseSanUris(null)).toEqual([]);
    expect(parseSanUris('')).toEqual([]);
  });
});
