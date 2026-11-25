# Platform source map

## Mail engine

Public entry: `@jini-ai/platform/mail` (`src/mail/index.ts`). The barrel reuses the
existing implementations below; existing mail exports and signatures are retained.

| Module | Responsibility | Public exports |
| --- | --- | --- |
| `src/mail/engine-contracts.ts` | Host credential metadata, catalog/settings ports, configuration/status reports and sender verdicts; separate from base types to avoid provider type cycles. | All module types, including `MailCredentialFact`, `MailCredentialPort`, `MailProviderCatalog`, `MailProviderSettingPort`, `MailProviderConfigurationReport`, `MailStatusReport`, `SenderDomainVerification` |
| `src/mail/provider-error.ts` | Redact provider diagnostics before truncation, including exact credential values and secret-shaped URL parameters. | `safeMailProviderText`, `credentialSecrets` |
| `src/mail/domain-read.ts` | Read with sending credentials first; retry with a separate account credential only on a permission refusal. | `readMailDomain`, `isDomainReadPermissionRefused`, `MailDomainReadCredentialPort` |
| `src/mail/sender-domain-verification.ts` | Deadline-bounded provider verdict independent of DNS answers; lookup failures become explicit verdicts. | `createSenderDomainVerification`, `SenderDomainVerificationDeps` |
| `src/mail/delivery-wrapper.ts` | Per-recipient test mode and approval checks over the existing policy, indexed batch keys, shared provider limiters and non-disruptive observation. | `createMailPolicyWrapper`, `MailPolicyWrapperDeps`, `MailPolicyWrapperOptions`, `MailPolicyWrapperInput` |
| `src/mail/purpose-scoped-mailer.ts` | One predicate owns both the delivery gate and its read-only probe; notification mail requires durable readiness in production. | `isPurposeGateOpen`, `PurposeGateRequired`, existing `wrapMailerWithPurposeGate` and `WrapMailerWithPurposeGateOptions` |
| `src/mail/resolve-mailer.ts` | Explicit lane selection, metadata-before-decryption credential rotation, single-flight resolution, invalidation and status projection. | `createResolvedMailer`, `ResolveMailerDeps`, `ResolveMailerOptions`, `ResolvedMailer` |
| `src/mail/mail-status-cache.ts` | Short-TTL single-flight cache; failures are not cached and invalidation prevents stale work from overwriting current status. | `createTtlCache`, `TtlCache`, `MAIL_STATUS_TTL_MS` |

The host retains trusted provider loading, credential decryption/account binding,
provider ABI adaptation, setup copy and configuration projection, persistence,
purpose-specific resend decisions, routes and UI. The engine passes the supplied
HTTP client through to providers without adapting its shape. The existing
`createPolicyMailer` batch behavior is unchanged; the delivery wrapper owns its
per-recipient indexed keys. SMTP remains a separate injected-transport entry at
`@jini-ai/platform/mail/smtp`.

Behavior tests live in `src/mail/__tests__/`.

## Legacy vault codecs (w4-runtime, 2026-11-24)

Original host source at the original host `3a93322474`: `apps/website/src/server/runtime/composition/vault-legacy-codecs.ts` → `src/secrets/legacy-codecs.ts` (`@jini-ai/platform/secrets/legacy-codecs`). The host's former custom-vault owner key is injected as `formerCustomOwnerKey`; why-comments kept verbatim.

## Owned temporary roots (P11 ST-6c.J, 2026-11-25)

`src/fs/owned-temp-root.ts` (`@jini-ai/platform/fs`): `withOwnedTempRoot` and `sweepOwnedTempRoots`. New code, no ported source.
**Accepted deviation from ALGO-P11 §9.7**, which placed the writer helper in the host
(`platform/temp/owned-root.ts`, "move to Jini later — not now, one consumer"). The lock-first /
provenance-marker / proven-dead-owner protocol is product-neutral, so it lives here; hosts supply
the prefixes, the parent folders and the lock adapter (whose process port is the liveness probe).
A `<root>.owner` provenance marker was added to the design so a failed in-`finally` removal stays
sweepable; roots without it are report-only.
