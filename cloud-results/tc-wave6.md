# tc-wave6 report (2026-11-18), Jini side. Status: DONE for S7 and S2b (Jini halves); Tovu halves in `Tovu/cloud-results/tc-wave6.md`

Branch `wave3/tc-wave5` (fast-forward only, base `origin/wave3/tc-wave5` = `6dbdca26`). OD-2 and OD-8/OD-9 are DECIDED = Rec in `2026-11-17-OWNER-DECISIONS-ANSWERED.md` (TC-OD1..OD11 all = Rec); the INDEX table still says OPEN, so README block 4.10 was not run literally.
Setup: Node 24.12.0 (`~/.local/node24`), pnpm 10.33.2 via corepack, `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build`. Vitest runs use `--pool=forks --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`.

## Pushed SHAs (`origin/wave3/tc-wave5`)
`45ebff93` S7 characterization · `2ebaa6d0` S7 change · `8419db02` S2b characterization · `b5bc169f` S2b change · report commit (last).

## S7: done (daemon + one core export)
- Landed checks (4.11): `rg -n "inputNames" packages/core/src/text/diagnostic-vocabulary.ts` rc 0. `rg -n "inputNames" packages/mcp/src/server/daemon-client.ts` prints nothing (rc 1): S6 put the reader in `mcp/src/server/call-vocabulary.ts` (which reads `details.inputNames`, `toolId`, `executionId` from the envelope) and core, not in `daemon-client.ts`. I treated the sheet's intent (the client reads `details`) as met; flagging it because the literal command is not green.
- `daemon/src/http/delegated-tool-error-details.ts` (new, 41 lines): `diagnosticDetails({ descriptor }, { executionId })` and `withDiagnosticDetails({ outcome, descriptor }, { executionId })`. Names come from core's schema walk, now exported as `schemaPropertyNames` from `@jini-ai/core/text/diagnostic-vocabulary` (existing entry; no second walker). Sorted, at most 64, identifier-shaped only. `descriptor` only; the caller's input is never read.
- `delegated-tools.ts`: the target is resolved once (`resolveRequestTarget`, so S1's decision and S7's descriptor are one lookup); everything after the gates moved into `runResolvedTool`, which answers every error through one `refuse` that attaches the details. The success path keeps `.then` (not `await`) on `toolExecutionResultWithRecovery`, so a rejection there still escapes the catch exactly as before. The read-only refusal and a throwing `resolvePrincipal` also carry the details (the tool resolved). Unknown tool, group id (`details.family` untouched) and unknown run carry no names.
- Changed model-facing sentences: none. Envelope gains `details: { toolId, inputNames, executionId? }` for resolved tools only; `code`, `message`, `requestId` unchanged (asserted).
- Tests: characterization (5, passed on the parent) replaced by `delegated-tools.error-details.test.ts` (16). Red on the parent: 11 of 16 (`expected undefined to deeply equal { toolId: 'shot_page', …(2) }`). Mutations: dropping `.sort().slice(0, 64)` fails 10; dropping the "details already present" guard in `withDiagnosticDetails` survives (an answer that already has details is the group answer, which has no descriptor, so the guard is defence in depth). Three older files pinned exact envelopes and now include the details: `delegated-tools.obtain-from.integration.test.ts` (7 assertions), `delegated-tools.test.ts` (1), `delegated-tools.unknown-tool.integration.test.ts` (1). Counts unchanged there.
- Changeset `.changeset/daemon-error-details-names.md` (daemon, core minor).

## S2b: done (mcp)
- `mcp/src/server/tools/family-retry.ts` (new): `selectFamilyMember({ error, input }, {})` reads only `error.code` and `error.details.family` (duck-typed, no `instanceof DaemonHttpError`, because the existing `delegated-tool.test.ts` replaces `daemon-client.js` with a mock that has no such export), and `postWithFamilyRetry`. At most one retry; second request gets a new `toolUseId`, the same run and `requireReadOnly`; its failure propagates as its own; a cancelled `ctx.signal` is never retried. Returns the `toolUseId` of the request that produced the answer, so the result marker names the right request.
- `delegated-tool.ts`: handler body shrank into `shapeDelegatedResult`; `createDelegatedGateway` 61 → 59 lines (still over 50, shrank: block 4.16 prints it).
- Changed sentence, old → new: a family call whose input names one member: `HTTP 404: UNKNOWN_TOOL: "fam" is a group of tools, not one tool. Call one of: fam.a, fam.b.` (error) → the member's result with the note `normalized: "fam" is a group; ran fam.a` (through core's `withNormalizationNotes`; `normalizationNotes: ["\"fam\" is a group; ran fam.a"]` on a non-content result). Every other family call is byte-identical to before.
- Tests: characterization (2) replaced by `delegated-tool.family.test.ts` (15). Red on the parent: 7 of 15 (`expected [ { runId: 'run-1', …(3) } ] to deeply equal [ …(2 requests) ]`). Mutations: no signal check fails 1; no single-selector check fails 1; no `members.includes` fails 1. The `Object.hasOwn(byValue, value)` mutant survives: it is redundant with the next `typeof memberId === 'string'` test (no inherited string exists on `Object.prototype`); kept as the sheet's explicit rule.
- Changeset `.changeset/mcp-family-call-retry.md`.

## Gates (exact command, result)
- BASE (`6dbdca26`): `pnpm guard` ok; daemon 242 files / **4787** tests; mcp 1880; core 3317.
- Final tree (`b5bc169f`): `pnpm guard` ok · `pnpm typecheck` 0 errors · `pnpm check:size` ok (157 entries) · `pnpm check:complexity` ok (17 entries) · daemon **4798** (242 files) · mcp **1895** (118 files) · core **3317** (217 files). A first complexity run failed on `createDelegatedGateway.handler` (11); fixed in the same commit before the push (`shapeDelegatedResult`).
- §4 on both diffs: 4.3, 4.4, 4.5, 4.6, 4.7, 4.15, 4.17 print nothing. 4.8 prints one line (S7): the old doc of `schemaPropertyNames` (reworded and extended in place). 4.9: `await import('@jini-ai/core/text/diagnostic-vocabulary')` from daemon prints `function`; no `node:` import in the new daemon file. 4.16: only the `createDelegatedGateway` line above.
- `pnpm api:check` not run (red on the base per `tc-wave2a.md`).

## Left / next step
Nothing left in the Jini halves of S7 and S2b. REL: Tovu must see `@jini-ai/core` (export `schemaPropertyNames`), `@jini-ai/daemon` (details on error answers) and `@jini-ai/mcp` (family retry) from a published snapshot.

## New Jini exports Tovu consumes (REL)
`@jini-ai/core/text/diagnostic-vocabulary`: `schemaPropertyNames`. No other new public symbol (`family-retry.ts` and `delegated-tool-error-details.ts` are internal files).

## Overlap with other runs (files)
`packages/daemon/src/http/delegated-tools.ts` (+ new sibling), `packages/mcp/src/server/tools/delegated-tool.ts`, `packages/core/src/text/diagnostic-vocabulary.ts`, `.changeset/` (2 new).
