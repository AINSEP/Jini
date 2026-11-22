DONE 554b7fde

# ex2-holds-jini (2026-11-22): RT-1, RT-2, C-contracts-core-1 held file, C026

Unattended cloud run, Opus high. Items 1–3 landed in Jini. Item 4 (C026) is Tovu-only, so no Jini change was made for it. No subagents, no codebase-memory tools, no force-push, no `--no-verify`. Nothing was published and no tag was pushed. Only `codex/ex2-holds-jini` was pushed, with a plain `git push` after `git pull --rebase`.

## Branch and SHAs

Jini `codex/ex2-holds-jini`, base `origin/integ/merge-13-2026-11-22` `7c4ee7881`.

| item | commit |
|---|---|
| 1 RT-1 retire `@jini-ai/sqlite` | `89f0c9ecf` |
| 2 RT-2 retire `@jini-ai/infra/db/{core,driver,sqlite}` | `ceacf0844` |
| 3 C-contracts-core-1 held file → `@jini-ai/core/extension-capability-vocabulary` | `bd407c02f` |
| gate follow-ups for 1–3 (guard self-test fixture, core `jini.entries`, why-comments debt) | `24e1f7b9a` |
| this report + raw outputs | the commit after `24e1f7b9a` |

Tovu was read only. Nothing was pushed to it.

## Consumer check (items 1 and 2)

- **Jini:** before the change, no package, example or script imported `@jini-ai/sqlite` or `@jini-ai/infra/db/*`. Every hit was a comment, a doc, a manifest, or the packages' own tests.
- **Tovu `origin/integ/merge-12-2026-11-22`:** `git grep '@jini-ai/sqlite'` and `git grep '@jini-ai/infra/db'` outside `ADS-memory/` and `cloud-results/` find **no import**. The only hits are:
  - comments naming the old `@jini-ai/sqlite-chat` package: `apps/desktop/src/contracts/workspace-conversations.ts:5`, `apps/desktop/src/site-dir-store.ts:16`, `apps/desktop/src/tracked-sites.ts:4`, `apps/website/src/assistant/__tests__/tool-catalog-query.test.ts:10-11`, `apps/website/src/features/post/{search-index.memory.ts:17, search-index.sqlite.ts:9, search.ts:24}`;
  - `apps/website/src/assistant/persistence/__tests__/release-manifests.test.ts:17-18`, which asserts that `@jini-ai/sqlite` and `@jini-ai/sqlite-chat` are **absent** from a manifest. It stays true.
- **Tovu consumer inventory (complete, review RT-2 FIX 3; Tovu `41e948ee4a`):** there are **zero** consumers of the removed DB shims (`@jini-ai/infra/db/*`). Tovu's root `package.json:153` declares `@jini-ai/infra` (`^0.7.3-next.2`) for the retained `./events/outbox` export, which is unchanged. That export is used by exactly these six files under `apps/website/src/`:
  - `contracts/core/events/enqueue-only-outbox.ts:2`
  - `contracts/core/events/jini-outbox-adapter.ts:3`
  - `contracts/core/events/outbox-drainer.ts:3`, `:32`, `:34`
  - `contracts/core/events/outbox-retry-policies.ts:2`
  - `contracts/core/events/outbox-worker.ts:3`, `:33`, `:44`, `:56`
  - `server/runtime/composition/__tests__/form-delivery-vertical-slice.integration.test.ts:9`

  (Re-checked with `git grep '@jini-ai/infra' 41e948ee4a -- apps/website/src package.json`: the only other hits, `outbox-worker.ts:30` and `:59`, are doc comments.)
- **Tovu follow-up (optional, comments only):** reword those comment lines to name the real owner, as Jini now does: `@jini-ai/chat/store/sqlite` for chat history, `@jini-ai/registry/tool-catalog/sqlite` for the tool catalog, `@jini-ai/db/sqlite` for inspect/integrity, `@jini-ai/daemon/store/event-log/sqlite` for the event log. No Tovu import changes.

