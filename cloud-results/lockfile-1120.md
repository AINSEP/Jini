**Jini `release/lockfile-1120` @ `9abbfb7d0` · Tovu `release/lockfile-1120` @ `d83f1924b`** (last content commits; only this SHA-line commit follows each)

# lockfile-1120 (2026-11-21) — PARTIAL (published: nothing; see step 10)

Unattended cloud run, 00:57–~02:30 UTC. Node v24.22.3 (`/opt/node24`), pnpm 10.33.2 (corepack). No subagents, no codebase-memory tools, no force-push, no `--no-verify`. Only `release/lockfile-1120` pushed in Jini and Tovu (AI-Dev-Shop untouched). `main`, `refactor/terra`, `plan/*`, `integ/*` read only.
Bases: Jini `origin/integ/merge-7-2026-11-20` @ `06559affb`; Tovu `origin/integ/merge-7-2026-11-20` @ `8d1a4c274` (its `cloud-results/combine-7-tovu.md` existed — a draft "full suite still running" — when the Tovu part started at 01:36, so no wait was needed).

## Summary
| step | status | commits (Jini unless marked) |
|---|---|---|
| 1 base install/build/guard | DONE | `874c0f26a` |
| 2 packed-entry proof | DONE (1 scope typo) | `874c0f26a` |
| 3 R8a 4–5, R8b 6–8 | DONE | `9b95d72bf` `ac3806e39` `ca8f2f49f` `47856b7a5` `d72ef4344` `fe7647eb4` `b2852c6e3` `c69df3cb8` |
| 4 R8 step 9 (drop daemon's agent-runtime) | LEFT — precondition not met | — |
| 5 R11a | DONE | `11b0d2558` `1156608cd`; Tovu `71cd5a84b` |
| 6 R11b-1 steps 1, 3–4 | DONE | `98c037e46` `c1f14c2cf` `5487cfd1e`; Tovu `71cd5a84b` `8258649f5` |
| 7 R11b-2 step 2 | DONE | `0cfd3e72e` |
| 8 R11b-3 | LEFT (time) | — |
| 9 release items | DONE | `b81e34fdd` `33324d5a4` `be97c1075` |
| 10 suite + version + publish | suite DONE; version set (not `changeset version`); **publish NOT DONE (no npm auth)** | `33324d5a4` `c58326bb3` `04ec7c284` |
| 11 Tovu bump + lockfiles | PARTIAL: manifests bumped + pairs; **lockfiles not regenerated** (versions not on npm) | Tovu `71cd5a84b` `aa9f8d3db` `8258649f5` |
| 12 Tovu checks | DONE (all = combine-7 final except the 2 lock-sync tests) | — |
| 13 local-only checks | LISTED below | — |

## Step 1 — base gates (`06559affb`): DONE
`pnpm install --frozen-lockfile` 0. `pnpm build` does not exist at the root (exit 254); `pnpm --no-bail -r build` 0, 0 `error TS`. `pnpm guard` 0, zero violations.

## Step 2 — packed-entry proof: DONE
`pnpm pack` core, admin, devops, http-kit, cms + protocol (closure) → `npm install` of the 6 tarballs in an empty consumer (exit 0) → `import()` of every subpath (`lockfile-1120-packed-entry-probe.{mjs,txt}`): all resolve from the tarball — cms `./presentation/html`, `./presentation/page-head`, `./forms/result-query`, `./forms/result-flash`, `./themes/preview/refresh`, `./themes/token-aliases`, `./media/cover-image`; http-kit `./range`; devops `./backup/plan-store`, `./backup/push-jobs`; core `./errors/{idioms,sentences,bindings,catalog,reporter,approved-cause,disclosure,error-id,testing}`, `./model-facing-tool-errors`.
- **`@jini-ai/cms/seo/cover-image` does not exist** (ERR_PACKAGE_PATH_NOT_EXPORTED); the entry is `./media/cover-image`.
- No published version (0.7.1, 0.7.2) ships any of these subpaths.

## Step 3 — R8 (daemon-r8-2 series rebased onto the split agent-executor): DONE
Patches 0001, 0002, 0005 via `git am --3way` with conflicts resolved; 0003, 0004, 0006 re-done by hand (no fake ancestor: `events.ts` was split by `96ec2664`). Port of the `events.ts` hunks: `child-stream-events.ts` (stream parsers from `AgentRuntimePort.streams`), `child-lifecycle.ts` / `acp-events.ts` / `pi-rpc-events.ts` (`identityKind`, session attach types), `event-cleanup.ts` (dead platform import). Drift fixed: core's `collectProcessTreePids` is object-form now (`runtime-bindings.ts`); `createModelReceiptTracker({ identityKind, startingModel }, { models })`; two split-era characterization tests take the fixture's ports; `resolveCodexDisablePlugins` and `pi/options.ts` deleted with their only caller. `pnpm-lock.yaml` folded into the R8a step 5 commit (node-adapters `link:` for daemon (dev), server, minimal-host, reference-web). 8 injection-debt rows and 2 size-debt values lowered. One why-comment (SEC-001) the reflow dropped was restored.
Verified: R8a tip `d72ef4344` and R8b tip `b2852c6e3` in a clean worktree (frozen install, build 0): daemon 4839 → 4841 passed, server 469, node-adapters 16, minimal-host 3; daemon/server/node-adapters/reference-web `tsc` 0.

## Step 4 — R8 step 9: LEFT (stop condition)
R8-RUNTIME §9: remove `@jini-ai/agent-runtime` from daemon `dependencies` "only when R7's `model-proxy`/`xai`/`research`/`agents` pairs have landed". They have not: `src/http/model-proxy.ts:121`, `src/http/xai.ts:141`, `src/http/research-tavily.adapter.ts:2` still import agent-runtime **values**. Dropping the dependency would break those routes at runtime. `@jini-ai/platform` also stays (imported by `terminal-session.ts`, `http/{attachment-persistence,terminals,host-tools}.ts`).

## Step 5 — R11a: DONE
- `11b0d2558`: the prepared patch (fileLock + atomicWriter required on `AgentPluginLifecyclePorts`, T1–T3) applied cleanly (3-way); `lifecycle/node.ts` → `packages/node-adapters/src/agent-plugins.ts` (body unchanged), `./agent-plugins` entry added, `./lifecycle/node` removed. Guard's OD-3 rule allows an adapter to name a domain's port **types** only as a peer: `@jini-ai/agent-plugins` is an optional, classified peer (+ devDependency) of node-adapters. The adapter's own tests moved with it (node-sleep, native-effects.contract, and the effect describe blocks — assertions unchanged; node-adapters 16 → 35 tests). agent-plugins' own tests use a test-local real-disk fixture (cannot import node-adapters: cycle). neutral-host declares and imports node-adapters.
- `1156608cd`: plugins `PluginSourceDeps.fileLock` (and `PluginRuntimeHostBinding.fileLock`) required; T4 `source-drafts.lock.unit.test.ts`; platform left the peer fields of agent-plugins and plugins (3 debt rows).
- "Prove preset + Tovu plugin-runtime bindings": the server preset constructs no plugin runtime (nothing to bind); Tovu binds `fileLock: nodeFileLock` in `server/runtime/composition/plugin-runtime.ts` (not in `pluginHostBinding`, which the tier-2 worker imports) and `features/agent-plugins/lifecycle.ts` imports the effects from node-adapters. Tovu typecheck green on it.
- Tests: agent-plugins 2187 passed, plugins 1017, node-adapters 35.

## Step 6 — R11b-1 steps 1, 3–4: DONE
- mcp `installOwnedJsonAgent({ …, files: { fileLock, writer } })` + T1 (`98c037e46`).
- sidecar `writeJsonFile` / `writeDaemonRegistryRecord` / `createSupervisorRegistry` take `writer` (`c1f14c2cf`); server preset passes `nodeAtomicWriter`.
- sidecar `createNodeDaemonProcessAdapter` takes `process: ProcessControlPort` and `commandShell: { platform, fallbackComSpec }` (`5487cfd1e`). **Deviation from the sheet** (decision below): the sheet's `planInvocation` + `ambientEnv = process.env` default fails guard HW9 (no `process.env` in sidecar), so the host states the ComSpec fallback via `nodeCommandShell({ env: process.env })` (the daemon executor's pattern) and sidecar calls core's pure planner. T4 cases: the host's platform/ComSpec reach the planner; the Windows wait gets `{ pid }`. `@jini-ai/platform` left sidecar's dependencies.
- Tests: mcp agent-install 91, sidecar 418 (+2), cli 604.

