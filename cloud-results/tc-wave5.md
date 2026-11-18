# tc-wave5 report (2026-11-18), Jini side. Status: PARTIAL (S8, S6 done; S7, S2b not run)

Branch `wave3/tc-wave5` from `origin/wave3/tc-wave4`, then `--no-ff` merge of `origin/wave2/chat-deps` (clean, `dc2d8571a`). Tovu half and S9: `Tovu/cloud-results/tc-wave5.md`.
OD-3 (and OD-2) are DECIDED = Rec in `2026-11-17-OWNER-DECISIONS-ANSWERED.md` ("TC-OD1..TC-OD11 all = Rec"), so S6 ran with source 4 (the caller's own slug arguments).

## Pushed SHAs (all on `origin/wave3/tc-wave5`)
`dc2d8571a` merge chat-deps · `08e2158d2` S8 characterization · `f970fd3d6` S8 change · `a1c7d960b` S6 core (`buildDiagnosticVocabulary`) · `019d23ed1` S6 mcp characterization · `251e9aca0` S6 mcp change (+ complexity fix of the core builder) · report commit (last).

## S8: done
- New `mcp/src/server/daemon-error-text.ts` (`describeDaemonFailure`, `isRecognizedEnvelope`, pure, ~90 lines), `DaemonTransportFailure` (status, route without query, contentType, bodyBytes; no body text), `DaemonHttpError` gains `code`, `requestId`, `details` (plain object under 4 KiB). `DaemonRequestOptions.reportFailure` threaded through `McpToolContext`, `daemonCallOptions`, `McpToolServerOptions`/`buildToolContext`, `RunToolHostOptions`/`assembleRunToolHost`, `ServeDeps`; `bin/stdio-error-reporter.ts` (new, `createStdioReportFailure`) builds `createErrorReporter` with ids from core `mintToolErrorId`, stderr console logger, no-op tracker (the one allowed block-4.17 hit), empty catalog, version from the package manifest.
- Changed sentences, old -> new (all asserted with `toBe`):
  - HTML / empty / non-envelope 5xx: `HTTP 500` -> `The tool service failed (HTTP 500) and its answer was not readable. Error ID: ERR-…. Do not retry the same call; give the user this error ID.` (no reporter: `…readable. Do not retry the same call; tell the user the tool service failed.`)
  - non-envelope 4xx: `HTTP 4xx` -> `The tool service refused this call (HTTP 4xx) and its answer was not readable. Error ID: ERR-…. Check the arguments; if they are right, give the user this error ID.`
  - flat 404: `HTTP 404` -> `HTTP 404: a live run is required`; flat code included: `HTTP 409: CONFLICT: stale`
  - flat 503 (no code): `HTTP 503` -> `The tool service is restarting or closed (HTTP 503): site scope is closed. Wait a few seconds and retry once.`
  - nested with `requestId`: appends ` Error ID: <requestId>.`; nested without: byte-identical `HTTP 403: TOOL_OPERATION_DENIED: x`.
  - Four pins in `daemon-client.test.ts` changed to the new sentences (404 `{}` body, non-string code/message, JSON `null`, auth-header case); `{"error":{"code":7,"message":["x"]}}` is now "not readable" (a 400 sentence), not `HTTP 400`.
- Red (parent state, 11 of 18 new cases failed, pasted): `expected 'HTTP 500' to be 'The tool service failed (HTTP 500) an…'`, `expected 'HTTP 404' to be 'HTTP 404: a live run is required'`, `expected [] to have a length of 1 but got +0` (no record). Canary property test: statuses 400-599 × {empty, HTML, plain, invalid JSON, 5 MB} with a 40-char sentence and token from `qxzjvkwy`: no 8-char run shared, ≤ 400 chars, contains `Error ID:`, one record each.
- Assembled host: `run-tool-host.report-failure.integration.test.ts` (HTML 500 through `execute_delegated_tool` → `Error ID: ERR-0000-0000-0000-0001.` in the result, exactly one record). Characterization `daemon-client.nested-envelope.characterization.test.ts` (the 4 bare-status rows it first pinned are replaced by `daemon-client.unreadable-answer.test.ts`; count 5 → 1 + 20 new).
- Not done: `McpHttpToolServerOptions` (`http-tool-server.adapter.ts` `Pick`) does not list `reportFailure`, so an in-process HTTP host gets the no-ID sentence until it is added (one word; not in the sheet's thread list).

## S6: done (with source 4)
- `core/src/text/diagnostic-vocabulary.ts` (`buildDiagnosticVocabulary`, entry `./text/diagnostic-vocabulary`) and `core/src/text/masked-identifier-rows.ts` (entry `./text/masked-identifier-rows`); both in `exports` and `jini.entries`. 4.9: `await import('@jini-ai/core/text/diagnostic-vocabulary')` from `packages/mcp` prints `function`; no `node:` import.
- mcp: `call-vocabulary.ts` (`callVocabulary`, `envelopeVocabulary`), `DaemonRequestOptions.trustedTokens`, `McpToolContext.diagnosticVocabulary` + `descriptorFor` (supplied by the publisher from a bounded 512-entry map of validated descriptors), first pass (`buildDaemonHttpError`) adds the envelope's names, `handleToolCall` builds the vocabulary once per call and re-adds the error's tokens in the second pass. `diagnosticToolIds` unchanged; test asserts the vocabulary never lands in it.
- Characterizations (pass on the parent): core 5 rows, mcp 10 (rows through `postDaemonJson` and `handleToolCall`): rows 2-5 print `[redacted]`, row 1 is already kept (slug-shaped). Red on the parent: 6 of 7 new mcp cases (e.g. `…fullPage (optional), [redacted] (optional)`). Mutations: dropping the first-pass envelope names fails 2 (rows 2 gateway-without-descriptor, 4/5); dropping the second-pass tokens fails 5; core: envelope tokens dropped fails 5, secret-marked check off fails 1, echoed shape unbounded fails 1 (found uncovered, test added).
- Still masked (tests): bearer token and `apiKey:` even when in the vocabulary, a UUID only in free text, a glued suffix, a 60-char `jobId`, `inputNames` outside the identifier shape or beyond 64, writeOnly / `format: password` / credential-named arguments, values a secret rule masks, echoed values > 64 chars or not one slug, schema walk > depth 6 / 512 names; 300 random 20-64 char tokens always masked.
- Existing pins changed (same commit): ctx now carries `diagnosticVocabulary` when non-empty (`tool-protocol.test.ts`, `args-convention.unit.test.ts`: the echo of `'hello'` is the caller's own word) and the catalog tools' options carry `trustedTokens` (`tool-catalog-tools.test.ts` ×2, `component-catalog-tools.test.ts`).
- **Gate miss to state plainly:** commit `a1c7d960b` (core) passed core tests/guard/check:size but **failed `pnpm check:complexity`** (3 new violations in `diagnostic-vocabulary.ts`); I saw it only when running the ratchet after the mcp part and fixed it in `251e9aca0`. That commit is therefore not green alone.

## Gates (exact command, result)
Setup: Node 24.22.3 (`~/.local/node24`), pnpm 10.33.2 via corepack; `pnpm install --frozen-lockfile` (14 s), `pnpm --no-bail -r build` green. Vitest needs `--pool=forks --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2` (`--maxWorkers=2` alone dies with "minThreads and maxThreads must not conflict").
- BASE (merged tree, before edits): `pnpm guard` ok; mcp 110 files / **1841** tests.
- After S8: mcp 114 files / 1861; after S6: core **3317** (217 files, +23 new), mcp **1880** (117 files). `pnpm guard` ok, `pnpm typecheck` 0 errors, `pnpm check:size` ok (157 debt entries), `pnpm check:complexity` ok (17 entries), at the final tree.
- §4: 4.3, 4.4, 4.5, 4.6, 4.7, 4.15 print nothing. 4.17: one hit `bin/stdio-error-reporter.ts: tracker: { reportError() {} }` (the allowed no-op tracker; the logger still writes every record to stderr). 4.8 (S8): the one lost line is the old `formatDaemonHttpError` doc, reworded on the new function and in `daemon-error-text.ts`; (S6): nothing. 4.16: prints nothing for every changed source file on both ranges.
- `pnpm api:check` not run (red on the base per `tc-wave2a.md`).

## Left / next step
S7 (daemon route sends `details.toolId`/`inputNames`; needs S1, S6: both landed) and S2b (needs S2a, S8, OD-2: all landed) were not started (budget). S7 is the missing server half: without it, a gateway call for a tool this run never described still masks the input names (row 2), as pinned in `masked-identifiers.unit.test.ts`. Next: S7 Jini characterization `delegated-tools.error-details.characterization.test.ts`.

## New Jini exports Tovu consumes (REL)
`@jini-ai/core/text/diagnostic-vocabulary`, `@jini-ai/core/text/masked-identifier-rows`; mcp: `DaemonHttpError.code/requestId/details`, `reportFailure` on `McpToolServerOptions` / `RunToolHostOptions` / `ServeDeps`, `trustedTokens`, `McpToolContext.diagnosticVocabulary/descriptorFor`.

## Overlap with other runs (files)
`packages/mcp/src/server/{daemon-client,tool-protocol,tool-server,run-tool-host}.ts`, `packages/mcp/src/bin/serve.ts`, `packages/core/package.json` (two exports), `.changeset/` (3 new).
