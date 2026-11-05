# mcp — tool sources, consent and immediate lowering

Date: 2026-11-05. Job: `mcp`. Implemented the job-file trim of X steps 1, 2, 3, 5 and 6. The chat write tool and new vendor bridges were excluded; L1–L3 remain written below and were not run.

Authority: `origin/cloud-plans-1105` at `c4a27563b7a69474d5a5ade6209217c3819ce5b1`; read COMMON.md, mcp.md, TRIM.md and both named X design/plan files with git show. Loaded Software Architect, Programmer and TDD personas from Jini/AI-Dev-Shop. Completed within the two-hour wall-clock cap.

## Branches and implementation SHAs

Only `cloud/mcp` was pushed in each repository. Report-only commits follow these implementation heads.

| Repository | Required base | Implementation head |
|---|---|---|
| Jini | `6f507852d` | `36099ce82710ccebfcbd7cf326d9c35f8f86f74f` |
| Tovu | `e327c07c8` | `bbf41a12f43a66d08e52c219ff7a79f8efdea336` |

Jini implementation commits: `2b89ed896`, `40c04fcb2`, `12e2cc686`, `a88f686d7`, `3757164dc`, `a9ff5e8f8`, `7eb2054d9`, `058362a44`, `8781efc66`, `6d0f51131`, `36099ce82`.

Tovu implementation commits: `abf90a05f`, `c3e8bc121`, `3d19ca032`, `13a13f3d8`, `5deaf89ab`, `3c0259661`, `f0875f6d5`, `0b0a21bcd`, `029e17355`, `a09cb49eb`, `8c5a4be68`, `378a1c6b0`, `8313a13e8`, `7a88f72bf`, `7ca3d128c`, `e3086f08d`, `9eaa317af`, `982821741`, `bbf41a12f`.

## Behavior

- A pure RUN/ASK/SETUP planner runs before session binding, bridge repair, run credentials and CLI execution. Antigravity no longer silently receives all permissions. Missing/unknown isolation is conservative; only aider/pi declare no MCP client. No live isolation stamp was fabricated.
- Tovu resolves `site + byAgent[selected]` after the owner/host gate. Owner cards preserve raw site fields and sibling agent entries, compare fresh effective permissions and the addressed layer revision, and write through the existing server settings authority/CAS. Terminal, cancelled, foreign, non-owner and locked requests cannot grant access. SETUP offers only qualified agent alternatives, with no Allow action.
- Settings use “Tools provided here” and explain personal/project MCP separately. Personal ON requires explicit Allow; affected personal-config and inherited-run-key disclosures appear where relevant. Alternatives reuse the same permission snapshot, then the selected agent is reread before dispatch.
- The run-bound `chat_settings_get` is argument-free and read-only. Its authenticated run/principal selects an explicitly projected snapshot shared with runtime guidance: effective permissions and origins, planner facts, tool IDs and hostname-only server metadata. The serialized response stays at or below 2 KiB, including escaped scalar values; truncation is explicit.
- Permission reductions, external source OFF and plugin/provider-face OFF revoke affected bridge credentials before Stop, close pending cards through existing cancellation, and await cleanup. CLI and BYOK partial text retains `Stopped because tool access changed.` Unrelated answers continue. Cleanup failures return explicit safe errors. BYOK also tracks tools admitted after the answer starts.
- Personal JSON repair is now owned by Jini's existing installer and requires Allow before I/O. It preserves foreign entries, refuses a foreign named connector or symlink, backs up once, locks and writes atomically, and persists one credential-free connector. Antigravity permission repair is likewise gated. Tovu retains composition only.
- Add/update-server cards disclose site-wide availability; stdio forms disclose local command execution as the OS user and the tool allowlist.

## Validation

Setup: the prescribed `/workspace/shared/dev-env.sh` and `start-postgres.sh` are absent. Installed pnpm 11 was incompatible; Corepack supplied the declared pnpm 10.33.2. The original store was read-only, so installation used a writable copy. No pristine-tree green baseline is claimed: workers had started before the full setup build completed. Tests used fixtures, temporary homes and local mock providers, not owner/live data.

Executed setup/build commands:

```bash
cd /workspace/Jini
corepack pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store --cache-dir /workspace/work/pnpm-cache
corepack pnpm -r build
npm --prefix packages/daemon run build
cd /workspace/Tovu
npm --prefix packages/contracts run build
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
```

The full Jini workspace build passed. The final daemon rebuild after the byte-bound fix and the final Tovu link also passed. Builds typechecked the changed Jini packages.

Jini final focused checks — 12 runtime tests and 73 daemon tests passed; MCP had 125 passes and one unresolved failure:

