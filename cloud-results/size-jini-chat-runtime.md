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
