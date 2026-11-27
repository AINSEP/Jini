# m26-tsc — Jini working-tree handoff

No commits: `.git` is read-only. No installs, builds, tests, typechecks or linters run, as dispatched. Regression tests are written before their corresponding production changes; RED/GREEN execution is reserved for the coordinator.

## Intended commit order

1. `fix(admin): accept protocol MCP caller results and kit dictionaries`
   - `packages/admin/src/shell/components/AssistantDock/__tests__/y5-dock.test.tsx`
   - `packages/admin/src/shell/components/AssistantDock/AssistantDock.state.hooks.ts`
   - `packages/admin/src/screens/settings/__tests__/SettingsUi.hooks.unit.test.ts`
   - `packages/admin/src/screens/settings/SettingsUi.tsx`
   - MCP regression: a synchronous caller returns the identical receipt, with the identical call. Mutation: restore the Promise-only renderer-hook return contract; the synchronous injected hook stops typechecking.
   - Settings regression: the kit's partial locale dictionaries fit the screen's dependency contract and preserve the Spanish overlay. Mutation: restore the total `Record<string, Record<string, string>>` screen contract; the type assertion fails.
   - Source review establishes both contract mismatches. Tests remain unexecuted.

2. `fix(cms): preserve absent post render inputs across extracted contracts`
   - `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/post.test.ts`
   - `packages/cms/src/public-http/routes/site/pages/handlers/post.ts`
   - `packages/cms/src/public-http/http/site/bare-page.ts`
   - `packages/cms/src/public-http/http/site/render-site.ts`
   - `packages/cms/src/admin-http/routes/posts/__tests__/template-preview-render.test.ts`
   - `packages/cms/src/admin-http/routes/posts/template-preview-render.ts`
   - Post regression: document-format posts accept an absent HTML embed map in both bare/generic paths, preserving explicit undefined assets, embeds and assistant inputs. Mutation: restore map-only resolver return declarations or remove explicit undefined from the renderer contracts; the injected callbacks/calls fail typechecking.
   - Preview regression: absent HTML embeds remain an own property on the renderer input. Mutation: conditionally spread `pageHtmlEmbeds` only when defined; the own-property assertion fails.
   - Root evidence: the host's `resolveHtmlEmbedsForRender` declares `Promise<ResolveHtmlPageEmbedsResult | undefined>`; the body renderer already accepts `resolved: ResolveHtmlPageEmbedsResult | undefined`. The old host preview forwards the property verbatim. No read/effect order changes.

## Row dispositions

"Implemented" below means source changes and regression cases are present, not a verified green typecheck. No compiler logs were supplied and executing the compiler is prohibited.