```bash
cd /workspace/Jini
npm --prefix packages/agent-runtime run test -- src/__tests__/plan-run.unit.test.ts src/__tests__/native-tool-compatibility.unit.test.ts
npm --prefix packages/daemon run test -- src/__tests__/run-tool-consent.unit.test.ts src/__tests__/unit/chat-settings.unit.test.ts src/__tests__/unit/tool-access-lowering.unit.test.ts src/agent-executor/__tests__/antigravity-permissions.test.ts src/agent-executor/__tests__/launch-defaults-and-staging.test.ts src/agent-executor/__tests__/launch-relay-m1.unit.test.ts src/agent-executor/__tests__/runtime-policy.test.ts
npm --prefix packages/mcp run test -- src/agent-install/__tests__/install.test.ts src/agent-install/__tests__/owned-json-install.test.ts src/federation/__tests__/mcp-federation.registrations.test.ts src/federation/__tests__/registrations.read-only.test.ts
```

The MCP failure is `defaultConnect: a real child writing to stderr does not fail, hang, or leak into the protocol stream`: `sessions.length` was 0 instead of 1 (“stderr must drain before the handshake completes”). Repeated without progress; stopped and left open.

Tovu final checks:

```bash
cd /workspace/Tovu
# 48 passed: owner settings, read/resolution and grant integrity.
node --import tsx --test --test-isolation=none apps/website/src/server/inbound/assistant/__tests__/assistant-tool-access.unit.test.ts apps/website/src/server/inbound/admin-http/routes/system/__tests__/assistant-subagents.test.ts apps/website/src/assistant/__tests__/subagent-settings.unit.test.ts
# 19 passed: persisted response plus existing owner-grant pins.
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-isolation=none apps/website/src/server/inbound/admin-http/routes/system/__tests__/assistant-subagents.test.ts apps/website/src/server/inbound/admin-http/routes/system/__tests__/assistant-owner-grant.tw4.pins.test.ts
# 18 passed: all 28 definitions/defaults, card integrity, protocol and real server RPC.
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-isolation=none apps/website/src/server/inbound/assistant/__tests__/every-cli-default-settings.contract.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-consent-protocol.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/assistant-tool-consent.unit.test.ts apps/website/src/server/runtime/composition/modules/__tests__/agent-daemon-consent-rpc.integration.test.ts
# 23 passed: actual scope permission/guidance wiring; final native-only recheck also passed 13.
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-isolation=none apps/website/src/server/inbound/assistant/__tests__/native-fallback-wiring.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.runtime-guidance-wiring.unit.test.ts
# 107 passed: lowering, authenticated control, late admission/provider stream, plugin faces and store.
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-isolation=none apps/website/src/assistant/__tests__/external-mcp-roster-change.test.ts apps/website/src/features/agent-plugins/__tests__/unit/set-enabled.tool-access-lowering.unit.test.ts apps/website/src/features/plugin-runtime/__tests__/unit/lower-tool-access.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/tool-access-lowering-route.unit.test.ts apps/website/src/server/runtime/composition/modules/__tests__/assistant-tool-access-lowering.unit.test.ts apps/website/src/server/runtime/composition/modules/__tests__/assistant-server-federation.lowering.unit.test.ts apps/website/src/server/runtime/composition/modules/__tests__/assistant-byok.tool-access-lowering.integration.test.ts apps/website/src/features/external-mcp/__tests__/external-mcp-store.test.ts
# 38 passed: server save forms and disclosures.
node --import tsx --test --test-isolation=none apps/website/src/features/external-mcp/__tests__/unit/save-form.unit.test.ts
cd /workspace/Tovu/apps/admin
# 35 passed in each of the following two commands.
npx vitest run src/features/ai-assistant/__tests__/AdminSubagents.unit.test.tsx src/features/ai-assistant/__tests__/use-assistant-owner-grant.hooks.unit.test.tsx
node_modules/.bin/vitest run src/features/settings/__tests__/ExternalMcpSettingsPanel.unit.test.tsx src/features/settings/__tests__/ExternalMcpSettingsPanel.hooks.unit.test.tsx
```

Additional affected source verification initially passed 108/111. Exact overlay/read-count expectations were updated for the intentional facts block and two launch reads; focused rechecks passed, giving 110/111 across those suites. The remaining existing federation wiring test expects an unknown-tool rejection but receives no rejection. It failed again with the required composed preload; logs also contain `charts-recharts INTEGRITY_FAILED`. Stopped without weakening it:

```bash
cd /workspace/Tovu
node --import tsx --test --experimental-test-isolation=none --test-concurrency=1 apps/website/src/server/inbound/assistant/__tests__/agent-daemon-startup-cause.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.durable-binding.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.attachment-kind-filter.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.attachment-binding.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.session-resume-wiring.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.page-context-wiring.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.runtime-guidance-wiring.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.run-start-branches.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.federation-runtime-wiring.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.run-analytics.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.tool-restriction-wiring.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-site-tools.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/native-fallback-wiring.unit.test.ts
node --import tsx --test --experimental-test-isolation=none --test-concurrency=1 apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.runtime-guidance-wiring.unit.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.tool-restriction-wiring.unit.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-isolation=none --test-concurrency=1 apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.federation-runtime-wiring.unit.test.ts
```

