import { sign } from 'node:crypto';
import type { RegistryEntry, RegistrySignature } from '@jini-ai/protocol';
import { describe, expect, it } from 'vitest';
import {
  GITHUB_ACTIONS_OIDC_ISSUER,
  canonicalRegistrySigningPayload,
  verifyRegistryEntrySignatures,
  verifyRegistrySignature,
  type RegistryTrustRoot,
} from '../trust.js';

// Fixture certificates generated once via `openssl` for this test suite
// (not fetched from any real CA/Sigstore instance, and no network call is
// made anywhere in this file — signing/verification below is pure
// `node:crypto` against these fixtures). See `trust.ts`'s module doc
// comment for why real Sigstore/Fulcio root-of-trust discovery is
// explicitly out of scope for v1; these are a self-contained CA + leaf pair
// standing in for "whatever CA a host configures as its trust root."

/** Self-signed root CA. */
const CA_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBkjCCATegAwIBAgIUK0avUXJe13wKID2ScGCeLXHryxswCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwSVGVzdCBUcnVzdCBSb290IENBMCAXDTI2MDcyMjA0MTE0NloY
DzIxMjYwNjI4MDQxMTQ2WjAdMRswGQYDVQQDDBJUZXN0IFRydXN0IFJvb3QgQ0Ew
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQsZHk8F8ScSaJGOG0tAW7SSkBEEjOm
q0kh74AkGQuKczmIOU2EndCHzCydqrMjX+DRhQSj7WSEAmMKyV7s594mo1MwUTAd
BgNVHQ4EFgQU+r4ExVmN9YMomT3H7izT/GPBfUswHwYDVR0jBBgwFoAU+r4ExVmN
9YMomT3H7izT/GPBfUswDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNJADBG
AiEAjMZ3lNIJhM1605xWipWZEJVcGrS/yTuMAhfzvypOkA0CIQDpU8fpu6b50Eiz
34W2FiMqCxQrKGm/+Xe2RnIbqsqw+w==
-----END CERTIFICATE-----`;

const CA_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIFwuaGm+4pIT8qwcOOS4YrejKVuubs3Rhl0dZxmZY5ijoAoGCCqGSM49
AwEHoUQDQgAELGR5PBfEnEmiRjhtLQFu0kpARBIzpqtJIe+AJBkLinM5iDlNhJ3Q
h8wsnaqzI1/g0YUEo+1khAJjCsle7OfeJg==
-----END EC PRIVATE KEY-----`;

/** Leaf, directly issued by CA_CERT_PEM, SAN = a GitHub Actions workflow-ref-style URI. */
const LEAF_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIB3jCCAYOgAwIBAgIUQeZvs2JYjKmz6xc9ULeTT5vFYw4wCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwSVGVzdCBUcnVzdCBSb290IENBMCAXDTI2MDcyMjA0MTE0NloY
DzIxMjYwNjI4MDQxMTQ2WjAgMR4wHAYDVQQDDBVzaWdzdG9yZS1pbnRlcm1lZGlh
dGUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR+nfb4UXXffOxtskFEODbANa6C
rKkY5/4UWFgyYzGEz7/usCsO8mY6TQzmoCSSyGEXqpd2zrF4DWf8YmkJaZNjo4Gb
MIGYMFYGA1UdEQRPME2GS2h0dHBzOi8vZ2l0aHViLmNvbS9hY21lL2V4YW1wbGUv
LmdpdGh1Yi93b3JrZmxvd3MvYnVpbGQueW1sQHJlZnMvaGVhZHMvbWFpbjAdBgNV
HQ4EFgQUtSJ2FIvj3KAq26Raozue9Zk+LK0wHwYDVR0jBBgwFoAU+r4ExVmN9YMo
mT3H7izT/GPBfUswCgYIKoZIzj0EAwIDSQAwRgIhAKm44q3D58Y1kqwtiAp9sJmI
W/QZnZCCwrcopIIrUlugAiEA0W4BwJOfXavjmReqxHUPEiyGS2gLKwXJakIqZveS
xY4=
-----END CERTIFICATE-----`;

const LEAF_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIPYWrccVvjkiAzi91Xg8UcexjDs0m4zgZPst1soCgCbdoAoGCCqGSM49
AwEHoUQDQgAEfp32+FF133zsbbJBRDg2wDWugqypGOf+FFhYMmMxhM+/7rArDvJm
Ok0M5qAkkshhF6qXds6xeA1n/GJpCWmTYw==
-----END EC PRIVATE KEY-----`;

