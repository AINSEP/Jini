# consent-declare

Status: complete. Job executed November 5, 2026 (America/Los_Angeles), within the two-hour cap.
Branch in both repositories: `cloud/consent-declare`. No main/combine push, force push, deployment, tag, npm publication, live data, or owner data changes.

## Result and step order

1. Added the shared `allows({state, consent})` check, API `allows({consent})`, declaration validation, ordered once-only optional script lifecycle, withdrawal cancellation/reload, and effective-permission checks. Several categories require all permissions. Omitted/empty/necessary-only consent uses ordinary delivery, including external URLs, without a warning.
2. Added the open consent bridge kind. Built-in and outside banners/CMPs drive the same receipt/GPC-enforcing API. Active plugin contributions load through the existing registry; broken bridges are isolated and disposers run on removal.
3. Added generic document assets, theme/plugin declarations, optional comments scripts, published-only context and explicit static-export asset copying. Managed shells and bare fragments construct slots; authored full documents remain unchanged. Comments HTML stays visible; only optional scripts inherit provider consent. Context has one fresh published policy read, never draft reads. Static evidence is local; live adapters/collectors are excluded from export. Core and extension assets keep the unchanged 4,608-byte per-asset ceiling.
4. Replaced the rewrite dry run with declaration validation and separate unmanaged-content/unsupported-slot warnings. Admin-only diagnostics retain the 1 MB sample, 200 inventory-entry cap, truncation and URL redaction. Banner preview is separate and scriptless. Publication refreshes the construction snapshot. Full-document bare Pages and static themes have explicit gaps; generated routes without a backing entry retain their theme eligibility.
5. Rewired analytics/proofs/receipts and admin telemetry before removing the legacy engine. Replacement public tests passed before deletion. Generic response capture now lives in HTTP-kit and is used only for admin telemetry, with original-byte fallback. Removed the old selector/fallback, request-port adapter, settings-link HTML detector, unsafe-eval UI and obsolete engine tests. Saved legacy flags still round-trip without effect. `parse5`, widget consent metadata, settings/revisions/privacy checks, receipts, origin/rate checks, and detached delivery rechecks remain.

The implementation never parses or rewrites served/saved page HTML for consent. Readiness inspection is admin-only. No automatic tracker conversion or stored-page rewrite was added. No new schema, package, framework, polling loop, or browser security-header policy was introduced.

## Publication and commits

The hashes below are implementation checkpoints. This report's final delivery commit is the branch head after the report push.

### Jini

Base: `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60` (`origin/cloud/combine` at fetch). Verified source head: `be6c7beabb5f603165350230d3b21bb1688c29b5`.

- `da26f3248` — Add declared script consent lifecycle
- `b45a3a974` — Support consent user interface bridges
- `f7c3ee94b` — Add document assets and context-aware consent delivery
- `c57cc24be` — Validate declared assets and isolate consent lifecycle failures
- `31dc35b17` — Retire legacy consent rewriting after replacement checks
- `252cbef4a` — Complete consent asset construction and gap diagnostics
- `42cd4ba05` — Keep consent rendering within complexity limits
- `cb1b023d3` — Make consent extension loading idempotent
- `be6c7beab` — Use object arguments for consent context boot

### Tovu

Base: `5358aa594fb6e8c0ca107b1106fbf9ae43871d50` (`origin/cloud/combine` at fetch). Verified source head: `a09c1d40a88a9fa55e8efd9e913c37ccc2248cb9`.

- `fd2cf6835` — Connect active consent bridge contributions
- `00261f060` — Construct consent assets from published declarations
- `e974ef925` — Complete declared asset delivery and authoring guidance
- `22082ad32` — Replace consent readiness rewriting with declaration diagnostics
- `ad70a9e84` — Retire legacy consent rewriting after replacement checks
- `dd192ac99` — Complete consent asset construction and gap diagnostics
- `a09c1d40a` — Simplify consent document composition

## Verification

