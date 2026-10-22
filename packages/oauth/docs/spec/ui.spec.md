Spec ID: SPEC-JINI-OAUTH-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1b151740ea0f9a4d9a2c243e3420e88aa7505dcf4582c994b1ad717f039be0c2
spec_mode: reverse_spec

# UI contract: @jini-ai/oauth

The package is headless. It prepares authorization URLs, validates callbacks and manages pending/token state. The host opens the user agent, renders callback success/error/cancel states, supplies redirect/listener policy and stores tokens. It ships no callback HTML, consent screen or credential-entry widget. OAuth provider pages and host navigation are external to this library.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [design](../decisions/design.md).
