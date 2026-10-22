Spec ID: SPEC-JINI-MCP-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:e9487e33b562d73d508fdb8a46eea26e7ff338a839ccb1c6bbbbada0045d9245
spec_mode: reverse_spec

# UI contract: @jini-ai/mcp

The package is headless. Federation, ask-choice, delegated tools and install configuration expose protocol/surface data; no chat renderer or approval dialog is shipped. Hosts provide human confirmation channels and refusal text/code namespaces, render explicit approvals, and own credential entry and roster/approval administration. A model cannot supply its own human approval by invoking a tool.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-federation-admission](../decisions/DR-001-federation-admission.md), [DR-002-protocol-resource-boundary](../decisions/DR-002-protocol-resource-boundary.md), [DR-003-trusted-federation-composition](../decisions/DR-003-trusted-federation-composition.md), [DR-004-parked-human-exchange-deadlines](../decisions/DR-004-parked-human-exchange-deadlines.md).
