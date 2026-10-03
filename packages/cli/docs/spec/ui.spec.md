Spec ID: SPEC-JINI-CLI-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:e8cc8e81d6b22f29636bfa5952c35d0cb662f579e16673069b5cc7e782b442d6
spec_mode: reverse_spec

# UI contract: @jini-ai/cli

The package exposes CLI command/runtime helpers and introspection data, without a GUI or stylesheet. Host command composition supplies output, prompts and daemon discovery policy. Structured help/inspection results are data contracts; the host owns terminal rendering, redaction and confirmation of effects.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-live-command-introspection](../decisions/DR-001-live-command-introspection.md).
