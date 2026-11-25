DONE 640cea5aec d71677aee9 | FILES LEFT 1044 (excl. themes) / 505

> The SHAs on the first line are the tested code tips: Tovu `640cea5aec`, Jini `d71677aee9`. The commit that adds this report sits on top of them.

# x9 batch — test-and-fix + OPUS-CLOUD finish (2026-11-25, unattended cloud run)

- Coordinator: Opus, high effort. Workers: 8 Opus-high runs for OPUS-CLOUD/security sheets, 1 Sonnet run for the files-left script. At most 4 ran at once.
- Bootstrap: read `AI-Dev-Shop/agents/programmer/skills.md` (Programmer v1.7.5). I applied its base rules: root-cause debugging, verification before completion, inline docs, and why-comments moving with the code.
- Setup: Node 24.22.3 (`/opt/node24/bin` first on PATH).
  - Jini: `pnpm install --frozen-lockfile && pnpm -r --filter './packages/*' build`.
  - Tovu: `npm ci --ignore-scripts` in the root, admin, desktop and site-chat. Then `link-jini` with an explicit `JINI_PACKAGES_DIR`, `prepare-desktop-hooks`, and a build of `packages/{contracts,sdk}`.
  - Trees: merge-21 baseline in `/home/user/{Jini,Tovu}`; the merged tree in worktrees; one worktree pair per worker.
- Branches pushed: Tovu and Jini `integ/x9-batch-2026-11-24`, plus `integ/wip-x9-{plugins,posts,deploy,small,rest}` on both. Each wip branch is the merge-21 + Sol state after that area's merge, untested.

## Per-area table

| Area | Sol sheets merged (J / T) | Red found after merge | Fixed (root cause) | Reverted |
|---|---|---|---|---|
| plugins | CC-01.J / CC-01.T (Sol had stopped AP-01.J and PR-01.J) | none | — | none |
| posts | Sol sheets covering post agent-hold, PostCoverImage, SlugCollisionWarning, use-post-featured-image, the page-html-store contract, PageExternalChangeBanner, media large-upload routing and verify-published-media | 1. guard N1: "Tovu" named in a Jini core comment (`page-html-store.ts`). 2. why-comments: 2 blocks lost (PostCoverImage seam note, large-upload JSDoc) | 1. Comment neutralised ("the host's … the engine's"). 2. Recorded in the debt file with reasons | none |
| deploy | E1 export preflight, E2 theme-preview manifest, D1 History tab, D2 overview hook, S1 source-control shell, P0.T, P1, P2 | 1. Tovu hook-injection: `source-control-panel.tsx` called `useAdminLocale` inside an inline default. 2. why-comments: SourceControl `@file` block (35 lines) dropped; publish-content types mirror note dropped | 1. Named module-level adapter hook `useShellAdminLocale` as the injected default. 2. `@file` block restored verbatim in `source-control-panel.tsx`; the mirror note was recorded as obsolete (type consolidated into core) | none |
| small | SM-J01/T01 newsletter catalog, SM-J02/T02 webhook HTTP double, SM-J03/T03 comment markers | 1. Jini build: `http.memory.ts` TS2322 under `noUncheckedIndexedAccess`. 2. guard R5: the Jini newsletter catalog hard-coded the host tool name `content_read`. 3. guard SI-domain: `public-markers.ts` reached the widgets barrel. 4. why-comments: http.memory `@file` paths reworded | 1. Explicit empty-script guard with a why-comment. 2. Jini text now uses `{{read:newsletter_campaign}}`/`{{read:newsletter_list}}` placeholders. Tovu binds `resolveHostReadRefs(…, { hostReads: contentReadVocabulary })`, the same pattern members uses, so the model-facing bytes do not change. 3. Import repointed to the shared `widgets/markers/marker.js`. 4. Debt entry | none |
| rest | TH02 open-file predicates + card preview, TH03 preview reload button | 1. Jini build: `use-theme-card-preview` test TS2379/TS2352 under `exactOptionalPropertyTypes`. 2. guard SI-domain: the card-preview hook entry had no per-entry isolation override. 3. Merge conflict in `cms/package.json` (two new isolation keys) | 1. The test omits the optional prop rather than passing `undefined`. 2. Added the same per-entry override its sibling hooks use. 3. Kept both keys | none |

