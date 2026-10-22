/**
 * @module trust
 *
 * A real (not config-asserted) verifier for `RegistryEntry.signatures[]`
 * (`@jini-ai/protocol`'s `RegistrySignatureSchema`), closing the still-open half
 * of SEC-RB-005 per
 * `ADS-memory/reports/proposals/PROP-registry-signature-trust-verification-2026-07-21.md`
 * and its follow-up sign-off: v1 supports exactly one signature `kind`,
 * `'github-oidc'` — `'cosign'`/`'minisign'`/`'custom'` are recognized but
 * always report `verified: false` with an explicit "unsupported kind"
 * reason, never silently pass and never throw.
 *
 * ## What `github-oidc` actually verifies
 *
 * A GitHub Actions OIDC *ID token* (a short-lived JWT, `iss:
 * https://token.actions.githubusercontent.com`, `exp` typically minutes in
 * the future) cannot itself be the durable, at-rest proof stored in
 * `RegistryEntry.signatures[]` — a registry entry is resolved and re-checked
 * long after it was signed, and a raw ID token would already be expired by
 * then. This is exactly why GitHub's own recommended mechanism for durable
 * artifact provenance ("Artifact Attestations",
 * `docs.github.com/en/actions/tutorials/publish-artifacts/verify-artifact-attestations-with-cli`)
 * is Sigstore-style **keyless signing**: the short-lived OIDC token is used
 * once, at signing time, to obtain a short-lived Fulcio-issued X.509
 * certificate whose Subject Alternative Name (SAN) encodes the OIDC
 * identity (e.g. a GitHub Actions workflow ref); that certificate's public
 * key then verifies a signature that remains checkable indefinitely. This
 * matches `RegistrySignatureSchema`'s own shape (`certificate` alongside
 * `signature`/`issuer`/`subject`/`signedAt`) far better than a raw JWT would
 * — the schema already models "signature + the cert that proves who made
 * it," not "a bearer token." So `kind: 'github-oidc'` here means: a
 * Sigstore/Fulcio-style keyless signature, cryptographically verified
 * end-to-end by this module.
 *
 * ## What this module deliberately does NOT do (v1 scope)
 *
 * - **No Sigstore transparency-log (Rekor) inclusion-proof verification.**
 *   Real Sigstore verifiers don't trust "is this short-lived cert valid
 *   *right now*" (it never is, days/weeks after signing) — they trust "was
 *   there a Rekor log entry, with an independent timestamp, proving the
 *   signature existed while the cert was valid." This module instead trusts
 *   the signature's own self-reported `signedAt` field against the
 *   certificate's validity window (see {@link verifyRegistrySignature}) —
 *   `signedAt` is NOT independently attested by a timestamp authority in
 *   v1. A host that needs that guarantee should not rely on this alone.
 * - **No Sigstore public-good root/TUF auto-discovery.** This module never
 *   hardcodes or fetches Sigstore's public Fulcio root — the host explicitly
 *   supplies the CA certificate(s) to trust via
 *   {@link GithubOidcTrustRoot.caCertificates} (which may be Sigstore's
 *   public root, a GitHub Enterprise private Fulcio-equivalent root, or any
 *   other CA the host chooses to trust). No network calls are made by this
 *   module.
 * - **No revocation checking (CRL/OCSP).** Fulcio-style short-lived certs
 *   are designed around expiry, not revocation, matching Sigstore's own
 *   documented model.
 * - **No Fulcio-specific custom-OID extension parsing** (e.g. the
 *   `1.3.6.1.4.1.57264.1.1` OIDC-issuer extension) — Node's built-in
 *   `X509Certificate` has no public API for arbitrary extension OIDs
 *   without a hand-rolled ASN.1 parser. Identity is instead read from the
 *   certificate's `subjectAltName` URI entries (a real, cert-bound value
 *   `X509Certificate` does expose) — see {@link GithubOidcTrustRoot.allowedIdentities}.
 *   The self-reported `signature.issuer`/`signature.subject` wire fields are
 *   checked too, but only as declarative/audit metadata layered on top of
 *   the cert-bound checks below — not the cryptographic root of trust.
 *
 * ## What IS cryptographically real here
 *
 * 1. The certificate chains (via `X509Certificate#checkIssued` +
 *    `X509Certificate#verify`, i.e. an actual signature check, not just a
 *    DN string match) to one of the host-configured
 *    {@link GithubOidcTrustRoot.caCertificates}.
 * 2. `signature.signature` is a real cryptographic signature (verified via
 *    `node:crypto`'s `verify()`) over {@link canonicalRegistrySigningPayload},
 *    made with the certificate's own public key.
 * 3. The certificate's `subjectAltName` URI (the cert-bound identity) is
 *    checked against {@link GithubOidcTrustRoot.allowedIdentities}, when
 *    configured.
 */