/** Leaf signed by a *different* CA, not in any test's trust root — the "untrusted" fixture. */
const OTHER_LEAF_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBzTCCAXOgAwIBAgIUTMmN09O0iX2N0ae7xJiqLy7FVf0wCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwST3RoZXIgVW50cnVzdGVkIENBMCAXDTI2MDcyMjA0MTE0N1oY
DzIxMjYwNjI4MDQxMTQ3WjAQMQ4wDAYDVQQDDAVvdGhlcjBZMBMGByqGSM49AgEG
CCqGSM49AwEHA0IABNowpikE9xdm8r4/br+/26seJdZHcGfV9Jlzsi8DHbDDuJja
VSuj+SGkZOJdP5HIBamti7elBEaBabu4tg0ym4OjgZswgZgwVgYDVR0RBE8wTYZL
aHR0cHM6Ly9naXRodWIuY29tL2FjbWUvZXhhbXBsZS8uZ2l0aHViL3dvcmtmbG93
cy9idWlsZC55bWxAcmVmcy9oZWFkcy9tYWluMB0GA1UdDgQWBBTOTDl5cTEeKquS
J7l4lKafQiwzCDAfBgNVHSMEGDAWgBQqdOclsP0OkSGrarwsQHSwZklLoDAKBggq
hkjOPQQDAgNIADBFAiAltnOLeXCm5NBLb7o6T2wPVhP3GWB8Mk/K80GuLtm8rgIh
AMXJUsYyv88fbPfdV9Q75KsnmAciNQnGRE0v4GZMOLPB
-----END CERTIFICATE-----`;

const OTHER_LEAF_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIK2FW+BNxi4LVtH1KLxuUVs1Bh7OqnNvAP5HKdryNh6AoAoGCCqGSM49
AwEHoUQDQgAE2jCmKQT3F2byvj9uv7/bqx4l1kdwZ9X0mXOyLwMdsMO4mNpVK6P5
IaRk4l0/kcgFqa2Lt6UERoFpu7i2DTKbgw==
-----END EC PRIVATE KEY-----`;

