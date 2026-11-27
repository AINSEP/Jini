# P6 Jini handoff

Spec: revised r62t-rev-p6, Opus-checked 1124b.
Base: `codex/b-p6j`, `010c8cd874f709ffa2c61de0de4e1dde4f808aad`.
HEAD and all P6-J1.J anchors matched. All changes remain uncommitted; `.git` was read only.

## Completed implementation, in commit order

1. **P6-J1.J — Byte activity on the existing AG-UI fetch agent**
   - Tests were written before production edits.
   - Changed `packages/chat/src/core/assistant-client/__tests__/ag-ui-fetch-agent.test.ts`.
   - Changed `packages/chat/src/core/ag-ui/__tests__/interrupts.test.ts`.
   - Changed `packages/chat/src/core/assistant-client/ag-ui-fetch-agent.ts`: optional supplied controller and byte callback, the specified transform before the existing parser/validator, and the named `AgUiFetchAgent` interface with `Promise<void>` subscription.
   - Changed `packages/chat/src/core/assistant-client/ag-ui-transport.ts`: export the named type alongside the existing factory.
   - Changed `packages/chat/src/core/ag-ui/event-projection.ts`: move the existing decision statements verbatim into private `readResumeDecision`, after unchanged schema and identity checks.
   - Created `.changeset/p6-ag-ui-fetch-activity.md`: `@jini-ai/chat` minor.
   - Created `COMMIT-PLAN.md`: coordinator handoff.

## Tests and required red mutations

- `reports byte activity before a split event completes`: heartbeat, incomplete event, suffix, and an empty chunk; exact callback arguments for every nonempty chunk; no event before the suffix; final activity callback precedes the one text event. Mutation: move byte reporting into the decoded-event loop.
- `uses the supplied controller and cancels the reader once`: pending read, exact controller/signal identity, one cancellation, released lock, one error and no `next` or `complete` after abort. Mutations: construct a different controller; omit `{ signal }` from `pipeThrough`.
- `rejects a matching resume with an unrecognized resolved payload`: assert the unknown payload passes the official input schema but returns `undefined`. Mutation: treat any resolved payload as allow. This characterizes behavior already present at the base.

Static case counts: fetch-agent 5 → 7; interrupts 7 → 8 (including the three existing `test.each` rows); combined 12 → 15. No existing tests or assertions were deleted or weakened.

Tests, mutation runs, builds, installs, type-checks, linters, and API regeneration were not run, as explicitly prohibited by the dispatch. No runtime pass or mutation-red result is claimed. Cloud verification remains required.

## Scope and review

- Re-read the full diff against P6-J1.J. No unrequested implementation additions remained; no cleanup deletions were needed. The controller construction moved into its specified default, and the decision statements moved into their specified helper.
- Reused `readSseFrames`, `EventSchemas.parse`, `AgUiClient`, the existing factory/client, and the existing resume checks. No parser, lifecycle, subpath, dependency, shell, or configuration change.
- Static architecture audit: PASS within the sheet's boundaries. HTTP and policy remain host-owned; byte notification precedes parsing; the pipe retains the supplied signal; resume schema, exact-one-entry and identity checks precede the private decision helper. Existing why-comments remain unchanged. Runtime conformance is unverified.
- Function assessment: `createAgUiFetchAgent`, `readAgUiResponse`/transform, `readConfirmationResume`, and `readResumeDecision` are INCONCLUSIVE pending the prohibited runtime/type checks. Static review found no required refactor. Byte notification adds O(1) time and space per chunk, with no retained activity history, timers, new I/O, or retries. Decision extraction adds O(1) time and space. Names, effect order, callback ordering and optional-field typing were reread; explicit `undefined` is accepted for the threaded optional callback under `exactOptionalPropertyTypes`.
- Documentation classification: only the required changeset and this handoff were added; production comments were neither added nor removed, per the owner rule.

## Sheets left

No eligible Jini SOL sheet stopped; P6-J1.J is the sole eligible Jini SOL sheet.

OPUS sheets left untouched: P6-T1.T, P6-T2.T, P6-T3.J, P6-T3.T, P6-T4.J, P6-T4.T, P6-T2.R.
Tovu SOL P6-T5.T is outside this repo dispatch and remains gated on all six P6-T4 parity rows.

## Tovu / verification handoff

- Consume the Jini candidate through P7-J2. Use existing `@jini-ai/chat/transports/ag-ui`; no new subpath or dependency.
- New exported type: `AgUiFetchAgent`. The existing factory takes optional `{ abortController, onBytes }`; Tovu supplies its controller and byte timer callback. Existing `createAgUiRunClient` remains available.
- `packages/chat/package.json` and `api-baseline/jini-ai__chat.json` are untouched. Opus runs `pnpm api:update` and accepts only the optional factory argument/type deltas specified by P6-J1.J, including its named return type; the resume helper signature and projection export stay unchanged.
- Run the three named mutations and both affected test files in the cloud. No Tovu idle, refusal, approval, durable lifecycle, or parity gate is claimed by this Jini sheet.
