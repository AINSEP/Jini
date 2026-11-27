# Jini extraction commit plan

Prepared against `codex/x9pluginsj` at `f36ab47ba97ad2f7deb102fe7b80ff4f3f43d06c`.
Changes remain in the working tree; no commits or Git metadata writes were made.
No tests, builds, installs, type-checks, linters, API generation, or mutation probes ran.

## 1. CC-01.J — prepared: publish compatibility type

Proposed commit: `refactor(core): expose publish compatibility contract`

Files touched:

- Created `packages/core/src/contracts/site/__tests__/custom-credential-publish-compatibility.test.ts` first.
- Created `packages/core/src/contracts/site/custom-credential-publish-compatibility.ts`.
- Updated `packages/core/package.json` with the exact types/import/default export and universal classification for `./contracts/site/custom-credential-publish-compatibility`.

The source interface's comments are preserved, including preparation before the credential write and no dependency loading afterward. Only the integrations return-type lookup is resolved to the existing core `CredentialSetSummary` callback shape.

Characterization: one new test, zero removed tests. Exact type-equality pins cover the required workspace argument, optional empty-object argument, and awaited post-write callback. `CC-PrepareDropsPostWriteCallback` (`Promise<void>`) must fail the callback pin during cloud type-checking; ordinary Vitest execution does not prove erased types. Neither green nor mutation-red results are claimed.

No implementation moved and no callers were repointed in this Jini-only sheet. CC-01.T can consume `@jini-ai/core/contracts/site/custom-credential-publish-compatibility` after cloud verification. Cloud must generate the additive `api-baseline/jini-ai__core.json` change with `pnpm api:update`.

Final scope review: no out-of-sheet additions retained; deletions: none.

## 2. AP-01.J — STOPPED: universal entry requires Node imports

Files touched: none.

The required `../lifecycle/host-tools/identity.js` source, `packages/agent-plugins/src/lifecycle/host-tools/identity.ts`, statically imports `node:fs/promises` and `node:path`. The sheet requires universal `./site/soon-lock`, but that exact import brings Node dependencies into its module graph. A split of the identity module or a different runtime classification is not authorized. No test, destination, export, or isolation entry was added. AP-01.T remains blocked; no Soon-lock subpath is supplied by this patch.

## 3. PR-01.J — STOPPED: tokenizer inventory differs

Files touched: none.

At Tovu `origin/integ/merge-21-2026-11-24`, `apps/website/src/features/plugin-runtime/built-ins/word-count/__tests__/unit/word-count.unit.test.ts` contains ten tokenizer tests before the manifest and runtime-source tests. The sheet requires nine transplanted cases and does not identify a case to omit. The tenth tokenizer case is `RT-005: nested content (a blockquote containing a paragraph containing text) is walked depth-first regardless of nesting depth`. Choosing a subset or transplanting ten would change the specified test inventory. No test, destination, or export was added. PR-01.T remains blocked; no word-count subpath is supplied by this patch.

## 4. XM-01.J — left: OPUS-CLOUD

Files touched: none. Not dispatched for this job; paired XM-01.T also left.

## 5. AC-01.J — left: OPUS-CLOUD

Files touched: none. Not dispatched for this job; paired AC-01.T also left.

## 6. PK-01.J — left: OPUS-CLOUD

Files touched: none. Not dispatched for this job; paired PK-01.T also left.

## 7. PK-02.J — left: OPUS-CLOUD

Files touched: none. Not dispatched for this job; paired PK-02.T also left.

## 8. PR-02.J — left: OPUS-CLOUD

Files touched: none. Not dispatched for this job; paired PR-02.T also left.

All Tovu files remain untouched. No generated API baselines, dependency changes, lockfile changes, compatibility shells, or root-barrel repoints were made.