/** An intermediate CA, itself issued by CA_CERT_PEM. */
const INTERMEDIATE_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBpjCCAUygAwIBAgIUQeZvs2JYjKmz6xc9ULeTT5vFYw8wCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwSVGVzdCBUcnVzdCBSb290IENBMCAXDTI2MDcyMjA0MjAxN1oY
DzIxMjYwNjI4MDQyMDE3WjAfMR0wGwYDVQQDDBRUZXN0IEludGVybWVkaWF0ZSBD
QTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABN/w32c8P9kGtPWjSO+RpneDAJeD
MhM5n6wgE4afVCvl61fhRitg/qG7JySdNmLvKFvbKCVLkp46mORG5fPzuAejZjBk
MBIGA1UdEwEB/wQIMAYBAf8CAQAwDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBQg
SNG4pK0KQlK6VKaEMXWVEmk7MTAfBgNVHSMEGDAWgBT6vgTFWY31gyiZPcfuLNP8
Y8F9SzAKBggqhkjOPQQDAgNIADBFAiEAqqmYBeOzMetKKLOiKe5gC4+8oQOLZtcn
b3idJsAxhl0CIGb55t+aIUwBYop+K9mxJgoMbjq7P/8GdxChzClG6xWE
-----END CERTIFICATE-----`;

/** Leaf issued by INTERMEDIATE_CERT_PEM (not directly by CA_CERT_PEM) — proves the multi-hop chain walk. */
const LEAF_VIA_INTERMEDIATE_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIB3zCCAYWgAwIBAgIUFthZZ6lQ/ezufof7a0TiI2+xXrMwCgYIKoZIzj0EAwIw
HzEdMBsGA1UEAwwUVGVzdCBJbnRlcm1lZGlhdGUgQ0EwIBcNMjYwNzIyMDQyMDE3
WhgPMjEyNjA2MjgwNDIwMTdaMCAxHjAcBgNVBAMMFWxlYWYtdmlhLWludGVybWVk
aWF0ZTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABD2+pErBiGY73ergtfQLfkqL
K438Pz3KSXoLQyPIOvp825iwib3LM3grSiEay8laWQO6TREW7HhxYWY7XzFrdkSj
gZswgZgwVgYDVR0RBE8wTYZLaHR0cHM6Ly9naXRodWIuY29tL2FjbWUvZXhhbXBs
ZS8uZ2l0aHViL3dvcmtmbG93cy9idWlsZC55bWxAcmVmcy9oZWFkcy9tYWluMB0G
A1UdDgQWBBQ6xEBSIc2oOzJU8JBo9LjtJWBnHDAfBgNVHSMEGDAWgBQgSNG4pK0K
QlK6VKaEMXWVEmk7MTAKBggqhkjOPQQDAgNIADBFAiAatfPMCWcCLFxp3SiI4Z25
oJ0DOCVixgnssarZzzBhkwIhAJJNMlFij3yTsepd7oV0OgxjYM+Mpiwt7fEo4CPT
XOIi
-----END CERTIFICATE-----`;

const LEAF_VIA_INTERMEDIATE_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIAjClLvk621WWDlx1adkGJGaCcvsY9NCRgPWypOhU5MhoAoGCCqGSM49
AwEHoUQDQgAEPb6kSsGIZjvd6uC19At+Sosrjfw/PcpJegtDI8g6+nzbmLCJvcsz
eCtKIRrLyVpZA7pNERbseHFhZjtfMWt2RA==
-----END EC PRIVATE KEY-----`;

/**
 * An Ed25519 leaf, issued by CA_CERT_PEM, chain-valid — used to prove
 * `verifyRegistrySignature`'s outer `try`/`catch` around the standalone
 * `crypto.verify('sha256', ...)` call is reachable: an Ed25519 public key
 * genuinely throws for an explicit 'sha256' digest algorithm (verified
 * empirically while building this module — see `trust.ts`'s comment on that
 * call site), unlike `X509Certificate#verify()` itself.
 */
