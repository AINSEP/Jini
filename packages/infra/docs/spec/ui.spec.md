Spec ID: SPEC-JINI-INFRA-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:085151158464bfd6564429aac34a4db5a60ccba0d2da64fd2ac56c9bd6513f53
spec_mode: reverse_spec

# UI contract: @jini-ai/infra

This compatibility shim is headless. It only re-exports the frozen db/core and db/sqlite surfaces. It contributes no components, routes, forms, themes, visual assets or interaction state; host applications own presentation.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-bounded-outbox-retries](../decisions/DR-001-bounded-outbox-retries.md).
