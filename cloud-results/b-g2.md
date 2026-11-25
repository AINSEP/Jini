PARTIAL a4c6aeeadf 998955138: left = P2-T4.T witness `choose-preflight-mode-from-original-agent` (no fixture), Jini guard L3/L5 on daemon preflight → http-kit import (owner decision), P1-T2.T memory-root rollback seam (sheet STOP finding, by design not fixed)

# b-g2 — P1 editors and forms + P2 plugins and guidance (BUILD + TEST)

- Branches: Tovu `integ/b-g2-2026-11-25`, Jini `integ/b-g2-2026-11-25`, both = `integ/merge-21-2026-11-24` + Sol branches (`codex/b-p1j`, `codex/b-p2j`, `codex/tv-b-p1`, `codex/tv-b-p2`) + this run. The SHAs on line 1 are the code heads; this report is one commit above them in each repo. WIP pushes went to `integ/wip-b-g2` in both repos.
- Programmer contract: read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first. Confirmed: test-first RED/GREEN, named mutations, function quality, and architecture audit applied per sheet.
- Setup: Node 24.22.3. Jini: `pnpm install --frozen-lockfile && pnpm -r --filter './packages/*' build`. Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat, then `link:jini` (`JINI_PACKAGES_DIR=/home/user/Jini/packages`), hooks, and a build of `packages/{contracts,sdk}`.
- Step 0: desktop `npm run gates` on merge-21 Tovu: **6/6 PASS**. No `apps/desktop` change since, so pre-push skipped the desktop gates.
- Sheets labelled `SOL (OPUS-REVIEW)`: none exist in `rev-p1.md` / `rev-p2.md`, so there was nothing to review under that label. The Sol work was tested and reviewed (below).
- Workers: 16 subagent runs, never more than 4 at a time and each under 50 calls (Opus for auth, redaction, ordering and deletion sheets; Sonnet for the rest). Jini rebuilds happened only between test runs.

## Sheet table

