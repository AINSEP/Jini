Spec ID: SPEC-JINI-CORE-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:0931924b036d93193693dd48f5cacafc2eb1a93244c65b624e1d87b31ee79b7a
spec_mode: reverse_spec

# UI contract: @jini-ai/core

The composition kernel is headless and universal. Tool definitions, human-confirmation handlers and model-facing errors are contracts; there is no dialog, chat renderer, admin shell or stylesheet. Hosts render disclosures/approvals, bind principals and supply transport. Emitting a surface or setting requiresConfirmation does not itself render consent.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-gated-mutation-check-order](../decisions/DR-001-gated-mutation-check-order.md).