const ED25519_LEAF_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBpTCCAUugAwIBAgIUQeZvs2JYjKmz6xc9ULeTT5vFYxAwCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwSVGVzdCBUcnVzdCBSb290IENBMCAXDTI2MDcyMjA0MjAxN1oY
DzIxMjYwNjI4MDQyMDE3WjAXMRUwEwYDVQQDDAxlZDI1NTE5LWxlYWYwKjAFBgMr
ZXADIQB6+7ceDucu5iF5RKPfweb9aWDO5cTTMvHIAQh59VfWAqOBmzCBmDBWBgNV
HREETzBNhktodHRwczovL2dpdGh1Yi5jb20vYWNtZS9leGFtcGxlLy5naXRodWIv
d29ya2Zsb3dzL2J1aWxkLnltbEByZWZzL2hlYWRzL21haW4wHQYDVR0OBBYEFGTQ
6ukLIJmJcb9ilQZJTGQb4EBXMB8GA1UdIwQYMBaAFPq+BMVZjfWDKJk9x+4s0/xj
wX1LMAoGCCqGSM49BAMCA0gAMEUCIQDB3Plj8LyaiDvPkNv7QezsQdsOPW521+tl
23UqyCKr9QIgLPgiwnosEy8fB90V6wVeUtnOqoy7CGLVBWI4wKWNA+w=
-----END CERTIFICATE-----`;

const WORKFLOW_IDENTITY = 'https://github.com/acme/example/.github/workflows/build.yml@refs/heads/main';

const entry: RegistryEntry = {
  name: 'vendor/example',
  version: '1.1.0',
  source: 'github:vendor/example@v1.1.0/entry',
  integrity: 'sha256:abc123',
};

function signBase64(payload: string, privateKeyPem: string): string {
  return sign('sha256', Buffer.from(payload, 'utf8'), privateKeyPem).toString('base64');
}

function githubOidcSignature(overrides: Partial<RegistrySignature> = {}): RegistrySignature {
  return {
    kind: 'github-oidc',
    issuer: GITHUB_ACTIONS_OIDC_ISSUER,
    subject: 'repo:acme/example:ref:refs/heads/main',
    signature: signBase64(canonicalRegistrySigningPayload(entry), LEAF_KEY_PEM),
    certificate: LEAF_CERT_PEM,
    signedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

const trustedRoot: RegistryTrustRoot = { githubOidc: { caCertificates: [CA_CERT_PEM] } };

describe('canonicalRegistrySigningPayload', () => {
  it('prefers integrity, falling back through manifestDigest, dist.integrity, dist.manifestDigest, then empty', () => {
    expect(canonicalRegistrySigningPayload({ name: 'v/n', version: '1.0.0', source: 's', integrity: 'sha256:a' })).toBe('v/n@1.0.0:sha256:a');
    expect(canonicalRegistrySigningPayload({ name: 'v/n', version: '1.0.0', source: 's', manifestDigest: 'sha256:b' })).toBe('v/n@1.0.0:sha256:b');
    expect(canonicalRegistrySigningPayload({ name: 'v/n', version: '1.0.0', source: 's', dist: { integrity: 'sha256:c' } })).toBe('v/n@1.0.0:sha256:c');
    expect(canonicalRegistrySigningPayload({ name: 'v/n', version: '1.0.0', source: 's', dist: { manifestDigest: 'sha256:d' } })).toBe('v/n@1.0.0:sha256:d');
    expect(canonicalRegistrySigningPayload({ name: 'v/n', version: '1.0.0', source: 's' })).toBe('v/n@1.0.0:');
  });
});

describe('verifyRegistrySignature', () => {
  it('verifies a well-formed github-oidc signature end to end', () => {
    const result = verifyRegistrySignature(entry, githubOidcSignature(), trustedRoot);
    expect(result).toEqual({
      verified: true,
      kind: 'github-oidc',
      issuer: GITHUB_ACTIONS_OIDC_ISSUER,
      subject: 'repo:acme/example:ref:refs/heads/main',
    });
  });

  it('falls back to the certificate’s own SAN identity for `subject` when the signature does not declare one', () => {
    const result = verifyRegistrySignature(entry, githubOidcSignature({ subject: undefined }), trustedRoot);
    expect(result).toEqual({ verified: true, kind: 'github-oidc', issuer: GITHUB_ACTIONS_OIDC_ISSUER, subject: WORKFLOW_IDENTITY });
  });

  it('verifies a multi-hop chain (leaf issued by a bundled intermediate, intermediate issued by the trusted root)', () => {
    const bundle = `${LEAF_VIA_INTERMEDIATE_CERT_PEM}\n${INTERMEDIATE_CERT_PEM}`;
    const signature = githubOidcSignature({
      certificate: bundle,
      signature: signBase64(canonicalRegistrySigningPayload(entry), LEAF_VIA_INTERMEDIATE_KEY_PEM),
    });
    expect(verifyRegistrySignature(entry, signature, trustedRoot)).toMatchObject({ verified: true });
  });

  describe('signature kind', () => {
    for (const kind of ['cosign', 'minisign', 'custom'] as const) {
      it(`reports "${kind}" as unsupported without throwing or silently passing`, () => {
        const result = verifyRegistrySignature(entry, { kind, signature: 'anything' }, trustedRoot);
        expect(result).toEqual({ verified: false, kind, reason: `unsupported signature kind: ${kind}` });
      });
    }
  });

  describe('trust root configuration (decision 4: no configured root => no verification at all)', () => {
    it('fails when no trustRoot is passed at all', () => {
      expect(verifyRegistrySignature(entry, githubOidcSignature(), undefined)).toMatchObject({
        verified: false,
        reason: 'no github-oidc trust root configured',
      });
    });

    it('fails when trustRoot.githubOidc is not configured', () => {
      expect(verifyRegistrySignature(entry, githubOidcSignature(), {})).toMatchObject({
        verified: false,
        reason: 'no github-oidc trust root configured',
      });
    });

    it('fails when caCertificates is an empty array', () => {
      expect(verifyRegistrySignature(entry, githubOidcSignature(), { githubOidc: { caCertificates: [] } })).toMatchObject({
        verified: false,
        reason: 'no github-oidc trust root configured',
      });
    });
  });

  describe('required signature fields', () => {
    it('fails when the certificate is missing', () => {
      expect(verifyRegistrySignature(entry, githubOidcSignature({ certificate: undefined }), trustedRoot)).toMatchObject({
        verified: false,
        reason: 'github-oidc signature is missing a certificate',
      });
    });

    it('fails when the issuer is missing', () => {
      expect(verifyRegistrySignature(entry, githubOidcSignature({ issuer: undefined }), trustedRoot)).toMatchObject({
        verified: false,
        reason: 'github-oidc signature is missing an issuer',
      });
    });

    it('fails when signedAt is missing', () => {
      expect(verifyRegistrySignature(entry, githubOidcSignature({ signedAt: undefined }), trustedRoot)).toMatchObject({
        verified: false,
        reason: 'github-oidc signature is missing signedAt',
      });
    });

    it('fails when signedAt is not a parseable date', () => {
      expect(verifyRegistrySignature(entry, githubOidcSignature({ signedAt: 'not-a-date' }), trustedRoot)).toMatchObject({
        verified: false,
        reason: 'github-oidc signature has an invalid signedAt timestamp',
      });
    });
  });

  describe('issuer allowlist', () => {
    it('fails when the issuer is not in the default allowlist', () => {
      const result = verifyRegistrySignature(entry, githubOidcSignature({ issuer: 'https://example.com/not-github' }), trustedRoot);
      expect(result).toMatchObject({ verified: false, reason: expect.stringContaining('is not in the configured allowlist') });
    });

    it('honors a custom allowedIssuers list', () => {
      const root: RegistryTrustRoot = { githubOidc: { caCertificates: [CA_CERT_PEM], allowedIssuers: ['https://issuer.example.com'] } };
      expect(verifyRegistrySignature(entry, githubOidcSignature({ issuer: 'https://issuer.example.com' }), root)).toMatchObject({ verified: true });
      expect(verifyRegistrySignature(entry, githubOidcSignature(), root)).toMatchObject({ verified: false }); // the default GitHub issuer is no longer allowed
    });
  });

  describe('certificate parsing', () => {
    it('fails cleanly when the certificate has no PEM markers at all', () => {
      expect(verifyRegistrySignature(entry, githubOidcSignature({ certificate: 'not a certificate' }), trustedRoot)).toMatchObject({
        verified: false,
        reason: 'no PEM certificate found in signature.certificate',
      });
    });

    it('fails cleanly when the certificate has PEM markers but unparseable content', () => {
      const result = verifyRegistrySignature(
        entry,
        githubOidcSignature({ certificate: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' }),
        trustedRoot,
      );
      expect(result).toMatchObject({ verified: false, reason: expect.stringContaining('could not parse certificate') });
    });

    it('fails cleanly when a configured trust-root CA certificate is itself invalid', () => {
      const badRoot: RegistryTrustRoot = { githubOidc: { caCertificates: ['not a real cert'] } };
      const result = verifyRegistrySignature(entry, githubOidcSignature(), badRoot);
      expect(result).toMatchObject({ verified: false, reason: expect.stringContaining('configured trust root certificate is invalid') });
    });
  });

  describe('chain of trust', () => {
    it('fails when the certificate does not chain to any configured trust root', () => {
      const signature = githubOidcSignature({
        certificate: OTHER_LEAF_CERT_PEM,
        signature: signBase64(canonicalRegistrySigningPayload(entry), OTHER_LEAF_KEY_PEM),
      });
      expect(verifyRegistrySignature(entry, signature, trustedRoot)).toMatchObject({
        verified: false,
        reason: 'certificate does not chain to a configured trust root',
      });
    });

    it('accepts a certificate chaining to any one of multiple configured CAs', () => {
      // INTERMEDIATE_CERT_PEM is a real, parseable cert but not the leaf's
      // actual issuer — only CA_CERT_PEM (the second configured entry)
      // should make this chain resolve.
      const multiRoot: RegistryTrustRoot = { githubOidc: { caCertificates: [INTERMEDIATE_CERT_PEM, CA_CERT_PEM] } };
      expect(verifyRegistrySignature(entry, githubOidcSignature(), multiRoot)).toMatchObject({ verified: true });
    });
  });

  describe('signedAt vs. certificate validity window', () => {
    it('fails when signedAt is before the certificate was valid', () => {
      const signature = githubOidcSignature({ signedAt: '2020-01-01T00:00:00Z' });
      expect(verifyRegistrySignature(entry, signature, trustedRoot)).toMatchObject({
        verified: false,
        reason: 'signedAt falls outside the certificate validity window',
      });
    });

    it('fails when signedAt is after the certificate expired', () => {
      const signature = githubOidcSignature({ signedAt: '2200-01-01T00:00:00Z' });
      expect(verifyRegistrySignature(entry, signature, trustedRoot)).toMatchObject({
        verified: false,
        reason: 'signedAt falls outside the certificate validity window',
      });
    });
  });

  describe('identity allowlist (matched against the certificate’s own SAN, not the self-reported subject field)', () => {
    it('fails when no SAN identity matches an exact-string allowlist entry', () => {
      const root: RegistryTrustRoot = { githubOidc: { caCertificates: [CA_CERT_PEM], allowedIdentities: ['https://github.com/other/repo/.github/workflows/build.yml@refs/heads/main'] } };
      expect(verifyRegistrySignature(entry, githubOidcSignature(), root)).toMatchObject({
        verified: false,
        reason: 'signer identity is not in the configured allowlist',
      });
    });

    it('passes with an exact-string allowlist match', () => {
      const root: RegistryTrustRoot = { githubOidc: { caCertificates: [CA_CERT_PEM], allowedIdentities: [WORKFLOW_IDENTITY] } };
      expect(verifyRegistrySignature(entry, githubOidcSignature(), root)).toMatchObject({ verified: true });
    });

    it('passes with a RegExp allowlist match', () => {
      const root: RegistryTrustRoot = { githubOidc: { caCertificates: [CA_CERT_PEM], allowedIdentities: [/^https:\/\/github\.com\/acme\//] } };
      expect(verifyRegistrySignature(entry, githubOidcSignature(), root)).toMatchObject({ verified: true });
    });

    it('fails with a non-matching RegExp allowlist entry', () => {
      const root: RegistryTrustRoot = { githubOidc: { caCertificates: [CA_CERT_PEM], allowedIdentities: [/^https:\/\/github\.com\/other\//] } };
      expect(verifyRegistrySignature(entry, githubOidcSignature(), root)).toMatchObject({ verified: false });
    });

    it('fails (rather than treating "no identity to check against" as a pass) when the certificate has no SAN at all and an allowlist is configured', () => {
      // The CA cert is self-signed (checkIssued/verify against itself both
      // succeed) and declares no subjectAltName extension at all — a real,
      // if unusual, shape for exercising the "no SAN entries" path.
      const selfRoot: RegistryTrustRoot = { githubOidc: { caCertificates: [CA_CERT_PEM], allowedIdentities: [WORKFLOW_IDENTITY] } };
      const signature = githubOidcSignature({
        certificate: CA_CERT_PEM,
        signature: signBase64(canonicalRegistrySigningPayload(entry), CA_KEY_PEM),
      });
      expect(verifyRegistrySignature(entry, signature, selfRoot)).toMatchObject({
        verified: false,
        reason: 'signer identity is not in the configured allowlist',
      });
    });

    it('accepts any identity (including no SAN at all) when allowedIdentities is not configured — the CA chain alone is the trust boundary', () => {
      const selfRoot: RegistryTrustRoot = { githubOidc: { caCertificates: [CA_CERT_PEM] } };
      const signature = githubOidcSignature({
        subject: undefined,
        certificate: CA_CERT_PEM,
        signature: signBase64(canonicalRegistrySigningPayload(entry), CA_KEY_PEM),
      });
      const result = verifyRegistrySignature(entry, signature, selfRoot);
      expect(result.verified).toBe(true);
      expect(result.subject).toBeUndefined();
    });
  });

  describe('signature bytes', () => {
    it('fails when the signature decodes to an empty buffer', () => {
      expect(verifyRegistrySignature(entry, githubOidcSignature({ signature: '' }), trustedRoot)).toMatchObject({
        verified: false,
        reason: 'signature is empty after base64 decoding',
      });
    });

    it('fails when the signature does not verify against the certificate’s public key (wrong payload signed)', () => {
      const signature = githubOidcSignature({ signature: signBase64('some-other-payload', LEAF_KEY_PEM) });
      expect(verifyRegistrySignature(entry, signature, trustedRoot)).toMatchObject({
        verified: false,
        reason: 'signature does not match the certificate public key',
      });
    });

    it('fails when the signature was made by a key unrelated to the certificate', () => {
      const signature = githubOidcSignature({ signature: signBase64(canonicalRegistrySigningPayload(entry), OTHER_LEAF_KEY_PEM) });
      expect(verifyRegistrySignature(entry, signature, trustedRoot)).toMatchObject({
        verified: false,
        reason: 'signature does not match the certificate public key',
      });
    });

    it('fails with a clear reason (not a thrown exception) when the certificate key/digest pairing is structurally incompatible', () => {
      // An Ed25519 certificate's key genuinely throws inside node:crypto's
      // `verify('sha256', ...)` rather than returning false (Ed25519 keys
      // require a null/implicit algorithm) — verified empirically while
      // building this module. The signature bytes' content doesn't matter
      // here; the throw happens before they would be checked.
      const signature = githubOidcSignature({ certificate: ED25519_LEAF_CERT_PEM });
      const result = verifyRegistrySignature(entry, signature, trustedRoot);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('signature verification failed');
    });
  });
});

describe('verifyRegistryEntrySignatures', () => {
  it('reports "entry has no signatures" when signatures is undefined', () => {
    expect(verifyRegistryEntrySignatures(entry, trustedRoot)).toEqual({ verified: false, reason: 'entry has no signatures' });
  });

  it('reports "entry has no signatures" when signatures is an empty array', () => {
    expect(verifyRegistryEntrySignatures({ ...entry, signatures: [] }, trustedRoot)).toEqual({
      verified: false,
      reason: 'entry has no signatures',
    });
  });

  it('returns the first verifying signature even when an earlier one fails', () => {
    const failing = githubOidcSignature({ issuer: 'https://not-github.example.com' });
    const passing = githubOidcSignature();
    const result = verifyRegistryEntrySignatures({ ...entry, signatures: [failing, passing] }, trustedRoot);
    expect(result).toMatchObject({ verified: true });
  });

  it('returns the last failure reason when every signature fails', () => {
    const first = githubOidcSignature({ issuer: 'https://not-github.example.com' });
    const second = githubOidcSignature({ signedAt: undefined });
    const result = verifyRegistryEntrySignatures({ ...entry, signatures: [first, second] }, trustedRoot);
    expect(result).toMatchObject({ verified: false, reason: 'github-oidc signature is missing signedAt' });
  });
});
