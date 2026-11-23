DONE f5c1f7a3ed 116d86b69

# Bug lane A — OPEN LOW / LOW-MED + NOT-CHECKED rows of part A and part C (2026-11-23)

- Branches: Tovu `codex/bugs-low-a-tovu` (base `origin/integ/merge-13-2026-11-22` f7185f153), Jini `codex/bugs-low-a-jini` (base `origin/integ/merge-14-2026-11-22` 4902a6a1). Jini linked into Tovu with `link-jini.mjs`.
- Inputs: Tovu `origin/plan/whats-left-1122:inputs/{part-A,part-C,bugs-triage}.md`.
- `AI-Dev-Shop/agents/programmer/skills.md` was read before any work (red-first slices, root cause, named mutation, function-quality and pre-completion checks were applied and passed to every subagent brief).
- Method: coordinator + 7 subagents in two waves (Opus: Jini batch, Tovu server/dev batch; Sonnet: themes/CSS batch, NOT-CHECKED verifier, stale pins, static publish, tool-row target). Every diff was reviewed by the coordinator and committed one item per commit; no subagent committed.
- AFTER-COMBINE = the fix needs a file changed on an in-flight branch (`codex/ex6-*`, `ex7-*`, `p12-*`, `bugs-high-*`, `bugs-medium-*`, `p11-next-*`, `visitor-chat-tovu`); files listed so it can be done after combine-15.
- A450 (themes on a separate origin) is security-graded, not LOW, so it is out of this lane.

