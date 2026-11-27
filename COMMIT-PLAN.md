# bug-chat — Jini working-tree handoff

No commits, installs, builds, tests, typechecks or linters are run in this dispatch.
Regression tests are written before implementation; RED/GREEN and mutation execution
are deferred to the coordinator. The approved sheets and existing injected seams
are the style and architecture contract; no new abstraction is planned.

## 1. chat 1 — shared AG-UI transport lifecycle (Jini implementation complete, unexecuted)

Files:
- packages/chat/src/core/assistant-client/__tests__/ag-ui-transport.test.ts
- packages/chat/src/core/__tests__/surface-recovery.test.ts
- packages/chat/src/core/assistant-client/ag-ui-transport.ts
- packages/chat/src/core/index.ts

Mutations: `terminal-not-latched` (repeat a terminal error/completion),
`eof-is-success` (complete a non-terminal stream as success),
`unaccepted-segment-id` (resolve an expected durable start with its segment ID),
`drop-before-live-observer` (drop accepted frames before the live observer),
`retain-accepted-entry` (omit follower/detach release),
`latch-until-acceptance` (omit the pending cancel port call),
`hide-exchange-meta-export` (remove the public metadata-key export).

Rewrite bug-pinning assertions: repeated RUN_ERROR, late error after RUN_FINISHED,
detach retaining an accepted entry, pre-acceptance Stop waiting for acceptance.

Implemented one segment terminal verdict; failure before completion preserves the
partial transcript, while pre-start failure rejects without stream callbacks.
Only acceptance or explicit segment RUN_STARTED acknowledges an expected durable
start. Accepted frames reach the live observer without transcript projection.
Follower completion and detach release accepted routing; segment EOF keeps the
follower's cancellation listener. Explicit Stop remains addressable during its
in-flight cancel. A required pending-cancel port shares success with acceptance;
only its rejection falls back to canonical cancellation. Acceptance racing an
already-detached reader also releases routing after the cancellation settles.
Public core now exports the unchanged SURFACE_EXCHANGE_META wire key.

## 2. chat 2 — shared approval answer result (implementation complete, unexecuted)

Files:
- packages/chat/src/core/assistant-client/__tests__/assistant-transport.ag-ui.approvals.unit.test.ts
- packages/chat/src/core/assistant-client/ag-ui-approval-relay.ts

Mutation: `claimed-means-sent` (return true for a repeated refused answer).
The relay and its tests now live in Jini. The named expired-resume test is absent
here; add it and strengthen the existing concurrent-success test to assert both results.

Installed one stored answer promise before invoking the injected resume, preserving
synchronous dispatch and claim-before-send order. Concurrent and repeated answers
share the boolean refusal/success result while the relay owns the exchange.
Refusal mapping, pause release, final usage selection and turn disposal are unchanged.

## Deferred to the Tovu half

- chat 1: required pending cancel HTTP binding and held-headers browser regression;
  metadata consumer import. No new package subpath is needed.
- chat 3: both named functions remain in the inspected Tovu files:
  apps/admin/src/lib/assistant-transport-ag-ui.ts (`wireLaunchFields`) and
  apps/website/src/server/runtime/composition/modules/assistant-ag-ui-launch.ts
  (`readAgUiLaunchFields`). Jini launch/replay logic is explicitly unchanged.
- All OPUS/NEEDS-OPUS and skipped near-matches are outside this dispatch.

## Final diff audit

Reviewed the complete six-file code/test diff. COMMIT-PLAN.md is the only new file
and is intentionally uncommitted. No production helper, dependency, package
subpath, hook, endpoint, server behavior, theme or launch projection was added.
Existing why-comments were retained/moved; the relay tap explanation now reflects
its request/thread identity role after the live-observer fix.

Test declarations (static source counts, not execution results): transport 20 -> 25,
relay 2 -> 3, surface recovery 2 -> 3. Including the literal parameterized cases,
26 -> 35 cases across these files. No test was deleted or skipped. The existing
EOF-only setup in unrelated token/thread tests now sends RUN_FINISHED first, so
those tests continue to exercise successful streams under the corrected verdict rule.

Reuse: existing subscribeRun/settleRunOnce, durable acceptance and cancellation
entries, and createAgUiApprovalRelay/resumeParked own the fixes; no parallel lifecycle.
Architecture audit (source review): PASS for the sheet's ownership and injection
boundaries. Only @jini-ai/chat code and its three named test files changed.
The host must supply cancelPendingRun (an explicit async no-op if unsupported).

Cost: transport; O(1) per frame and cancellation, one entry per active accepted run,
released on follower completion/detach (after an in-flight cancel settles).
Cost: relay; one answer promise per owned parked exchange until existing turn disposal.
Both are ESTIMATED from source; no memory or runtime measurements were performed.

Verification: source/diff review and static test counts only. Tests, mutation runs,
builds, installs, typechecks, linters and real-app checks were not run by instruction.
Coordinator must run the three touched test files and the listed mutations, then
the Tovu held-headers/expired-approval checks after its binding changes.

Deletions of out-of-scope additions during the final audit: none. Removed obsolete
bug-pinning assertions only where replaced by the sheet's corrected assertions.
