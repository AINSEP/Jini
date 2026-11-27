# Dispatched sheets: T5a, G06.RUN.J, J10

Base: `codex/w3-noj`, `aa9d689ee9bade8bfc94661ccaa9e197732183fc`.
All changes are in the working tree; Git's index, refs and history were not written.
No tests, builds, installs, typechecks, linters or mutation runs were executed, as dispatched.

## Build-order disposition

1. **T5a: STOPPED before edits.** The supplied contract and implementation disagree with named test 1. In `kernel-core.ts`, `kernelTransaction` increments `rt.own.transactions` while the transaction body is running. The sheet's `idleTurnControl.tryTake` checks `rt.own.transactions > 0` before `lock.tryAcquire`, returning `transaction-open`. Test `step never runs while a kernel transaction is open` requires exactly `{ ran: false, reason: "busy" }` for that same state. Choosing a different admission order or weakening that assertion would change the design. No db files, tests, changeset or exports were added.
2. **G06.RUN.J: implementation and three tests written; Opus verification pending.** Read-only comparison against `e04253142` confirmed the only launch-source differences were K03's mechanism additions at the two specified anchors.
3. **J10: STOPPED before edits.** Read the specified source at Tovu commit `dbb9fa5d5` (the local Tovu working checkout is older; it is not the source used for this finding). `apps/admin/src/features/email/EmailProviderTab.tsx:167–173` exports `shownProviderId({ providers, selectedId }, _options = {})` and calls the imported admin `isFullyActive` inside its selection expression. Section 5.2 requires that export remain unchanged and forbids the admin import; `rules.isFullyActive` is injected only through component props. No rule dependency is specified for this non-component export. Preserving its algorithm requires a changed parameter contract or a duplicated rule, both outside the stated move. Resolve that dependency contract before building J10. No user-management files, tests, copied controller types, leaves or changeset were added.

## G06 commit sequence for the coordinator

These logical steps are complete in the combined working-tree diff; no intermediate commits were created. The coordinator can partition the diff as needed.

| Order | Proposed commit | Files touched |
| --- | --- | --- |
| 0 | `test(daemon): pin launch cleanup and immediate exit` | `packages/daemon/src/agent-executor/__tests__/r8a-pins.test.ts` |
| Types | `wip: define launch phase contracts` | `packages/daemon/src/agent-executor/launch.ts`, `packages/daemon/src/agent-executor/launch-run.ts` |
| 1 | `wip: lift executor helpers behind ExecutorScope` | `packages/daemon/src/agent-executor/launch.ts` |
| 2 | `wip: extract admitLaunch` | same |
| 3 | `wip: extract createLaunchResources` | same |
| 4 | `wip: extract createLaunchCleanup` | same |
| 5 | `wip: extract createLaunchLock` | same |
| 6 | `wip: extract prepareLaunchInputs` | same |
| 7 | `wip: extract stageLaunchConfiguration` | same |
| 8 | `wip: extract prepareLaunchInvocation` | same |
| 9 | `wip: extract handoffLaunch` | same |
| 10 | `refactor(daemon): sequence executor launch phases` | same, `packages/daemon/src/agent-executor/launch-run.ts` |
| Package | `chore(daemon): record launch phase patch` | `.changeset/g06-launch-phases.md` |
| Handoff | `docs: record sheet disposition and mutations` | `COMMIT-PLAN.md` |

## Tests first and named mutations

Three tests were added before production edits, all in `r8a-pins.test.ts`:

- `a synchronous spawn failure releases an acquired lock and each staged home once`: asserts one release, one cleanup per home/config, exact stage/release/cleanup order, and no stdin prompt dispatch. Named mutation **M-double-release-staged-home** should fail its count/order assertions.
- `an immediate child exit cannot beat lifecycle registration`: emits spawn/exit/close in the next microtask, then asserts `sendUserMessage` returns `not-running` and one lock release. Named mutation **M-yield-before-child-wiring** should fail this test (or leave spawn confirmation unresolved).
- `prepare-phase failure before the lock uses cleanupStagedFiles only`: HTTP configuration preparation throws after obtaining an endpoint; asserts one endpoint close, no lock acquisition, no spawn.

Also record **M-cleanup-order-swap**: swap MCP JSON disposal and staged-home disposal in `createLaunchCleanup`. Opus must check its kill against the retained suite; the three prescribed new cases do not populate both slots together, so a kill is not claimed here. No additional test case was invented.

`agent-executor.test.ts` was not edited; its retained MCP-file, scratch-home and rejecting-prompt-cleanup tests remain unchanged. Existing tests were not deleted or weakened; the test-count delta is **+3** (execution counts unavailable).

Stopped-sheet mutations, not applied: T5a **M7c-idle-turn-queues**, **M7c-skip-foreign-check**, **M7c-no-step-recheck**; J10 **M-reveal-provider-key-in-status**, **M-preview-marks-unsaved-template-saved**, **M-ignore-part-prop**.

## Review and remaining gates

- Static boundary review: G06 keeps one mutable resource state, sequential cleanup with clear-before-await, one argument build, and child exit/live-map registration in the same function before spawn-confirmation await. Existing why-comments moved with their code. No package export or barrel changed.
- Static function review: sequencing, admission, staging, invocation, cleanup and handoff remain the sheet's named units; no additional production helper was introduced. Runtime timing, types and mutations remain unverified.
- The launch file is **1,747 physical lines** after the move (was 1,623). `scripts/size-debt.json` was deliberately left untouched: Opus must measure with the repository's actual counting rules, confirm the new functions are <=80 lines, then retire only `createAgentExecutor.run`; retain/re-measure the whole-file debt.
- Opus still owns `pnpm guard`, `pnpm typecheck`, daemon package tests, `api:check` and all three G06 mutation applications/reverts. No public API baseline change is intended.
- Self-validation: **not run**, because this dispatch prohibits execution. Overall delivery is **PARTIAL**: G06 awaits verification; T5a/J10 require design resolution.

## Final diff deletions

- Removed the old nested helper definitions and monolithic `run` body after moving their statements to the named module-level units.
- Removed the executor's unused destructuring of `journal`, `continuation`, `classifyFailure`, `mcpJsonInjection`, `claudeConfigDirIsolation`, `promptAugmenter`; moved references read the existing `scope.options` object.
- Omitted the unused type imports listed in the `launch-run.ts` sketch; the driver uses only `AgentExecutor` and the three phase-result types.
- No source file, test, capability, why-comment or debt row was deleted.

## Tovu release integration

- **T5b remains blocked:** T5a has not supplied `withIdleTurn`, `IdleTurnResult`, `IdleTurnRefusal` on `@jini-ai/db/kernel`. No new subpath is needed once T5a is resolved. T5b must retain its disabled activation state.
- **T10 remains blocked:** J10 has not supplied `@jini-ai/user-management/react/mail/Email`, `/EmailProviderTab`, `/EmailTemplateEditor`, `/email-view.types`. No range bump is ready. T10 still owns host bindings, CSS imports, lazy-route repoints and the existing kit provider.
- No timers, retention activation or `scheduledDryRun` changes were made. No other sheet was built, and no Tovu working-tree file was modified.
