# older-fixes — in progress

Branch: `cloud/older-fixes`. Base: `f4e3b18a5ea67fc7531357aae05c4495dd593bea`.

O01–O08 pending; C11–C30 pending focused traces. C01–C10 excluded as instructed.

Setup: rebuilding Jini from the specified base before relinking Tovu; focused baselines follow.

## Bugs found

- O01: static options use allocated archive folder names.
- O02: export history has no type label.

O03 fixed: collapsed targets include an explicitly supplied nonnegative integer offset, including zero. Chrome follow-up: compare two file reads at different offsets in collapsed chat rows.
Tests: `pnpm --filter @jini-ai/chat exec vitest run src/react/components/__tests__/ToolCard.batch-target.test.tsx` — initial generic-rule edit left specialized Read cards failing; corrected in the follow-up below.
Baseline `pnpm -r build` fails in provider-plugins (fix-round scope). Build excluding provider-plugins also fails in chat on existing test import of @jini-ai/ui-kit/react.

- O03: collapsed targets omit read offsets.

O03 follow-up: specialized Read cards now call the shared target rule too. `pnpm --filter @jini-ai/chat exec vitest run src/react/components/__tests__/ToolCard.batch-target.test.tsx src/react/components/__tests__/ToolCard.test.tsx` — 154 pass (12 + 142).

O06 fixed: every read has a 30-second deadline and caller cancellation; the tool passes its signal. Expiry releases admission, aborts the extraction port and returns a typed actionable failure. PDF teardown interrupts a pending text operation; DOCX checks cancellation around its non-cancellable SDK call.
State cost O06: before, up to 2 concurrent reads × 50 MiB source could occupy admission indefinitely; after, up to 2 admitted reads × 50 MiB plus bounded extraction output, each caller wait ≤30 seconds and one timer/listener per read. Cooperative adapters release resources; synchronous/blocking or non-cancellable third-party work cannot be forcibly terminated on this thread (recorded limitation).
Tests: `pnpm --filter @jini-ai/cms exec vitest run src/media/__tests__/unit/document-text.unit.test.ts src/media/__tests__/document-read-w2g.unit.test.ts src/media/__tests__/unit/document-text-adapters.unit.test.ts src/media/__tests__/unit/unpdf-boundaries.unit.test.ts` — 22 pass after deadline and PDF cancellation red tests.
Types: `pnpm --filter @jini-ai/cms exec tsc -p tsconfig.json --noEmit --pretty false` — pass after fixing exact optional signal typing. Scoped ESLint — pass.
O03 complexity fixed by separating offset formatting; chat tsc passes.
Setup: locked pnpm install in a writable workspace store completed; the complete build now succeeds. No manifest or lockfile edits.

- O06: stalled document reads have no deadline; PDF operations lacked cancellation cleanup.

O07 fixed: subsequent byte-offset pages reuse prepared text under a repository/adapter/workspace/id/hash identity. Every page still checks active document ownership. Fresh first pages force refresh; changed hashes/hosts cannot reuse old bytes. Cache: ≤2 entries, ≤50 MiB combined, 60-second expiry; binary source buffers are not retained after extraction.
State cost O07 before: P page reads × up to 50 MiB source I/O plus P extractions; after: one source read/extraction per cached document followed by P × ≤64 KiB output, plus P small metadata lookups. After expiry/eviction the next page rebuilds once. Memory changes from ≤100 MiB admitted source to ≤100 MiB admitted source + ≤50 MiB cache (adapter workspace excluded in both).
Tests: `pnpm --filter @jini-ai/cms exec vitest run src/media/__tests__/unit/document-read-paging.unit.test.ts` — 7 pass after two source/extraction-count regressions failed. Existing document tests remain green; CMS tsc and document-read ESLint pass.

- O07: following byte offsets reloads/re-extracts the complete source.

Part2 focused checks: C15 scanner boundaries87; C21 staged-closure8; C26 file-lock85; C27 teardown2 all pass. C20 new packed-release-set comparison passes (release-consistency9). C23 secret/alias catalog-to-handler test plus principal/write fixtures43 pass. Detailed cross-repo per-item status will be copied into this report at completion.
C30 confirmed in Tovu: six individual producers each return a preview; every actual two-item production batch drops images under core/batch-tool-inputs.ts's explicit policy. Stopped: a bounded top-level image envelope requires a shared batch/MCP/chat contract change beyond a small ten-minute fix.

- C30: batch media production removes inline preview blocks while preserving saved-media results.