## Item 1 — RT-1: retire `@jini-ai/sqlite` (`89f0c9ecf`)

**What changed**
- Deleted `packages/sqlite/` (re-export barrel, README, docs, tests) and `api-baseline/jini-ai__sqlite.json`.
- Removed its `knip.json` workspace, its sonar source path, its `CAPABILITIES.md` section and its `packages/README.md` native-deps row.
- Removed the `"@jini-ai/sqlite": patch` line from the pending `.changeset/core-storage-contract.md`. Changesets refuse a removed package.
- Removed its four Q2 L5 rows from `scripts/injection-exceptions.json`.
- Reworded 35 comment lines in artifacts, capability-providers, chat, daemon, integrations, protocol, registry and server. They named `@jini-ai/sqlite` or its older name `@jini-ai/sqlite-chat`. Each one now names the real owner subpath and keeps its reason.
- Changed one historical link in `packages/core/docs/spec/refresh-report.md` to plain text, since its target was deleted.
- **LOCK:** ran `pnpm install`. `pnpm-lock.yaml` drops the `packages/sqlite` importer (−22 lines).
- **Changeset:** `.changeset/rt1-retire-sqlite.md`.
  - `@jini-ai/db` major. A removed package cannot carry its own changeset. db owns most of what the facade forwarded, and the note lists every replacement subpath. Majors were already pending in the fixed group (`r13b-legacy-owner`, `core-observability-contract`).
  - Patch for each comment-only package.

**Tests (written first, red before the delete)**
- `scripts/__tests__/injection-exceptions.q2.test.ts` now also asserts no `sqlite` exception, no `packages/sqlite` and no sqlite api-baseline. It was then rewritten again for RT-2.

**Mutation (named):** re-add `{"owner":"sqlite","target":"db",…}` to `scripts/injection-exceptions.json`.
- Result: 2 of 6 red ("lists exactly the infra package edge", "keeps no exception, workspace or surface baseline for the deleted sqlite forwarder").
- Reverted: 6/6 green.

## Item 2 — RT-2: retire the `@jini-ai/infra/db/*` shims (`ceacf0844`)

**What changed**
- Deleted `packages/infra/src/db/{core,driver,sqlite}/index.ts`.
- Deleted the shim-only tests `shim-surface.test.ts` and `args-convention.dbpkg-infra.test.ts`. They exercised db's helpers through the shim; `@jini-ai/db`'s own tests already cover them (`core/artifact-naming.test.ts`, `sqlite/db-ops.test.ts`, `loads-without-driver.test.ts`, …).
- Updated `packages/infra/package.json`:
  - removed the `./db/core` and `./db/sqlite` exports and their `typesVersions`;
  - removed the `@jini-ai/db` optional peer, `peerDependenciesMeta`, devDependency and `jini.optionalPeers`;
  - removed `jini.neutralEntries: ["src/db/core"]`;
  - removed the `deprecated` notice, since the package is now only the live outbox owner.
- `./events/outbox` stays. Tovu `form-delivery-vertical-slice.integration.test.ts:9` imports it.
- README now opens with the outbox and the old→new import map.
- Each of the five `docs/spec/*.md` gets an RT-2 notice that the shim text is historical. The specs were not re-derived.
- Rewrote the outbox barrel's header comment so it no longer mentions the shims. The reason is kept.
- `CAPABILITIES.md`: the infra rows now describe `./events/outbox`. The "used by" columns of db/core and db/sqlite no longer list infra or sqlite.
- `packages/db` tests: renamed only the two describe strings (`@jini-ai/infra/db/core barrel` → `@jini-ai/db/core barrel`, and the same for sqlite).
- `scripts/injection-exceptions.json` is now `"exceptions": []`, with the reason in `_comment`.
- `scripts/__tests__/check-package-layers.injection.test.ts` now expects no exceptions.
- `scripts/check-package-layers.ts`: dropped `sqlite: 6` from the layer table.
- `scripts/lib/self-test.ts`: two comments now say the `infra-like` fixture mirrors the retired shim shape. The fixture is unchanged.
- **LOCK:** ran `pnpm install`. `pnpm-lock.yaml` drops infra's `@jini-ai/db` devDependency (−3 lines).
- **Changeset:** `.changeset/rt2-retire-infra-db-shims.md`. `@jini-ai/infra` major with the full replacement list; `@jini-ai/db` patch for the describe strings.
- `api-baseline/jini-ai__infra.json` refreshed by `pnpm api:update`.
- The `infra → db` cross-package pair is gone.