Commands below were run in this container, using `source /workspace/.tovu-build/env.sh`. Loopback HTTP tests and the full guard used the tool's network-enabled sandbox permission. No checks/rules were disabled, no thresholds raised, and no tests marked skipped. Obsolete classifier/CSP tests were retired with their deleted mechanism; applicable receipt, privacy, metadata, streaming and lifecycle assertions were migrated.

### Jini

- `pnpm install` succeeded after granting the existing pnpm store write access. Initial offline setup lacked tarballs. `pnpm -r build` passed; changed packages were rebuilt again after later edits. Tovu was relinked with `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini`.
- `npm --prefix packages/cookie-consent run build` and `run typecheck` passed. Final sizes: core **4,540 B gzip**, extensions **1,813 B gzip**, total **6,353 B gzip**; both retain the **4,608 B** ceiling and core retains the existing smoke-test headroom.
- The following final focused command passed **107 tests across 10 files**:

```sh
npm --prefix packages/cookie-consent test --   src/__tests__/client.test.ts src/__tests__/anonymous.test.ts   src/__tests__/policy.test.ts src/__tests__/scripts.unit.test.ts   src/__tests__/bridges.unit.test.ts src/__tests__/context.unit.test.ts   src/__tests__/render.test.ts src/__tests__/bundle.smoke.test.ts   src/__tests__/cms-resource-release.integration.test.ts src/__tests__/server.test.ts
```

- `CONSENT_CLIENT_SOURCE=1 npm --prefix packages/cookie-consent test -- src/__tests__/cms-resource-release.integration.test.ts`: **5 passed** after CMS deletion, in addition to shipped-asset coverage.
- `npm --prefix packages/devops test -- src/static-export/__tests__/runner.test.ts`: **24 passed**. Devops `run typecheck` and `run build` passed.
- `npm --prefix packages/http-kit test -- src/__tests__/html-response.test.ts`: **4 passed**, including files/pipes, backpressure/callbacks, HEAD, binary, mutation-then-failure and overflow fallback. HTTP-kit `run typecheck`/`run build` passed.
- `npm --prefix packages/capability-providers test -- src/comments/__tests__/comments.test.ts`: **4 passed**; its typecheck/build passed.
- `npm --prefix packages/admin test -- src/consent/react/__tests__/ConsentFields.test.tsx src/consent/react/__tests__/ConsentSettingsPanel.test.tsx src/consent/react/__tests__/consent-entry.test.tsx`: **29 passed**; admin build/TypeScript passed. Four obsolete unsafe-eval tests were replaced with absence/legacy-value-preservation cases, without changing test count.
- CMS `npm --prefix packages/cms run typecheck` and `run build` passed after deletion. Stale generated `dist/consent` output was removed so retired code cannot ship accidentally.
- `node --check examples/cookie-consent-standalone/server.mjs` passed. A local HTTP probe verified cookie-free page delivery, no-store context, both assets and declared script delivery.

### Tovu

