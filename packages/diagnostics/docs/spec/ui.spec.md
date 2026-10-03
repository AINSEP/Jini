Spec ID: SPEC-JINI-DIAGNOSTICS-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:6549176a59529eddca6f167e74738e68dd8289e14f8c4b9f7b65c5bd0c00c11f
spec_mode: reverse_spec

# UI contract: @jini-ai/diagnostics

The package is headless. Observability/logging/redaction/evidence/DNS helpers expose structured reports; Playwright is an injected/dynamic evidence adapter, not user UI. Accessibility evidence is a bounded observation rather than a conformance verdict. Hosts present redacted results, availability/consent observations and operator errors, with no package-owned dashboard or stylesheet.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-trusted-evidence-addresses](../decisions/DR-001-trusted-evidence-addresses.md).
