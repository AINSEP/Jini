# Commit plan — r62t-rev-p4, Jini SOL

Base: `010c8cd874f709ffa2c61de0de4e1dde4f808aad`, branch `codex/f-p4j`.
Changes remain in the working tree; no staging, commits, or pushes performed.

## 1. P4-J1.J — refusal disclosure and L6 artifact

Implementation completed, with the characterization test written before the production edit.

Files:
- `packages/core/src/errors/__tests__/reporter.test.ts`
- `packages/core/src/errors/reporter.ts`
- `.changeset/core-error-reporter-contract.md`

Added `an own-message match carrying a canary message answers the fallback words`.
The injected catalog supplies the exception message on an own-message match. The test
asserts the fallback message, original refusal code, refusal classification, and no host
record or tracker report. Existing assertions, including the authorized-only sentence
pin, remain unchanged.

Named code mutation: change the own-message arm to
`message: match.message ?? fallback.message`. The canary then replaces the asserted fallback.
Mutation execution is deferred to the cloud run.

Added the private `refusalMessage` with audience admission before an exhaustive switch.
Kept parameter redaction and interpolation in `refusalError`, with unchanged wire fields.
Added only the requested why-comment and the exact major changeset text. No API export
or baseline change.

Named artifact mutation: remove `.changeset/core-error-reporter-contract.md` against
the pre-break baseline. The merge-21 baseline may already contain the reporter API
changes; a green artifact-deletion run against merge-21 alone does not prove L6 coverage.
Opus review of complexity and L6 release coverage remains owed.

## Stopped — P4-J5.J

Required staged P4-J2a.J is absent. At the base, `runOperation` in
`packages/core/src/errors/reporter.ts:222–239` requires `deps.observability`, returns no
verdict, has no `classify` or `settle`, and calls tracker start/end without the staged
lifecycle containment. J2a belongs to Opus, so no replacement lifecycle was implemented.
No sidecar files or tests were changed.

Overlap screen: visible refs `origin/codex/ex-env`, `origin/codex/ex-env2`, and
`origin/codex/ex-env4` each contain commit `aa3926fdb` changing
`packages/sidecar/src/json-ipc.ts` (28 insertions, 36 deletions from their merge base).
It replaces the environment trace gate with per-instance trace options and changes the
same factory/trace paths. The current checkout retains the sheet's environment gate;
coordinate this overlap before resuming J5. No ref was merged or modified.

## Left to Opus / outside this dispatch

Jini OPUS sheets: P4-J2a.J, P4-J2b.J, P4-J4.J, P4-J3a.J, P4-J3b.J.
Tovu OPUS sheets: P4-T2.T, P4-T3.T, P4-T3b.T.
Tovu SOL sheets P4-T1.T and P4-T5.T, and the Tovu P4-T4 status work, are outside
this Jini-only dispatch.

## Review and validation

Re-read the scoped diff and exact changeset content. No tests, builds, installs,
type-checks, linters, or mutations ran, as instructed. No passing runtime or coverage
claim is made. Existing tests were neither removed nor weakened.

Static architecture audit: PASS for J1 scope; the decision remains private in core,
with existing injected ports, audience order, redaction, and wire ownership preserved.
Function assessment: `refusalMessage` and `refusalError` have no recorded static findings;
both are below 50 lines and complexity 10. The former selects words in constant space
and time; the latter retains existing parameter redaction/interpolation costs.
Skepticism review checked mode exhaustiveness, variable meanings, audience precedence,
and unchanged redaction. Execution evidence remains pending.

Final diff cleanup: no unrequested additions found; no cleanup deletions made.
The replaced inline refusal-selection branches now live in the sheet-named helper.

Tovu requirements from this completed work: no new subpaths or exports. The major
changeset documents the already-present reporter contract; J5 adoption remains deferred.
`COMMIT-PLAN.md` is the only additional handoff file.