`npx tsc -p tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, and `npx tsc -p development/tsconfig.e2e.json --noEmit` all passed. A focused temporary typecheck over the five changed middleware/preview/readiness/port test files passed; repository configurations were not changed.

Each Node command below is prefixed with `node --import tsx` from `/workspace/Tovu`:

| Test path | Passed |
| --- | ---: |
| `apps/website/src/features/consent/__tests__/service.test.ts` | 47 |
| `apps/website/src/features/consent/__tests__/service.pins.test.ts` | 2 |
| `apps/website/src/features/consent/__tests__/readiness.pins.test.ts` | 14 |
| `apps/website/src/features/consent/__tests__/unit/declared-readiness.unit.test.ts` | 4 |
| `apps/website/src/features/consent/__tests__/ensure-privacy-defaults.test.ts` | 13 |
| `apps/website/src/server/runtime/composition/__tests__/site-consent.ports.unit.test.ts` | 10 |
| `apps/website/src/server/inbound/admin-http/routes/consent/__tests__/routes.test.ts` | 12 |
| `apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.test.ts` | 24 |
| `apps/website/src/server/inbound/public-http/middleware/__tests__/site-consent.test.ts` | 22 |
| `apps/website/src/server/inbound/admin-http/routes/posts/__tests__/preview-consent.integration.test.ts` | 1 |
| `apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts` | 7 |
| `apps/website/src/server/inbound/public-http/http/site/__tests__/bare-page.unit.test.ts` | 16 |
| `apps/website/src/server/inbound/public-http/http/site/__tests__/declared-assets.unit.test.ts` | 2 |
| `apps/website/src/server/inbound/public-http/middleware/__tests__/site-consent-metadata.unit.test.ts` | 62 |
| `apps/website/src/server/inbound/public-http/middleware/__tests__/site-consent-policy.unit.test.ts` | 2 |
| `apps/website/src/features/consent/__tests__/tools.test.ts` | 20 |
| `apps/website/src/features/consent/__tests__/adapters.test.ts` | 19 |
| `apps/website/src/features/consent/__tests__/unit/config.unit.test.ts` | 9 |
| `apps/website/src/features/consent/__tests__/unit/region-plugins.unit.test.ts` | 8 |
| `apps/website/src/features/comments/__tests__/public-markers-scripts.unit.test.ts` | 3 |
| `apps/website/src/features/comments/__tests__/builtin-provider.test.ts` | 6 |
| `apps/website/src/features/theme/__tests__/declared-scripts.unit.test.ts` | 3 |
| `apps/website/src/features/theme/validation/__tests__/validate-theme-package.test.ts` | 61 |
| `apps/website/src/features/theme/__tests__/template-render.canary.test.ts` | 12 |
| `apps/website/src/features/agent-plugins/__tests__/unit/plugin-embed-render.test.ts` | 8 |
| `apps/website/src/features/site-export/__tests__/declared-assets.unit.test.ts` | 1 |
| `apps/website/src/server/runtime/composition/__tests__/analytics-providers.unit.test.ts` | 6 |
| `apps/website/src/server/runtime/composition/__tests__/browser-analytics-http.unit.test.ts` | 1 |
| `apps/website/src/server/inbound/public-http/__tests__/visitor-analytics.unit.test.ts` | 2 |
| `apps/website/src/server/runtime/composition/__tests__/browser-analytics.unit.test.ts` | 2 |

`node --import tsx --test-name-pattern='T40:' apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.regressions.unit.test.ts` and the equivalent `T41:` command passed the affected capture/collector checks. Existing theme-loader/build-manifest focused tests also passed **19 + 13**.

`npm --prefix apps/admin test -- src/features/consent/__tests__/CookieConsent.unit.test.tsx src/features/consent/__tests__/settings.unit.test.ts src/features/consent/__tests__/rules.unit.test.ts src/features/consent/__tests__/use-consent-page.hooks.unit.test.tsx` passed **84** at the diagnostics checkpoint. The affected `CookieConsent.unit.test.tsx` suite passed **32/32** again after UI retirement/service selector cleanup; test count stayed unchanged.

### Baseline and retained check failures

Initial setup failed before an initial green baseline was recorded. A retrospective, untouched archive of Jini base `b0cc1371b` was checked after implementation: original cookie-consent build/typecheck and client/policy/render/CMS integration suites passed **57/57**. All **765 archived file contents** matched the original git archive. Existing dependency symlinks were the only scratch setup. This is retrospective evidence, not an initial baseline claim. The original client measured **4,554 B gzip**. Its jsdom navigation warning also reproduces while tests pass.

Strict checks used `complexity: [error,10]` and `sonarjs/cognitive-complexity: [error,10]`. All new/changed functions pass. Whole-file Tovu checking retains unchanged baseline functions: theme `readBundledTemplateFallback` **11**, app `createRouteDeps` **11**, app `createApp` **11**, deps `composeSiteRouteDeps` **21 cyclomatic / 21 cognitive**. Same-command base comparisons verified these values; the latter three function bodies are byte-identical. No rule was relaxed. Jini's 23 changed production files pass complexity checking (existing stylistic warnings remain in the export runner).

`npx tsc -p tsconfig.tests.json --noEmit` remains red with **59 diagnostics in 33 unchanged test files**, chiefly clock/OAuth/provider-fixture typing. No changed test file has a diagnostic; the error-source diff against the base is empty. These unrelated test types were listed, not repaired.

`pnpm guard` completes with **25 unrelated findings**, listed below. Nineteen source/manifest findings are byte-unchanged from the base; six are untracked setup directories with no tracked files. No consent/extension metadata finding remains. The first restricted-sandbox run hung in Node synchronous child stdin; a minimal probe identified the tool-permission issue, and the network-enabled run completed without changing a check. Full repository test suites and live visual/browser review were left for the later integration stage as instructed.

```text
[guard] R13-model-fallback-freshness claude: MF3 SKIPPED — no readable ~/.claude.json and the CLI initialize handshake found nothing (Claude Code not installed/usable here). Staleness date still enforced (MF1/MF2).
[guard] R13-model-fallback-freshness codex: MF3 compared 9 live id(s) against 20 fallback entr(ies).
[guard] R13-model-fallback-freshness antigravity: MF3 SKIPPED — `agy models` unavailable (spawn agy ENOENT). Staleness date still enforced (MF1/MF2).
[guard] R13-model-fallback-freshness pi: MF3 SKIPPED — MF3 does not apply to `pi` — only MF1/MF2 (staleness date) apply. Staleness date still enforced (MF1/MF2).
[guard] R13-model-fallback-freshness aider: MF3 SKIPPED — MF3 does not apply to `aider` — only MF1/MF2 (staleness date) apply. Staleness date still enforced (MF1/MF2).
[guard] R13-model-fallback-freshness opencode: MF3 SKIPPED — MF3 does not apply to `opencode` — only MF1/MF2 (staleness date) apply. Staleness date still enforced (MF1/MF2).
[guard] R8-package-metadata packages/plugin-ai-trace-langfuse/package.json: package directory "plugin-ai-trace-langfuse" is missing package.json
[guard] R8-package-metadata packages/plugin-analytics-posthog/package.json: package directory "plugin-analytics-posthog" is missing package.json
[guard] R8-package-metadata packages/plugin-observability-opentelemetry/package.json: package directory "plugin-observability-opentelemetry" is missing package.json
[guard] R8-package-metadata packages/plugin-observability-sentry/package.json: package directory "plugin-observability-sentry" is missing package.json
[guard] R8-package-metadata packages/plugin-payments-stripe/package.json: package directory "plugin-payments-stripe" is missing package.json
[guard] R8-package-metadata packages/plugin-ui-ux-design/package.json: package directory "plugin-ui-ux-design" is missing package.json
[guard] R2-deep-path packages/chat/src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.agent-handles.test.tsx: relative import "../../../../../../../ui-kit/dist/react/index.js" reaches into another package's src (ui-kit) — import by package name instead
[guard] L1-layer-edge packages/agent-plugins/package.json: agent-plugins → @jini-ai/cms: L4 cannot depend on L4
[guard] L1-layer-edge packages/agent-plugins/package.json: agent-plugins → @jini-ai/commerce: L4 cannot depend on L6
[guard] SI-optional-peer packages/agent-plugins/package.json: unclassified optional peer @jini-ai/cms; declare jini.optionalPeers with opt-in feature and user-facing message, or make it required
[guard] SI-domain packages/cms/src/widgets/resolvers/contact-form.ts: ./widgets (widgets) reaches src/forms/provider.ts (forms) via ../../forms/provider.js
[guard] SI-domain packages/cms/src/widgets/resolvers/contact-form.ts: ./widgets/html (widgets) reaches src/forms/provider.ts (forms) via ../../forms/provider.js
[guard] SI-domain packages/cms/src/widgets/resolvers/contact-form.ts: ./widgets/resolvers (widgets) reaches src/forms/provider.ts (forms) via ../../forms/provider.js
[guard] SI-domain packages/commerce/src/catalog/repo.rows.ts: ./repo (repo) reaches src/money/money.ts (money) via ../money/money.js
[guard] SI-domain packages/commerce/src/payments/kernel.ts: ./payments/kernel (payments) reaches src/money/money.ts (money) via ../money/money.js
[guard] SI-domain packages/commerce/src/payments/ops/common.ts: ./payments/kernel (payments) reaches src/money/money.ts (money) via ../../money/money.js
[guard] SI-domain packages/commerce/src/payments/ops/intent.ts: ./payments/kernel (payments) reaches src/money/money.ts (money) via ../../money/money.js
[guard] SI-domain packages/commerce/src/catalog-tools.ts: ./tools (tools) reaches src/payments/tools/input.ts (payments) via ./payments/tools/input.js
[guard] SI-domain packages/commerce/src/payments/tools/input.ts: ./tools (tools) reaches src/money/money.ts (money) via ../../money/money.js
[guard] SI-domain packages/commerce/src/catalog/checkout.ts: ./tools (tools) reaches src/money/money.ts (money) via ../money/money.js
[guard] SI-domain packages/commerce/src/payments/tools/input.ts: ./payments/tools (payments) reaches src/money/money.ts (money) via ../../money/money.js
[guard] SI-domain packages/commerce/src/payments/tools/money-tools.ts: ./payments/tools (payments) reaches src/money/money.ts (money) via ../../money/money.js
[guard] HW3-module-state packages/commerce/src/catalog-tools.ts: Module state must be instance-owned; readonly collections or explicitly reviewed path-keyed locks may be retained.
[guard] HW3-module-state packages/commerce/src/payments/tools/resolve-unknown.ts: Module state must be instance-owned; readonly collections or explicitly reviewed path-keyed locks may be retained.
[guard] HW3-module-state packages/ui-kit/src/react/Kit.hooks.ts: Module state must be instance-owned; readonly collections or explicitly reviewed path-keyed locks may be retained.
```

## Memory and read costs

| Path | Frequency and payload / state cost |
| --- | --- |
| Source activation/publication | Published construction snapshot: one head plus at most one published revision, bounded at 32 KiB. Script/bridge/region manifest data uses existing active-plugin loading and 60-second lazy caches; up to three independent cached manifest loads per enabled site per minute, no timer or polling loop. |
| Managed page, consent on | Zero consent policy-store reads and no full-HTML consent buffer/scan. In-memory declaration validation/serialization scales with declaration bytes; automatic assets use ordinary defer delivery. Optional lifecycle retains O(N) entries/nodes; permission reconciliation scans categories. Sequential eligible-script selection can scan O(N) per completion, O(N²K) over N starts, with no storage/network beyond the script fetches. |
| Managed page, consent off | Zero consent requests, cookie reads/writes, policy-store reads or per-page manifest reads; no consent runtime/config. Ordinary scripts still deliver, and local plugin declarations remain in export assets. Startup/source activation work remains outside this page path. |
| Browser boot/context | Two consent JS assets, total 6,353 B gzip, plus one same-origin no-store context GET. Context reads the published head/revision once (no draft), resolves trusted region, and writes/clears the region cookie only there. Initial client reads region/choice cookies; permission checks thereafter are in memory. A stale policy/copy pair reloads before cookie access or optional execution. |
| Choice | Existing one bounded receipt POST, cookie writes/verification and bounded immutable receipt write/retirement. Receipt inventory/maintenance remains amortized; it is not claimed to be one filesystem syscall. |
| Server analytics | Enabled requests use the existing published policy read/cookie parsing. Detached delivery rechecks current policy and the receipt. Disabled snapshot checks do zero consent I/O and avoid cookie parsing. Generic collectors/forwarders require full analytics; anonymous capability remains explicit in consent adapters. |
| Admin readiness | Existing bounded page render, storage check, theme lookup and cached declarations, plus one indexed published-entry lookup (including its existing stored body payload). At most 1 MB of sample HTML and 200 declaration/warning inventory entries; URL labels are redacted. No public-path read was added for this inspection. |
| Admin telemetry capture | Existing 5 MiB response cap. Mutation-safe fallback may retain two bounded input buffers (10 MiB) plus transform output. Overflow resumes native streaming/backpressure. This helper never captures public consent pages. |
| Export | One deferred explicit asset-list evaluation after app construction; each unique local declared asset is fetched/copied once through the normal deduplicated HTTP writer. Live collectors omitted; local evidence snapshot retained. No consent HTML conversion. |

## In-scope bugs fixed (one per line)

- Malformed declared URLs and unknown categories could reach the new loader; validation now rejects them.
- Throwing bridge mount/disposal or a rejected lazy mount could block the UI or escape as an unhandled rejection; contributions are isolated.
- Fresh context policy could be paired with stale cached banner copy; boot now reloads before storage/API/optional execution.
- Mounted browser-analytics paths used the provider segment as the surface; corrected the index with a failing regression.
- Trusted US subdivision headers such as `us-ca` were treated as strict; valid US subdivisions now preserve opt-out defaults, custom allowlists remain respected.
- Disabled server checks added policy/cookie reads; snapshot guards and early proof return remove that I/O.
- Disabled exports omitted ordinary plugin declarations; explicit export lists now retain their local assets.
- Managed bare fragment Pages bypassed document asset slots; their construction owner now emits the slots, while authored full documents stay unchanged.
- Automatic declarations depended on successful consent context; the shared renderer now emits them as ordinary assets and keeps only optional declarations in JSON.
- Preview could emit automatic executable declarations; preview output stays scriptless.
- Loading the extension asset twice could start a declared script twice; an API-instance marker now makes feature installation idempotent across bundle executions.

These bugs were exercised with failing regressions before their fixes. Unrelated findings above were retained rather than expanded into fixes.

## Owner review and remaining boundaries

Review the admin declaration list and separately labelled unmanaged-content/runtime-slot gaps before moving an existing site. Raw scripts/handlers and live embeds remain authored content; a JSON declaration does not disable an old tag. Full-document static themes and authored full-document bare Pages remain outside automatic runtime insertion. No converter or stored-page migration exists.

Review banner appearance and outside CMP wiring in the target site. The old unsafe-eval control is gone; retained saved flags have no effect. External declarations without consent remain intentionally automatic, without warnings. Several consent values are all-of permissions.

Publish/re-export through the normal site lifecycle when policy/declarations change. Construction snapshots refresh on policy publication; document bytes/ETags include the emitted declarations, and policy mismatch forces revalidation. Static exports are snapshots with local evidence; they need fresh exports after changes and do not contain live collectors. No external CDN purge service was introduced.

Runtime implementation is complete within the requested scope. The unrelated guard/test-type/complexity findings and visual/site-by-site review remain open as listed. No full-suite or live deployment claim is made.

## Exact Jini file inventory and removed lines

Diff from `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`: **80 paths**, **+1099 / -6108 lines**, excluding this report from line totals. Moved/replaced lines are included in diff counts.

The deleted CMS consent directory is **36 files / 5,758 lines**, comprising **15 production TS files / 2,314 lines** and 20 obsolete tests/fixtures plus README / 3,444 lines. `parse5` and `packages/cms/src/contracts/consent-category.ts` remain.

`A` added, `M` modified, `D` deleted; rename notation follows git.

```text
A	cloud/reports/consent-declare.md
M	examples/cookie-consent-standalone/README.md
M	examples/cookie-consent-standalone/server.mjs
M	knip.json
M	packages/admin/src/consent/react/ConsentFields.tsx
M	packages/admin/src/consent/react/ConsentSettingsPanel.tsx
M	packages/admin/src/consent/react/__tests__/ConsentFields.test.tsx
M	packages/admin/src/consent/react/settings-panel.hooks.ts
M	packages/capability-providers/src/comments/ports.ts
M	packages/cms/package.json
D	packages/cms/src/consent/README.md
D	packages/cms/src/consent/__tests__/analytics-proof-m1.unit.test.ts
D	packages/cms/src/consent/__tests__/analytics-proof.test.ts
D	packages/cms/src/consent/__tests__/appearance.test.ts
D	packages/cms/src/consent/__tests__/compact-banner.test.ts
D	packages/cms/src/consent/__tests__/css.cov-j2.test.ts
D	packages/cms/src/consent/__tests__/css.test.ts
D	packages/cms/src/consent/__tests__/file-records-w2g.unit.test.ts
D	packages/cms/src/consent/__tests__/fixtures.ts
D	packages/cms/src/consent/__tests__/floating-ui.test.ts
D	packages/cms/src/consent/__tests__/gate-boundaries-m1.unit.test.ts
D	packages/cms/src/consent/__tests__/html.cov-j2.test.ts
D	packages/cms/src/consent/__tests__/html.test.ts
D	packages/cms/src/consent/__tests__/http.test.ts
D	packages/cms/src/consent/__tests__/policy.test.ts
D	packages/cms/src/consent/__tests__/records.test.ts
D	packages/cms/src/consent/__tests__/request-choices.test.ts
D	packages/cms/src/consent/__tests__/resources-w2g.unit.test.ts
D	packages/cms/src/consent/__tests__/response.cov-j2.test.ts
D	packages/cms/src/consent/__tests__/response.test.ts
D	packages/cms/src/consent/__tests__/shadow-boundaries-m1.unit.test.ts
D	packages/cms/src/consent/css-parser.ts
D	packages/cms/src/consent/css.ts
D	packages/cms/src/consent/express/index.ts
D	packages/cms/src/consent/express/response.ts
D	packages/cms/src/consent/html/client.ts
D	packages/cms/src/consent/html/gate.ts
D	packages/cms/src/consent/html/index.ts
D	packages/cms/src/consent/html/render.ts
D	packages/cms/src/consent/html/resources.ts
D	packages/cms/src/consent/html/static.ts
D	packages/cms/src/consent/html/styles.ts
D	packages/cms/src/consent/index.ts
D	packages/cms/src/consent/node/index.ts
D	packages/cms/src/consent/policy.ts
D	packages/cms/src/consent/types.ts
A	packages/cms/src/presentation/document-assets.ts
M	packages/cms/src/presentation/index.ts
M	packages/cookie-consent/README.md
M	packages/cookie-consent/package.json
M	packages/cookie-consent/scripts/build-client.mjs
A	packages/cookie-consent/src/__tests__/bridges.unit.test.ts
M	packages/cookie-consent/src/__tests__/bundle.smoke.test.ts
M	packages/cookie-consent/src/__tests__/cms-resource-release.integration.test.ts
A	packages/cookie-consent/src/__tests__/context.unit.test.ts
M	packages/cookie-consent/src/__tests__/render.test.ts
A	packages/cookie-consent/src/__tests__/scripts.unit.test.ts
M	packages/cookie-consent/src/__tests__/server.test.ts
M	packages/cookie-consent/src/client.min.ts
A	packages/cookie-consent/src/client/bridges.ts
A	packages/cookie-consent/src/client/features.ts
M	packages/cookie-consent/src/client/index.ts
A	packages/cookie-consent/src/client/runtime.ts
A	packages/cookie-consent/src/client/scripts.ts
M	packages/cookie-consent/src/contract.ts
A	packages/cookie-consent/src/contracts/scripts.ts
A	packages/cookie-consent/src/extensions.min.ts
M	packages/cookie-consent/src/policy.ts
M	packages/cookie-consent/src/render/banner.ts
M	packages/cookie-consent/src/render/index.ts
A	packages/cookie-consent/src/render/scripts.ts
M	packages/cookie-consent/src/server/region.ts
M	packages/cookie-consent/vitest.config.ts
M	packages/devops/src/static-export/__tests__/runner.test.ts
M	packages/devops/src/static-export/contracts.ts
M	packages/devops/src/static-export/runner.ts
M	packages/http-kit/package.json
A	packages/http-kit/src/__tests__/html-response.test.ts
A	packages/http-kit/src/html-response.ts
M	pnpm-lock.yaml
```
