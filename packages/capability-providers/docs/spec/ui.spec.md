Spec ID: SPEC-JINI-CAPABILITY-PROVIDERS-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:6f5073dc5d3e401810cea13ea1de5b869c9b1fbe8a7d55862b71c774069d44bc
spec_mode: reverse_spec

# UI contract: @jini-ai/capability-providers

This package is headless. Visitor-auth planners produce authorization URLs and callback/claim decisions; providers expose capability ports and adapters. The host owns sign-in redirects, callback screens, account linking, payment presentation, tenant authority, errors and accessible interaction. Development-reference auth/payments must be presented according to the host environment; they supply no production UI or identity proof.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.
