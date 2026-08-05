# Proposal: verified signature/allowlist basis for registry `trust`, not config-asserted trust (SEC-RB-005 remainder)

**Status:** Proposal only — not implemented. Requires human/architect sign-off before any code change, per the security review's "Human sign-off required: Yes" on SEC-RB-005 and this task's scope boundary (architecture changes, breaking API changes, and this package's still-unlocked status are explicitly out of scope for direct implementation).

**Finding:** `ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`, SEC-RB-005 (High) — the part of it this session's hardening pass did **not** close. See `packages/registry/source-map.md`'s `## 2026-07-21 hardening pass` section for what *was* fixed in the same finding (the earlier `97ad2d80f` commit already removed the hardcoded `'official'` default; this proposal is about the remainder).

**Do not implement from this document without a follow-up decision.** No source changes were made as part of writing this proposal.

## The problem

`@jini/protocol`'s `RegistryEntrySchema` already defines a `signatures: RegistrySignature[]` field (`packages/protocol/src/registry.ts:100`), and `RegistrySignatureSchema` (`packages/protocol/src/registry.ts:48-58`) already models `kind: 'github-oidc' | 'cosign' | 'minisign' | 'custom'` plus `issuer`/`subject`/`signature`/`certificate`/`signedAt`. The wire shape for "this entry is signed, and here is the proof" has existed since the protocol-layer port. **No backend in `packages/registry/src/` ever reads, verifies, or requires that field.**

Concretely:

- `GithubRegistryBackendOptions.trust` (`packages/registry/src/github-backend.ts:79-94`) is a plain constructor argument the *host* asserts (`'official' | 'trusted' | 'restricted'`, defaulting to `'restricted'` as of this session's fix). There is no code path anywhere in this package that checks a `RegistryEntry.signatures[]` array against any trusted key/issuer/allowlist before serving that entry with the backend's configured `trust` level.
- `StaticRegistryBackendOptions.trust`/`DatabaseRegistryBackendOptions.trust` are the same shape — trust is a property of *how the backend was configured*, not a property *derived from* anything cryptographically checkable about the entries it serves.
- `resolve()`/`list()`/`search()` (`packages/registry/src/static-backend.ts`) attach the backend's `trust` to every `ResolvedRegistryEntry` uniformly (`packages/registry/src/static-backend.ts:120`) — an entry with zero `signatures` and an entry with a valid `cosign` signature are indistinguishable in the returned trust level, as long as they came from the same backend.

This means "trust" today is really "which backend object a host happened to construct," not "what can be cryptographically proven about this specific artifact." A misconfigured or compromised GitHub repository, or a database row inserted by any code path with write access, inherits the *backend's* trust level with no per-entry verification gate.

## Why this matters

Locked decision C8 (`ADS-memory/reports/jini-port/extraction-plan.md`, quoted in the earlier CR/SEC audit reports) requires **signed third-party packs, explicit capabilities, scoped credentials, and sandboxing** before a registry-sourced artifact is trusted enough to execute/install. This package currently implements none of the "signed" half — it has the wire format for signatures but no verifier. A downstream consumer (a future CLI `install` command, a future daemon plugin loader) that naively treats `resolve()`'s returned `trust: 'official'` as "safe to install without further checks" would be trusting *configuration*, not *cryptography*.

This is not a new regression from this session — it is the same gap SEC-RB-005 originally flagged ("no cryptographic or allowlist proof tying owner/repository/ref to that trust class") that the earlier fix (defaulting to `'restricted'` instead of always `'official'`) narrowed but did not close. Removing the *automatic* `'official'` default stops the worst case (every configured GitHub source silently becoming maximally trusted), but a host can still explicitly pass `trust: 'official'` today with nothing backing that claim beyond its own say-so.

## Why this needs sign-off rather than a direct fix

Closing this gap for real requires deciding, before any code is written:

1. **Verification algorithm(s) to support first.** `RegistrySignatureSchema.kind` already enumerates four (`github-oidc`, `cosign`, `minisign`, `custom`) — each needs its own verifier with its own dependency (e.g. `sigstore`/`cosign` verification needs a Rekor/Fulcio client or a bundled verifier library; `minisign` needs its own tiny verifier; `github-oidc` needs OIDC token/attestation verification against GitHub's own attestation API). Picking "verify all four" vs. "ship one now, stub the rest" is a scope decision, not an implementation detail.
2. **Trust-root management.** Verifying a signature proves *who* signed something; deciding whether that signer is *trusted* requires an allowlist (of keys, of GitHub org/repo identities, of OIDC issuers) that has to live somewhere and be host-configurable — this is new stateful configuration surface, not a pure function.
3. **Backward-compatible trust semantics.** Today `'restricted'`/`'trusted'`/`'official'` are backend-wide. Does per-entry signature verification *replace* the backend-level `trust` field, *narrow* it (an unsigned entry from an `'official'` backend degrades to `'restricted'`), or add a fourth orthogonal dimension (`verified: boolean` alongside the existing `trust` enum)? This is a `@jini/protocol` schema decision (touches `ResolvedRegistryEntrySchema`/`RegistryEntrySchema`), which is outside `packages/registry/`'s boundary and this task's scope per its own instructions.
4. **Two-consumer rule.** Per `extraction-plan.md`'s two-consumer/experimental gate (already cited against this package in CR-014), building a full verification pipeline with zero current consumers risks the same "speculative surface" problem `@jini/capability-providers` was flagged for. Whether to build this now (before any consumer exists) or wait for a real install/execute path to define the actual requirements is itself a product-sequencing decision.

None of these are "just write the code" — each is a real design fork this task's ground rules explicitly route to a proposal doc rather than an implementation.

## Suggested shape (for the follow-up session, not this one)

Illustrative only — not a commitment to this exact design:

```ts
// packages/registry/src/trust.ts (illustrative — not implemented)
export interface RegistryTrustVerifier {
  /** Verify `entry.signatures` against a host-configured trust root; return the
   * strongest trust level the entry's signatures actually prove, or `null` if
   * nothing verifies. */
  verify(entry: RegistryEntry): Promise<RegistryTrust | null>;
}

// A backend would then compute per-entry trust as, e.g.:
//   const verified = await this.verifier?.verify(entry);
//   const effectiveTrust = verified ?? downgradeUnverified(this.trust);
// rather than unconditionally stamping `this.trust` onto every resolved entry.
```

## Open questions for the architect / human sign-off

1. Which signature kind(s) should a first verifier implementation actually support — `github-oidc` (arguably the most natural fit for a GitHub-hosted registry) alone, or all four `RegistrySignatureSchema` kinds from the start?
2. Does per-entry verified trust replace, narrow, or sit alongside the existing backend-level `trust` field? This decides whether `@jini/protocol`'s `ResolvedRegistryEntrySchema`/`RegistryEntrySchema` need a new field, which is outside this package's boundary.
3. Where does the trust-root/allowlist configuration live — a new constructor option on each backend, a shared `RegistryTrustVerifier` port in `@jini/protocol` that hosts implement, or a separate not-yet-built package (mirroring how `@jini/capability-providers` speculatively modeled auth/payments/storage as their own package)?
4. Should this wait for a real consumer (a CLI/daemon "install this registry entry" path) to exist first, per the two-consumer/experimental gate, rather than being built speculatively now?
