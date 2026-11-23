PARTIAL 320a0f8c3 125408f6d: X-media-1 (2 of 10 files: where-used.ts, purge-media.ts — need P-publish-content-1), K4-asset-transfer-1, K4-image-transform-1, K5-media-1, K5-media-2, K5-media-4, K5-media-generation-1, K5-media-import-1, K5-object-storage-1, V-media-3, A-K2-media-1, A-K2-media-2, A-K2-library-1, RT-K1-adm-media-1–4, S7b.J/.T — all blocked on prerequisites not landed in these bases (list below)

# ex4 — Library, Media lane (2026-11-22)

This was an unattended cloud run on Opus high. Three lane steps are done in both repos: **X-image-transform-1**, **X-object-storage-1** and **X-media-1** (8 of its 10 files). One more lane file, `routes/media/content-type.ts`, is also gone, because after the move it would have been a re-export shell. Every other lane step has at least one prerequisite that has not landed in these bases (table below), so those steps were skipped and are listed.

- **FILES-LEFT** went from 2,486 to **2,475** (−11). Without the theme areas: 2,375 → 2,364. Lane-step files left: 98/98 → **87/98**.
- **No new red.** Every Tovu and Jini gate equals base. The few deltas are the ones explained under Gates: debt that moved from Tovu to Jini, three contract updates for the new entries, and one load timeout.
- **Mutations:** 3 named mutations were killed in Jini, and 1 consumer mutation was killed in Tovu.

## Branches and SHAs (plain `git push`, `git pull --rebase` before each push, no force)
- **Jini `codex/ex4-media-jini`**, from `origin/integ/merge-14-2026-11-22` `4902a6a1a`:
  - `944514c6e` X-image-transform-1.J
  - `96ad836c9` X-object-storage-1.J
  - `bc0a9a4c7` X-media-1.J (8/10)
  - `cdf868607` gate fixes (HW3 `ReadonlySet`, plus debt rows that moved with the code)
  - `125408f6d` both new entries declared `node`, and the new platform subpath pinned in its export-list test
  - The report-copy commit comes on top of these.
- **Tovu `codex/ex4-media-tovu`**, from `origin/integ/merge-13-2026-11-22` `f7185f153`. That base is `0d7f78fa4` plus one docs-only commit, the combine-13 report.
  - `ddd9081b4` X-image-transform-1.T
  - `e30341eef` X-object-storage-1.T
  - `0a9806677` X-media-1.T (8/10)
  - `08cd259e3` deletes the would-be shell `routes/media/content-type.ts`
  - `3fcbff226` why-comment debt rows (moved or obsolete)
  - `320a0f8c3` multi-line import layout restored (format only)
  - The report commit comes on top of these.
- **Not used or touched:** subagents, codebase-memory tools, force-push, `--no-verify`, tags, publish, RemoteTrigger. `main`, `integ/*`, `plan/*` and `release/*` were only fetched (`plan/whats-left-1122` was read, and `refactor/terra` was fetched as the why-comments base).

## Setup
- **Jini** at `4902a6a1a`:
  - `pnpm install --frozen-lockfile`: 0.
  - `pnpm --no-bail -r build`: 0.
  - Jini baseline = combine-14's recorded `gates-final` (same content, `190860f22`).
- **Tovu** at `f7185f153`:
  - `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`: 82 links changed. The link points at **this run's Jini branch**. cms and platform were rebuilt after each Jini commit (symlinked `dist`).
  - `packages/contracts` tsc: 0. `packages/sdk` build: 0.
- **Node:** the image default is Node 22.23.5, but Tovu requires `>=24` and Jini `~24`.
  - All gates and tests of record ran on **`/opt/node24` (v24.22.3)**, the same as combine-13.
  - A first Tovu test pass and a first Jini gate pass on Node 22 were discarded. They showed Node-22-only reds, such as `RegExp.escape is not a function` in `cms/forms/result-html`.
