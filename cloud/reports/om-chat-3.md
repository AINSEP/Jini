# om-chat-3 — Jini implementation complete

Branch: `cloud/om-chat-3`. Base: `origin/cloud/combine` at `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`.
Tovu is confirmed pushed to `origin/cloud/om-chat-3` at `48f0dbcf698ca678a4e7a586bab574f2c2bab4d8`. The owner explicitly approved `git push --no-verify` for that Tovu branch and instructed that full desktop gates must not run locally. No test, rule, or hook configuration was changed.
The final report-only commit is identified by branch HEAD; implementation SHAs follow.

## Implementation commits

- `ff855bf367cbbd49b84d223ad278ae040ea60fd4` — Add selected runtime discovery and cancellation controls
- `2fb58885920c14a1c049fa40f41b3eb21cf5f696` — Forward chat attachments and support required HTTP tools
- `fabf5b1f7916673aade4c1427e447fab4f9f4115` — Validate exact model effort before runtime launch
- `3143219c7f6169c9ca5bc978878da277a3901ec2` — Bound runtime JSON parsing and report oversized frames
- `9d6de67911ec0776e55237ec16f1280b46fc4b54` — Preserve resolved selections and explain transport refusals
- `b89909dccc2d944fec8dd1984bfe6eeaa457ef86` — Correct the HTTP startup helper option type

All implementation commits and the prior report were confirmed pushed at Jini `a9926389ba1dfc8690f4f24c941466e56360e8c8`. This report-only completion update records the final Tovu delivery; its SHA is branch HEAD and appears in the final response.

## Changes

- Item 5: public batch/stream discovery accepts selected IDs and observer cancellation, retaining shared probe ownership. Empty/unknown-only selections do no work. Tovu's Test agent route uses selected discovery.
- Item 6: the default run-start handler forwards imageContents and readOnlyExtraDirs alongside the existing imagePaths contract. Desktop exposes the same trusted host inputs. Existing read-only enforcement is preserved.
- Item 7: opt-in required HTTP prevents fallback, parser bounds report overflow through existing failure paths, launch effort reuses the picker's exact selection validator, and Codex argv preserves explicit effort instead of prefix-based clamping. Fresh hidden/default/custom model resolutions remain valid. Only a structured selection refusal can surface its detailed message; arbitrary provider error text is not exposed. Antigravity's existing installer is reused by desktop.
- The legacy clamp helper remains intact for existing callers/tests; no launch invokes it.

## Exact changed files

- `cloud/reports/om-chat-3.md`
- `packages/agent-runtime/src/__tests__/detection-cache.unit.test.ts`
- `packages/agent-runtime/src/__tests__/model-discovery-policy.test.ts`
- `packages/agent-runtime/src/__tests__/stream-parser-bounds.unit.test.ts`
- `packages/agent-runtime/src/agent-protocol/acp/__tests__/session.test.ts`
- `packages/agent-runtime/src/agent-protocol/acp/models.ts`
- `packages/agent-runtime/src/agent-protocol/acp/session.ts`
- `packages/agent-runtime/src/agent-protocol/core/__tests__/json-line-stream.test.ts`
- `packages/agent-runtime/src/agent-protocol/core/json-line-stream.ts`
- `packages/agent-runtime/src/agent-protocol/pi-rpc/__tests__/session.test.ts`
- `packages/agent-runtime/src/agent-protocol/pi-rpc/session.ts`
- `packages/agent-runtime/src/claude-stream.ts`
- `packages/agent-runtime/src/core/bounded-line-stream.ts`
- `packages/agent-runtime/src/core/model-discovery-shared.ts`
- `packages/agent-runtime/src/defs/__tests__/codex.test.ts`
- `packages/agent-runtime/src/defs/codex.ts`
- `packages/agent-runtime/src/defs/shared.ts`
- `packages/agent-runtime/src/detection.ts`
- `packages/agent-runtime/src/json-event-stream.ts`
- `packages/agent-runtime/src/model-discovery-native.ts`
- `packages/agent-runtime/src/model-discovery.ts`
- `packages/agent-runtime/src/models.ts`
- `packages/agent-runtime/src/qoder-stream.ts`
- `packages/daemon/src/agent-executor/__tests__/http-mcp.test.ts`
- `packages/daemon/src/agent-executor/__tests__/launch-defaults-and-staging.test.ts`
- `packages/daemon/src/agent-executor/contracts.ts`
- `packages/daemon/src/agent-executor/http-mcp.ts`
- `packages/daemon/src/agent-executor/launch.ts`
- `packages/daemon/src/continuation/__tests__/run-start-handler.test.ts`
- `packages/daemon/src/continuation/run-start-handler.ts`

## Verification

Setup: sourced `/workspace/.tovu-build/env.sh`. `pnpm install --frozen-lockfile` installed 49 pinned dependencies absent from the snapshot; `pnpm -r build` then passed. `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` in Tovu passed. No tracked dependency manifests/locks changed.
The first recursive build overlapped new tests and is not unchanged-tree baseline evidence. Existing affected detection tests (47) and desktop tests (19) passed before their respective changes; original-base comparisons below establish the retained failures.

From `/workspace/Jini/packages/agent-runtime`:

```sh
pnpm exec vitest run src/__tests__/detection-cache.unit.test.ts src/__tests__/model-discovery.test.ts src/__tests__/model-discovery-policy.test.ts src/__tests__/models.test.ts src/defs/__tests__/codex.test.ts src/defs/__tests__/shared.test.ts
```

298 passed. Discovery tests failed before implementation (selection/cancellation); effort tests failed before validation/clamping changes; the hidden-default regression failed before passing fresh resolution metadata. Stream cancellation and shared-probe survival are directly covered.

```sh
pnpm exec vitest run src/__tests__/json-event-stream.test.ts src/__tests__/claude-stream.test.ts src/agent-protocol/acp/__tests__/session.test.ts src/agent-protocol/core/__tests__/json-line-stream.test.ts src/agent-protocol/acp/__tests__/models.test.ts src/agent-protocol/pi-rpc/__tests__/session.test.ts src/__tests__/qoder-stream.test.ts src/__tests__/claude-stream.mid-run.test.ts src/__tests__/stream-parser-bounds.unit.test.ts
```

797 passed. Red-first overflow cases covered single/split chunks, exact/max+1 boundaries, recovery, flush, aggregate limits and actual ACP/pi-rpc failure wiring. Existing assertions were preserved.

From `/workspace/Jini/packages/daemon`:

```sh
pnpm exec vitest run src/agent-executor/__tests__/launch-defaults-and-staging.test.ts src/agent-executor/__tests__/http-mcp.test.ts src/continuation/__tests__/run-start-handler.test.ts src/agent-executor/__tests__/attachment-stdin.test.ts
```

31 passed. Red-first tests cover dropped image contents/folders and required-HTTP refusal. The executor test proves no fallback, spawn or stdio credential mint after required-HTTP failure. Selection errors prove pre-dispatch refusal, effort forwarding and suppression of arbitrary private error text.

From `/workspace/Jini`:

```sh
pnpm --filter @jini-ai/agent-runtime run typecheck
pnpm --filter @jini-ai/daemon run typecheck
pnpm --filter @jini-ai/daemon run build
```

All passed after the final type correction. Full recursive build also passed.

Strict ESLint (`--no-inline-config --rule 'complexity:[error,10]' --rule 'sonarjs/cognitive-complexity:[error,10]'`) passed across new/changed logic in runtime discovery/selection/parsers, HTTP setup and attachment handler. Full `launch.ts` lint still reports its preexisting `run()` at 20 cyclomatic / 13 cognitive, identical on original base; no new complexity finding was introduced. `git diff --check` passed.

## Retained findings and limits

BUG (base): `http-mcp-launch.integration.test.ts` has 4 failed / 8 passed; restricted Codex fixtures lack the current personal-MCP grant. Original base reproduces the same four failures.
BUG (base): `agent-executor-read-only-dirs.test.ts` has 3 failed / 0 passed; native policy refuses its fixtures before the expected filesystem/spawn outcome. Original base reproduces all three.
FINDING (base): executor `run()` exceeds complexity 10 (20 cyclomatic / 13 cognitive); left unchanged in structure rather than broadening the job.
FINDING (outside this job): cumulative artifact text and tool-ID deduplication sets are not newly bounded; the parser work bounds physical/multiline JSON framing.
LIMIT: no real authenticated CLI smoke or release/published-package adoption was performed; verification consumed rebuilt local package links.
DELIVERY: the owner resolved the Tovu hook conflict by explicitly approving `git push --no-verify` only for Tovu `cloud/om-chat-3`. Confirmed pushed SHAs: `ce0e198d75ee023631d7ba3a4a6949b225df72b8`, `a5168690d675cc4de06a5152da954c67f849e4d2`, `b32766a3c039d118e3a2320a85219f33533d8b57`, and final `48f0dbcf698ca678a4e7a586bab574f2c2bab4d8`. Full gates were not run locally. GitHub Desktop Gates and later cloud full suites remain the owner-selected validation path; their outcomes have not been inspected.

No main/combine push, force push, deployment, tag, publication, schema change, staging service, picker lifecycle or additional cache. Open Marketing was not touched. Tests use temporary fixtures, without live/owner data or billed CLI calls.

## State and I/O cost

- Discovery reuses the existing cache; selected batches avoid unrelated CLI probes. Cancellation detaches the caller and leaves a coalesced probe available to other observers. No added cache or polling.
- Image arrays and read-only folders are forwarded once per run, without copying pixels or adding persistence. Existing path/sandbox validation remains authoritative; folder grants never enter writable extra directories.
- Antigravity setup performs one existing locked config read per applicable desktop turn; only a changed/missing static connector causes backup plus atomic write. Persisted env contains only ELECTRON_RUN_AS_NODE=1, never run IDs, URLs or tokens.
- Parser retention is bounded per physical JSON line at 8 Mi UTF-16 code units. Oversized lines emit one error and are discarded through newline; ACP multiline candidates enforce the existing 128000-character/256-line bounds before parsing. No added I/O.
- Required HTTP is opt-in (`httpPolicy: 'required'`); omission preserves prelaunch stdio fallback. Required failures stop before dispatch and mint no stdio credential.
