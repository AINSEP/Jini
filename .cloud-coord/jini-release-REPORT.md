# Jini release candidate report — cloud/jini-release-2026-10-22 @ f79301c9
Node 24.22.0, pnpm 10.33.2, --maxWorkers=2, coverage off.

**VERDICT: NOT READY TO PUBLISH** — 3 test failures (agent-runtime, core, integrations); `@jini-ai/chat-react` does not exist in the repo.

## Build
`pnpm --no-bail -r build`: exit 0, no failures.

## Tests (passed / failed / skipped)
- admin 2799/0/0
- agent-runtime 4142/1/1  FAIL
- agentic 1474/0/0
- capability-providers 221/0/0
- charts-recharts 85/0/0
- chat 3609/0/1
- chat-react: NOT RUN — no packages/chat-react dir; `--filter` matched no project
- cms 3987/0/0
- core 1407/1/0  FAIL
- daemon 3514/0/0
- devops 1001/0/0
- http-kit 531/0/0
- infra 64/0/0
- integrations 1886/1/0  FAIL
- mcp 1317/0/0
- platform 2497/0/6
- protocol 92/0/0
- server 410/0/1
- ui 8680/0/0 (first run hit my 600s cap mid-run; rerun alone passed)
- user-management 1047/0/0

## Failing tests
1. agent-runtime: src/__tests__/integration-contracts.test.ts > "declares each subpath runtime and both declaration resolution paths"
   AssertionError: expected { @jini-ai/core, @jini-ai/oauth, ... } to deeply equal { @jini-ai/core, @jini-ai/oauth }
   (package.json deps/declarations now include an extra dependency the test doesn't expect)
2. core: src/__tests__/source-neutrality.test.ts > "all package source rejects host paths and product references"
   Offending: packages/core/src/redact.ts: "Tovu"; packages/core/src/__tests__/security-vocabulary.test.ts: "Tovu"
   (from commit 22f0619e, core security vocabulary — product name in neutral core)
3. integrations: src/saved-requests/__tests__/schema.test.ts:27 > "the installed validator enforces enum, numeric, array, nested closure and required contracts"
   Error: Instances of "undefined" type are not supported. (@cfworker/json-schema 4.1.1 validate.js:43; test input contains an undefined value)
   (from commit 9b301433, saved-requests J2)

## Typecheck
`pnpm --if-present run typecheck` on the 19 existing packages: exit 0, no errors.

## Skipped / notes
- chat-react missing (see above). Not verified whether the publish list is wrong or the package was renamed/folded.
- No source changed; only this file committed.
