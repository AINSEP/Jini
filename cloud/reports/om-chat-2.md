# om-chat-2 — in progress: Tovu push blocked

Authorized scope: OMJ items 1, 2, 3, 4 and 8, from `cloud/jobs/COMMON.md` and `cloud/jobs/om-chat-2.md` read with `git show origin/cloud-plans-1105:<path>`. P0 was already done. Items 5–7, publication, deployment and Open Marketing remain outside this job.

## Branches and commits

Both repositories use only `cloud/om-chat-2`, based on the fetched current `origin/cloud/combine` tips:
- Jini base: `3a86f98ba03380651c8bf64b8fc18c4f90a122fd`.
- Tovu base: `abead52498c80fd86b8f7b37a2caed31d98a7307`.

Jini code/documentation commits, pushed:
- `2470683a6388d03ba524e906d84256f3a05003eb` — initial scope/bases report.
- `317704407d1c6510850be11755af6a0f1f962ac2` — reported duration and optional actions.
- `8614860445d637188ee50d7b60f6e2408a24ceaf` — grid and supported settings stylesheet.
- `5eb9471819f0bc63cff161f19e851062b101692b` — shared model-effort projection and metadata.
- `c53435bb8b092f14219426a12a0b8bb91deb9398` — local action extraction for complexity, CSS documentation.

Tovu commits:
- `5978d387142f5a75f41512bd0629c962f5874a18` — shared stylesheet adoption (pushed).
- `99faf59da602a59b56f6a37509213c317fc9dcbd` — site/desktop inventory metadata (push rejected by existing desktop hook; explicit exception requested).

Final report commits are subsequent commits on these same branches. No main, cloud/combine, force push, publish or deployment was used.

## Delivered behavior and reuse

1. Reported CLI duration, including zero and summed attempts, survives conflicting send/end timestamps. Timestamps fill only a missing duration. Updated the old timestamp-wins expectation because the owner explicitly changed that contract; invalid timestamp, reload and multi-reply assertions remain.
2. Conversation delete/rename callbacks are optional. Unsupported buttons, rename tooltip and double-click editing disappear; supported confirmation, keyboard rename/select, search and New remain. Removing rename support hides an already-open editor. A small private action component keeps the changed row below the required complexity ceiling.
3. The existing pane grid declares `grid-template-columns: minmax(0, 1fr)`. Browser RED measured a 4180px child track inside a 379px dock; GREEN bounds header/composer tracks to the dock.
4. The browser-safe `@jini-ai/agent-runtime/model-selection` owner exports `modelReasoningOptions({ agent, model }, options)`. Validation, selection rules and rendering use it: retain an advertised Default, narrow to model levels, deduplicate, distinguish absent/empty lists, and suppress a second effort field for suffix-based runtimes. Codex still omits the effort flag for Default. Found and repaired dropped model reasoning at Jini server and Tovu desktop projections; optional suffix ownership now reaches server/site/desktop summaries. Those small DTO changes are necessary for the shared picker to receive its model metadata.
8. Existing settings CSS moved from Tovu into the public optional `@jini-ai/chat/react/styles/chat-settings.css` export, with standalone defaults and host theme tokens. Build copying and browser entry metadata include it. Tovu imports it and keeps theme bindings, dark selected styling and its dock-only help targets. Shared segmented controls still receive styles because App eagerly loads AssistantDock. Native dialog, focus lifecycle and semantics stay owned by the existing components.

No new framework, platform module, table, runtime option, polling loop or persisted state. Generic behavior is in Jini; Tovu changes are metadata/style wiring.

## Validation

Every command below first sources `/workspace/.tovu-build/env.sh` (Node 24.22.1). Network-enabled execution is required for Git, browser sockets and subprocess test harnesses in this sandbox. Default pnpm store was read-only: copied its cache into writable `/workspace/work/pnpm-store` and used that store; no tracked dependency/lockfile change.

