# fixes-2 (cloud run 2026-11-17)

Three items, one branch each. The same report is committed on every branch of the run. Code SHAs
are listed per item; the report commit is the tip of each branch.

Bases: Tovu `origin/refactor/terra` 232764af5, Jini `origin/refactor/terra` 65d73b0d5.
Setup: Node 24.22.3 in `~/.local/node24`; Jini `pnpm install --frozen-lockfile` + `pnpm --no-bail -r build`;
Tovu `npm ci` (root + apps/admin), `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`,
`tsc` for `packages/contracts` and `packages/sdk`. Vitest was run with `--maxWorkers=2` (Jini's vitest 2 rejects
`--minWorkers`); node:test with `--test-concurrency=2`. No subagents, no force-push, no RemoteTrigger.

## 1. `ci/why-comment-gate` (Tovu AND Jini): DONE

Owner rule: refactors MOVE "why" comments with the code, never delete them.

What it is (identical in both repos; Jini `scripts/`, Tovu `development/scripts/`):
- `check-why-comments.mjs` (CLI), `check-why-comments-lib.mjs`, `check-why-comments-lexer.mjs` (a small JS/TS
  comment extractor that knows strings, templates and regex literals), debt file
  `scripts/why-comments-debt.json` / `development/why-comments-debt.json` (`{version:1, allow:[{id, reason}]}`;
  an entry with no reason is an error), tests `check-why-comments.test.mjs` (22 cases).
- For `git diff -U0 --no-renames <base> <head>` over `.ts/.tsx/.mjs/.js`, every comment block (`//` runs, `/* */`,
  JSDoc) that touches a removed or rewritten line is a candidate. Exempt: eslint/ts/istanbul/c8/prettier/etc.
  directive lines, license headers, commented-out code, blocks of 1-3 words. A candidate is LOST unless its
  normalized text (lowercase, markers and whitespace collapsed, so rewrapping is free) is: an existing comment block
  anywhere in this repo or the sibling repo; a substring of any tracked text file (<=2 MB) of either repo; or
  edited in place (>=75% of its 3-word runs are in the range's added text or in the same file's current text, so
  rewording a word or two is fine, dropping a sentence is not).
- Reports, plans and the gate's own baseline are NOT counted as "the comment survives" (`cloud-results`, `cloud`,
  `.cloud-coord`, `ADS-memory` are excluded from the corpus). Found by the run itself: the committed baseline
  quotes every lost comment and silently cleared 37 of 55 findings until the exclusion (red test first, then green).
- Flags: `--base` (env `WHY_COMMENTS_BASE_REF`, default `origin/refactor/terra`), `--head`, `--merge-base` (CI),
  `--root`, `--other-root` (repeatable; env `WHY_COMMENTS_OTHER_ROOT`; defaults to the `../Tovu` / `../Jini`
  sibling when present), `--debt`. Exit 1 on any non-allow-listed lost block; each finding prints file:lines, a
  12-hex id and the text. Git and file reads are injected; the tests use real two-commit fixture repos.
- Run: Tovu `npm run check:why-comments`, Jini `pnpm check:why-comments`.
- CI: Jini `.github/workflows/ci.yml` step "why-comments (blocking ratchet)" after hook injection; Tovu step
  "Check why-comments ratchet" with `continue-on-error: true` and `id: gate-why-comments`, added to the summary
  list next to `check:hooks`. Both pass `--merge-base` and `WHY_COMMENTS_BASE_REF` like the size gate.
  Tovu CI has no sibling Jini checkout, so a comment moved into Jini there is reported (non-blocking).
- Mutation proof: the fixture test deletes a why comment (gate exits 1, names file, line, id), restores it (exit 0),
  moves it to another file (0), rewraps it (0), folds it into a longer comment (0), keeps it only in the other repo (0)
  and drops a sentence (1). Report-quoting test shown red with the exclusion disabled, green with it.

Baselines (do NOT restore comments in this run; they are the to-do list):
- Tovu `80b00f5bb..232764af5`: 211 lost blocks, `cloud-results/why-comments-baseline.txt` (exit 1 expected).
- Jini `02edbb68..65d73b0d`: 55 lost blocks, `cloud-results/why-comments-baseline.txt` (exit 1 expected).
  Runtime ~17-20 s each.

SHAs: Jini `ci/why-comment-gate`: a0dfbcc3, dd6110a2, b44c4377, cfbaba82, 708df5c8 (+ report).
Tovu `ci/why-comment-gate`: e1f3fb9f7, b3332b383, d7434b6c6, 39550561b (+ report).

