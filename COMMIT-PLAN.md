# Commit plan

Base: `codex/b-p2j`, `010c8cd874f709ffa2c61de0de4e1dde4f808aad`.
Changes are left in the working tree for the coordinator to commit; `.git` was not modified.

1. `fix(cms): lead publish catalog with scoped work` — P2-T3.J implemented, runtime verification pending.
   - Added `packages/cms/src/publish/content/__tests__/agent-tools.test.ts` before the production edit, with exactly the two specified tests.
   - Changed only the two designated description fragments in `packages/cms/src/publish/content/agent-tools.ts` to the sheet's exact replacement string, including its trailing space.
   - Added `.changeset/p2-scoped-publish-catalog.md` with `@jini-ai/cms: patch`.
   - Added `COMMIT-PLAN.md` as the coordinator handoff.

## Tests and mutations

- `publish guidance checks readiness and gives an exact item key before describing publish-all`: requires all three phrases, checks readiness-before-items-before-publish-all ordering, and pins the exact-key example and explicit request condition. Named mutation `unfiltered-lead` restores the old fragments and is expected to fail this test.
- `scoped guidance keeps the publish card and overwrite instructions`: pins the unchanged overwrite, confirmation, and verified-live-URL wording and reads `{ class: "publish", confirmation: "policy" }` from `toolMetadata.publish_content_publish.approval`. Named mutation `drop-card-copy` removes the confirmation sentence and is expected to fail this test.
- New test file count: 0 → 2 tests. No existing tests deleted, skipped, or weakened. Mutations and tests were not executed: the dispatch prohibits tests, builds, installs, type-checks, and linters. The coordinator's cloud run must verify them.

## Review

- HEAD, source anchors, approval metadata, and the existing `@jini-ai/cms/publish/content/agent-tools` export match the sheet.
- Static architecture review: PASS. The catalog remains the existing owner; no production functions, imports, schemas, permissions, result fields, handlers, comments, dependencies, or exports changed. No API-baseline edit.
- Diff reviewed against P2-T3.J and the owner rules. Unrequired additions removed: none. Required deletions: only the two replaced string fragments; no files deleted.
- Runtime verification and self-validation were not run, as explicitly required by the dispatch. No passing-test or mutation-result claim is made.

## Remaining sheets

- Stopped Jini SOL sheets: none.
- P2-J1: DONE-ALREADY per dispatch; untouched.
- OPUS sheets left untouched: P2-J2.J, P2-T4.J, P2-T1.T, P2-T2.T, P2-T3.T, P2-T4.T, P2-T5.0 (both repositories), and its non-runnable follow-on P2-T5.J/T.journal.
- P2-T1.T0 is Tovu SOL and outside this Jini-only dispatch.

## Tovu handoff

Consume the updated catalog through the existing `@jini-ai/cms/publish/content/agent-tools` export for P2-T3.T. No new subpaths, exports, or signature changes. Tovu still owns resolving “this page” and re-recording the intended moved-tools golden delta with the updated Jini artifact linked.