Baseline: original affected chat tests **146 passed**, runtime models **52 passed**, before production edits. Clean detached base worktree builds of agent-runtime and chat also passed. The first asynchronous workspace build overlapped newly added RED tests and therefore is not claimed as an unmodified-tree baseline. After implementation, the complete current Jini workspace rebuild passed.

From `/workspace/Jini`:
```sh
pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store
pnpm -r build
npm --prefix packages/chat run test -- src/core/__tests__/turn-usage.test.ts src/react/components/__tests__/ConversationList.test.tsx src/react/components/__tests__/ConversationList.gaps.test.tsx src/react/components/__tests__/ConversationList.trigger.test.tsx src/react/features/chat-pane/__tests__/rules.test.ts src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.test.tsx src/react/__tests__/ChatSettingsDialog.lifecycle.test.tsx src/react/__tests__/ChatSettingsDialog.test.tsx
npm --prefix packages/agent-runtime run test -- src/__tests__/models.test.ts src/defs/__tests__/codex.test.ts
npm --prefix packages/daemon run test -- src/http/__tests__/agents.test.ts
npm --prefix packages/server run test -- src/__tests__/builtin-features.test.ts -t 'preserves model reasoning|agent diagnostic projection'
npm --prefix packages/agent-runtime run typecheck
npm --prefix packages/chat run typecheck
npm --prefix packages/daemon run typecheck
npm --prefix packages/server run typecheck
CHROMIUM_PATH=/usr/bin/chromium node --test examples/reference-web/e2e/chat-layout.test.mjs
```
Results: chat **179/179**, runtime/Codex **124/124**, HTTP agents **12/12**, server projection **6 selected passed** (44 unrelated tests filtered), browser **2/2**. Types/build pass. All new bug regressions failed before their production fixes. Browser fixture uses real React Composer/ChatSettingsDialog in Chromium, and asserts grid geometry, border/fieldset/control presentation, bounded body scrolling, keyboard focus, Escape and focus return.

Browser setup uses the already-installed Playwright: `mkdir -p examples/reference-web/node_modules`; if absent, `ln -s /workspace/Tovu/node_modules/playwright examples/reference-web/node_modules/playwright`. No tracked dependency was added. Browser MCP was unavailable. Full authenticated application flows were not exercised.

Packed CSS, from `/workspace/Jini/packages/chat`:
```sh
npm pack --pack-destination /workspace/work/om-chat-2 --cache /workspace/work/om-chat-2/npm-cache --json
```
Extracted the tarball to a scratch consumer and resolved/read `@jini-ai/chat/react/styles/chat-settings.css` with `createRequire`: pass, actual dialog rules included.

From `/workspace/Tovu`:
```sh
npm --prefix packages/contracts run build
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
npm --prefix apps/admin run test -- src/__tests__/unit/chat-settings-tip-phone-css.unit.test.ts src/components/AssistantDock/__tests__/chat-settings-tooltips.unit.test.tsx src/components/AssistantDock/__tests__/DockSettingsMenu.unit.test.tsx src/features/ai-assistant/__tests__/VisitorAssistantTabs.unit.test.tsx
node --import tsx --test apps/website/src/assistant/__tests__/agents-owned-runtime.test.ts
npm --prefix apps/admin run typecheck
./node_modules/.bin/tsc -p apps/desktop/tsconfig.main.json --noEmit
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```
From `/workspace/Tovu/apps/desktop`:
```sh
node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test src/desktop-agent-inventory.test.ts
```
Results: affected admin suites **77/77**, modified site inventory **6/6**, desktop inventory **8/8**. All three consumer type checks pass after rebuilding stale Jini devops/MCP output from the new base. The phone CSS test retains every old assertion and reads both the host bindings and extracted public stylesheet.

