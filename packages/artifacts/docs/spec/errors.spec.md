Spec ID: SPEC-JINI-ARTIFACTS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:28ea603fc8c9f4f9c982fca51e213a3c53074c850455ea13bbc4f7a16cac8da1
spec_mode: reverse_spec


# Error contract: artifacts

| Class / code | When produced | Caller action |
|---|---|---|
| `ArtifactManifestRequiredError` / `ARTIFACT_MANIFEST_REQUIRED` | Resolver has no truthy explicit/inferred manifest | Supply a manifest or working inferrer |
| `ArtifactManifestInvalidError` / `ARTIFACT_MANIFEST_INVALID` | Resolver's manifest fails validation | Correct reported field/taxonomy |
| `ArtifactPublicationBlockedError` / `ARTIFACT_PUBLICATION_BLOCKED` | Configured guarded kind contains blocked marker | Resolve every listed placeholder before retry |
| `ArtifactRegressionError` / `ARTIFACT_REGRESSION` | Consumer explicitly constructs/throws it | Recover full content or intentionally revise guard policy |
| Stub `warning.code = ARTIFACT_REGRESSION` | Ratio decision is warn/reject | Enforce the verdict at the consumer write boundary |
| `{ ok: false, error: string }` | Manifest validation failure | Return a field-level validation response; no stable field code exists |
| `null` | Persisted manifest is corrupt/stale; record absent | Treat as no usable manifest/record |
| Native serialization/codec/port exception | Cyclic/BigInt metadata, byte decoding or injected callback failure | Correct input; do not assume successful mutation |

The error constructors and details are listed in `api.spec.md`. The package supplies no shared HTTP mapping, automatic retry or publication rejection inside `ArtifactStore.create`. Classifier `reject` must be acted on by the caller. Filesystem scanning intentionally swallows read/stat failures and treats them as absent history.

Text suppression uses object arguments throughout recursive block processing. Root import failures in browser resolvers are packaging errors, not a package error code; publication guards require the standard TextDecoder API rather than a Node buffer polyfill.

Evidence: `src/store.ts`, `src/publication-guard.ts`, `src/stub-guard.ts`, `src/node/stub-guard.ts` and matching source tests.
