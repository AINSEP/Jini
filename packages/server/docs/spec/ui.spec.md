Spec ID: SPEC-JINI-SERVER-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1e571f1e32d01cb753c696ffb5609fa6f1a145ff7bdd7ff464d2481af6b7a8d9
spec_mode: reverse_spec

# UI contract: @jini-ai/server

The host assembly is headless. It composes enabled features and listens on HTTP; it ships no web application, login screen or stylesheet. Probe/readiness JSON is operational data, not a public health dashboard. The host supplies security, working-directory policy, prompts, UI integration and any restore/project navigation.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-partial-boot-rollback](../decisions/DR-001-partial-boot-rollback.md).
