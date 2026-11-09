# Integrations extraction provenance

## EXTRACT-S9 credential tools

`src/credentialed-http/tools/` owns credential-save/create/rotate/plugin-card orchestration,
request/DELETE preflight, metadata projections, username/file-write helpers and the saved-reference
picker. Host vocabulary, policy, rendering and persistence implementations are required ports.
Production imports use defining relative integrations modules and core only.

Source: AINSEP/Tovu commit `94c9bb85c78cc8bf7858ee40f1ba5b27cc419b46`:

- `apps/website/src/features/custom-credentials/tool-registrations.ts`: 29 named closure declarations,
  including the owner-authorized F1 DELETE caller-safe validation repair.
- `apps/website/src/features/custom-credentials/credential-copy-tool.ts`: six closure declarations.
- `apps/website/src/features/custom-credentials/credential-tool-host.ts` and
  `credential-tool-operations.ts`: local consumer contracts.

The frozen four-test closure check is re-homed under `tools/__tests__/contracts-closure.test.ts`
with unchanged assertions/regexes and directory-local reads. Original rationale is preserved except
actual N1-rejected consumer names and the N1/N2 source header, which are neutral in code; exact
original source paths remain here and in the host's EXTRACT-S9 report. Strict optional-property type
adaptations and the value-free hint projection retain model/card bytes and I/O counts.