- **Base attribution:** a clean `git worktree` at `f7185f153` that shares the same `node_modules` symlinks, and so the same Jini link. The full Tovu gate set ran there too.

## Steps

| step | files moved (Tovu → Jini) | importers repointed | tests | mutation (named) | status |
|---|---|---|---|---|---|
| **X-image-transform-1** | `features/image-transform/image-ops.ts` → `cms/src/media/site-transform/image-ops.ts`; export `./media/site-transform/image-ops` | 1 (`image-transform/tool.ts`) | `image-ops.test.ts` moved: Tovu base 12/0 → Jini 12/0 | negate `normalizeOutputs`' first `if (` → **11/12 red**; restored (`cmp`) 12/0 | DONE |
| **X-object-storage-1** | `features/object-storage/setting.ts` → `platform/src/object-store/site/setting.ts`; export `./object-store/site/setting` | 5 + barrel line deleted: `site-deps/{identity-settings,media-storage,site-sharing}.ts`, `index.unit.test.ts`, `site-backup-wiring.integration.test.ts` | `setting.unit.test.ts` moved: 6/0 → 6/0. Stay-green: `index.unit.test` 1/0, site-backup-wiring green | the first exported functions have no `if`, so the substitute was negating the reader's `typeof … === "string"` ternary → **4/6 red**; restored 6/0 | DONE |
| **X-media-1** (8/10) | `bootstrap`, `chat-preview`, `content-type-store`, `hydrate-blob-store-from-seed`, `original-bytes`, `public-path`, `upload-content-type`, `content-type-resolution` → `cms/src/media/site/*`; 8 exports | 68 files; the 8 media-barrel re-export lines deleted and each barrel user of those names split to the Jini subpath (`importer-rewrite-log.txt`); plus `routes/media/{list,trash,update}.ts` + `content-type.test.ts` off the deleted shell | 3 moved: hydrate 9/0, public-path 6/0, upload-content-type 1/0 (= Tovu base counts). The 8 sheet "stay green" files are green | negate `hydrateBlobStoreFromSeed`'s first `if (` → **8/9 red**; restored 9/0. **Tovu consumer:** negating `mediaUrlKey`'s slug-wins `if` in the linked Jini `dist` → `resolve-media-public-urls.test` 18/0 → **7/11**; restored 18/0 | PARTIAL: `where-used.ts` and `purge-media.ts` HELD (`where-used` imports `#src/features/publish-content/media-references`, which is P-publish-content-1 and not landed; `purge-media` imports `where-used`) |
| extra: `routes/media/content-type.ts` (RT-K1-adm-media-1 row) | deleted, not moved. It only re-exported `resolveContentTypes` / `readRecordedContentType`, so after X-media-1 it would forward to Jini, which makes it a re-export shell | 4 (`list`, `trash`, `update`, `__tests__/content-type.test.ts`) | `content-type.test` green | — | DONE |

Raw outputs: `cloud-results/ex4-media-raw/` (`mutations-jini.txt`, `mutations-tovu-consumer.txt`, `tovu-tests-*.txt`, `tovu-gates-{tip,base}/`, `jini-gates/`, `admin-full-summary.txt`, `files-left.txt`, `importer-rewrite-log.txt`).

### What changed beyond a byte-for-byte copy (for Codex)
- **Jini code, type-level only:**
  - `image-ops.ts` `encode`: `flatten: jpeg ? {…} : undefined` became the conditional spread `...(jpeg ? { flatten: {…} } : {})`. This was needed for `exactOptionalPropertyTypes`. The codec only reads `flatten` when it is truthy (`image-transformer.sharp.ts:158`), so behaviour is unchanged.
  - `SOURCE_FORMATS` is now typed `ReadonlySet<string>` (guard HW3).
- **Specifiers:**
  - Same-package `@jini-ai/cms/media`, `/media/import` and `/media/slug` imports are now relative.
  - The moved tests use `node:test` → `vitest` (`node:assert/strict` stays), and `hydrate-blob-store-from-seed.test` imports `../../index.js`.