import { X509Certificate, verify as nodeVerify } from 'node:crypto';
import type { RegistryEntry, RegistrySignature } from '@jini-ai/protocol';
import { chainToTrustedRoot, parseCertificateBundle, parseSanUris } from './trust-certificates.js';

/** GitHub Actions' own OIDC token issuer — the default {@link GithubOidcTrustRoot.allowedIssuers} entry. */
export const GITHUB_ACTIONS_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

/**
 * Host-supplied trust anchor for `kind: 'github-oidc'` signatures. Modeled
 * as a constructor option on each backend (`StaticRegistryBackendOptions.trustRoot`,
 * `GithubRegistryBackendOptions.trustRoot`, `DatabaseRegistryBackendOptions.trustRoot`)
 * — matching how `trust` itself is already a constructor option, per this
 * task's sign-off decision 3.
 */
export interface GithubOidcTrustRoot {
  /**
   * PEM-encoded CA certificate(s) a signing certificate must chain to.
   * Required — without at least one, `github-oidc` signatures cannot be
   * cryptographically verified and are always reported `verified: false`
   * (never silently trusted). May be Sigstore's public Fulcio root, a
   * private/enterprise equivalent, or any other CA the host chooses.
   */
  caCertificates: string[];
  /**
   * Allowlisted OIDC issuer URL(s) checked against the signature's own
   * `issuer` field. Defaults to `[GITHUB_ACTIONS_OIDC_ISSUER]` when omitted.
   * This is a declarative check on self-reported metadata, not a
   * cryptographic one — see the module doc comment.
   */
  allowedIssuers?: string[];
  /**
   * Allowlisted signer identities, matched against the *certificate's own*
   * `subjectAltName` URI entries (e.g.
   * `https://github.com/OWNER/REPO/.github/workflows/WORKFLOW.yml@REF`,
   * the shape GitHub Artifact Attestations certificates use) — a
   * cryptographically real, cert-bound value, not the signature's
   * self-reported `subject` field. A plain string must match exactly; a
   * `RegExp` is tested against each SAN URI. When omitted, any identity
   * whose certificate chains to a configured CA is accepted (the CA chain
   * alone is the trust boundary).
   */
  allowedIdentities?: Array<string | RegExp>;
}

/** Per-kind trust roots. Only `githubOidc` is implemented in v1 (see the module doc comment). */
export interface RegistryTrustRoot {
  githubOidc?: GithubOidcTrustRoot;
}

/** Outcome of verifying one {@link RegistrySignature} against a {@link RegistryTrustRoot}. Never thrown — always returned. */
export interface SignatureVerificationResult {
  verified: boolean;
  /** The signature kind this result is about. Omitted only when an entry has no signatures to report on at all. */
  kind?: RegistrySignature['kind'];
  /** Present when `verified` is `false` — a human-readable, non-throwing reason. */
  reason?: string;
  /** Present when `verified` is `true` — the signature's self-reported `issuer` field. */
  issuer?: string;
  /** Present when `verified` is `true` — the signature's self-reported `subject` field, falling back to the certificate's own first SAN identity when the signature didn't declare one. */
  subject?: string;
}

/**
 * The exact string a `github-oidc` signature's `signature` bytes must cover.
 * `@jini-ai/protocol`'s `RegistrySignatureSchema` does not itself define a
 * canonical signing payload (it only models the wire shape of a signature),
 * so this is this package's own convention: `name@version:digest`, where
 * `digest` is whichever integrity/manifest-digest field the entry declares.
 * Exported so a future signing tool can compute the exact same string this
 * verifier checks against, rather than the two drifting independently.
 *
 * @param entry - The registry entry the signature is claimed to cover.
 * @returns The canonical UTF-8 string the signature must be a valid signature over.
 */
