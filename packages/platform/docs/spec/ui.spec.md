Spec ID: SPEC-JINI-PLATFORM-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:4f40bab9331d25da111043bb68c2515422b59794174849a4c1715a5b31b8b39c
spec_mode: reverse_spec

# UI contract: @jini-ai/platform

The current package is headless. It supplies native effects, network classification, guarded transport/readers, credentials, SMTP and filesystem writers/locks. Analytics moved to analytics and trash to CMS. Hosts present refusals/lock contention and own credential/SMTP configuration UI. No visual shell, chart, trash view or stylesheet is shipped.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-purpose-scoped-mail](../decisions/DR-001-purpose-scoped-mail.md), [DR-002-guarded-egress](../decisions/DR-002-guarded-egress.md).