**Tests (written first; both red before the change)**
- `packages/infra/src/__tests__/merge-surface.dbpkg-infra.test.ts` checks four things: exports are exactly `['./events/outbox']`, `typesVersions` holds only `events/outbox`, there is no `@jini-ai/db` peer, and there is no `optionalPeers` entry.
- `packages/infra/src/__tests__/optional-db-peer.test.ts` installs physical copies of core and infra without db. The outbox still works there, and `@jini-ai/infra/db/core` and `/db/sqlite` both fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- `scripts/__tests__/injection-exceptions.q2.test.ts` is rewritten (4 tests):
  - no exceptions at all, and the "never add one to silence the gate" rule is kept;
  - no sqlite or infra debt allowance;
  - no sqlite workspace, sqlite api-baseline or infra `src/db`;
  - a **re-added infra db shim surfaces as an L5 edge** in a fixture root now that nothing excuses it.
- Infra suite: 13 files, 147/147 green.

**Mutation (named):** restore `exports["./db/core"]` in `packages/infra/package.json`.
- Result: 2/2 red (manifest pin, and the physical-install test, because the entry resolves again).
- Reverted: green.

## Item 3 — C-contracts-core-1's held file (`bd407c02f`)

**The hold:** `extension-capability-vocabulary.ts` was held under STOP 5 in `cloud-results/ex-core.md`, on Tovu `origin/codex/ex-core-tovu`, lines 59-64.
- The guard is the Tovu test `apps/website/src/contracts/core/__tests__/unit/extension-capability-vocabulary.unit.test.ts:27-28`.
- Its `SHARED_IMPORT_PATTERN` requires `plugin-runtime/host-binding.ts` to import `SHARED_EXTENSION_CAPABILITIES` from the relative path `../../contracts/core/extension-capability-vocabulary.js`.
- The guard exists to catch a private re-declaration of the three strings in the host binding. A value comparison cannot catch that.

**What changed in Jini**
- Moved the file to `packages/core/src/extension-capability-vocabulary.ts` and exported it as `@jini-ai/core/extension-capability-vocabulary` (dist triple, `jini.entries` universal).
  - **Not** under `src/contracts/site/` as the sheet said: the file holds a runtime `Object.freeze([...])`, and the owner rule XP4 bars runtime code under core `src/contracts`.
  - It sits beside `host-read-vocabulary.ts`, the existing precedent for a policy-vocabulary module at core's root.
- **Verbatim except three doc-comment literals** (log these in `plans/P9-BREAKS.md`):
  - `Tovu's two extension mechanisms` → `a host's two extension mechanisms`. Guard N1 forbids `/tovu/i`.
  - `` `Jini/packages/plugins/src/host/manifest.ts`, `Jini packages/plugins/src/glue/manifest.ts` `` → `` `packages/plugins/src/host/manifest.ts`, `packages/plugins/src/glue/manifest.ts` ``.
  - `same "policy constant core/ module" shape as ./runtime-mode.ts` → `a "policy constant core/ module", kept out of src/contracts because the frozen array is a runtime value`. `runtime-mode.ts` does not exist in core.
  - Code, types and the other why-comments are unchanged.
- New test `packages/core/src/__tests__/extension-capability-vocabulary.test.ts` (3 tests): the exact three values in order, frozen (push throws), and the published subpath triple.
- `CAPABILITIES.md` row; `.changeset/core-extension-capability-vocabulary.md` (`@jini-ai/core` minor); `api-baseline/jini-ai__core.json` via `pnpm api:update`.

