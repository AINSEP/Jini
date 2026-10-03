Spec ID: SPEC-JINI-ANALYTICS-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:427943bf3aac238e45d02f56b1fec1dfde405f03f5db11cbfc35d99318299748
spec_mode: reverse_spec

# UI contract: @jini-ai/analytics

This package is headless. It ingests privacy-filtered hits and exposes repository queries; it ships no dashboard, tracking script, consent banner, report widgets or stylesheet. The host presents analytics-enabled/disabled configuration and policy drop outcomes. Accepted is sink completion, not proof of durable retention or user consent. IP/UA hashes must not be displayed as a claim of personal identity.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.
