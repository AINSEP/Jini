# UI review

Completed read-only within the two-hour cap. No code or repository tests changed. Only this report is committed.

## Branches and scope

- Jini review base: `origin/cloud/combine`, `f07ae3d6ff55cf4da480acac44cc6f4b7686966b`.
- Tovu review base: `origin/cloud/combine`, `74fedc1320d31431ab4a13d1e38af03a402ca28b`.
- Reviewed ranges: Jini `dfaf12f1f..f07ae3d6f`; Tovu `14030521c..74fedc132`.
- Report branch: Jini `cloud/ui-review`. No Tovu commits or pushes.
- Published progress commits: `f22e62997`, `2d2fc9130`. The final report SHA is supplied in the task thread.

The review covered the prioritized allowlist rationale, desktop close/stop/background paths and idle policy, the shared site-card package surface, and the payment-return flow. It also examined site-list preferences, import/export presentation, form-provider edits, shared table/menu/chat changes, consent snapshot changes, media-evidence invalidation, and connection configuration changes.

The three reviewed allowlist additions are justified by their actual call paths. The rebuilt shared UI JavaScript and stylesheet exports resolve successfully. Detailed findings, locations, reproductions, and recommendations are reserved for the task thread as requested; this public report uses general wording.

## Bugs found

- Desktop renderer test-loader compatibility needs correction.
- A tab background choice does not retain the requested lifecycle behavior.
- Payment-return error rendering needs a reliable fallback.
- Overlapping tab-close operations can lose a pending request.
- Connection argument preservation has an inherited edge case that remains unresolved.

No findings were fixed in this report-only job.

## Resource and excess-code review

No additional recurring network poll was found in the new site-list controls. Preferences add an initial read and writes on user changes; their size grows with the stored identifiers, so the stated small-payload estimate is not a hard bound. The shared list recomputes filtering and sorting when its host inventory rerenders. Existing visibility-aware inventory polling remains relevant to that CPU cost. The consent refresh remains request-driven and minute-spaced, now sharing a snapshot across app constructions for the same site.

Legacy card selectors remain in the admin stylesheet after the shared-card migration. They are a cleanup opportunity. Background lifecycle choices also affect ongoing process resource use; the full details are in the task thread.

## Validation

Successful setup commands, with `/workspace/.tovu-build/env.sh` sourced:

From `/workspace/Jini`:

```sh
CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/ui-review/pnpm-store
pnpm --filter @jini-ai/core run build
pnpm --no-bail -r build
```

From `/workspace/Tovu`:

```sh
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
npm --prefix packages/contracts run build
npm --prefix packages/sdk run build
npm --prefix apps/desktop run build:preload
```

The workspace-local package store was seeded from the existing cache after the default store proved read-only. Initial HTTP test attempts exposed missing refreshed contract output and restricted loopback sockets; after rebuilding the outputs and enabling execution-network access, the focused HTTP checks passed. No PostgreSQL service was needed.

Focused existing checks: **611 named tests passed**, with the renderer qualification below. Full suites were not run.

From `/workspace/Jini`:

```sh
pnpm --filter @jini-ai/ui exec vitest run src/features/site-card/__tests__ src/features/mcp-ui/__tests__/surfaces/document.test.ts
pnpm --filter @jini-ai/admin exec vitest run src/react/__tests__/components/DataTable.test.tsx src/react/components/RowMenu/__tests__/RowMenu.test.tsx src/forms/react/__tests__/FormEditorFieldsBody.unit.test.tsx
pnpm --filter @jini-ai/chat exec vitest run src/react/components/__tests__/MidRunUserMessage.test.tsx
pnpm --filter @jini-ai/cms exec vitest run src/forms/__tests__/write-service.test.ts
```

Results respectively: **67, 86, 10, 23 passed**.

From `/workspace/Tovu`:

```sh
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-isolation=none --test-reporter=tap --experimental-test-module-mocks apps/website/src/assistant/__tests__/mcp-ui-allowlist-completeness.test.ts apps/website/src/assistant/__tests__/mcp-ui-tool-calls.test.ts apps/website/src/server/runtime/composition/__tests__/commerce-http.unit.test.ts apps/website/src/server/inbound/public-http/routes/commerce/__tests__/purchase.integration.test.ts
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-isolation=none --test-reporter=tap --experimental-test-module-mocks apps/website/src/features/consent/__tests__/unit/region-plugins.unit.test.ts apps/website/src/server/inbound/public-http/__tests__/declared-consent.unit.test.ts apps/website/src/features/site-export/__tests__/declared-assets.unit.test.ts apps/website/src/features/external-mcp/__tests__/access-save.integration.test.ts apps/website/src/features/project-keys/__tests__/site-sealer.unit.test.ts apps/website/src/server/inbound/admin-http/__tests__/owner-mfa-login.unit.test.ts
```

Results respectively: **52, 37 passed**.

From `/workspace/Tovu/apps/admin`:

```sh
npx vitest run src/features/sites/__tests__/AllSitesTab.unit.test.tsx src/features/sites/__tests__/use-site-list-prefs.hooks.unit.test.tsx src/features/sites/__tests__/site-transfer-tabs.unit.test.tsx src/features/sites/__tests__/site-transfer-credential-warnings.unit.test.tsx src/features/themes/__tests__/Themes.unit.test.tsx
```

Result: **125 passed**.

From `/workspace/Tovu/apps/desktop`:

```sh
node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test --test-isolation=none --test-reporter=tap src/main/windows/last-window-quit.test.ts src/project-ipc.test.ts
node --import tsx src/renderer/use-tab-close-ask.hooks.render.test.ts
node --import tsx src/renderer/app/TabCloseAsk.render.test.ts
node --import tsx src/renderer/use-site-list-prefs.hooks.test.ts
node --import /workspace/work/ui-review/one-react-pre-resolved.mjs --import tsx src/renderer/SiteGrid.jsdom.test.ts
```

Results respectively: **165, 7, 4, 8, 27 passed**. The last command uses a scratch-only resolver that resolves React entry points before registering its hook. The repository's own renderer loader fails before assertions on the installed Node 24.22.1 runtime; these results do not certify the normal renderer test command. A combined no-isolation renderer invocation also encountered shared-DOM interference, so the reported renderer results are individual-file runs.

Additional scratch-only probes exercised lifecycle timing, overlapping operations, argument round trips, and error rendering. They changed no repository source or tests. Logs and scratch harnesses remain under `/workspace/work/ui-review`; they are not committed or pushed.

## Limits and remaining work

This was a source review of the final net changes and relevant surrounding call paths, with focused automated checks. It was not an exhaustive review of every intermediate commit or every test implementation. Locale dictionaries were inspected structurally, not certified translation by translation. Binary logo/icon changes were not visually reviewed. No full native Electron click-through, cross-platform window-manager verification, or browser/device layout matrix was performed. Unchanged subsystems were followed only as needed to validate findings; no whole-repository correctness claim is made.

Follow-up code work remains for the five bugs and optional cleanup. No source typecheck or complexity-lint run was required for this report-only change; the setup build compiled Jini and the Tovu preload/contracts/SDK. Neither main branch was changed or pushed.