No area needed reverting. Every new red was traced to its root cause and fixed with an import repoint, a manifest/isolation entry, a strict-TS test or type fix, or a carried comment. No moved logic was rewritten.

## OPUS-CLOUD sheets (and the two stopped Sol sheets)

Each sheet was written test-first in Jini, with its named mutation applied, shown RED, reverted, and shown GREEN again. Host halves are repointed in Tovu with product literals injected. Worker branches were merged into `integ/x9-batch-2026-11-24`.

| Sheet(s) | Plan | Result | Named mutation → RED evidence |
|---|---|---|---|
| CC-01.J/T | plugins (Sol) | merged from Sol; tested here | (Sol's pin; build and tests green) |
| **AP-01.J/T** (Sol STOPPED) | plugins | **DONE**. The anchor mismatch was the sheet saying "universal `./site/soon-lock`" while `identity.ts` imports `node:fs/promises` and `node:path`. Fixed by classifying it `node` in isolation group `lifecycle`, like its sibling `./site/host-plugin-guidance`. `hostSoonPluginIds` is required; Tovu passes `HOST_SOON_AGENT_PLUGINS` at all 8 importers | `AP-HostListWinsOverManifest`: Jini 3/5 red ("a manifest `untested` flag wins over the host's Soon list"); Tovu host case red (actual 'soon', expected 'untested') |
| **PR-01.J/T** (Sol STOPPED) | plugins | **DONE**. The mismatch was that Tovu has **ten** RT-005 tokenizer cases, not the nine the sheet counts; all ten moved, since none is a manifest or loader case | `PR-JoinWithoutSeparator`: Jini 2/10 red; Tovu hook assertion red ({count:1} vs {count:2}) |
| XM-01.J/T | plugins | **STAYS-HOST (STOP)**. A structural member differs: core `KeyringPort.activeKey(_required)` vs `@jini-ai/integrations/secrets` `activeKey()` → TS2322 where the host forwards `siteAssistantSecretKeyring` as `keyring`. The crypto port contract was not changed | not run (no move) |
| AC-01.J/T | plugins | **DONE** | `AC-ReadBeforeMembershipCheck`: Jini "never reads or projects an unselected id" red; 2 Tovu host cases red |
| PK-01.J/T | plugins | **DONE** | `PK-MakeLabelLookupRequired`: Jini TS2741/TS2344; Tovu `helpers.ts` `satisfies KeyAttachments` TS2741/TS1360 |
| PK-02.J/T | plugins | **STAYS-HOST (STOP)**. Same `KeyringPort.activeKey` arity mismatch: the verbatim body `keyring.activeKey()` fails TS2554 against the core type, and `ownerKeyHandleOnly`'s result is not assignable to the host `projectVault.keyring` (TS2322). Also unlisted: `mcp-ui-allowlist-completeness.test.ts:108` names the Tovu file | `PK-DropPostOpenGrantCheck` Tovu half only: red on "a revoke committed during asynchronous crypto prevents returning plaintext", reverted green |
| PR-02.J/T | plugins | **DONE**. "Café Münster" → `cafe-muenster` | `PR-UseAsciiOnlyHeadingSlug`: Jini red (`caf-m-nster`); Tovu `buildContentAnalyzerPatch` red |
| SM-J04/T04 | small | **DONE**. The logger is now a required arg; Tovu passes `{ logger: createConsoleLogger({ prefix: "" }) }` at all 5 call sites | `ST-ZONE-DROP-ERROR-CLASS` red (exact log record); `ST-TITLE-UNDEFINED-ERROR-CLASS` red (absent errorClass) |
| S01.J/T | rest | **DONE**. `"TOVU_SITE_KEY"` is supplied only by Tovu | `SITE-KEY-FALLBACK-HOST`: red both ways (hardcoded fallback; fallback preferred over the server's name) |
| S02.J/T | rest | **DONE**. Submit, focus, pending cancellation, the redacted message and the single notification are all preserved | `COPY-KEYS-NONDEFAULT-SOURCE`: red with hardcoded selection and with hardcoded request; also notify-on-rejection red |
| TH01.J/T | rest | **DONE**. Type-only: 4 core contracts and 34 importers repointed by symbol | `TH01-OptionalApprovalToken` (restore `confirmationToken` optional): TS2344 red; `HELD-BACK-RESTORE-RESULT` red |
| PT01.J/T | rest | **DONE**. Session codec moved to `@jini-ai/cms/publish/trust/session` | `SESSION-EXACT-EXPIRY` (>= → >): 2 red; T-D4c length-guard mutation red |
| PT02.J/T | rest | **DONE**. `messageVersion` is required; Tovu `PUBLISH_TRUST_WIRE` keeps the literal `tovu-publish-challenge-v1` | `CHALLENGE-EXACT-EXPIRY` (<= → <): 3 red; hardcoded-version mutation red |
| PT03.J/T | rest | **DONE**, on top of PT02. The first attempt correctly reported BLOCKED-ON-PT02 and was re-dispatched. The guarded egress instance is unchanged; peer label and failure code are injected | `CONNECT-REPEAT-SAME-DOCUMENT`: fixture 5 red, production 1 red; PEER-LABEL mutation 2 red |

Posts, deploy and small (apart from SM-04) carry only OPUS-CLOUD *holds* (NOT-PLANNED rows), with no executable OPUS-CLOUD sheets, so nothing was dispatched from them. Total: **12 of 14 sheet pairs done** (10 of 12 OPUS-CLOUD pairs plus both stopped Sol sheets). **2 STAYS-HOST**: XM-01 and PK-02, both blocked on the same `KeyringPort.activeKey` arity split.

## Gates vs merge-21

Same commands on merge-21 (`/home/user/{Jini,Tovu}`, unmodified) and on the final tree. Jini was never rebuilt during a Tovu test run.

| Gate | merge-21 | x9 final | Note |
|---|---|---|---|
| Jini `pnpm -r --filter ./packages/* build` | 0 | 0 | |
| Jini `pnpm typecheck` | — | 0 | |
| Jini `api:check` / `api:update` | additions pending | 0; baselines regenerated (6 files, +1036/−8, including drift already present on merge-21: admin kit hashes, members/roles/users api entries) | changeset `x9-sol-extraction-batch.md` plus 10 sheet changesets |
| Jini `pnpm guard` | 1 (HW3 `shell-failure-log.ts`) | 1 (same) | Sol introduced 4 new violations (R5, N1, 2× SI-domain); all 4 fixed |
| Jini `check:hooks` / `check:why-comments --base merge-21` | ok / ok | ok / ok | |
| Tovu `tsc -p tsconfig.json` | — | 0 | |
| Tovu admin `tsc --noEmit` | — | 0 | |
| Tovu `check:hooks` | ok | ok | Sol introduced 1 new entry; fixed |
| Tovu `check:why-comments --base merge-21` (sibling Jini = merged tree) | — | ok (22 reworded or superseded blocks recorded with reasons, 1 block restored) | the default base `origin/refactor/terra` does not exist in cloud |
| Tovu `check:boundaries` | — | 0 | |
| Tovu `check:architecture` | FAILED (runtime-only propagation 3.58%, 43 NEW cross-feature edges) | FAILED (3.62%, 43 NEW edges) | already red on merge-21; +0.04 pts on the ratchet metric |
| Desktop `npm run gates` | 5/6 (tests gate FAIL) | **6/6 OK** | merge-21 was red before any change |
| Tovu website node tests: changed + direct importers (548 files, `--test-concurrency=3`) | — | 5840 tests: 5781 pass, 52 fail, 7 skip | **all 27 failing files fail identically on merge-21** (same pass/fail counts per file); 0 new reds |
| Tovu admin vitest: changed + direct importers (126 files, `--maxWorkers=2`) | 7 fail (CollectionEntries 1, security-panel 6) | 2943 pass, 7 fail | same 7 |
| PT03 follow-up node tests | — | 147 pass, 1 fail | the failure is `publish-zero-setup-end-to-end` (pre-existing ReferenceError, 5/1 on merge-21) |
| Jini new/moved vitest (28 files) | — | 96/96 | plus each worker's sheet tests |

Test-list scope: the website list is every test that directly imports a changed production file. It leaves out the 477 importers of `server/runtime/composition/app.ts`, whose only change is the one-argument logger injection that tsc already covers. A 1-in-24 sample of those (20 files) was included. Pre-existing website reds: tool-registrations.contracts, library-share, export-preflight.unit, mail-send.golden, pages-html-revisions-wiring and publish-agent-tools fail to load (missing modules); content-read-get-by-id, tool-registrations.media, publish-content.overwrite, resolve-html-page-embeds, site-title (7), automatic-agent-plugins, bundled-*-package, bundled-automatic-relevance, federate-mcp, install-upload-update, tw2-L224, resolve-mailer, bundled-inactive-gating, deps-provider-plugin-boot, webhook-delivery-worker, wiring-identity, assistant-byok.inputs-pin, railway/render deploy-config and publish-zero-setup fail on assertions.

**FILES LEFT** (`combine-18-plan.mjs` over `scan.mjs`; true count = the same planner with every proposed KEEP_RULE from `plans/count-1124/*.md` appended):

| Tree | Planner | Planner excl. themes | True count | True count excl. themes |
|---|---|---|---|---|
| merge-21 | 1186 | 1066 | 642 | 522 |
| **x9 final** | **1158** | **1044** | **619** | **505** |

Only `count1124.md` carries a ```js block. The rule lists in count2-a, -w1, -w2 and -crp (tables and text) were converted to anchored regexes; counts match each report's claim. The script is in the run scratchpad (`files-left.sh`).

## UNVERIFIABLE-IN-CLOUD

- Electron/desktop runtime and real-browser behaviour of the moved admin components (PostCoverImage, SourceControl shell, History tab, CopyKeysDialog, ThemePreviewReloadButton). Only jsdom unit tests and tsc ran.
- Real outbound publish-trust handshakes (PT03) against a live peer site. Covered only by fixtures and the guarded-client test doubles.
- `pnpm -r build` for `examples/reference-desktop` (no electron in cloud). Only `./packages/*` were built.
- The why-comments default base (`origin/refactor/terra`) is not fetchable. Checked against merge-21 instead.
- Guard `R13-model-fallback-freshness` MF3 for codex/agy CLIs (binaries absent). Skipped by the guard itself.
- Full website `npm test` was not run (scope: changed files + direct importers, as instructed).

## New bugs / findings

1. **`KeyringPort` split (blocks XM-01, PK-02 and every later crypto-port move).** `@jini-ai/core/contracts/vault` has `activeKey(_required: Record<string, never>)`; `@jini-ai/integrations/secrets` has `activeKey()`. The two are not mutually assignable. An owner decision is needed: align the arities, or let user-management/core import the integrations port. No port was changed in this run.
2. **Plan errata.** AP-01.J classified `./site/soon-lock` as universal, but it must be `node` (its identity reader uses `node:fs`). PR-01 has 10 tokenizer cases, not 9. PK-02.T misses the `mcp-ui-allowlist-completeness.test.ts:108` reference. The AP-01.T README note names a route file (`routes/agent-plugins/set-enabled.ts`) that no longer exists.
3. **Sol output was not strict-TS clean in Jini.** Jini's `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` broke 2 verbatim moves. Sol also copied a hard-coded host tool name (`content_read`) and a "Tovu" comment into Jini. These need a guard + build step in the Sol loop.
4. Pre-existing on merge-21 and untouched here: 6 website test files fail to load on missing modules (`features/mail-status/delivery-agent-tools.js`, `features/consent/privacy-page-template.js`, …). `publish-zero-setup-end-to-end.test.ts:257` uses `deployConfigGenerators` without defining it. `check:architecture` is red. `api-baseline` drift (admin kit hashes) had accumulated before this batch.
5. Stale comments left verbatim by rule: the Tovu theme hooks still say "see `themes-port.hooks.ts`" (deleted by TH01), and the word-count `index.ts` header still says its unit test pins the tokenizer (moved to Jini by PR-01). `error-gate-debt.json` keeps a stale entry for the deleted `use-copy-keys.hooks.ts`.
6. Process: the website test run on the first merged tree hit the 30-min background cap; it was re-run in full on the final tree with a 70-min cap and finished in 22 min.
