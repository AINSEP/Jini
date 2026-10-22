Spec ID: SPEC-JINI-INTEGRATIONS-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:f08b2c6be3562be15e1352ca665a175da62ada56a97ba679412b5c790c15d21d
spec_mode: reverse_spec

# UI contract: @jini-ai/integrations

The package is headless. Media catalog/dispatch, credentialed requests and webhook operations expose metadata and outcomes. It ships no connector settings page, credential-entry form, generation UI or webhook dashboard. Hosts supply credential storage/authorization and display only redacted request/verification results; buildAuthorizationHeader returns a secret-bearing transport value for trusted use.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-independent-webhook-retries](../decisions/DR-001-independent-webhook-retries.md).
