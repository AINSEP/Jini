Spec ID: SPEC-JINI-CMS-FORMS-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:980debe14193542cefd462dfb42c710122f060003a4293c8950b4d8300ec60d7
spec_mode: reverse_spec

# UI contract: @jini-ai/cms-forms

The package is headless. Definitions contain field labels/types and limited class/attribute hints, but no browser form renderer, submission endpoint, notification UI or stylesheet is shipped. Hosts render supported descriptors, validate outer payload shapes, apply accessible labels/errors, route anonymous submissions and present accepted without implying mail delivery. Honeypot acceptance is intentionally indistinguishable from ordinary acceptance.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-anonymous-submission-containment](../decisions/DR-001-anonymous-submission-containment.md).
