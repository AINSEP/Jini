Spec ID: SPEC-JINI-ARTIFACTS-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:6f0ae2c6828564f4733762bd9758c5f70b6a5c4eb70c2dbf98ba71822eec1072
spec_mode: reverse_spec

# UI contract: @jini-ai/artifacts

This package is headless. Manifests describe renderer/export intent and guards return validation/regression/publication outcomes; no artifact renderer, publish button, preview or stylesheet is included. The host selects renderers, displays refusals and prior-output warnings, and owns any approval workflow. Manifest membership and lexical path checks do not provide execution isolation.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.