- **Comments (N1/N2), with every why kept:**
  - "Tovu imports" became "host imports".
  - "Tovu-owned port" became "host-owned port".
  - `apps/website/...` path citations became "the host's … route" / "the host's … composition root".
  - The `TOVU_MEDIA_BLOB_STORE` env-var name in two comments became "the host's media blob-store env var".
- **Tests:**
  - `public-path.test` gets one `as const` on a tuple-literal array (Jini `noUncheckedIndexedAccess`).
  - `hydrate-blob-store-from-seed.test` temp-dir prefixes changed from `tovu-hydrate-blob-seed-` / `tovu-seed-uploads-notdir-` to `jini-…`. These are test-only literals; this is the P9-BREAKS row, which is recorded here because `plan/*` is read-only for this run.
  - `public-path.test`'s header cites `../public-path.ts`.
- **Tovu barrel-shape test** `object-storage/__tests__/index.unit.test.ts`: the barrel intentionally lost the setting module, so the test now:
  - expects 3 modules, not 4;
  - checks that no setting name is on the barrel;
  - reads `STORAGE_SETTINGS_NAMESPACE` / `MEDIA_OBJECT_STORE_KEY` from the Jini module.

  This is an assertion edit, not just an import edit, so please review it.
- **Packaging:**
  - cms gains `@cfworker/json-schema` as an **optional peer**: `^4.1.1`, already in the lockfile for integrations/agent-plugins/mcp. That means `jini.optionalPeers` text, devDep, peer and `peerDependenciesMeta`. `pnpm-lock.yaml` +3 lines.
  - Both new entries are declared `node`. The cms universal-entry walker cannot follow a third-party peer, and platform's contract test reserves `universal` for its listed browser-safe entries.
  - `platform/src/secrets/__tests__/exports.test.ts` pins the full published subpath list, so the new entry was added to it.
- **Debt that moved with the code:**
  - Two Tovu `error-gate-debt` rows (`catch-reads-error`, chat-preview and content-type-resolution) are now Jini `error-gate-debt` rows.
  - Jini `log-safety-debt` gained `hydrate-blob-store-from-seed.ts` `stored-error-text` (2), the per-file error text in the seed-hydration report. Changing it would change behaviour, so it is listed, not fixed.
  - Two Tovu `check-architecture.baseline` edges to the deleted files were removed.
  - Tovu `why-comments-debt` gained 9 rows: 8 blocks "Moved to Jini …", plus the `content-type.ts` one-liner, which was obsoleted with the shell it justified.
- **Changesets:** `.changeset/p9-x-image-transform-1.md`, `p9-x-object-storage-1.md`, `p9-x-media-1.md` (patch).
- **API delta:**
  - `api-baseline/jini-ai__cms.json` gains `./media/site-transform/image-ops` plus the 8 `./media/site/*` entries.
  - `jini-ai__platform.json` gains `./object-store/site/setting`.
  - `api:check` now covers 705 entries / 17,283 symbols, up from 695 / 17,245.

## Steps skipped, and why (prerequisites not landed in Jini `4902a6a1a` / Tovu `f7185f153`)
A step counts as landed when all of its sheet's Tovu source files are gone.