export function canonicalRegistrySigningPayload({ entry }: { entry: RegistryEntry }): string {
  const digest = entry.integrity ?? entry.manifestDigest ?? entry.dist?.integrity ?? entry.dist?.manifestDigest ?? '';
  return `${entry.name}@${entry.version}:${digest}`;
}

/**
 * Verify one {@link RegistrySignature} against a host-configured
 * {@link RegistryTrustRoot}. Never throws — a malformed certificate,
 * unparseable signature, or missing trust root all resolve to
 * `verified: false` with a `reason`, matching this package's existing
 * "never crash a caller-facing read on untrusted input" convention (see
 * `static-backend.ts`'s `validEntries()`/`doctor()`).
 *
 * @param entry - The entry the signature is claimed to cover (used to derive {@link canonicalRegistrySigningPayload}).
 * @param signature - One entry of `entry.signatures`.
 * @param trustRoot - The backend's configured trust root, if any.
 * @returns The verification outcome; check `.verified` before trusting `.issuer`/`.subject`.
 */
export function verifyRegistrySignature(
  { entry, signature }: { entry: RegistryEntry; signature: RegistrySignature },
  { trustRoot }: { trustRoot?: RegistryTrustRoot | undefined } = {},
): SignatureVerificationResult {
  if (signature.kind !== 'github-oidc') {
    // Decision 1: recognize but don't implement cosign/minisign/custom —
    // report "unsupported", never silently pass and never throw.
    return { verified: false, kind: signature.kind, reason: `unsupported signature kind: ${signature.kind}` };
  }
  const outcome = verifyGithubOidcSignature(entry, signature, trustRoot?.githubOidc);
  if ('reason' in outcome) return { verified: false, kind: signature.kind, reason: outcome.reason };
  return { verified: true, kind: signature.kind, issuer: outcome.issuer, ...(outcome.subject !== undefined ? { subject: outcome.subject } : {}) };
}

/** A failed check's human-readable reason. Every stage below returns one instead of throwing. */
interface VerificationFailure {
  reason: string;
}

const fail = (reason: string): VerificationFailure => ({ reason });

/**
 * The `github-oidc` checks, in their fixed order — the first failing check's
 * reason is the one reported: trust root, signature fields, certificate
 * chain + validity window, identity allowlist, signature bytes.
 */
function verifyGithubOidcSignature(
  entry: RegistryEntry,
  signature: RegistrySignature,
  root: GithubOidcTrustRoot | undefined,
): VerificationFailure | { issuer: string; subject: string | undefined } {
  if (!root || root.caCertificates.length === 0) {
    // Decision 4: a backend with no configured trust root gets no
    // verification at all — current (pre-this-task) behavior, unchanged.
    return fail('no github-oidc trust root configured');
  }
  const fields = checkSignatureFields(signature, root);
  if ('reason' in fields) return fields;
  const leaf = checkCertificate(fields.certificate, root, fields.signedAt);
  if ('reason' in leaf) return leaf;
  const identities = parseSanUris(leaf.subjectAltName);
  if (!identityAllowed(identities, root.allowedIdentities)) {
    return fail('signer identity is not in the configured allowlist');
  }
  const signatureFailure = checkSignatureBytes(entry, signature.signature, leaf);
  if (signatureFailure) return signatureFailure;
  return { issuer: fields.issuer, subject: signature.subject ?? identities[0] };
}

/** Presence of certificate/issuer/signedAt, the issuer allowlist, and a parseable `signedAt`. */
function checkSignatureFields(
  signature: RegistrySignature,
  root: GithubOidcTrustRoot,
): VerificationFailure | { certificate: string; issuer: string; signedAt: Date } {
  if (!signature.certificate) return fail('github-oidc signature is missing a certificate');
  if (!signature.issuer) return fail('github-oidc signature is missing an issuer');
  const allowedIssuers = root.allowedIssuers ?? [GITHUB_ACTIONS_OIDC_ISSUER];
  if (!allowedIssuers.includes(signature.issuer)) {
    return fail(`issuer ${JSON.stringify(signature.issuer)} is not in the configured allowlist`);
  }
  if (!signature.signedAt) return fail('github-oidc signature is missing signedAt');
  const signedAt = new Date(signature.signedAt);
  if (Number.isNaN(signedAt.getTime())) return fail('github-oidc signature has an invalid signedAt timestamp');
  return { certificate: signature.certificate, issuer: signature.issuer, signedAt };
}