Complexity commands, from each respective root:
```sh
# Jini
pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/agent-runtime/src/core/model-discovery-shared.ts packages/agent-runtime/src/models.ts packages/chat/src/core/turn-usage.ts packages/chat/src/react/components/ConversationList.tsx packages/chat/src/react/features/chat-pane/rules.ts packages/chat/src/react/features/chat-pane/components/AgentRuntimePicker.tsx packages/chat/src/react/features/chat-pane/styles.ts packages/daemon/src/http/agents.ts packages/server/src/builtin-features.ts examples/reference-web/e2e/chat-layout.tsx
# Tovu desktop
./node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",9],"sonarjs/cognitive-complexity":["error",9]}' apps/desktop/src/desktop-agent-inventory.ts apps/desktop/src/contracts/runtime-inventory.ts
# Tovu other
./node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/assistant/agents.ts apps/admin/src/components/AssistantDock/AssistantDock.tsx
```
All complexity checks have zero errors. Existing unrelated warnings remain: turn-usage loop continues, server require, site nested assignment. No disables, thresholds or test scope rules were changed. `git diff --check` passes in both repositories.

Tovu's automatic pre-push gates **rejected the push** of `99faf59da`: tree-quiet PASS, tests FAIL, typecheck PASS, coverage FAIL, complexity PASS (0 new violations), js-backslide PASS. Four passed, two failed, zero disabled. Exact attempted command: `git pull --rebase origin cloud/om-chat-2 && git push origin HEAD:refs/heads/cloud/om-chat-2`. Existing `apps/desktop/scripts/hooks/pre-push` runs `npm run --silent gates` in apps/desktop; its runner sanitizes/truncates each child's diagnostics to 2,000 characters. Coverage reports failed test passes (`node=1, tsx=1`), so no coverage percentage is claimed. The failing full-suite assertions cannot be identified from the truncated hook output; they are not claimed as pre-existing. The job ran focused tests; broader desktop suites were invoked only by the existing push hook. No gate/test was disabled or weakened. An explicit user exception is pending before any `--no-verify` push. Raw retained hook output: `/workspace/work/om-chat-2/tovu-inventory-push.log`.

## Findings left open

Bug (pre-existing): adjacent `apps/website/src/assistant/__tests__/agents.test.ts` fails four assertions (rescan freshness, available-Claude fixture, catalog/default projection, unresolved-default projection) and cancels one background-inventory test after its 2-second timeout. The same command and same failures reproduce on clean base `abead5249`; this adjacent file has 15 pass / 4 fail / 1 cancelled both before and after these changes (the combined run also includes the 6 passing modified-inventory tests). No assertions were weakened and no unrelated cache/detection changes were made. Repro from Tovu root (or clean-base worktree): `node --import tsx --test apps/website/src/assistant/__tests__/agents.test.ts`.

Minor: Jini's build regenerates an untracked legacy `packages/plugin-ui-ux-design/` payload; it is excluded from every commit and left alone.

## Cost, architecture and handoff

Existing usage/render/selection calls perform in-memory projections only; no new DB reads/writes, requests, probes, polls or timers. Existing inventory responses now include optional model reasoning: cost per existing response scales with catalog models × their level entries; the two-model high/empty fixture adds **58 UTF-8 bytes**, optional suffix metadata adds **62**. Shared settings CSS is **11,154 UTF-8 bytes** per uncached stylesheet load, replacing Tovu's duplicate rules.

Architecture audit: PASS — existing owners and browser-safe model-selection entry reused, host wiring stays in Tovu, no schema/security/native-permission changes. Function check: duration fill changes only the projection-local summary; effort helper is deterministic O(levels) time/space with direct tests for empty/absent/duplicate/suffix/default cases; row action rendering is directly exercised through keyboard and callback-presence matrices; host projections retain only declared metadata. No unresolved new complexity finding. Coverage was not gamed; focused behavioral evidence is recorded above, with full coverage left to the existing push hook.

Next: explicit decision on the blocked Tovu push, then coordinator review/merge of the delivered branches. Release/publication and Open Marketing dependency adoption remain separate work. Logs and clean-base scratch checkouts are under `/workspace/work/om-chat-2/`.