**Mutation (named):** drop `Object.freeze` from the array.
- Result: 1/3 red ("is frozen…").
- Restored: 3/3 green.

**Guard-regex change (Tovu, not applied: Tovu is read-only in this run).** The smallest change is to swap the relative specifier for the Jini specifier and keep everything else:

```ts
// apps/website/src/contracts/core/__tests__/unit/extension-capability-vocabulary.unit.test.ts:27-28
const SHARED_IMPORT_PATTERN =
  /import\s*\{[^}]*SHARED_EXTENSION_CAPABILITIES[^}]*\}\s*from\s*["']@jini-ai\/core\/extension-capability-vocabulary["'];?/;
```

Checked both ways against the real `host-binding.ts` (Tovu `codex/ex-core-tovu`); script and output are in `cloud-results/ex2-holds-jini-raw/regex-check.{mjs,txt}`:

| fixture | old regex | new regex |
|---|---|---|
| moved host-binding (Jini specifier) | no match | **match** (passes) |
| original host-binding (relative specifier) | match | no match |
| BAD: import removed, array re-declared as a private literal | no match | **no match** (still fails) |
| BAD: imported from some other module | no match | no match (still fails) |
| BAD: imported from a look-alike subpath `…-vocabulary-copy` | no match | no match (still fails) |

**Tovu follow-up for item 3 (exact lines on `origin/integ/merge-12-2026-11-22`):**
1. `apps/website/src/features/plugin-runtime/host-binding.ts:10` → `import { SHARED_EXTENSION_CAPABILITIES } from "@jini-ai/core/extension-capability-vocabulary";`
2. `apps/website/src/contracts/core/__tests__/unit/extension-capability-vocabulary.unit.test.ts:7` → `import { SHARED_EXTENSION_CAPABILITIES } from "@jini-ai/core/extension-capability-vocabulary";`
3. Same file, `:27-28`: the regex above.
4. Same file, `:39`, message text: `from core/` → `from @jini-ai/core`. Optional; wording only.
5. Delete `apps/website/src/contracts/core/extension-capability-vocabulary.ts`.

The test can stay where it is. It reads `host-binding.ts` by a path relative to itself, which does not change. No other Tovu file imports the module.

## Item 4 — C026 vendor names: Tovu-only, not touched

- `bundled-catalog.ts` and `shared-owner.ts` exist only in Tovu:
  - `apps/website/src/features/agent-plugins/bundled-catalog.ts`. Lines 45-49 are the `SELECTED_AGENT_PLUGIN_PACKAGES` vendor id list; line 57 is `HOST_SOON_AGENT_PLUGINS`.
  - `apps/website/src/features/api-connections/shared-owner.ts:81` (near `createSharedOAuthLabels`).
- Jini has neither file (`git ls-files` finds none). Per the brief, these are left for the Tovu run.

## Gates (base = unmodified merge-13 tree; after = branch head)

| gate | base | after |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 0 (after the two lockfile updates above) |
| `pnpm --no-bail -r build` | 0 | 0 |
| `pnpm typecheck` | — | 0; `tsc -p scripts/tsconfig.json` re-run after the last scripts edit: 0 |
| `pnpm guard` | ok | ok (see the self-test fix below) |
| `pnpm api:check` | 0 | 0 |
| `check:size` | red | red, identical New-violation and stale lines |
| `check:complexity` | red (3 new) | red, identical |
| `check:why-comments` (base ref `origin/refactor/terra`) | 10 blocks | 10 blocks (same) |
| `check:hooks` | 0 | 0 |
| `check:errors` | 0 | 0 |
| cross-package | 760 lines | 760 lines, identical after sort |

