# fix-round — complete

All 16 requested findings have been checked and scoped work is complete. Focused verification passed; validation remains partial because unrelated compiler fixtures and an optional export timing fixture also fail on the exact base.

## Branches and delivery

Only `cloud/fix-round` is used in each repository. Bases: Tovu `c11d491f3cb2a695caa5d0f2e700581d747af735`, Jini `f4e3b18a5ea67fc7531357aae05c4495dd593bea` (`origin/cloud/combine`). Started November 6, 2026 at 09:30 America/Los_Angeles; completed around 09:52, within the two-hour cap. No main push, force push, deployment or publication.

The Software Architect, Programmer and TDD personas from the plans branch were loaded. The job and COMMON instructions governed the scoped work.

## Item dispositions

| Item | Disposition and reason |
| --- | --- |
| 1 | Fixed Node 24 resolver recursion: resolve all React/ReactDOM export targets before registering the hook. Real child-process regression reproduced the stack overflow. |
| 2 | Fixed tab Keep running: trusted main IPC establishes a per-site idle-sleep hold before the tab releases presence. Stop, delete, manual Start and Quit release it; automatic recovery/RSS replacement preserves it. |
| 3 | Fixed overlapping closes: asynchronous success/failure changes only its own request, preserving a later prompt and its state. |
| 4 | Fixed empty connection argv: existing quoting grammar now preserves leading/trailing empty strings on an unchanged save. |
| 5 | Fixed mail cleanup race using the existing addressed revision snapshot and transactional settings revision guard. A concurrent selection survives and the conflict is reported. |
| 6 | Fixed two approval cards, reproduced through assembled ToolExecutor and real HTTP answers. Each publish now has one domain-owned shared card; ordinary/no-preview publishes still require approval. Permission and consent are checked again after the answer. Cancellation/headless paths have no provider effects. |
| 7 | Fixed Workspace metadata: only actual read-only status/list actions declare read; mutations retain write. |
| 8 | Fixed unchecked prototype-named choices with a null-prototype ID map. Trusted selection works for __proto__, constructor and toString in both layouts. |
| 9 | Reported first-save 500 was a stale fixture omitting the production create/replace ports; corrected it. This exposed and fixed a real owner-session re-save 400 by reusing the existing trusted replacement opt-in. Nonowner refusal and unchanged secret remain asserted. |
| 10 | Corrected six stale strict hashes. All six changes originate in intentional 44px coarse-pointer CSS commit `1e4b1d4ba92fee6b6b1f73047d9979a0fd5f1b45`; historical render probes proved this. Kept intended output and refreshed exact pins, including item 8. |
| 11 | Corrected stale OAuth key-loss timing, anonymous boot-error envelope, daemon diagnostic and export-history fixtures. Retained or strengthened behavioral assertions; details below. |
| 12 | Fixed observability fixture with an explicit temporary site binding and marker assertion. Teardown awaits runtime readiness, closes the store, then removes its directory. |
| 13 | Split canonical URL validation out of isDesktopMcpCapability and extracted the maintenance test's owner fixture setup. Both meet the ceiling; no debt entry/suppression. |
| 14 | Partly wrong: SiteTrashTab and AllSitesTab still use the broad card selectors. Retained live rules; removed four unused declarations only. Corrected Jini's stale queued-label/dashed-bubble commentary without CSS behavior changes. |
| 15 | Fixed awaited rejection-callback Semgrep detection in both repos with positive and safe negative fixtures. Replaced five current trailing-slash regex sites (brief said three) with a linear backward scan; covered long separator strings and directory boundaries. |
| 16 | Already correct on the requested base; left manifests unchanged. Recreated node_modules using the frozen lockfile and built provider-plugins successfully. React/Recharts declarations date to `6d55eae6a`; ECharts to `285b819b5`. The prior report described stale installed dependencies, not a missing manifest dependency on this base. |

## Setup and affected verification

Commands below run after `source /workspace/.tovu-build/env.sh`. Local subprocess/HTTP tests used network-enabled execution permissions for reliable child processes and loopback. PostgreSQL was not needed. No full suites or coverage percentage are claimed.

In Jini:

```sh
CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/fix-round/pnpm-store
pnpm --filter @jini-ai/core run build
pnpm --no-bail -r build
npm --prefix packages/provider-plugins run test -- src/__tests__/distribution-manifest.test.ts src/__tests__/artifact.integration.test.ts
```

Install recreated node_modules, recursive build passed, and provider tests passed 16/16. The first install attempted a read-only default pnpm store; the writable store resolved that setup failure. An initial artifact-test attempt without working child-process permissions returned empty npm pack output; the permitted rerun passed all 16 cases. Browser chart tests emit jsdom canvas diagnostics but pass their behavior assertions.

In Tovu:

```sh
npm --prefix packages/contracts run build
npm --prefix packages/sdk run build
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
```

Passed. After the Jini edits, rebuilt ui, chat, agent-plugins and devops and relinked Tovu again. No manifest/lockfile workaround was committed.

Focused groups: desktop 183 main/preload/loader and 15 renderer cases; connections/mail 67; publish 157 with one unchanged optional skip; UI 111; Workspace 81; cleanup 108 website, 9 admin and 1 capability; devops coverage 139. Semgrep: each repository's six local rule suites passed. Exact commands and red-first evidence follow.

## Bugs found

- Fixed: renderer loader recursively resolved itself on Node 24.
- Fixed: tab Keep running allowed the selected site to idle-sleep.
- Fixed: an older asynchronous close discarded or contaminated a newer close prompt.
- Fixed: unchanged connection saves lost empty argv entries.
- Fixed: mail plugin cleanup could overwrite concurrent provider selection.
- Fixed: custom-domain static publish requested two approvals for one action.
- Fixed during approval ownership change: ordinary publication must preserve permission and consent checks after the person answers; regression tests enforce this ordering.
- Fixed: Workspace read-only actions inherited write approval.
- Fixed: an unchecked standalone __proto__ choice could not be selected.
- Fixed: owner human-session mail-key rotation omitted the existing trusted replacement opt-in.
- Corrected fixture: project mail credential test omitted production write ports and generated an artificial first-save 500.
- Corrected fixtures: six hashes lagged intended touch-target CSS; OAuth key-loss fixture failed before the intended provider rejection; boot fixture expected authenticated details at an anonymous boundary; daemon fixture omitted current HTTP/code diagnostic; export notes fixture omitted the completed row from history.
- Corrected fixture: ordinary HTTP export expected a theme-authored loader tag removed from shipped themes; it now supplies the supported authored reference whose export it asserts.
- Fixed fixture: observability boot could write its protection marker at the default site path.
- Fixed complexity: capability source helper and form maintenance test exceeded their ceilings.
- Fixed: four unused admin CSS declarations and obsolete Jini queued-message commentary remained.
- Fixed: awaited rejection-callback provider errors escaped both scanners.
- Fixed: five trailing-slash regex sites could rescan long separator strings quadratically.
- Open, baseline: test compiler rejects obsolete assertAccessApprover fixture fields in mail-status-tool.test.ts (lines 88/185), provider-tools.unit.test.ts (line 124), and site-mailer.unit.test.ts (line 273); one related callback has an implicit-any principalId. Five diagnostics reproduce on the exact base.
- Open, baseline: admin agent-plugin-choice-replay.unit.test.ts calls at lines 16/52 omit workspaceId, conversationId, preferenceRevisionSeq and selected. Two diagnostics reproduce on the exact base.
- Open, baseline: opt-in real-export test's 1000-event-loop-turn wait expires before its real exporter finishes and contaminates following cases with an active job. Exact-base reproduction confirms the same timeout; no timing/gate/assertion workaround was introduced.
- Listed only: pre-existing project-ipc.test.ts unused collection and cognitive-15 fixture; warning-only canary/nested-flow/template lint findings remain. No debt entries or suppressions were added.

## Architecture, integrity and state cost

Architecture review PASS for scoped changes: shared coverage/scanning logic stays in Jini; Tovu keeps product wiring, existing ports and desktop lifecycle composition. No new table, framework, package, dependency, background process or polling loop. No test, assertion, rule, skip gate or measurement scope was disabled, weakened or deleted.

The tab hold adds one boolean per existing site runtime plus one IPC and one tracked-site read per Keep running answer. It intentionally retains that site's existing server process and memory, with no extra renderer/process/timer. Existing RSS restarts remain enabled. Confirmation maps remain proportional to selected IDs. Connection serialization remains linear in argv bytes. Coverage path trimming is linear in path bytes.

