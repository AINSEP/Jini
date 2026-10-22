Spec ID: SPEC-JINI-PLUGINS-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:f98e72b59666d42ea587b1b8fd8fcad217bc8b3c51af8bd0a4b1c0ef26860aff
spec_mode: reverse_spec

# UI contract: @jini-ai/plugins

Plugin glue is headless. Admin-navigation/render/HTTP attachment payloads are host-defined data and do not implement screens, route mounting or a stylesheet. The host defines payload semantics, permissions, subscriptions and any presentation of validation/quarantine/dispatch outcomes.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-category-specific-glue-containment](../decisions/DR-001-category-specific-glue-containment.md).