Notes on the gates:
- **Cross-package was run with `--base origin/integ/merge-13-2026-11-22`.** The pinned `35c4961af` is not in this shallow clone. The XP3 declaration snapshot was written from a clean merge-13 worktree with `--write-baseline` and passed as `JINI_DECLARATION_BASELINE_DIR`.
- **First full run, before `24e1f7b9a`: three new reds.**
  - The guard self-test failed: `publish-hygiene-self-test.ts` used a `sqlite` package as its layer-6 same-level fixture. `infra`, also layer 6, takes that fixture over with the same assertion, so coverage is unchanged.
  - Guard R8 failed: core `jini.entries` lacked the new subpath.
  - why-comments went from 10 to 34 blocks: 24 deleted blocks, 23 unique ids. 21 went with deleted files; 3 were reworded in place. 23 reasoned entries were added to `scripts/why-comments-debt.json`.
  - All three are fixed in `24e1f7b9a`.

**Tests**

| suite | result |
|---|---|
| core | 217 files, 2974/2974 |
| infra | 13 files, 147/147 |
| db | 114 files, 950/950 |
| artifacts | 242/242 |
| capability-providers | 198/198 |
| protocol | 795/795 |
| registry | 392/392 |
| chat | 4508 passed, 1 skipped |
| daemon | 4854 passed, 1 skipped |
| integrations | 2077/2077 |
| server | 469 passed, 1 skipped |

- No Jini package depends on `@jini-ai/infra`. Core's dependents are not run in full: core's only change is an additive new subpath, and the dependents that are changed packages (chat, daemon, db, infra, server, …) are run above.
- `vitest run scripts/__tests__`:
  - base: 10 failed, 987 passed, 54 skipped (1051);
  - after: 10 failed, 982 passed, 54 skipped (1046).
  - **The same 10 tests fail on both.** The −5 is the Q2 test going from 9 tests (5 per-edge `it.each`) to 4.
- `test:scripts:node`: 43/46 on both, the same 3 failures. That includes the infra-retirement integration test, which is red by design.
- Raw outputs are in `cloud-results/ex2-holds-jini-raw/`.

## For the owner

1. **RT-1 changeset:** the major is recorded on `@jini-ai/db`, because the removed package cannot carry one. Change the target if another owner should carry it.
2. **Item 3 destination:** it lives at `@jini-ai/core/extension-capability-vocabulary`, not `contracts/site/…` as the sheet said (XP4). Update the C-contracts-core-1 sheet and `stays-in-tovu`/scanner inputs so FILES-LEFT drops by one when Tovu applies the follow-up.
3. **Infra spec files:** they got an RT-2 notice, not a rewrite. They were already stale on base: they say the outbox has no export.

## Review fixes

Review: Tovu `origin/plan/whats-left-1122:reviews/ex3-review-c0b-holds-jini.md` (Codex 6.2). Code fixes are in `554b7fde`; RT-2 FIX 3 and this section are in the report commit on top of it. C026 was APPROVED for Jini, so nothing changed for it here.

### RT-1 · Retire `@jini-ai/sqlite`

- **FIX 1** `.changeset/rt1-retire-sqlite.md:13`: the migration note now names the deleted barrel's type owners: `ChatSessionMode` from `@jini-ai/chat/store/legacy`, and `ToolCatalogEntry` and `ToolCatalogSearchHit` from `@jini-ai/registry/tool-catalog`. These were checked against the deleted `packages/sqlite/src/index.ts` at base, plus `chat/src/store/legacy/index.ts:2` and `registry/src/tool-catalog/index.ts:2,11`. The SQLite subpaths stay listed for their runtime exports, and `@jini-ai/registry/tool-catalog/sqlite` is now labelled "(tool-catalog runtime)". `npx changeset status`: rc 0.
- **FIX 2** `packages/capability-providers/src/unsafe-reference/db.ts:9`: the real-adapter example is now `SqliteDbProvider` from `@jini-ai/capability-providers/adapters/sqlite`, the sibling that `implements DbProvider` (`adapters/sqlite/index.ts:54`). It replaces the chat store. Comment only.

### RT-2 · Retire `@jini-ai/infra/db` shims