| Dispatched row | Disposition and evidence |
| --- | --- |
| Admin AssistantDock MCP caller | Implemented: Jini hook contract now matches synchronous or asynchronous protocol results. The protocol's `McpUiToolCallHandler`, the kit surface-card callback and discovery's `callAllowlistedTool` already permit both. |
| Admin SettingsUi dictionaries | Implemented: screen dependency uses existing `KitDictionaries`, matching the kit/provider and dictionary overlay. |
| Website post x2 | Implemented the demonstrated bare/generic handler contract mismatch: HTML embed reads can return undefined. Existing renderer contracts now accept the explicit undefined assets, embeds and assistant values the moved callers already pass. No full-row green claim without the coordinator's compiler run. |
| Website template-preview-render | Implemented absent-embed contract/forwarding repair. Restores the original host's own `pageHtmlEmbeds` property and satisfies the pre-existing own-property regression. Theme callbacks remain opaque `object`; any host theme-typing error needs a specific diagnostic/design before another change. |
| Website peer-transport x2, publish-site, plugins/install, mount-admin-system | Left for host pass: reporter selection and the failing calls are Tovu-owned. Jini peer transport takes an injected `incident`; Jini plugin install takes an injected failure writer. No host reporter dependency added to either package. |
| Website import-database repo.sqlite | Stopped: the named path does not exist under the host's site-backup/import-database area. Found `site-backup/import-database.ts` and `site-backup/share-database/repo.sqlite.ts`; neither contains the named reporting calls. No matching import-database implementation in Jini db/cms/server. Coordinator needs the exact path/diagnostic. |
| Website purchase x3 | No additional repair justified from source: Jini's HTTP specs use `RouteInputContext` path values, validate identifiers, and already allow explicit undefined in the unavailable-reason option. The inspected host still uses Express params; exact diagnostics are needed to distinguish those host errors from the extracted implementation. |
| Website publish-agent-tools x2 | No additional repair justified: Jini's execution paths already use `optionalPublishPorts` to omit absent optional dependencies. Need the original diagnostics for another root cause. |
| Website domain-publish-tool | No demonstrated remaining Jini error: domain publishing already uses injected `gatewayPlan`/`gatewayConfirm`/`gatewayExecute` methods and `optionalPublishPorts`; `GatedMutationHooks` declares its callbacks as methods. Need the specific diagnostic before changing these approval contracts. |
| Website project-store | Left for host pass: named composition file remains host-owned; no Jini project-store counterpart found in platform/db/server. |
| Website virtual-page | Stopped before redesign: Jini intentionally receives opaque `object` themes, while the host's callbacks need `DiscoveredTheme`. Repairing that boundary would require a theme contract/generic not named by this dispatch; themes must remain untouched. Exact diagnostics or an approved contract change are needed. |
| Website protect-existing-files | Stopped before redesign: Jini's kernel fixes every dynamic table to one combined row shape (`Kysely<Record<string, ...>>`), unlike the host's `KyselyKernel<ContentDatabase>`. A safe schema/table binding change is not specified; no cast, wrapper, new port or generic introduced. |
| Website mail-status | No demonstrated remaining Jini error: the host now mounts `mailStatusRoute` in `modules/system-mail.ts` and already spreads its report into a DTO object. The separate mail tool is in user-management. Exact symbol/diagnostic is needed to choose the owner. |
| Admin AccessTokensTab label | Not reproduced from the cited anchor: host line 50 is documentation in the available checkout; Jini field, chip-field and secret-input labels inspected are required strings. Need the exact failing expression; no fallback/optional-label weakening added. |
| Admin use-other-credentials delete envelope test | Left for host pass: the cited test remains in the host. Keep the core `ExternalMcpDeleteEnvelope` contract and correct its fixture. |
| Admin use-external-mcp fake | Left for host pass: the cited hook test remains in the host; its fake must provide `restartRequired`. |
| Admin credential-input-autocomplete | Left for host pass: the cited test remains in the host; inject the required `useMediaProvidersTabHook`. |

## Scope and review

- Jini only; no subagents; no new helpers, runtime adapters, dependencies or exports.
- No tests deleted, skipped or weakened; no configuration changes.
- Diff cleanup deletions: none.
- Four new regression test declarations; zero existing tests removed or weakened. Type regressions need the coordinator's test typecheck as well as runtime test execution.
- Architecture review: source changes remain in admin's existing injected hook/kit boundaries and CMS render contracts. No host runtime imports, new exports/subpaths, dependency/configuration changes or theme changes. Unspecified kernel/theme boundary changes stopped and disclosed above.
- Function review: no new production functions or branches. Only one runtime statement changed, restoring the original preview argument property; existing deferred reads, effect order and rendering remain in place. Existing large files/functions were not refactored under the smallest-diff rule.
- Fresh evidence: read-only `git diff`/`git status` inspection only. No claim of passing tests, typecheck, lint, build, coverage or mutation execution.
- Host adoption: consume the existing Jini subpaths with rebuilt declarations; no new subpaths/exports required. Retain required hooks/reporters and repair host fixtures/callers in the host pass.
