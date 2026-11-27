# Round 2 — w3b-ext-w1 (Jini)

Working branch: `codex/r2-ext-w1j`
Inspected HEAD: `fe7bf8cc1c0ee977f5b82af8bf3889f4bc5917f6`
Source anchors inspected from Tovu commit `c0f1068a59`.

## Completed design commits, in order

None. Prerequisite verification stopped implementation before tests or production edits.

## STOP — J19 prerequisite

The approved G-W1 revision replaces the rejected W1 J01/T01 prerequisite with
round-1 ext-crp CRP-01/CRP-02 (J and T). CRP-02.J is not complete in this tree:

- `packages/core/src/contracts/site/daemon-surface-exchanges.ts:13–17`
  exports only `AssistantSurfaceDeps`. It does not export the
  `HumanConfirmSurfaceDeps` required by G-W1.
- `packages/daemon/src/surface-exchanges/human-confirm.ts`, the CRP-02
  implementation named by the dispatch, is absent; its parent directory is absent.

Per the dispatch's prerequisite-failure rule, J19 is stopped rather than
substituting `AssistantSurfaceDeps`, implementing CRP-02 here, or bypassing the
stated build order. `ToolPermissionAuthorizationPort` is available through the
existing alias at `packages/core/src/index.ts:67`; it is not a blocker.

## Remaining sheets, in design order

| Sheet | Status | Reason |
| --- | --- | --- |
| J19 | STOPPED | Required CRP-02.J prerequisite is incomplete, as detailed above. |
| J20 | LEFT — dependent | Requires J19. |
| J21 | LEFT — dependent | Requires J19–J20 and CRP-02; its literal approval type also requires the missing `HumanConfirmSurfaceDeps`. |
| J22 | LEFT — dependent | Requires J19–J21 and their approval contract. |
| T18 | LEFT — Tovu | Outside the Jini-only dispatch; requires J19–J22. |
| J23 | LEFT — dependent | Requires J19's storage port. |
| T19 | LEFT — Tovu | Outside the Jini-only dispatch; requires J23 and T18. |
| J24 | LEFT — REJECT | Approved check assigns recovery to ext-w2b 72. |
| T20 | LEFT — REJECT / Tovu | Approved check assigns recovery cutover to ext-w2b 73. |

No independent eligible Jini sheet remains after the J19 stop.

## Named tests and mutations — pending, not written or executed

- J19 `media/site-import/__tests__/tool-registrations.test.ts`: permission
  denial (`fetch-before-authorize`); final redirect URL and sniffed MIME
  (`persist-request-url`); replacement capabilities before source I/O
  (`read-before-cas-capability`); cancellation before storage
  (`drop-import-abort-fence`); content-type write refusal propagates
  (`ignore-content-type-write`, absorbed from rejected ext-w2a J14).
- J19 `media/site-import/__tests__/caller-safe-refusal.test.ts`: safe refusal
  reaches schema decoration and ordinary transport errors retain identity
  (`throw-original-refusal`).
- J20 `asset-transfer/__tests__/asset-destinations.test.ts`: destination scope
  (`authorize-picked-as-site`); preparation has no writes and retains picked
  batch (`write-during-prepare`); disk and case-folded batch collisions
  (`ignore-batch-collision`); partial FS failure (`drop-partial-failure`).
- J21 `asset-transfer/__tests__/copy-tool.test.ts`: authorize destination before
  source (`read-before-destination-check`); truncated glob refusal
  (`accept-truncated-glob`); complete document preflight
  (`save-documents-during-preflight`); approved site batch (`skip-site-approval`).
- J22 `media/site-transform/__tests__/tool.test.ts`: inspect avoids destination
  (`prepare-destination-on-inspect`); approved bytes are the executed bytes
  (`render-again-after-confirm`); declined picked batch never writes
  (`skip-picked-approval`).
- J23 `media/site-generation/__tests__/tool-registrations.test.ts`: saved-key
  failure never reaches env/dispatch (`env-after-saved-open-error`); validation
  shares catalog enum (`validate-against-builtins`); Stop fences late generator
  result (`drop-post-dispatch-abort`); placeholder provenance credits no model
  or provider (`credit-stub-as-real`).

All test paths above are relative to `packages/cms/src/`.

## Files, release metadata, and Tovu handoff

Only this uncommitted `COMMIT-PLAN.md` was created. No production code, tests,
package exports, `jini.entries`, changesets, or API baselines were changed.
No deletions. No tests, builds, installs, typechecks, or linters were run.
Git state was not mutated.

Land the required CRP-02.J work before retrying this set. No new subpaths or
exports are available for the Tovu half from this run; T18/T19 must not cut over
based on it. API baseline regeneration remains with Opus after implementation.