Mail cleanup makes one definition lookup and one addressed setting read per relevant disable, with at most one guarded write and its addressed revision read in the existing transaction. No write occurs for unchanged lanes. Mail owner replacement awaits the existing owner-principal promise on credential PUT, without new persistent state. Ordinary publish preserves detached input/actor/run snapshots and adds bounded preflight/effect permission and consent reads around one approval; domain publish removes one exchange. No new periodic read/write costs.

Changed units were reviewed for direct test seams, concurrency, bounds, authority and variable meaning. Adversarial probes cover overlapping prompts, concurrent mail selection, prototype IDs, permission/consent changes during approval, long path separators and anonymous error equivalence. Validation remains PARTIAL only for the listed baseline compiler/optional timing issues. No live Electron launch was performed; desktop evidence exercises the actual hook, renderer hooks, preload and main IPC.

## Desktop exact verification


Cwd `/workspace/Tovu/apps/desktop`:

```sh
node --test src/one-react-loader.test.ts
```

1 passed (red before loader fix as above).

```sh
node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test src/project-ipc.test.ts src/project-ipc-dispatch.test.ts src/preload/preload.test.ts src/one-react-loader.test.ts
```

Final 183 passed, zero failures/skips; full affected main/preload tests only. Log `/workspace/work/fix-round/desktop-main-tests.log`.

```sh
node --import ./scripts/one-react.ts --import tsx --test src/renderer/use-tab-close-ask.hooks.render.test.ts src/renderer/use-project-tabs.hooks.render.test.ts
```

Final 15 passed, zero failures/skips; log `/workspace/work/fix-round/desktop-renderer-tests.log`.

```sh
npm run typecheck
```

Passed all four existing desktop tsconfigs (preload, renderer, main and live-verify). Log `/workspace/work/fix-round/desktop-types.log`. After the final equivalent bridge type cleanup, additionally ran `npx tsc -p tsconfig.renderer.json` (log desktop-renderer-types.log).

Cwd `/workspace/Tovu`:

```sh
npx eslint --no-inline-config --rule '{"complexity":["error",9],"sonarjs/cognitive-complexity":["error",9]}' apps/desktop/scripts/one-react.ts apps/desktop/src/one-react-loader.test.ts apps/desktop/src/project-ipc.ts apps/desktop/src/preload/preload.mts apps/desktop/src/renderer/runner-api.ts apps/desktop/src/renderer/use-tab-close-ask.hooks.ts apps/desktop/src/renderer/use-tab-close-ask.hooks.render.test.ts
```

Passed (zero errors; four existing warnings in project-ipc.ts). Including old `project-ipc.test.ts` and `preload.test.ts` in the lint command found unchanged test debt: unused collection at project-ipc.test.ts:985 and cognitive complexity 15 at :2417 (line numbers may shift), plus existing warning-only secret-like fixtures and nested increment. These pre-existing lines were left unchanged under smallest-scope instruction; new desktop test callbacks pass the ceiling. Logs desktop-source-lint.log and desktop-lint.log.

`git diff --check` passed.


## Connections and mail exact verification