TypeScript and complexity:

```bash
cd /workspace/Tovu
node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false
npm run typecheck:tests
npm --prefix apps/admin run typecheck
```

Production Tovu TypeScript reports the unchanged `apps/website/src/features/deployments/publish-credentials/store.ts:410` TS2322 (`string | undefined` assigned to `string`); no changed production-file errors. Admin TypeScript reports dependency/type drift including `sourceTreeStamp`, `FrontendSessionBridge.rebind`, `ErrorNotice` and `terminalNotice`, plus unrelated existing test errors. The final test TypeScript run remains blocked by existing typing drift in unrelated fixtures; it reports no diagnostics in changed files. Initial new fixture typing issues were corrected before that final run.

Strict complexity checks used ESLint with `--no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'` on changed production files. New/changed logic satisfies 10. Unchanged baseline findings were measured and left alone: Jini `launch.run` cyclomatic 20/cognitive 13, installer `installedLaunchMatches` 11, Tovu `createSiteScope` 11 and retained `createAgentDaemonCoreDeps` 12. The existing host-specific refusal-text lint finding remains. No disables or thresholds were added.

## Bugs found

FIXED — Antigravity silently enabled all permissions, including personal MCP.

FIXED — JSON bridge repair could run before consent, replace a foreign connector and omit a backup.

FIXED — The permissions reader dropped per-agent entries.

FIXED — A first selected-agent write could promote the requested personal setting into site defaults; its HTTP response could describe parsed input instead of persisted settings.

FIXED — Terminal completion during the settings writer's own authorization/transaction could commit a dead run's grant. Real-memory/RPC regressions prove rollback even after revision append.

FIXED — A hanging status emitter could delay Stop; late-admitted BYOK/plugin-provisioned sources could be missed by lowering.

FIXED — Maximum escaped scalar combinations could exceed the 2 KiB facts cap; scalar truncation was not labelled.

OPEN — MCP stderr child-session test failure described above.

OPEN — Existing federation unknown-tool rejection expectation and bundled-chart integrity warning described above.

OPEN — Unchanged production/admin/test TypeScript drift and baseline complexity findings described above.

## Remaining limits and written live validation

No proved isolation stamp is published. Real Claude/Codex therefore conservatively ASK before loading their personal/project MCP list; live isolation/version claims remain unverified. Unbridged runtimes keep the explicit “can't use tools provided here” notice; new vendor bridges were cut by the job.

A BYOK answer turning off its own source may reach the bounded cleanup deadline because that tool call is waiting on the same answer's cleanup. It reports failure honestly and then finishes stopping; it does not claim confirmed cleanup. Actions completed before removal cannot be undone.

L1 (written, not run): for Claude and Codex, install home, project and native-plugin canaries; request personal MCP OFF; verify no canary starts while the supplied bridge still works. Only passing CLI-version-specific evidence may establish a per-run isolation stamp; repeat/drop that claim after a version change.

L2 (written, not run): after Antigravity Allow, attach a sibling personal MCP canary and determine whether it sees the run key. Retain the inherited-key disclosure until this proves otherwise.

L3 (written, not run): for Claude, Codex and Antigravity, exercise HTTP and stdio fallback with a Tovu operation, Jini gateway, enabled plugin tool and independently injected MCP tool. Verify personal MCP OFF does not exclude supplied tool groups where isolation is proved, explicit Allow is required otherwise, each source OFF stops affected answers, and protected actions retain their confirmation cards.

## Added state/I/O cost

- Planner and alternative qualification: pure/in-memory, zero extra configuration reads. Inventory reuses existing readiness information.
- Launch permissions: existing owner/site effective blob read before consent/session binding and again immediately before repair/spawn. ASK previews and clicks each resolve effective permissions plus the addressed raw layer; approval rereads and uses one existing CAS value/revision write. Server run identity/liveness uses existing indexed attempt reads, including the transaction commit guard. Payload scales with the existing permissions blob; no schema was added.
- Run facts: one detached block at most 2 KiB per launch; one bounded in-memory lookup per explicit read tool call. Federation provenance comes from the existing admitted connection data, with no extra config/remote reads.
- Lowering: one authenticated command at most 1 KiB per explicit change, in-memory selection of affected runs, existing cancellation/cleanup awaits and O(affected runs) result IDs. BYOK unions admitted IDs with an O(tool count) in-memory scan per tool call and OFF change. Provider OFF adds one existing linked-face metadata scan. No polling was added.
- Owned repair: under the existing lock, a fresh config read and an atomic replacement only when needed, plus one original backup; equivalent existing permission-file I/O after Allow. No run token or owner credential is persisted in the connector.
- Settings UI: fixed registry metadata added to the existing load/refresh response; existing confirmation/mutation/cache lifecycles reused.