Gates (exact command, result):
- Jini `node --import tsx --test scripts/__tests__/check-why-comments.test.mjs`: 22 pass, 0 fail.
- Tovu `node --test development/scripts/__tests__/check-why-comments.test.mjs`: 22 pass, 0 fail.
- Jini `pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10],"max-lines-per-function":["error",50],"max-lines":["error",500]}' scripts/check-why-comments*.mjs`: clean (after splitting 5 functions; first run had 5 errors).
- Jini `pnpm check:size`: passed (157 debt entries). `pnpm check:complexity`: passed (17 entries).
- Test script wiring: Jini `test:scripts:node` and Tovu `test`/`test:ci` now include the new test file.

## 2. `fix/charts-recharts-repin` (Tovu): DONE (Jini not needed)

Cause: Tovu pinned `charts-recharts` at 0.7.0 while the installed `@jini-ai/provider-plugins` carried a different
version; the bundle folder is named for the PACKAGE version and the dependency was a range (`^0.7.0`), so any
other installed version means "pinned directory absent" or "integrity mismatch": `[plugin-runtime] bundled
initialization failed for 'charts-recharts'`, charts fall back to the table.

Re-review (published tarballs 0.7.0, 0.7.1, 0.7.2 fetched with `npm pack`, compared file by file): 0.7.0 -> 0.7.1
`client/provider.js`, `client/styles.css`, `server/index.mjs` are byte-identical (sha256 9462...6d4e... unchanged);
only three license metadata files differ, each by the version string only. 0.7.2 has the same executable bytes.
So the re-pin admits no new code.

Change (commit b4401819c): `RECHARTS_BROWSER_APPROVAL.version` 0.7.1 and the published 0.7.1 integrity map;
root `package.json` `@jini-ai/provider-plugins` is now the EXACT `0.7.1`, `package-lock.json` updated
(`npm install --package-lock-only --ignore-scripts`; only that package changed); new test "the pin is the exact
version the manifest declares and the lockfile installs" (red against the old `^0.7.0` manifest, green now); the
admin bundle test reads the pinned version from the root manifest instead of a hand-kept copy.

Gates:
- `node --import tsx ... --test recharts-package-pin.unit.test.ts browser-provider.integration.test.ts` against the
  PUBLISHED 0.7.1 package: 13 pass, 0 fail (the one "bundled initialization failed" line is the intentional
  no-approval negative case).
- Attach path, same published package: `admin-local-boot-session-route`, `agent-plugin-set-enabled`,
  `agent-plugin-set-enabled-busy`, `routes/plugins browser-provider`, `static-publish/publish-run`: 80 pass, 0 fail,
  no "initialization failed" line (these were the tests counting that warning).
