# DR-004: Conservative live form timing

Status: approved by the owner's 2026-10-26 Phase 1 dispatch, adopting the recommended answers in `2026-10-25-captcha-plan.md`. Extends DR-001's abuse controls and ADR-PIPE-010's sole anonymous submission owner; supersedes the original CAPTCHA exclusion only for first-party Phase 1 checks.

## Decision

Extend the existing `SubmissionAttempts` owner with object-shaped `issue` and `ageMs` operations. The live host supplies the same app-scoped store to response finalization and submission. Issuance is separate from accepted/pending claims: retain at most 10,000 opaque token/scope/time records for two hours, with lazy bounded eviction and no timers, answers or IPs.

After validation and rate admission, before claims, uploads or persistence, reject a known correctly scoped attempt younger than 1000 ms with `FormSubmissionTooFastError`, JSON 422 / `FORMS_SUBMISSION_TOO_FAST` and exactly `Please wait a moment, then submit again.` HTML uses the existing safe redirect/flash flow, preserving eligible text; files must be selected again after navigation. Never automatically resubmit. Missing, unknown, expired, evicted, wrong-scope and clock-rollback observations skip timing. No client timestamp is evidence. This heuristic is deliberately bypassable and is no proof of humanity.

Keep honeypot responses, 5/60-second host rate policy, 60-second dedupe, failure release, random permanent IDs, transactional row/event persistence, upload compensation and background notification delivery. No provider dependency, new cookie or distributed claim store is added. Hosts can disable timing by ceasing issuance while retaining dedupe.

## Counting and scope

Tovu's events job already binds visitor provenance at ingress and counts only committed `form.submission.received` events. Preserve that owner; do not add a parallel `onPersisted` callback or conversion capture. Discards, retries and duplicates emit no new committed event.

Static receivers retain their existing controls. Phase 1B requires a separate additive D1 receipt/migration decision for atomic dedupe, safe retry, scoped retention, cap parity and edge timing; no receiver implementation is authorized here. Phase 2 `bot_check`, browser admission and vendors remain excluded.

## Verification and handoff

DI tests cover store scope/retention/capacity/rollback, one-second boundaries, refusal ordering and no rejected effects, native HTML/JSON retry parity, shared rendering/submission wiring, honeypot markup and protection guidance. Tests are written only: the owner forbids all execution, builds and installs tonight. Coordinator owns later validation, package release/adoption and Phase 1B dispatch.