| sheet | built by | status | tests + mutation |
|---|---|---|---|
| P1-J3.J menu focus | Sol (tested by Opus) | DONE | ResourceCard/Board 64/64. RED: skip-open-focus, focus-disabled-menu-item, skip-escape-focus-restore. Added the missing why-comment for Escape-only focus restore (e78eb5b56). |
| P1-T1.J versioned form PUT | Sol (tested) | DONE | update.test 12/12. RED: drop-writer-options, allow-mixed-versioned-status, versioned-empty-is-legacy-read, use-unclassified-conflict-copy. coerce-version-string and require-version-for-all-puts are covered by the same witnesses; no separate run. |
| P1-T4.J post Load latest handle | Sol (tested) | DONE | notices 5/5. RED: drop-post-load-latest-handle. |
| P2-T3.J scoped publish catalog | Sol (tested) | DONE | agent-tools 2/2. RED: unfiltered-lead, drop-card-copy. |
| P1-T1.T forms host binding | Opus coordinator → Sonnet worker. **Sol skipped this sheet** (`codex/tv-b-p1` held only T4.T). | DONE | lost-update-boundaries 7/7, forms-i18n 15/15. RED: drop-expected-version-at-host-binding. The other mutations edit Jini code and were reasoned only. The i18n witness could not be seen RED because the keys were already in dist. `check-openapi-contract` was not re-run after the dist fix. |
| P1-T4.T page/post Load latest | Sol + Opus snapshot | DONE | PageEditor.unit 100/100, PostEditor DOM 76/76. RED: drop-page-load-latest-handle. The snapshot was re-recorded with `-t 'version conflict banner'`; the delta is exactly the 3 `data-agent-*` attributes. drop-post-handle-in-package is reasoned (it was RED via the Jini mutation). |
| P2-T1.T0 inactive-read option | Sol (tested) | DONE | kuinetic package witness passes. drop-packaged-companion NOT RUN: the staged package path did not resolve from the shell. Covered by erase-manifest-companions in P2-T1.T. |
| P1-J1.J form editor refresh | Opus worker | DONE | forms + screens/forms 449/449. RED: all 11 named mutations. `useFormEditorRefresh` takes `generation` instead of `t` (documented deviation). Strings for the 21 locales are machine translations. |
| P1-J2.J failed choice card (redaction) | Opus worker | DONE | ToolCard + tool-call-detail 175/175. RED: all 6 (match-choice split in two). Coordinator extracted `resultText` to keep complexity ≤ 10. |
| P1-T2.J per-item revert policy (auth) | Opus worker | DONE | 29/29 across 3 suites. RED: all 8. Policy tests now use the built public entry (adb2d68d1). |
| P1-T2.T page-html undo (deletion/undo) | Opus worker ×2 | DONE (STOP finding logged) | html-undo 23/23, wiring 3/3, pages+golden 332/332. RED: 11 named + 1 extra. expose-inverse-payload-in-list NOT RUN (it would mutate the shared Jini dist mid-run); its behaviour test passes. Also fixes the 2 wiring tests that were red at merge-21 (the fixture now sends expectedVersion). |
| P1-T3.J embed inspection route | Sonnet worker | DONE | 8/8. RED: render-before-authorization, scan-all-src-attributes, scan-serialized-source, drop-pending-body, return-rendered-html. |
| P1-T3.T preview video links (auth) | Opus + Sonnet ×2 | DONE | Server embeds 7/7. Admin pages+themes 525/525. RED: ignore-rendered-ids, accept-superseded-ids, replace-local-ids-on-error, omit-preview-revision, accept-host-substring, inspect-page-body-instead-of-assembled-html, mount-with-publishing-grant-or-skip-content-read (skip-content.read variant), lose-template-tristate. Route-table fixture: only the new route was added and later indices shifted. Admin RED-first was not observed (mutations used instead). PageEditor.tsx 1445 → 1167 raw lines. Size and hook baselines are not raised; the hook debt went down by 1. |
| P2-J2.J offer/commit (ordering) | Opus worker | DONE | 95/95 (new + 4 existing suites). RED: all 9. See the consent-publication note under new bugs. |
| P2-T4.J argv variant fit + preflight spec | Opus worker + Sonnet size fix | DONE, guard red | daemon executor/http 964, agent-runtime defs 652. RED: all 7. launch.ts is back within its size baseline (998955138). **Guard L3/L5:** the daemon preflight spec imports `@jini-ai/http-kit`, a devDependency (logged). |
| P2-T5.0 lock ordering (ordering/migration) | Opus worker | DONE | Jini 16/16 new, agent-plugins 2392/2392. Tovu 3/3 with a real lock. RED: reacquire-inside-seed (Jini + Tovu), swallow-restore-failure. Journal stub not built (as the sheet says). Behaviour change: a sibling-workspace migration fault is now logged with redaction and skipped instead of failing every seed. |
| P2-T1.T inactive admission e2e | Opus worker | DONE | integration 45/47; the 2 failures were already red at merge-21. RED: force-inactive-read-true, drop-explicit-inactive-option, record-inactive-read-as-delivery, erase-manifest-companions, require-companion-to-resolve (Jini mutations applied to dist, then restored with cmp). |
| P2-T2.T survey-first import guidance | Sonnet worker | DONE | 35/35, compose 12/12. RED: all 5. tovu-theme 1.1.4. No digest re-pin was needed. |
| P2-T3.T publish "this page" | Sonnet worker | DONE | publish-tool 52/52, overlay 38/38. RED: use-publish-without-scope, drop-final-item-filter (Tovu call-site variant), bypass-publish-policy-wrapper. The approval characterization is green on the baseline (no finding). Golden: aggregate bytes only. |
| P2-T4.T compose variants + commit chosen ids (auth/ordering) | Opus worker ×2 + coordinator | PARTIAL | RPC 9/9, argv-fit 4/4 through the real executor, prefix 13/13. RED: commit-by-run-id-without-live-attempt-fence, retry-after-abort, commit-all-offered-ids-on-fallback, argv-agents-always-use-catalog, size-the-early-user-text-only, skip-final-quoted-argv-check, trim-pinned-prefix-for-catalog. NOT RUN: choose-preflight-mode-from-original-agent (no fixture) and bypass-commit-receipt (the receipt lives in Jini; covered by the cached-retry witness). Coordinator fixed 3 new red tests (plugin-prompt-prefix fixture, 10e15f3bcf). |
| P2-J1 | — | DONE-ALREADY (per sheet) | — |

