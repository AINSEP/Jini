Spec ID: SPEC-JINI-CMS-FORMS-UI
Version: 2.2.0
Last Edited: 2026-10-26
Hash: sha256:b1f92f1c803642a3562e02c2b2be9646f2bd832678b59200f9955ecef236f597
spec_mode: reverse_spec

# UI contract: @jini-ai/cms-forms

The package is headless. Definitions contain field labels/types and limited class/attribute hints, but no browser form renderer, submission endpoint, notification UI or stylesheet is shipped. Hosts render supported descriptors, validate outer payload shapes, apply accessible labels/errors, route anonymous submissions and present accepted without implying mail delivery. Honeypot acceptance is intentionally indistinguishable from ordinary acceptance.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-anonymous-submission-containment](../decisions/DR-001-anonymous-submission-containment.md).

## Phase 1 live UI addendum (2026-10-26)

The active CMS exports its existing HTML and Express adapters. Both supported renderers retain exactly one inaccessible, unfocusable `_hp`. Live finalization issues one opaque `_attempt` per form response through the same app store used at submission; static exports omit it.

A fast submission displays exactly `Please wait a moment, then submit again.` through existing HTML error hooks. The form stays visible; eligible text survives the bounded read-once flash cookie. File controls require reselection after a navigation; no automatic retry or new script/cookie is added. JSON clients can retry the same token.

The existing Jini admin Forms panel says `Basic spam protection is on.` and explains live timing when available, duplicate suppression and rate limits, including the 1-second / 5-per-minute defaults. Guidance distinguishes exported destination capabilities and custom embeds without generated hidden controls. No provider selector or tuning controls are introduced. See [DR-004](../decisions/DR-004-basic-live-submission-timing.md).