- `cd apps/admin && npx vitest run src/integrations/chart-providers --maxWorkers=2`: 17 pass.
- IMPORTANT caveat: the container links the LOCAL Jini checkout (0.7.1 version string) and its `plugins/` build is
  not byte-identical to the published 0.7.1 (`client/provider.js` sha256 1ded682e... vs 9462...; extra
  `_jini-ai_core` license folder; the folder is gitignored and built from terra source, which is ahead of the
  published 0.7.1). Under that link the pin is refused by design ("a package upgrade never admits unreviewed
  bytes") and boot still warns. The pin follows what Tovu actually installs from the registry. The tests above were
  run with the published tarball swapped in for the linked package. To get a clean linked boot, Jini must publish
  the terra build and Tovu re-pins to it (the new lockfile test makes that a one-place change).

## 3. `fix/vendor-names-out-of-core`: PARTIAL (the failing tests live in Tovu, not Jini)

The two failing "vendor" tests are in Tovu, not Jini (Jini's own `vendor-neutrality.test.ts` is green on terra):
(a) `features/api-connections/__tests__/vendor-neutrality.test.ts` "no generic seam file names the first provider",
(b) `features/deployments/deploy-targets/__tests__/no-vendor-in-core.boundary.test.ts` "real core tree has only
reviewed pattern exceptions" (72 uncovered entries at the start; 0 stale). The code work is on the Tovu branch of
this name; the Jini branch of this name carries only this report.

Result: (a) PASSES. (b) 72 uncovered entries at the start -> 4 uncovered groups, 0 stale. No exception count was raised.

Changes (Tovu commits a05d27564, a47b6e17a):
- `bundled-catalog.ts` no longer names any vendor: the three id lists (seeded enabled, selected from Jini, host
  Soon) and the default chart provider's plugin id are data in `platform/plugin-selection/bundled-selection.json`
  (JSON import with an import attribute; `tsconfig.json` gets `resolveJsonModule` + the two JSON includes; Node type
  stripping in `compose-bundled-agent-plugins.mjs` still loads it, checked). Composition order preserved.
- Source-control saved API-key labels: data in `features/source-control/saved-api-key-labels.json`.
- Default agent id: one definition `assistant/default-agent.ts`, used by `agent-daemon-scope.ts`,
  `agent-daemon-core-rpc.ts`, `assistant-tool-exec.ts` (the preflight test, which evals that function's source,
  gets the binding injected).
- `charts-recharts-source.ts` -> `default-chart-provider-source.ts` (pluginId from the data file).
- Seam hits reworded without losing the why (`shared-owner.ts`, overlay-guidance test); soon-lock test reads the
  host Soon list instead of naming ids; the two stale `ALLOWED` lines of the neutrality test removed (their
  `federate-mcp.ts` text no longer exists) with the original reason kept in the docblock.
- `vendor-exceptions.json`: only ratchet-DOWN edits and a re-point: github (catalog group) 3 -> 2, lipay 4 -> 2,
  assistant google 21 -> 18, and the moved YouTube embed files added to the existing youtube path (total still 14).
- `vendor-scan.ts`: "commerce" added to `FIRST_PARTY_PLUGINS`. Jini now ships a plugin named `commerce`, which made
  the word "commerce" a vendor word and flagged ~28 first-party commerce files (Tovu's own commerce domain, owner 10-22
  rule that first-party plugins are product features, like `deploy`, `jev`). OWNER: please confirm this
  classification; it is the only scanner-config change.
- How-tovu-works skill text updated to name the new selection file.

Still red (4 groups), each needing an owner decision rather than a code move:
1. `apps/admin` AssistantDock/ai-assistant/skills translated copy: anthropic 100 -> 121, google 13 -> 159,
   github 16 -> 77. Cause: translated UI dictionaries (`assistant-dock-i18n.ts` google 125, `skills-page-dictionary.ts`
   anthropic 21 / github 61 / google 21: "Add a GitHub skill", the Gemini CLI sign-in notice in every locale). Moving
   them means extracting provider copy into plugins/descriptors (Phase 8 per the existing reason) or an owner decision
   that locale dictionaries are exempt or their counts reviewed. Counts were not raised.
2. `features/forms/agent-tools.ts`: "Cloudflare manifests" in the forms-update tool description (1 hit). Rewording
   passes the scan but changes the catalog bytes pinned by `assistant/__tests__/moved-tools.golden.test.ts` (755108),
   so I reverted it; it needs the golden's resync rule or an exception.

Gates (Tovu, branch fix/vendor-names-out-of-core):
- `npx tsc -p tsconfig.json --noEmit`: clean. `NODE_OPTIONS=--max-old-space-size=6144 npx tsc -p tsconfig.tests.json --noEmit`: clean.
- Source-reading tests of the touched areas (`features/{agent-plugins,source-control,forms,api-connections,deployments,site-backup}`,
  `server/runtime/{boot,composition}`, `server/inbound/assistant`, `assistant/`, `development/scripts` bundled/compose
  tests): 10081 tests, 48 failed. Compared file by file against a clean base worktree (same links): every failure also
  fails on base except two that I caused and fixed (assistant-agent-plugin-preflight eval binding; moved-tools golden
  from the description reword, reverted). Base-red set: postgres tests (no PG), agent-daemon-server.typed-tools (13),
  boot/* (7), component-catalog-routes, mcp-ui-sandbox-proxy-route, domain-no-direct-tool-registration,
  bundled-agent-plugin-selection, U1 export template, agent-daemon-core-rpc memory-mode, charts-recharts pin family
  (linked Jini, see item 2), no-vendor-in-core.
- Final re-run: vendor-neutrality 2/2, soon-lock, preflight, moved-tools golden: pass; no-vendor-in-core real-tree test: 4 groups left.
- Gate scripts vs base (`npm run check:architecture|size|complexity|errors|hooks` on branch vs on a base worktree):
  size, complexity, errors, hooks: identical output; architecture: same lines, the already-regressed "module API
  surface (files exposed)" reads 852 -> 854 (+2: `default-agent.ts`, the selection JSON). That is a worse number on
  an already-red line, not a new line.
- `check:why-comments` (item 1 script, run on this branch's range): 0 lost blocks.

SHAs: Tovu `fix/vendor-names-out-of-core`: a05d27564, a47b6e17a (+ report). Jini `fix/vendor-names-out-of-core`: report only.

## Overlaps with parallel runs
- `charts-recharts-source.ts`: item 2 edits version + integrity there; item 3 renames it (and edits its pluginId
  line). Different hunks; git should follow the rename.
- `package.json` / `package-lock.json` (item 2) and `tsconfig.json`, `bundled-catalog.ts`, `vendor-exceptions.json`,
  `vendor-scan.ts` (item 3) are hot files for other runs; item 1 touches only CI, package scripts and new files.

## Next steps
1. Merge the three Tovu branches and the Jini gate; turn the Tovu why-comment step blocking once the 211-block
   baseline is worked down (restore or move the comments, or allow-list with reasons).
2. Owner: confirm "commerce" as first-party in the vendor scanner; decide the four remaining vendor groups
   (locale dictionaries, forms tool description + golden resync).
3. Jini: publish the terra build of `@jini-ai/provider-plugins`, then re-pin charts-recharts to it
   (change `package.json` exact version, lockfile, the approval version + integrity map; the new test guards the rest).
