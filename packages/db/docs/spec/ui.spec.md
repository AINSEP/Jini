Spec ID: SPEC-JINI-DB-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:177803db38d35bdd22a21d63db84a3ed555234c03ed255ca0dad2c437eea27df
spec_mode: reverse_spec

# UI contract: @jini-ai/db

The package is headless. Database/transfer tools expose plans, progress, confirmation surfaces and restoration routing envelopes; no database screen or restore UI is shipped. Hosts supply restore destinations and copy/confirmation text, and must disclose replacement/restore-point costs before authorizing effects. A catalog description is not a working destination or executed backup.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-bounded-operational-timeline](../decisions/DR-001-bounded-operational-timeline.md), [DR-002-restore-point-precondition](../decisions/DR-002-restore-point-precondition.md), [DR-003-host-owned-schema-copy](../decisions/DR-003-host-owned-schema-copy.md).