All commands cwd `/workspace/Tovu`, after `source /workspace/.tovu-build/env.sh`. Final commands used network-enabled tool permissions, including local tests. Tests are affected tests only. No tests/assertions disabled, removed, skipped or weakened. Original assertions retained in corrected fixture.

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/external-mcp/__tests__/unit/save-form.unit.test.ts apps/website/src/server/runtime/composition/__tests__/site-mailer.unit.test.ts apps/website/src/server/__tests__/routes/mail-providers-route.test.ts
```

**67 passed, 0 failed, 0 skipped.** Log `/workspace/work/fix-round/connections-final-tests.log`. Red evidence logs `connections-red.log` (item4), `connections-mail-red.log` (item5), `connections-http-red.log` (owner rotation). Original outdated fixture copied temporarily from origin/cloud/combine to adjacent `.fix-round-baseline.test.ts`, run with `--test-name-pattern='mail card saves attach'`, then removed: first-save500 confirmed in `connections-http-original-fixture.log`.

```sh
npx eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/features/external-mcp/save-form.ts apps/website/src/features/external-mcp/__tests__/unit/save-form.unit.test.ts apps/website/src/server/runtime/composition/site-mailer.ts apps/website/src/server/runtime/composition/__tests__/site-mailer.unit.test.ts apps/website/src/server/inbound/admin-http/routes/system/mail-providers.ts apps/website/src/server/__tests__/routes/mail-providers-route.test.ts
npx tsc -p tsconfig.json --noEmit
```

**Both pass.** ESLint 0 errors, one unchanged `sonarjs/no-nested-incdec` warning at existing test helper line34. Logs `connections-final-lint.log`, `connections-final-tsc.log`.


## Confirmation and Workspace exact verification


All commands run in /workspace/Jini with `source /workspace/.tovu-build/env.sh` first.

- `npm --prefix packages/ui run test -- src/features/mcp-ui/__tests__/surfaces/confirmation.test.ts` baseline: 67 pass, 6 hash failures.
- `npm --prefix packages/ui run test -- src/features/mcp-ui/__tests__/surfaces/confirmation.test.ts -t 'initially unchecked prototype'` red: standalone case failed (missing __proto__), grouped case passed; existing unrelated cases filtered for this diagnostic only.
- `node --test packages/agent-plugins/google-workspace/__tests__/admin-surfaces.pin.test.mjs` red: new effect case failed connection/status write vs read; final 4/4 pass.
- `npm --prefix packages/ui run test -- src/features/mcp-ui/__tests__/surfaces/confirmation.test.ts src/features/mcp-ui/__tests__/surfaces/document.test.ts`: final 111/111 pass.
- History probe: `node --import /workspace/Jini/node_modules/tsx/dist/loader.mjs /workspace/work/fix-round/hash-history.mjs /workspace/work/fix-round/history/<revision>/packages/ui/src/features/mcp-ui/surfaces/confirmation.ts <revision>`, revisions 82e44e07f, 1e4b1d4ba, 8eaa43138. Full digests and minimal HTML diff retained in scratch history-hashes.log and history/*.minimal.html. No tracked files changed for historical runs.

- `node --test packages/agent-plugins/google-workspace/__tests__/admin-surfaces.pin.test.mjs packages/agent-plugins/google-workspace/__tests__/surfaces.contract.test.mjs packages/agent-plugins/google-workspace/__tests__/surfaces.security.test.mjs`: 81/81 pass.
- `npm --prefix packages/ui run typecheck`: pass.
- `npm --prefix packages/chat run typecheck`: pass.
- `npm --prefix packages/agent-plugins run typecheck`: pass.
- `pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/ui/src/features/mcp-ui/surfaces/confirmation.ts packages/ui/src/features/mcp-ui/__tests__/surfaces/confirmation.test.ts packages/chat/src/react/features/chat-pane/styles.ts packages/agent-plugins/google-workspace/__tests__/admin-surfaces.pin.test.mjs`: pass, zero output.
- `git diff --check -- packages/agent-plugins/google-workspace/tovu-admin-surfaces.json packages/agent-plugins/google-workspace/__tests__/admin-surfaces.pin.test.mjs packages/ui/src/features/mcp-ui/surfaces/confirmation.ts packages/ui/src/features/mcp-ui/__tests__/surfaces/confirmation.test.ts packages/chat/src/react/features/chat-pane/styles.ts`: pass.

All executable verification used network:true additional sandbox permissions, including local tests. Logs are under /workspace/work/fix-round/confirmation-*.log and google-effects-*.log. Plugin manifest/version unchanged: this job corrects bundled descriptor effects without publishing a release; no artifact/catalog metadata was manually altered.


## Fixture, complexity and scanner exact verification


All JS commands first source /workspace/.tovu-build/env.sh. Tovu cwd/workspace/Tovu, Jini cwd/workspace/Jini unless stated. Runtime listener tests use permitted network/loopback access.

Tovu base failure reproduction (95 total,92 pass/3 fail), then final same prefix adding2 fixture files (108 pass):
```
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/external-mcp/__tests__/external-mcp-oauth.test.ts apps/website/src/server/inbound/admin-http/__tests__/dev-auth-failures.unit.test.ts apps/website/src/server/runtime/lifecycle/__tests__/assistant-daemon-connection.test.ts apps/website/src/features/forms/__tests__/form-file-maintenance.test.ts apps/website/src/server/runtime/composition/__tests__/deps-observability-wiring.integration.test.ts
```
After final teardown correction, identical prefix on only deps-observability-wiring.integration.test.ts:2pass. No new/removed/skipped test declarations in existing fixtures.
```
node --import tsx --test apps/website/src/assistant/__tests__/desktop-mcp-capability.unit.test.ts
```
1pass.

From Tovu/apps/admin:
```
node_modules/.bin/vitest run src/features/sites/__tests__/SiteExportTab.static.unit.test.tsx
```
9pass. Base1fail/8pass.

Tovu strict lint (0errors,5 existing warnings:2 existing OAuth assertions-in-tests warnings,source concise-regex warning,auth canary warning and maintenance nested-flow warning; exact output log final-fixture-lint.log):
```
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/assistant/desktop-mcp-runtime.ts apps/website/src/assistant/__tests__/desktop-mcp-capability.unit.test.ts apps/website/src/features/forms/__tests__/form-file-maintenance.test.ts apps/website/src/server/runtime/composition/__tests__/deps-observability-wiring.integration.test.ts apps/website/src/server/inbound/admin-http/__tests__/dev-auth-failures.unit.test.ts apps/website/src/server/runtime/lifecycle/__tests__/assistant-daemon-connection.test.ts apps/website/src/features/external-mcp/__tests__/external-mcp-oauth.test.ts
```
Final observability file separately checked under same policy after teardown correction:0errors0warnings. Export test separately checked from admin using ../../node_modules/.bin/eslint and same rules; see export-tab-lint.log.

Jini:
```
npm --prefix packages/devops run test -- src/checks/coverage/__tests__
npm --prefix packages/devops run typecheck
npm --prefix packages/devops run build
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10],"sonarjs/super-linear-regex":"error"}' packages/devops/src/checks/coverage/lcov.ts packages/devops/src/checks/coverage/floors.ts packages/devops/src/checks/coverage/disk.ts packages/devops/src/checks/coverage/__tests__/coverage.test.ts
```
139pass; types/build pass;lint0errors1 existing warning.

Semgrep1.184.0 installed into disposable /workspace/work/fix-round/semgrep-env, no repository dependency changes. Each repo cwd:
```
SEMGREP_SETTINGS_FILE=/workspace/work/fix-round/semgrep-settings.yml SEMGREP_LOG_FILE=/workspace/work/fix-round/semgrep.log /workspace/work/fix-round/semgrep-env/bin/semgrep --test .semgrep --oss-only --metrics=off --disable-version-check
```
Each6/6 local rule suites passes. Jini red5/6 missed138;Tovu red5/6 missed57. Initial Semgrep setup retries selected writable settings/log paths (default home is read-only), not source failures.

Final Tovu production compiler passed. Final test compiler has only the five baseline diagnostics listed under Bugs found; the two interim test typing errors were corrected. No coverage claim or full suite run.


## Publish exact verification
 all source /workspace/.tovu-build/env.sh, cwd /workspace/Tovu; HTTP tests use network-enabled sandbox for loopback.

Red (after base rebuild/relink):
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-name-pattern='assembled custom-domain' apps/website/src/features/deployments/static-publish/__tests__/domain-publish-tool.unit.test.ts
Result: one failure, actual2 expected1 cards, provider publication otherwise completed. Log publish-red.log.

Affected:
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/deployments/static-publish/__tests__/domain-publish-tool.unit.test.ts apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.static-publish.integration.test.ts apps/website/src/features/deployments/__tests__/publish-agent-tools.unit.test.ts apps/website/src/assistant/__tests__/tool-approval-policy.test.ts
Final result after all source edits: 157 passed, 0 failed, 1 pre-existing optional skip (158 total). Earlier pre-recheck run: 155 passed. Skip name: "execute: exported bytes reach publishStaticSite and the same call reports the provider outcome"; existing gate TOVU_G3_REAL_EXPORT !== "1", reason "port test: real site export binds loopback". No skip added or altered. Optional attempt with TOVU_G3_REAL_EXPORT=1 is recorded below; original skip/gate retained.

Focused after final detached actor/run snapshot:
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-name-pattern='assembled' apps/website/src/features/deployments/static-publish/__tests__/domain-publish-tool.unit.test.ts
Result:4pass0fail0skip (before adding the two effect-boundary recheck regressions).

npx tsc -p tsconfig.json --noEmit
Passed (publish-tsc.log). Final test compiler has five baseline diagnostics; introduced test type diagnostics were corrected with explicit descriptor type and error fallback.

npx eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/features/deployments/publish-agent-tools.ts apps/website/src/contracts/core/tool-metadata/deployments.ts
Passed, no warnings/errors. Expanded changed-test lint initially identified increased complexity in the provider fixture helper; split the emitter adapter. Expanded lint now passes with0 errors and7 warnings (unchanged-file warnings plus return-style warnings in the test adapters; no complexity errors). No suppressions/debt list.

git diff --check -- <six paths above>
Passed.


## Jini pushed commit ledger

- `39b4c0e3b8495029b3c324a92a2c7dff4e5d9c03` — docs: record fix round in progress
- `2c4816fbfa904f7552e540af001e1ed6edafc1d4` — fix: preserve confirmation choices and declare read effects
- `2bcc41d4a914a0b609e7c1713337ec71f35ff259` — docs: record verified fix round progress
- `4daf545fe82e53b907a6179edad351ea67d92d98` — fix: cover awaited rejections and trim coverage paths linearly

## Tovu pushed commit ledger

- `fdf8257f6a27a7fa3d74d291f2569f5d911890ab` — fix(desktop): resolve React targets before registering loader
- `f27ec74d66c6b59d10e0d5343bdb5cea39f26b38` — fix(desktop): retain running sites and concurrent close prompts
- `4037de4f07c3013891f3fbbd545462f35670a939` — fix: retain connection arguments and guard mail changes
- `07965b1abdc95278615c071e4a6b46f33806c553` — docs: record verified fix round progress
- `f82c3208e3c1e0acc240b54e9a258e814857fae0` — fix: isolate fixtures and complete scoped cleanup
- `b61cfa68bca6e6728e3bd3f260fdedb30d0ee285` — fix: ask once for static publication and recheck before effects

Final report-only commits follow the ledgers above; their SHAs are supplied in the final response. All delivery targets only cloud/fix-round.

## Final type checks and baseline proof

In Tovu, after all source edits:

```sh
npx tsc -p tsconfig.json --noEmit
NODE_OPTIONS=--max-old-space-size=6144 npx tsc -p tsconfig.tests.json --noEmit
npm --prefix apps/admin run typecheck
```

Production types pass. Test types report the same five baseline diagnostics; admin types report the same two baseline diagnostics. Both were independently reproduced on a detached exact-base worktree at `c11d491f3`, using identical installed dependencies:

```sh
cd /workspace/work/fix-round/tovu-publish-base
npx tsc -p apps/admin/tsconfig.json --noEmit
NODE_OPTIONS=--max-old-space-size=6144 npx tsc -p tsconfig.tests.json --noEmit
```

No new compiler diagnostics remain. Desktop's four configs and Jini ui/chat/agent-plugins/devops typechecks pass, as listed above.

## Optional export timing check

The following opt-in affected command was also tried in Tovu:

```sh
TOVU_G3_REAL_EXPORT=1 node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/deployments/static-publish/__tests__/domain-publish-tool.unit.test.ts apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.static-publish.integration.test.ts apps/website/src/features/deployments/__tests__/publish-agent-tools.unit.test.ts apps/website/src/assistant/__tests__/tool-approval-policy.test.ts
```

142 passed, 14 failed. The optional real-export case exhausted its existing 1000-setImmediate-turn fixture wait; 13 later failures followed from the still-running shared job. The exact same first failure reproduces on the untouched base:

```sh
cd /workspace/work/fix-round/tovu-publish-base
TOVU_G3_REAL_EXPORT=1 node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-name-pattern='execute: exported bytes reach' apps/website/src/features/deployments/__tests__/publish-agent-tools.unit.test.ts
```

Baseline: 0 passed, 1 failed with the same fixture timeout. Stopped on this known limitation; retained the original opt-in gate and all assertions. The ordinary real-export HTTP integration and six assembled approval regressions pass in the standard affected run. No new skips were introduced.