| step | unlanded prerequisite(s) |
|---|---|
| X-media-1 (2 files) | P-publish-content-1 (11/11 open) |
| K5-media-1 | K4-contracts-core-5, K4-seam-5/10/15, X-content-duplication-1, K5-webhooks-4, K5-contracts-headless-2, K5-contracts-core-10 (+ X-media-1 full) |
| K5-media-2 | K5-media-1, K5-contracts-core-1, K5-webhooks-4, K4-seam-1 (Jini half merged in merge-14; Tovu file still present) |
| V-media-3 (media barrel) | K5-media-1, K5-media-2, X-media-1 full |
| K5-media-4 | K5-media-1, V-media-3, K5-publish-content-1/3, K4-publish-content-2, K4-seam-5, K4-contracts-core-5 |
| K5-media-generation-1 | K5-agent-plugins-4, K5-media-2/4, K4-seam-5/20, K4-contracts-core-5, K5-contracts-core-1/7/10, K5-contracts-headless-2 |
| K5-media-import-1 | K5-fs-files-1, V-media-3, K4-seam-2, K5-media-4, K4-contracts-core-5, K5-contracts-core-10 |
| K5-object-storage-1 | K5-agent-plugins-4/5, K4-seam-13 |
| K4-asset-transfer-1, K4-image-transform-1 | K5-contracts-core-10, K5-media-import-1, V-media-3, K5-theme-5, K5-fs-files-1, K4-contracts-core-5 (and asset-transfer-1 for image-transform) |
| RT-K1-adm-media-1–4 | V-media-3. **RT-K1-0.T has not landed in Tovu:** no `adminJsonRoutePorts`. RT-K1-0.J is in Jini merge-14. Also R-admin-http-1, K5-media-4 and K5-media-import-1 for -3/-4. |
| A-K2-media-1/2, A-K2-library-1 | A-adm-shell-lib-1–4, A-adm-other-5, A-K2-shell-lib-4, A-K2-shell-hooks-3, A-adm-shell-hooks-1, A-K2-shell-components-8/9, A-K2-publish-content-1, A-K2-users-1, A-K2-auth-1. **A-K2-0a.T has not landed in Tovu:** see the admin tsc note below. |
| S7b.J/.T (off-index) | after X-media-1 complete (2 files held) |

No step needed an owner decision beyond the held items listed under Findings.

## Gates (tip vs base, same Jini link, Node 24)
**Tovu**, with all 16 combine-13 gates (`tovu-gates-{tip,base}/summary.txt`):
- **Exit codes:** identical on every gate.
  - size 1/1, boundaries 0/0, admin tsc 2/2, desktop tsc ×4 0/0, typecheck(+e2e) 0/0, hooks 0/0, worker-import-graph 0/0, errors 0/0, complexity 0/0, typecheck:scripts 2/2, why-comments 1/1, typecheck:tests 0/0, architecture 1/1.
- **Content:**
  - size, errors, complexity, typecheck:scripts and hooks print byte-identical findings.
  - boundaries: the same 112 warnings over 7 fewer modules.
  - **architecture improved:** cross-feature edges 309 → 302, propagation 12.45 → 12.40 %, API surface 687 → 683, bidirectional hubs 313 → 311. Its one regressed metric (runtime propagation 3.06 → 3.29) is identical at base.
  - why-comments: 80 = 80, after the 9 debt rows.
- **Admin tsc exit 2 is BASE-RED from the Jini link, byte-identical at base.** The errors are `Icon` / `useT` / `values` missing in `integrations/jini-kits.ts`, `main.tsx` and `render-with-jini-kits.tsx`. They come from Jini merge-14's A-K2-0a kit, whose Tovu half is not in merge-13. combine-13 linked Jini merge-13, which is why it recorded 0.

**Tovu tests:**
- **Node:** 134 files, made up of the changed tests, direct test importers of the changed production files, and the sheets' stay-green lists. The two hubs `features/media/index.ts` (94 test importers) and `server/routes/types.ts` (174) were skipped and covered by typecheck and typecheck:tests. Each file ran alone, under a 15-min watchdog, 3 in parallel.
  - Result: **1,664 pass / 1 fail**.
  - The fail is `widgets/__tests__/integration/resolve-html-page-embeds.integration` 64/1, **BASE-RED**: the same test fails at base, 64/1 (`base-attribution-…txt`). combine-13 recorded the same result.
- **Admin full:** 909 files, **6 fail / 14,917 pass / 2 skipped. This is identical to combine-13**: same 4 red files (JiniMediaPicker.hooks, admin-literal-copy, credential-input-autocomplete, dictionary-lookup-sinks). No admin, desktop or site-chat file changed.