## Gates (base-diff: no new red)
- Jini: `pnpm -r build` 0 (base 0); `pnpm typecheck` 0; `pnpm guard` 0. Changed vitest: sidecar 409/409 (+3 skipped); ui resource-dashboard 313/313; chat ToolCard* 189/189; `scripts/__tests__/optional-peer-contract.test.ts` 56 pass / 1 fail (base: 55/3; the remaining red is user-management's manifest, AFTER-COMBINE).
- Tovu: `npm run typecheck` 0. Admin `tsc --noEmit` 4 errors = base 4, identical lines (Jini kit types `values`/`Icon`/`useT`; pre-existing against Jini merge-14). Admin vitest (deployment, admin-themes, integrations/jini-admin) 43 files / 720 tests pass. Website node tests on changed files and importers (agent-daemon-*, theme toggle/drift): 258 pass / 1 fail; dev scripts tests 128 pass / 1 fail. Both reds are base-red, proven by swapping the base file(s) back: `shipped-site-theme-drift.canary` "reinstall stock renders nested header links..." and `dev-api-restart` "Windows restart stops the watcher..." (TypeError reading 'filter'). `check:errors` 0. `check:why-comments` exit 1 with 80 open blocks = base (combine-13: 80); none in a changed file.
- First C112 commit broke 3 SEC-004 console-shape pins in sidecar `index.test.ts`; fixed in de4865d0f before push of the gate run (code + traceId stay in the message, not `meta`).

## Results
item id | status | commit | test name
---|---|---|---
C003 | FIXED (doc only: comment said "non-terminal"; code writes terminal ROLLED_BACK, data-module.ts:973) | J 6b991c6b7 | — (comment)
C014 | FIXED (stale ui→lexical and daemon→express pins; agentic subpath text; `namedImports()` matcher) + AFTER-COMBINE: `packages/user-management/package.json` optionalPeers texts must name `@jini-ai/user-management/admin/react` | J f8409dabf | optional-peer-contract.test.ts::"keeps ui → lexical…" / "…daemon → express…" (red 3 → 1)
C017 | FIXED (21 dead `.jini-*` rules removed; live elements use unprefixed classes already styled in styles.css; visual check UNVERIFIABLE-IN-CLOUD but a selector matching nothing cannot render) | T e4e6c62ad6 | jini-media-css-selectors.unit.test.ts (mutation re-add-.jini-card-head red)
C025 | AFTER-COMBINE (J `packages/agent-plugins/src/lifecycle/seed-bundled.ts`) | — | —
C026 | NEEDS-OWNER: allow-list vendor names in host inventory or move them into plugins? Recommend: move names into plugin manifests, keep the guard. (`shared-owner.ts` also AFTER-COMBINE) | — | —
C028 | AFTER-COMBINE (`features/site-backup/share-service.ts`, `server/runtime/composition/modules/site-search.ts`) | — | —
C029 | OBSOLETE (no `apply-repoint.mjs` in either repo or Jini history) | — | —
C036 | ALREADY-FIXED for `A/lib/standing-draft-recovery-message.ts` (file gone, 08db7a1de) + AFTER-COMBINE for `W/server/inbound/assistant/plugin-prompt-prefix.ts:73` | — | —
C037 | FIXED (ui api.spec.md) + AFTER-COMBINE (`packages/user-management/README.md:35` add `{ viewerTimeZone }`) | J 97cefd7e7 | — (doc)
C046 | AFTER-COMBINE (`A/features/menus/hooks/use-menu-editor.hooks.ts`) | — | —
C056 | OBSOLETE as stated (md-02 not tied; listed known gap `fixtures/tool-search-known-gaps:7`; `media_generate_asset` is Tovu-owned). Note: `tool-search-keywords.operator-requests.test.ts` is base-red on pg-06 (unrelated) | — | —
C070 | NEEDS-OWNER (rule debt, 41 rows in `development/hook-injection-debt.json`; burn-down is its own lane). Recommend: one inject-as-props sheet per feature folder | — | —
C074 | AFTER-COMBINE (`development/scripts/check-architecture.baseline.json` is on an in-flight branch) | — | —
C076 | ALREADY-FIXED (connect-tool.api-connections.unit.test.ts 12/12) | — | —
C085 | OBSOLETE (no refresh-bk test or source in either base) | — | —
C086 | ALREADY-FIXED (batch-tool-inputs.test.ts 15/15; import-local-file-search.test.ts 2/2) | — | —
C095 | FIXED | T 2382fb7c03 | agent-daemon-run-start.dev-marker.unit.test.ts::"a client site run without an AI-Dev-Shop pipeline gets no dispatch marker" (mutation always-marker red)
C096 | UNVERIFIABLE-IN-CLOUD (flake under load only; submit-service.host-options.test.ts 25/25 three runs) | — | —
C097 | ALREADY-FIXED (`ThemePreviewReloadControl` lives in `@jini-ai/admin/react`, used by `A/features/themes/ThemePreviewReloadButton.tsx`) | — | —
C099 | ALREADY-FIXED (moved-tools golden tests 3/3 green) | — | —
C100 | ALREADY-FIXED for stdin-input.ts (8761768b1) + AFTER-COMBINE for `apps/desktop/src/tovu-server.ts` (no longer WARN either). Gate shows 3 new WARN rows in other files (bundled-id-upgrade.ts, lifecycle.ts, use-page-editor.hooks.ts), not this lane's | — | —
C101 | AFTER-COMBINE (`W/server/inbound/admin-http/dev-auth.ts`; owner: 500 lines not a blocker) | — | —
C107 | FIXED | J 93c9563e8 | ResourceBoard.test.tsx::"moves focus into the kebab menu on open and back to its trigger on Escape" (mutation drop-menuRef red)
C112 | FIXED | J 9932ab798, de4865d0f | json-ipc.contract.test.ts::"handler failure goes to the host's injected reporter…" (mutation inline-console-logger red)
C115 | AFTER-COMBINE (`W/server/inbound/shared/admin-failure.ts`) | — | —
C130 | AFTER-COMBINE / Jini-owned: raw text from J `packages/mcp/src/server/tool-protocol.ts:281,316`, shown by J `packages/chat/src/react/components/ToolCard.tsx` (avoided) | — | —
C131 | AFTER-COMBINE (T `assistant-ag-ui.ts`, J `chat/src/core/ag-ui/event-projection.ts`) | — | —
A010 | NEEDS-OWNER: should raw raster originals be public? 404 is deliberate and pinned (`media-original-video-route.test.ts:197`) because public renditions strip EXIF/GPS. Recommend: keep the 404, document `/m/<id>/public.v1/<slug>.webp`; neutral wording needs a coordinated change of 5 pinned sites | — | —
A017 | OBSOLETE (no kuinetic-reference.md; no "0.2.4" in ui-ux-design) | — | —
A046 | FIXED (tovu-starter and tovu-theme, both copies byte-identical) | T 0664c4c743, 09130d6d5a | starter-theme-toggle-storage-key.test.ts / tovu-theme-toggle-storage-key.test.ts::"a duplicated theme remembers its own mode…" (mutation hard-coded-key red)
A106 | NEEDS-OWNER (broad i18n debt; recommend a hygiene-audit missing-keys lane per screen) | — | —
A182 | NEEDS-OWNER (~110 baselined bare listen(0) test sites; migration is its own lane; guard c7b9477c3 stops growth) | — | —
A196 | FIXED for tool rows + AFTER-COMBINE: dedicated Read card in J `ToolCard.tsx:~335` must pass `limit: obj.limit` | J 116d86b69 | ToolCard.rules.test.ts::"toolRowTarget > read window (offset and limit)" (mutation drop-limit-pass-through red)
A212 | NEEDS-OWNER (feature: agent upload of video > 10 MB; recommend routing through local file import path) | — | —
A213 | ALREADY-FIXED (`A/features/media/Media.tsx:818-823` tooltip + name) | — | —
A244 | NEEDS-OWNER (perf debt; narrow imports when those graphs are next touched) | — | —
A268 | ALREADY-FIXED (`apps/desktop/scripts/check-gates.ts:70` bounded redacted output) | — | —
A287 | NEEDS-OWNER: should `stageTransitiveDependencies` accept each root's staged destination? Recommend yes, as an optional map, keeping the fail-closed throw when absent (J devops/packaging/electron/staging.ts:87-90) | — | —
A289 | ALREADY-FIXED (vitest-compat.test.mjs 2/2; guard queues via onTeardown, vitest-compat.mjs:242) | — | —
A305 | ALREADY-FIXED (zero bar intended; bar-chart.test.tsx asserts it, 118/118) | — | —
A307 | ALREADY-FIXED / OBSOLETE (durable-json suites 47+15 green; no source-boundaries flag exists) | — | —
A308 | ALREADY-FIXED (decided in code: platform/src/fs/file-lock.ts:11 "Proven live owners are never age-evicted"; both U6 tests agree) | — | —
A310 | NEEDS-OWNER (analytics forwarding with consent off; recommend: forward nothing, document it) | — | —
A312 | FIXED for the two leaking files found + AFTER-COMBINE for the root cause. A full root `npm test` (corrected after the first report said ALREADY-FIXED) showed `database-migration-reconciliation-boot.integration.test.ts` writing ~770 agent-plugin files into the REAL `sites/tovu-dev` (`createSiteRouteDeps({}, { dbPath })` binds to the process's site, not dbPath's). Both files now inject their disposable site through `overrides.siteBinding`; the leftovers this run created were removed (diffed against the pre-run `find sites` list). Root fix: `site-deps/overrides.ts` `resolveSiteBindingOverride` should bind from `resolveSiteDirForDatabase({ dbPath })` (+ `boot-phases.ts`, `site-registry.ts` helper) — avoided files. Still leaking until then: create-sqlite-route-deps-for-workspace, tool-attempt-audit-sink-composition, create-sqlite-route-deps-overrides, dev-capability-origin-scheme (all under `W/server/__tests__/integration/`), `composition/__tests__/create-site-route-deps-boot-options.integration.test.ts`; ~27 files call createSiteRouteDeps without a binding. Consent receipts themselves were never written | T f5c1f7a3ed | database-migration-reconciliation-boot.integration.test.ts::"A312 regression: a booted composition is bound to its disposable site…" (mutation drop-injection red)
A313 | ALREADY-FIXED (`development/test-support/composed-bundle-env.ts` sets a disposable plugins dir when unset) | — | —
A314 | ALREADY-FIXED / debt (typecheck:tests 0; complexity 0; hardwiring is a pinned 67-row baseline) | — | —
A315 | ALREADY-FIXED (plugin-activation-polling.ts durable-row polling + test) | — | —
A316 | ALREADY-FIXED (dev-startup-failure.test.mjs "a failed API boot never announces success…", 9240cbe16) | — | —
A319 | UNVERIFIABLE-IN-CLOUD (CSS at dock width) | — | —
A337 | NEEDS-OWNER (switcher off → no browser path to add a site; recommend by design + one line of empty-state copy) | — | —
A340 | FIXED | T 616b6a6634 | use-static-publish-last-project-name.unit.test.tsx::"shows the project name the last publish to the selected host used" (mutations history-overwrites-typed, ignore-host red)
A343 | ALREADY-FIXED (ui-animation.md pinned-sections; chrome-mobile-test-matrix.md:36,110) | — | —
A346 | ALREADY-FIXED (site-share-password.ts sendSiteShareFailure logs + reports) | — | —
A352 | ALREADY-FIXED (no INTEGRITY_FAILED in combine-12/13) | — | —
A355 | UNVERIFIABLE-IN-CLOUD (layout; todos.md:51) | — | —
A358 | ALREADY-FIXED (J mcp/src/server/tool-arguments.ts:93-131) | — | —
A359 | UNVERIFIABLE-IN-CLOUD (live Antigravity CLI) | — | —
A360 | ALREADY-FIXED (settings path, J agent-runtime/src/native-tool-policy.ts:54,68); squeeze is visual | — | —
A361 | UNVERIFIABLE-IN-CLOUD (load time) / route alias ALREADY-FIXED (A/App.tsx:129-132) | — | —
A362 | FIXED (stale import after deps split 7da748308) | T cee11d6c87 | site-plugin-directories.test.mjs (7/7; red was SyntaxError on the import)
A369 | FIXED (5 stale source pins re-anchored, each mutation-proven; behaviours still present) | T 95690f2f05 | agent-daemon-server*.test.ts 174/174 (was 169/5)
A373 | ALREADY-FIXED (automatic-agent-plugins.ts:159) | — | —
A380 | ALREADY-FIXED (background publish job + status tool, publish-agent-tools.ts:236) | — | —
A382 | FIXED | T 7396fd6777 | dev-admin-deps-cache.test.mjs::"a changed @jini-ai tree forces exactly one Vite re-optimize, then the stamp holds" (mutation stamp-always-matches red). dev-desktop.mjs starts Vite separately and does not get this yet
A383 | UNVERIFIABLE (aggregate of 12 old review items; traced sample fixed: J cms/src/forms/notify-subscriber.ts:157) | — | —
A394 | ALREADY-FIXED (J scripts/check-plugin-packages.ts:126-128) | — | —
A395 | ALREADY-FIXED (J scripts/check-plugin-packages.ts:132-144) | — | —
A397 | OBSOLETE (no forms delete tool; forms are soft-retired) | — | —
A399 | ALREADY-FIXED (not in combine-14 complexity list) | — | —
A400 | NEEDS-OWNER (auto-inert authored third-party scripts? recommend no; add a publish-time warning) | — | —
A401 | ALREADY-FIXED (J daemon/agent-executor/codex/home-config.ts:66) | — | —
A405 | ALREADY-FIXED (clean setup worked this run; note `packages/contracts` prepare still builds, so link Jini before `apps/admin` `npm ci`) | — | —
A406 | UNVERIFIABLE (aggregate; lead library-share.integration.test.ts:319) | — | —
A407 | ALREADY-FIXED (formspree in J plugin-catalog/catalog.json:363-376) | — | —
A408 | ALREADY-FIXED (J connect-tool.ts:150-163 explicit confirm; confirmer kind documented T human-confirm.ts:180-185) | — | —
A409 | ALREADY-FIXED for DOM ids (J cms/src/forms/html-render.ts:159); other two parts untraceable | — | —
A413, A415, A416, A417, A418, A420, A422, A427, A434, A435, A437, A442 | UNVERIFIABLE (stale aggregates of old review leftovers with no traceable file/line; spot-traced parts fixed or deliberate, see scratch V table) | — | —
A421 | ALREADY-FIXED header (`llms.route.test.ts:192-207`); stray date UNVERIFIABLE (client content); NEEDS-OWNER: `ADD YOUR CONTACT EMAIL` placeholder ships in exports — recommend an export pre-flight warning while the literal is on a published page | — | —
A423 | ALREADY-FIXED for static themes (site-cookie-consent.ts:265-340); consent tests need Node 24 (`RegExp.escape`), UNVERIFIABLE-IN-CLOUD on Node 22 | — | —
A425 | NEEDS-OWNER (prelaunch card when the run has no write tools? recommend skip it, keep the disclosure) | — | —
A426 | ALREADY-FIXED ("Include saved keys" gone); composio part = A007 (MED lane) | — | —
A429 | ALREADY-FIXED trailing slash (commerce-http.ts:~45-47); rest untraceable | — | —
A430 | ALREADY-FIXED (packages/contracts/src/startup-secret-keys.ts lists both) | — | —
A432 | ALREADY-FIXED (static and __original-themes__ copies identical; drift canary) | — | —
A433 | OBSOLETE fixture part; rest untraceable | — | —
A439, A454 | UNVERIFIABLE-IN-CLOUD (UI copy/layout, Chrome) | — | —
A443 | ALREADY-FIXED share link/zip (apps/desktop/src/renderer/ImportWebsite.tsx:26-30,121); rest needs packaged app | — | —
A445 | ALREADY-FIXED (Reset owner password, RecoveryCodesCard.tsx:78) | — | —
A448 | ALREADY-FIXED desktop wording + AFTER-COMBINE: server still says "ZIP size or SHA-256 mismatch." at `W/features/site-backup/import-verifier-inventory.ts:262` (avoided) | — | —
A452 | NEEDS-OWNER (feature, security-sensitive): add list + restore routes for `.import-quarantine` themes that re-run manifest/load checks, `theme.edit` + approval card, a "Held back on import" Themes section, and fallback-to-default notice. Recommend yes, as its own lane | — | —
A453 | FIXED admin (self-hosted OFL fonts copied from the desktop shell's vendor fonts, ~564 KB TTF) ; starter ALREADY-FIXED (theme.css:32-45). Still on Google Fonts: tovu-theme css, templated fashion-modern/storefront — need font files (NEEDS-OWNER) | T 4e2b5f55cf | classic-fonts-self-hosted.unit.test.ts::"names no remote font host" (mutation googleapis-import red)

## Notes for the owner
- Hook injection in C107 follows the ui package's existing defaulted hook-prop pattern (`useMenuKeyboardHook = useMenuKeyboard`), not a required host prop, to match its siblings (ResourceCard, ResourceBoard).
- A196: any tool with a readable target and a valid `limit` now shows it (same as `offset` already did), e.g. `fill (limit 5)`.
- A453: TTF, not woff2 (no converter offline); no Vite production build or browser check was run.
