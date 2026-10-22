Spec ID: SPEC-JINI-HTTP-KIT-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1e8fcba4422aaa6f96c889fa3344035ac61fd32141b345d94aee45e5842a740d
spec_mode: reverse_spec

# UI contract: @jini-ai/http-kit

The package is headless. It exports generic route adapters, request/response/origin/security middleware, SSE, verified-origin and rate-limit primitives. Domain routes belong to daemon/http and CMS settings routes to cms/http/settings. Error envelopes/events are transport data, without a component, notification view, CSS or automatic retry UI.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-redirect-normalization](../decisions/DR-001-redirect-normalization.md), [DR-002-background-failure-containment](../decisions/DR-002-background-failure-containment.md).
