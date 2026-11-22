# size-jini-chat-runtime — PARTIAL

Branch `refactor/size-jini-chat-runtime` (Jini), based on `origin/integ/wave-b`. Stopped on the tool-call / context budget, not on a blocker.

## DONE (all in `packages/agent-plugins`; every function now <= 50 lines, lint clean of size rules, tsc clean)
- admin-surfaces/connections/connections.ts `createAdminSurfaceConnections` (87 -> max helper < 50)
- admin-surfaces/surface-client.ts `createAdminSurfaceClient` (101)
- connect/credential-save-tool.ts `createCredentialSaveTools` (119)
- connect/plugin-host/index.ts `createPluginHost` (107)
- lifecycle/automatic-use.ts `createAutomaticAgentPluginUse` (143)
- lifecycle/bundled-digests.ts, bundled-source-archive.ts, install.ts (also split `installAgentPlugin`, 61 -> <50), resolve-agent-plugin-refs.ts, retire-bundled.ts, seed-bundled.ts, uninstall.ts — each `buildModule`
- lifecycle/index.ts `createAgentPluginLifecycle` (81)
- lifecycle/tools/projection.ts `createAgentPluginToolProjection` (87)
- lifecycle/update.ts `createUpdateModule` (204)

Technique for `buildModule`/factory closures: inner functions hoisted to module level taking `ports` (or a small scope object) first; `buildModule` is now a thin wrapper that binds `ports`. Public exports/signatures unchanged.
Note: the doc comment above `buildModule` in resolve-agent-plugin-refs / retire-bundled / seed-bundled, if any, may now sit above the first hoisted helper rather than above `buildModule` (cosmetic).

## NOT REACHED
Everything else in the list: agent-plugins `buildModule` of bundled-* done above; remaining are all `packages/agent-runtime/*`, `packages/agentic/*`, `packages/chat/*`, `packages/daemon/*` entries, and agent-plugins `lifecycle/*` none left. (agent-runtime/acp/models.ts, session.ts, pi-rpc, ai-trace/recorder, claude-stream, model-discovery, oauth-callback-server, recon-site.mjs, a2ui interpreter, install-service, all chat/*, all daemon/*.)

## size-debt entries now removable (scripts/size-debt.json, `max-lines-per-function`)
createAdminSurfaceConnections, createAdminSurfaceClient, createCredentialSaveTools, createPluginHost, createAutomaticAgentPluginUse, buildModule in bundled-digests / bundled-source-archive / install / resolve-agent-plugin-refs / retire-bundled / seed-bundled / uninstall, createAgentPluginLifecycle, createAgentPluginToolProjection, createUpdateModule. (check:size prints "Remove stale debt entry" for each.)

## Pre-existing test failures (identical on unmodified wave-b files)
In packages/agent-plugins: 3 tests — `activation-corrupt-file-writes.unit.test.ts` (seedBundledAgentPlugins corrupt activations), `lifecycle-reconciliation.unit.test.ts` (host migration failure refuses seeding), `plugin-identity.unit.test.ts` (core peer version). Plus 4 failing test *files* in the full package run (one is a suite that cannot load). Verified the 3 above fail with my touched files reverted to origin/integ/wave-b.
Setup: `@jini-ai/http-kit` `pnpm build` fails on its own test files (pre-existing); core built fine and agent-plugins typechecks.
Test counts: no tests added/removed.

---

# Continuation run (agent-runtime + agentic) — PARTIAL (chat/daemon deferred by instruction)

Setup: Node 24, `pnpm install --frozen-lockfile`; agent-runtime `tsc` build already fails on the unmodified tree (missing `@jini-ai/oauth`, `@jini-ai/integrations`), so verification was `tsc --noEmit` + eslint + vitest. Building `@jini-ai/platform` unlocked more suites.

## DONE (one commit per file, on `refactor/size-jini-chat-runtime`)
- 9a9e3815 acp/models.ts `detectAcpModels` (+ anonymous callback)
- 3bcc2a2a acp/session.ts `attachAcpSession` (482 -> state moved to an `AcpRun` context in new `acp/session-run.ts`)
- 52aee119 permission reply moved to new `acp/session-permission.ts` (keeps session-run.ts under 500 lines)
- 74cdb62f pi-rpc/session.ts `attachPiRpcSession`
- 96cc2d76 ai-trace/recorder.ts `createAiTraceRecorder`
- 1e5009e8 claude-stream.ts `createClaudeStreamHandler` (373 -> new sibling `claude-stream-handler.ts`; one-way logic, but the two files import each other's functions — fine at runtime, only used inside function bodies; `normalizeArtifactEchoContent` now exported from claude-stream.ts, not in the package barrel)
- f3bb9f53 model-discovery.ts `createAgentModelDiscovery`
- f0ff83db providers/oauth-callback-server.ts `startOAuthCallbackListener`
- e95f56d2 agentic core/a2ui/interpreter.ts `createA2uiInterpreter`
- 7004d94c agentic skills/install/install-service.ts `createSkillInstaller`
Final push: see branch head (last commit 52aee119 unless a later one is listed by `git log`).

## SKIPPED
- agent-runtime/src/skills/web-clone/scripts/recon-site.mjs `collectSignals` (260) + `page.evaluate` callback (258): the callback is serialized into the page, so every helper must live inside it; splitting needs a different transport (string-expression evaluate or `new Function`, the latter blocked by strict page CSP) plus changes to the shared fake `createFakePage`. Needs a design decision, not a mechanical split.

## DEFERRED (by instruction: another run is on them)
All `packages/chat/*` and `packages/daemon/*` entries in the list.

## Removable size-debt entries (check:size prints "Remove stale debt entry")
detectAcpModels, detectAcpModels.<anonymous>, attachAcpSession, attachPiRpcSession, createAiTraceRecorder, createClaudeStreamHandler, claude-stream.ts `<file>` (685), createAgentModelDiscovery, startOAuthCallbackListener, createA2uiInterpreter, createSkillInstaller. `acp/session.ts <file>` can be lowered 1236 -> 772.
Other check:size findings NOT from this work (pre-existing on the base): new `createOtelObservabilityPort` (provider-plugins) and worsened file lengths in plugins/runtime-core.ts and server/builtin-features.ts.

## Pre-existing failures
agent-runtime vitest: 38 failing entries (34 files + 7 tests) identical before/after my changes (diffed lists) — missing `@jini-ai/oauth`/integrations modules, root-user chmod tests. Includes model-discovery.test.ts / model-discovery-policy.test.ts which cannot load, so `createAgentModelDiscovery` is verified by tsc/eslint and the 3 loadable model-discovery suites only. agentic: no failures.
Tests: none added/removed (agent-protocol 779, ai-trace 62, a2ui 475, skills 391, oauth-callback 16 all pass).
Not touched: `applyDsmlArtifactSuppression` in acp/session.ts is 54 lines (warning-level, not in the list).
