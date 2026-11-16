# Coverage pass: `@jini-ai/integrations` and `@jini-ai/plugins`

Branch `test/coverage-jini-integrations-plugins`, cut from `origin/integ/wave-b`. Status: **PARTIAL**. Continuation needed for the integrations items below.

Method: tests through public behaviour, dependency-injected fakes (plus a real in-memory vault for credential sets, and a real temp install directory for the plugin source service). No module mocks of internals. No coverage config, threshold or exclude was touched. No behaviour was changed.

## Totals (v8, lines)

| package | before | after | notes |
|---|---|---|---|
| plugins | 84.90% (4234/4987) | **98.37%** | 6 tests were already failing on the base (see BUGS) plus 4 new RED tests that state correct behaviour |
| integrations | 80.50% (6661/8274) | **82.57%** | the large gaps need a continuation (see FILES LEFT) |

Integrations tests: 2051 -> 2157 passing. Plugins: 1005 -> ~1090 passing, 10 failing (all from the one root cause below).

## Per-file results

### plugins (`src/host`)
| file | before (lines) | after (lines) |
|---|---|---|
| tools/management.ts | 0% | 100% lines/branches/funcs |
| tools/source.ts | 0% | 100% |
| tools/install.ts | 0% | 100% |
| tools/index.ts | 0% | 100% |
| tools/contract.ts | 0% (7 import lines) | 0 executable lines (imports made type-only, see SEAMS) |
| node/runtime-core.ts | 66.97% | 93.02% lines / 93.85% branches |

### integrations (`src`)
| file | before | after |
|---|---|---|
| api-connections/budgets.ts | 86.66% | 100% |
| api-connections/declarations.ts | 91.81% | 100% |
| api-connections/shared.ts | 100 lines, 84% branches | 100% all |
| credentialed-http/sets/store.ts | 57.63% | 100% lines, 98.6% branches |
| credentialed-http/sets/vault-repo.ts | 60.9% | 100% |
| credentialed-http/credentialed-request.ts | 99.67% | 100% lines (re-check branch 404 in the next run) |
| media-providers/dispatch/openai-compatible.ts | 98.98% branches | covered (default-argument branch) |

## FILES LEFT (numbered, worst first)

Integrations:
1. `api-connections/hosted-mcp/sign-in.ts` - 549 uncovered lines (3.85%). No tests exist at all. Needs a full OAuth fake set (`HostedMcpSignInPorts`, repo, flow ports).
2. `credentialed-http/tools/tool-registrations.ts` - 392 lines (0%). Needs the `askThenReport` exchange engine from core plus the card/surface ports.
3. `api-connections/host.ts` - 206 lines (0 functions covered). Compose with fake vault stores.
4. `credentialed-http/tools/credential-copy-tool.ts` - 101 lines (0%).
5. `api-connections/connect.ts` - 100 lines (2.9%).
6. `api-connections/hosted-mcp/shared-sign-in.ts` - 91 lines (64%, branches 39%).
7. Barrels `api-connections/hosted-mcp/index.ts` and `credentialed-http/tools/index.ts` - 1 line each; they go green automatically once 1/2/4/6 import paths are exercised, or add a barrel identity test like `plugins/src/host/tools/__tests__/tools-barrel.unit.test.ts`.
8. `credentialed-http/sets/store.ts` branches at 41, 476, 541: line 541 is the legacy `custom`-kind resolve path. The vault refuses to create a new `custom` row and an envelope sealed under `vendor` cannot be opened as `custom`, so it cannot be reached without hand-sealing a legacy envelope.

Plugins (all small):
9. `node/runtime-core.ts` - remaining: provider-plugin paths (lines ~697-733, `isSelected`, `attachProviderWithin`, `loadProviderPlugins`, `listProviderPlugins`) are blocked by the BUG below; hook-attach failure catch (`PLUGIN_HOOK_ATTACH_FAILED`, ~593) has no reachable trigger because `hookRegistry.attach` is a `Map.set`; the two `startsWith` guards in `locatePluginPackageDirs` (~749, ~754) are defence-in-depth behind the id regex (unreachable by design - left alone rather than removed); `onDisabled` no-op for other workspaces in `reloadActivation` is never called because that path only ever enables.
10. `declarative-content-types.ts` (92.9%), `capability-tools.ts` (93.3%), `provider-contributions.ts` (94.7%, BUG-blocked), `provider-revision-watch.ts` (88%), `discovery.ts`, `module-snapshot.ts`, `hook-registry.ts` (1 line) and branch-only gaps in `admin-response.ts`, `contributions.ts`, `provider-host.ts`, `provider-settings-migrations.ts` (50% branches), `archive-policy.ts`, `package-files.ts`, `worker/start.ts`.

## BUGS found (behaviour NOT changed; tests state the correct behaviour)

1. **`packages/plugins/src/host/provider-contributions.ts:171`** uses `PLUGIN_PROVIDER_CAPABILITY` without importing it (lost in the wave-B import rewrite, commit 6133716e). Validating any manifest with `contributes.providers` throws `ReferenceError: PLUGIN_PROVIDER_CAPABILITY is not defined`. Fix is one line: `import { PLUGIN_PROVIDER_CAPABILITY } from '@jini-ai/core/contracts/plugin-sdk';`.
   - RED already on the base (6 tests): `host-entry-purity.test.ts`, `provider-contributions.unit.test.ts` (2), `provider-schema-w2g.unit.test.ts`, `provider-settings-migrations.unit.test.ts` (2).
   - RED added by this pass, marked with a `BUG` comment: `src/host/__tests__/unit/runtime-core.coverage.unit.test.ts` "provider plugins" (4 tests).
2. `tsc -p packages/plugins` fails on the base for the same rewrite: missing type names `DefinedPlugin`, `PluginSdk`, `HookPoints` (`host/ports.ts`), `PluginRouteContribution`/`PluginToolContribution`/`PluginWidgetContribution` (`host/contributions.ts`), implicit-any params in `host/worker/import-seam.ts`. `tsc` still emits, so tests run, but `pnpm -r build` reports failure for this package.

## SEAMS added

- `packages/plugins/src/host/tools/contract.ts` lines 4-9: `import { type X } from` -> `import type { X } from` (type-only imports; no runtime change, removes six side-effect imports from an otherwise type-only module).
- No other source file was modified.

## Notes for the continuation

- Setup: Node 24 into `~/.local/node24`, `pnpm install --frozen-lockfile`, build `integrations`.
- Plugins has no `vitest.config.ts`, so coverage was gathered with CLI flags (include `src/**`, exclude tests).
- Useful harnesses to copy: `plugins/src/host/__tests__/unit/runtime-core.coverage.unit.test.ts` (runtime core with temp install dir and real source service), `integrations/src/credentialed-http/sets/__tests__/store-vault-coverage.unit.test.ts` (real in-memory vault host, project store variant), `plugins/src/host/tools/__tests__/management-registrations.unit.test.ts` (approval-port fake).
