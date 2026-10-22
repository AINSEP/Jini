Spec ID: SPEC-JINI-CMS-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:4d9eb33c06bd5770ec187b5de434d0358feb90947e83d55ff5e46e50d9addb6e
spec_mode: reverse_spec

# UI contract: @jini-ai/cms

The current CMS package is headless. Widgets moved to `@jini-ai/ui/admin-widgets`; identity administration/registrations belong to user-management. CMS owns content/media/settings/workspace/navigation/taxonomy/presentation/trash contracts and settings HTTP adapters. Hosts render service outcomes, optimistic conflicts and irreversible purge confirmation. Presentation theme identity is data, not compiled UI assets.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-safe-schema-and-index-transitions](../decisions/DR-001-safe-schema-and-index-transitions.md), [DR-002-content-lifecycle-and-cleanup](../decisions/DR-002-content-lifecycle-and-cleanup.md), [DR-003-settings-ledger-invariants](../decisions/DR-003-settings-ledger-invariants.md), [DR-004-journaled-blob-gc](../decisions/DR-004-journaled-blob-gc.md), [DR-005-ordered-taxonomy-validation](../decisions/DR-005-ordered-taxonomy-validation.md), [DR-006-mutation-audit-atomicity](../decisions/DR-006-mutation-audit-atomicity.md), [DR-007-workspace-and-owner-floors](../decisions/DR-007-workspace-and-owner-floors.md), [DR-008-navigation-event-intent](../decisions/DR-008-navigation-event-intent.md).