- **FIX 1** `scripts/__tests__/injection-exceptions.q2.test.ts:47-62`: the re-added-shim case now pins the source edge itself. The gate output must contain `{ rule: 'L5-injected-edge', file: 'packages/infra/src/db/sqlite/index.ts', reason: …'→ @jini-ai/db/sqlite' }`. Because `LayerViolation` carries no kind, `collectInjectionFindings` must also contain `{ rule: 'L5-injected-edge', file: 'packages/infra/src/db/sqlite/index.ts', spec: '@jini-ai/db/sqlite', kind: 'export-from' }`. The `found.length` count is gone, since the forbidden manifest peer alone satisfied it. Test count is unchanged: 4 cases, assertions strengthened inside the existing one.
  - Mutation: the scanner drops re-exports (`scripts/lib/import-sites.ts`, `runtimeImportReferences(…).filter(ref => ref.syntax !== 'export')`).
    - New test: **1 failed | 3 passed** (`AssertionError: expected [ { rule: 'L5-injected-edge', …(2) } ] to deep equally contain ObjectContaining{…}`).
    - Old test under the same mutation: **4 passed**. This is the gap the review named.
    - Restored with `git checkout --`: 4/4, tree clean.
- **FIX 2** `packages/db/src/core/ports.ts:10-12`: the driver-neutrality comment now points to `@jini-ai/db` / `@jini-ai/db/core`. The obsolete `@jini-ai/infra/db/core` recommendation is gone. The R12 explanation (`pnpm guard` walks the closure, fails on a driver folder or package, `scripts/check-driver-isolation.ts`) is kept word for word. Comment only.
- **FIX 3** `cloud-results/ex2-holds-jini.md:27-35`: the complete Tovu consumer inventory is recorded. There are zero consumers of the removed DB shims. `package.json:153` declares Infra for the retained outbox, used by the six `apps/website/src/` files at the lines the review lists. Re-verified with `git grep` at Tovu `41e948ee4a`; it matches exactly, and the only extra hits are 2 doc comments.

### C-contracts-core-1

- **FIX 1** `.changeset/core-extension-capability-vocabulary.md:2`: `"@jini-ai/core": minor` → `patch` (P9 §1 extraction rule). `npx changeset status` rc 0.

### Gates after the fixes

Setup was a fresh install on this branch (`pnpm install --frozen-lockfile` ok; the lockfile was not touched by the fixes) and `pnpm -r build` rc 0. Then `pnpm --filter '...@jini-ai/db' --filter '...@jini-ai/capability-providers' -r build` (changed packages + dependents, 20 packages) rc 0.

| gate | head | base `origin/integ/merge-13-2026-11-22` | delta |
|---|---|---|---|
| `pnpm typecheck` | rc 0 | — | — |
| `pnpm guard` | ok, 0 violations, self-test passed | — | — |
| `pnpm api:check` | rc 0 (39 packages, 688 entries, 17169 symbols) | — | — |
| `pnpm check:hooks` | rc 0 | — | — |
| `check:size` / `check:complexity` / `check:why-comments` | rc 1 | rc 1 | identical output |
| `check:cross-package` | rc 1 | rc 1 | identical except the logged `pid` |
| `npm --prefix packages/db run test` | 114 files, 950 passed | — | — |
| `npm --prefix packages/capability-providers run test` | 18 files, 198 passed | — | — |
| `npx vitest run scripts/__tests__` | 8 failed / 978 passed / 54 skipped (1040) | — | — |

**Pre-existing script failures.** The 8 failures are in 8 files: `check-env-access`, `check-why-comments.test.mjs`, `connection-card.packed`, `coupling-isolation`, `extract-s3-source-contracts`, `fetch-query-isolation`, `leaf-import-closures` and `optional-peer-contract`. None of these files was touched. They are not caused by the fixes: running the same files with the fix files reset to the pre-fix tip `e2f61dd0` gives the identical **8 failed | 67 passed | 21 skipped**. `injection-exceptions.q2.test.ts` passes.

No new red.