/** Parse the bundled certificate(s) and the configured CAs, require a chain to a CA, and require `signedAt` inside the leaf's validity window. Returns the leaf. */
function checkCertificate(pem: string, root: GithubOidcTrustRoot, signedAt: Date): VerificationFailure | X509Certificate {
  let chain: X509Certificate[];
  try {
    chain = parseCertificateBundle(pem);
  } catch (cause) {
    return fail(`could not parse certificate: ${(cause as Error).message}`);
  }
  const leaf = chain[0];
  if (!leaf) return fail('no PEM certificate found in signature.certificate');

  let trustedCas: X509Certificate[];
  try {
    trustedCas = root.caCertificates.map((caPem) => new X509Certificate(caPem));
  } catch (cause) {
    return fail(`configured trust root certificate is invalid: ${(cause as Error).message}`);
  }
  if (!chainToTrustedRoot(chain, trustedCas)) return fail('certificate does not chain to a configured trust root');

  if (signedAt < leaf.validFromDate || signedAt > leaf.validToDate) {
    return fail('signedAt falls outside the certificate validity window');
  }
  return leaf;
}

/** No (or an empty) allowlist accepts any identity; otherwise one SAN URI must match one pattern — exact string, or `RegExp#test`. */
function identityAllowed(identities: string[], allowedIdentities: GithubOidcTrustRoot['allowedIdentities']): boolean {
  if (!allowedIdentities || allowedIdentities.length === 0) return true;
  return identities.some((identity) =>
    allowedIdentities.some((pattern) => (typeof pattern === 'string' ? pattern === identity : pattern.test(identity))),
  );
}

/** Verify `signature` (base64) over {@link canonicalRegistrySigningPayload} with the leaf's public key; `undefined` when it verifies. */
function checkSignatureBytes(entry: RegistryEntry, signature: string, leaf: X509Certificate): VerificationFailure | undefined {
  // `Buffer.from(str, 'base64')` never throws (Node's base64 decoder is
  // lenient about invalid input, silently dropping bad characters) — a
  // malformed encoding surfaces as an empty/garbage buffer that then fails
  // the signature check below, not as an exception here.
  const signatureBytes = Buffer.from(signature, 'base64');
  if (signatureBytes.length === 0) return fail('signature is empty after base64 decoding');
  const payload = Buffer.from(canonicalRegistrySigningPayload({ entry }), 'utf8');
  let signatureValid: boolean;
  try {
    // `crypto.verify()` CAN throw (not just return false) for a
    // structurally-incompatible key/algorithm pairing — e.g. an Ed25519
    // certificate's key does not accept an explicit 'sha256' digest
    // algorithm the way RSA/ECDSA keys do. Verified empirically, not
    // assumed: an Ed25519 test certificate throws
    // "Provider routines::invalid digest" from this exact call.
    signatureValid = nodeVerify('sha256', payload, leaf.publicKey, signatureBytes);
  } catch (cause) {
    return fail(`signature verification failed: ${(cause as Error).message}`);
  }
  return signatureValid ? undefined : fail('signature does not match the certificate public key');
}

/**
 * Verify every signature on `entry` against `trustRoot`, returning the first
 * result that verifies, or (if none do) the last failure — so a caller gets
 * a meaningful `reason` even when an entry declares multiple signatures and
 * all fail.
 *
 * @param entry - The entry to verify.
 * @param trustRoot - The backend's configured trust root, if any.
 * @returns The first verifying result, or the last failing one.
 */
export function verifyRegistryEntrySignatures(
  { entry }: { entry: RegistryEntry },
  { trustRoot }: { trustRoot?: RegistryTrustRoot | undefined } = {},
): SignatureVerificationResult {
  const signatures = entry.signatures ?? [];
  let last: SignatureVerificationResult = { verified: false, reason: 'entry has no signatures' };
  for (const signature of signatures) {
    const result = verifyRegistrySignature({ entry, signature }, { trustRoot });
    if (result.verified) return result;
    last = result;
  }
  return last;
}