**Jini** (`jini-gates/`, Node 24, vs combine-14 `gates-final`):
- full build 0 (0 `error TS`).
- typecheck 0 = 0.
- guard 0 = 0, after the HW3 fix.
- api:check 0 (+10 entries).
- hooks 0 = 0.
- why-comments `--base 4902a6a1` 0 (0 lost). Default (terra) 1 = 1: 10 not allow-listed, same as base.
- size 1 = 1 and complexity 1 = 1, with identical findings.
- error gate WARN 25 = 25, after the moved debt rows.
- log-safety 1 = 1: identical lines, with the moved `hydrate` debt row.
- `check:cross-package` 1 = 1: XP1 39 / XP2 33 / XP3 2050 / XP4 760 / XP5 6, identical. No finding names a file this run added. Same caveat as combine-14: there is no declaration snapshot in this clone.
- **vitest:**
  - platform 3,360 pass / 0 fail.
  - cms 5,047 pass / 2 fail:
    - `forms/package-boundary`: BASE-RED, in combine-14's suites.
    - `forms/create-tables.reference` (pglite): "Test timed out in 5000ms" while 3 gate jobs ran at once. It passes **2/2 alone**, so it is load-induced and listed.

## FILES-LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`, clean worktrees, raw `files-left.txt`)

| tree | moving | shells | **FILES-LEFT** | excl. theme areas (theme + adm-themes = 111) | lane scanner areas (media, media-import, media-generation, image-transform, asset-transfer, object-storage) | lane-step files left (k-work rows of the 19 lane steps) |
|---|---|---|---|---|---|---|
| base `f7185f153` | 2,483 | 3 | **2,486** | 2,375 | 50 | 98/98 |
| tip `320a0f8c3` | 2,472 | 3 | **2,475** | 2,364 | 40 | 87/98 |

## Findings (LISTED, not fixed)
1. **The Node default is 22**, while both repos require 24. A run on the default `node` produces false reds (`RegExp.escape`), and the pglite/forms tests fail. Use `/opt/node24/bin` first in `PATH` for every gate and test.
2. **Tovu admin tsc is red when linked to Jini merge-14.** A-K2-0a.T (Tovu `jini-kits.ts` supplying `Icon` / `useT` / `values`) is not in Tovu merge-13. It is identical at base. It needs the A-K2-0a Tovu half before the next combine.
3. **`check:why-comments` only searches Tovu,** so every verbatim move to Jini needs "Moved to Jini" debt rows. This run added 9, one of which is the obsolete shell comment `a6cfe1079080`. **Owner check:** that comment justified the forwarding file itself. Deleting the file deletes its subject, and I judged that better than keeping a shell.
4. **Jini log-safety:** `hydrate-blob-store-from-seed.ts` stores `err.message` in its report rows. It is now Jini debt with a reason, and could be converted to a named idiom later. That would change the report's shape, so it should be done tests-first.
5. **The `object-storage` barrel-shape test was edited beyond its import line** (see "What changed"). Codex should confirm this is the intended treatment for barrel-contract tests when a barrel shrinks.
6. **X-image-transform-1 adds an optional third-party peer to cms** (`@cfworker/json-schema`). The sheet did not foresee it. The lockfile already held the package. Owner/Codex should confirm that cms is the right home, as against `integrations`.
7. **`plans/P9-steps/RT-K1-adm-media-1.md` still lists `routes/media/content-type.ts`,** and this run deleted it. That sheet's importer list for `list` / `trash` / `update` is now stale. Also: `V-media-3`'s barrel has 8 fewer lines, and K5-media-4's `view-image-tool.ts` now imports `@jini-ai/cms/media/site/original-bytes`, which becomes a relative import when it moves.
8. **The importer rewrite collapsed 14 multi-line imports;** the layout was restored in `320a0f8c3`. There was a near-miss on the deleted shell: a re-export file forwarding to a moved module turns into a Jini re-export shell unless the rewriter treats `export … from` in non-barrel files specially. Later lane runs should check for this.
9. **cms `forms/create-tables.reference` times out at 5 s under parallel load,** while it passes alone. This is a possible flake source in combined gate runs.