## Step 7 — R11b-2 step 2: DONE (`0cfd3e72e`)
No mcp source imports platform; it leaves `dependencies` (devDependency kept), debt row retired, re-locked.

## Step 8 — R11b-3: LEFT
Not started: threading `GuardedHttpPort.fetch` through the media dispatch engine touches 29 files (21 with `vi.mock('@jini-ai/platform/http/guarded')`) plus Tovu/reference-web hosts; did not fit after steps 3–7 and the release cut.

## Step 9 — release items: DONE
- `api:check` recorded first (`lockfile-1120-api-check-before-update.txt`: daemon, mcp, node-adapters, plugins, server, sidecar drift; agent-plugins via the patch's baseline), `api:update` in `b81e34fdd` and `be97c1075` (sidecar step 4). `api:check` on the tip: 0 drift.
- Plugin catalog regenerated: no diff before the version cut; re-sealed after it (`guard:plugins:catalog` 68/68).
- `@jini-ai/admin` peer on core `^0.7.0` → `^0.7.3-next.1` (first version with `./errors/idioms`). `@jini-ai/oauth` ships core as `workspace:^` (packs to `^0.7.3-next.1`); its stray devDependency `^0.7.1` → `workspace:^`.

## Step 10 — suite, version, publish
- **Version**: `33324d5a4` sets the 41 public packages to **0.7.3-next.1** (precedent `a2b536ef`, the unpublished 0.7.3-next.0 cut; next.0 left to that branch). **Not `changeset version`**: 3 pending changesets carry 4 `major` bumps (cookie-consent-react-subpath, core-observability-contract ×2, r13b-legacy-owner), so it would mint **1.0.0** — owner decision. Changesets stay unconsumed.
- A prerelease does not satisfy `^0.7.x`; a non-frozen install then pulled npm 0.7.2 copies into the workspace, and npm 7+ consumers would hit ERESOLVE on `^0.7.0` peers. Every literal internal range was raised: devDependencies → `workspace:^`, peerDependencies → `^0.7.3-next.1` (agent-plugins, agent-runtime, agentic, chat, infra, integrations, server, user-management). Lockfile diff: specifier lines only.
- **Publish: NOT DONE** — no npm credentials in the container (no `NPM_TOKEN`, no auth in the npm userconfig). Would be published (41, all `--tag next`, via the tag → `publish.yml`): @jini-ai/admin@0.7.3-next.1, @jini-ai/agent-plugins@0.7.3-next.1, @jini-ai/agent-runtime@0.7.3-next.1, @jini-ai/agentic@0.7.3-next.1, @jini-ai/analytics@0.7.3-next.1, @jini-ai/artifacts@0.7.3-next.1, @jini-ai/capability-providers@0.7.3-next.1, @jini-ai/chat@0.7.3-next.1, @jini-ai/cli@0.7.3-next.1, @jini-ai/cms-forms@0.7.3-next.1, @jini-ai/cms@0.7.3-next.1, @jini-ai/commerce@0.7.3-next.1, @jini-ai/cookie-consent@0.7.3-next.1, @jini-ai/core@0.7.3-next.1, @jini-ai/daemon@0.7.3-next.1, @jini-ai/db@0.7.3-next.1, @jini-ai/desktop-host@0.7.3-next.1, @jini-ai/devops@0.7.3-next.1, @jini-ai/diagnostics@0.7.3-next.1, @jini-ai/http-kit@0.7.3-next.1, @jini-ai/infra@0.7.3-next.1, @jini-ai/integrations@0.7.3-next.1, @jini-ai/mcp@0.7.3-next.1, @jini-ai/memory@0.7.3-next.1, @jini-ai/node-adapters@0.7.3-next.1, @jini-ai/oauth@0.7.3-next.1, @jini-ai/platform@0.7.3-next.1, @jini-ai/plugin-catalog@0.7.3-next.1, @jini-ai/plugins@0.7.3-next.1, @jini-ai/protocol@0.7.3-next.1, @jini-ai/provider-plugins@0.7.3-next.1, @jini-ai/registry@0.7.3-next.1, @jini-ai/sandbox@0.7.3-next.1, @jini-ai/search@0.7.3-next.1, @jini-ai/server@0.7.3-next.1, @jini-ai/sidecar@0.7.3-next.1, @jini-ai/sqlite@0.7.3-next.1, @jini-ai/ui-kit@0.7.3-next.1, @jini-ai/ui@0.7.3-next.1, @jini-ai/user-management@0.7.3-next.1, @jini-ai/vibecoding@0.7.3-next.1
  Note `@jini-ai/node-adapters` has never been published (first release).
- **Full suite** (worktree at `33324d5a4`, fresh frozen install + full build 0, `npm --prefix <pkg> run test -- --maxWorkers=2 --minWorkers=1`, 48 packages/examples): 58,424 passed / 7 failed. Every red:
  - agent-plugins 1, chat 2, infra 1: manifest tests whose floor regex/pins did not accept `^0.7.3-next.1` → fixed in `c58326bb3`, `04ec7c284` (re-run green).
  - **cms 1 (RED, LISTED)**: `cms/forms/src/__tests__/package-boundary.test.ts` wants a CHANGELOG heading equal to the version; only `changeset version` writes it (ties to the decision above).
  - commerce, search: my runner passed `--maxWorkers` twice (their scripts already do) → re-run with their own script: commerce 52 + 11 + 1421 passed, search 371.
  - neutral-host 1 (BASE-RED): `contribution-contracts.test.ts` walks `tovu-*.json`; combine-7 renamed them `jini-*.json`.
  - plugin-fixture-provider 1 (BASE-RED): expects version 0.6.19, package is 0.7.1 (unchanged, private).
  - reference-web e2e (ENV): `playwright` package not resolvable from the example.
- **Final gates on the tip**: frozen install 0; `pnpm --no-bail -r build` 0 (0 `error TS`); `pnpm -r --if-present run typecheck` 0 + scripts tsc 0; `pnpm guard` 0; size 0; complexity 1 (2 New = combine-7's, BASE-RED); hooks 0; `api:check` 0 drift; log-safety 1 (9 lines, identical to combine-7, BASE-RED); error gate WARN 29 New (identical to combine-7); why-comments `--base 06559affb` 1 — 28 lost (27 R8 + 1 sidecar). Outputs: `lockfile-1120-gate-*.txt`, `lockfile-1120-final-guard.txt`, `lockfile-1120-full-suite.txt`.
  Tarball install proof at the new version: `pnpm pack` of all 41 public packages → one `npm install` of the 41 tarballs (exit 0, no ERESOLVE with the raised peer floors) → imports of node-adapters `./agent-plugins|./fs|./process`, sidecar, `./supervisor/node`, mcp, daemon, core `./errors/idioms`, admin, oauth all OK; plugins `./host/node` and agent-plugins `./lifecycle` need `semver`, their declared opt-in optional peer (by design) — `lockfile-1120-next1-install-probe.{mjs,txt}`.
  Ratchets vs the merge-7 base: size 0; complexity = combine-7's 2 (BASE-RED); hooks 0; error gate 29 New = combine-7 final, identical list; log-safety identical to combine-7 (BASE-RED); why-comments `--base 06559affb`: 28 blocks lost — 27 are `@default`/resolver docs of options and helpers R8 deleted, 1 is sidecar's note on the removed platform-ABI options (decision below).

## Step 11 — Tovu: PARTIAL
- Branch from `8d1a4c274`. Setup: `npm ci --ignore-scripts` root/admin/desktop 0, `link-jini` to this Jini tree, contracts + sdk built.
- `71cd5a84b`: every `@jini-ai/*` range in root, apps/admin, apps/desktop, apps/site-chat, packages/contracts, packages/sdk → `^0.7.3-next.1` (provider-plugins exact `0.7.3-next.1`), the `@jini-ai/chat@` override selector follows, `@jini-ai/node-adapters` declared at root and apps/desktop. Plus every host pair (R8 host patches re-done on the split scope: `createScopeAgentExecutor`, `startBridgeProbe`, `startupMessage` threaded as `RunStartRequired.startupMessage`; R11a; R11b-1 mcp/sidecar writer). `8258649f5`: the sidecar adapter pair (4 callers). `aa9f8d3db`: desktop test pin.
- **Lockfiles NOT regenerated**: `npm install` cannot resolve 0.7.3-next.1 (or node-adapters at all) until the Jini tag publishes. This also leaves the downgraded core 0.7.0 pin in both lockfiles. Tarball-only installs were not committed into any lockfile.

## Step 12 — Tovu checks (linked to the Jini tip)
`typecheck` 0, `typecheck:tests` 0, admin `tsc` 0, desktop `typecheck` 0 (all four configs). `check:boundaries` 20 errors / 111 warnings = combine-7 final (only module count +3), `check:architecture` identical, `typecheck:scripts` identical (3 base-red), `worker-import-graph.test.ts` identical case list (17 ✖ lines, base-red incl. `C7-theme-preview-refresh-public-barrel`).
Targeted tests: website assistant/daemon files 203/208 — the 5 red also fail on the base (source-shape wiring tests); sidecar-adapter callers 56/56; desktop agent/service/peers 62/64 — the 2 red are `jini-mcp-peers.test.ts` lock-vs-manifest checks (integrations, sidecar), red **until the lockfiles are regenerated**.
COMMIT-PLAN mutations: tv-z1 H-LIST-NEWS (remove `+ 1`; `>` → `>=`) and H-LIST-VISITOR (`>=`; drop `truncated`): **4/4 killed** (baseline 85/85, sources restored). Not run: tv-b3 (beyond combine-7's RC-W1), tv-b4 idiom bypasses (7 sheets), tv-y2 DC culled checks, tv-z1 comment/`Cancel` mutations.

## Step 13 — not runnable here (coordinator, locally)
Packaged desktop install-from-archive boot; Chrome: page head + form feedback, byte-range media serving, theme preview refresh, backup plan/push, public rendition and replace-file freshness.

## Lockfile diffs
- Jini `pnpm-lock.yaml`: node-adapters `link:` in daemon (dev), server, minimal-host, reference-web, neutral-host; agent-plugins `link:` in node-adapters (dev); platform moves to devDependencies in mcp/sidecar; specifier-only lines for the raised ranges. No registry versions added.
- Tovu `package-lock.json`, `apps/admin`, `apps/desktop`: unchanged (see step 11).

## Decisions needed
1. **Release cut**: `changeset version` would mint 1.0.0 (4 `major` bumps in cookie-consent-react-subpath, core-observability-contract ×2, r13b-legacy-owner). Keep the manual 0.7.3-next.1 cut (cms-forms CHANGELOG test stays red) or consume the changesets?
2. **Publish**: push the tag for `release/lockfile-1120` (41 packages incl. first-ever `@jini-ai/node-adapters`), then in Tovu run `npm install` at root, `apps/admin`, `apps/desktop` and commit the three lockfiles; `npm ci` must then pass.
3. **Why-comments**: 28 blocks lost (27 R8 + sidecar's removed-options note) are docs of options/resolvers R8 deleted (`contracts.ts` `@default …` ×13, `launch.ts` resolver docs, `pi/contracts.ts`, `codex/contracts.ts`, server test/kernel notes about pre-R8b behaviour). Allow-list with "code deleted by R8b step 6" or not? (Not added: no debt raised.)
4. **R11b-1 step 4 shape**: `commandShell` from the host instead of the sheet's `planInvocation` + `ambientEnv` (guard HW9).
5. **Raised peer floors**: every internal peer range is now `^0.7.3-next.1`, so a 0.7.3-next.1 package refuses a 0.7.2 peer.

## Red lines (all listed, none hidden)
cms-forms CHANGELOG heading test; why-comments 28 (+combine-7's); complexity 2 / error gate 29 / log-safety (BASE-RED, unchanged); neutral-host contribution walk (BASE-RED); plugin-fixture-provider version pin (BASE-RED); reference-web e2e (ENV); Tovu `jini-mcp-peers` lock-sync ×2 until re-lock; Tovu website wiring 5 (BASE-RED).

## Minor findings (listed, not fixed)
- `cloud-results/combine-7-tovu.md` on Tovu merge-7 is still a draft ("full suite still running") with `SHA_PLACEHOLDER`.
- The scope's `@jini-ai/cms/seo/cover-image` is `./media/cover-image`.
- No root `build` script in Jini (`pnpm build` exits 254).
- Combine runs invoking `npm run test -- --maxWorkers=2` double the flag for commerce/search (their scripts set it).

## Next step
Owner: decisions 1 and 2 → tag publish → Tovu re-lock (3 lockfiles) + `npm ci` → the step-13 local checks. Then R11b-3 and R8 step 9 (after R7's route pairs).