## Gates vs merge-21

- **Jini:** typecheck passes on all 8 changed packages (core, cms, chat, ui, admin, agent-plugins, agent-runtime, daemon), strict.
- **Jini vitest:**
  - ui 8986/8986, chat 4675/4675, agent-plugins 2392/2392, agent-runtime 4579/4579.
  - cms 8291/8294 and core 3146/3149: the failures are all in files this run did not touch.
  - admin 6264/6266: 2 failures in untouched files (theme-boundaries/email.css, AlwaysAllowPanel).
  - daemon 4981/4997: 15 failures in the upload characterizations (500s). Those files were not touched by this run, but the failures were not bisected.
- **Jini other checks:**
  - `api:check` 0. Baselines refreshed only for this run's deltas; unrelated admin and user-management drift left as it was.
  - why-comments ok. hooks ok.
  - complexity and size: no new entry from this run (the rest is pre-existing).
  - **guard: 3 violations.** HW3 was there at merge-21. L3 and L5 are new from the daemon → http-kit import (logged).
- **Tovu:**
  - root tsc 0, admin tsc 0, hooks ok, why-comments ok (base merge-21).
  - boundaries exit 0 (144 warnings).
  - `check:size` lists only pre-existing entries in untouched files.
- **Tovu tests:**
  - Admin vitest: pages/posts/forms/themes 1280/1280.
  - Website node tests (190 changed/neighbouring files, concurrency 2): 1423/1497 at the gate run.
    - All 74 failures were re-run on a clean merge-21 worktree: 71 fail there too. The other 3 were the plugin-prompt-prefix tests this run broke; fixed after the gate run and confirmed 13/13 in that file.
    - The website suite was not re-run in full after that fix.
- **Desktop gates:** 6/6 on merge-21. No desktop change since.

## UNVERIFIABLE-IN-CLOUD

- Live admin UI checks were not done: form reload notice, failed-choice card styling (new classes `jini-op-choice-failed` / `jini-op-copy-details` have no CSS), page preview "Watch on YouTube" links, and real-Chrome keyboard focus on the resource menu.
- Real CLI argv on Windows (cmd shim) and POSIX `E2BIG` were checked only through the injected platform predicates.
- A real-site boot with legacy `tovu/<id>` installs under the new lock ordering was not run.
- Native-speaker review of the 21 machine-translated forms locale strings is still needed.
- Registry promotion / published artifacts were not touched (no publish, no tag).

## New bugs

- **Fixed this run:**
  - Sol skipped P1-T1.T. It is built now, and the required `versionedUpdateMessages` gap at the Tovu mount is closed.
  - 2 wiring tests were red at merge-21 (missing expectedVersion). Fixed.
  - The why-comment for Escape-only focus restore was missing; 4 why-comments were dropped by refactors and are restored.
  - A hook-injection regression from the preview extraction is fixed, and the debt is lowered by 1.
  - A size regression in PageEditor/panels is fixed.
  - The `describeToolCallDetail` complexity rose to 13. Fixed.
  - The `seedBundledAgentPlugins` complexity rose to 11. Fixed.
  - The launch.ts size ratchet was exceeded. Fixed.
  - The plugin-prompt-prefix fixture failed for argv agents. Fixed.
  - Open-bugs rows marked fixed: the ResourceBoard menu focus row and the failed `assistant_ask_choice` raw-error row.
- **Logged** (in `development/open-bugs.md` § "Found at b-g2"):
  - Daemon preflight → http-kit guard edge.
  - Memory-root change-set rollback seam (P1-T2.T STOP).
  - P2-T4.T mode witness.
  - P2-J2.J consent publication deferred to commit.
  - The full list of pre-existing reds.
- `development/todos.md`: no open row matched these sheets, so nothing was ticked.
