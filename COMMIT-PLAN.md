# w3b-ext-a2 Jini — coordinator commit plan (DO NOT COMMIT THIS FILE)

Base: 6e20bc15e (codex/r2-ext-a2j, origin/codex/w3-ext-aj). Source: Tovu 724ddc31a, the reviewed integration tip; source blobs read with git show, without modifying Tovu. Programmer instructions read first. No subagents, tests, mutation runs, builds, installs, typechecks, linters, Git writes or API-baseline generation.

## STOP / LEFT ledger, in sheet order

- **081 STOP — prerequisite absent.** A1 J35 has not created mcp React setup: packages/mcp/package.json has no React peer or React browser entries and packages/mcp/tsconfig.json has no jsx option. Do not build J35 under 081.
- **083 LEFT — dependent.** Needs 081 and A1 J35's banner/form leaves.
- **085 STOP — prerequisite absent.** Required first-pass J16 descriptor/rules leaf packages/devops/src/deploy/react/rules.ts does not exist. The FIX expressly requires its same-package types; no replacement catalog was invented.
- **087 LEFT — dependent.** Requires J16 descriptor/rules leaf. J01 core deployment ports exist, but do not supply the missing J16 rules.
- **089 LEFT — dependent.** Requires J16, 085 and 087.
- **091 STOP — unlisted host build/effect dependency.** Tovu use-page-editor.hooks.ts:792–798 retains the why-comment and instrumentation `if (import.meta.env.DEV) { console.debug(... Math.round(performance.now())) }`. A verbatim browser-package move retains a Vite-only global; non-Vite hosts have no import.meta.env. The sheet names scheduling/DOM callbacks but no diagnostic/build-environment binding. Removing the block changes effects and deletes its why-comment; adding an environment/logger seam violates the no-unlisted-collaborators rule. Needs an explicit disposition for this block before this sheet can move verbatim.
- **093 LEFT — dependent.** Needs 091 controller and surface.
- **095 STOP — source/spec behavior and literal contract mismatch.** Tovu PostEditorNotices.tsx:75 suppresses stale-basis while saveConflict exists; :85 suppresses external-change while saveConflict exists. The sheet requires notices independent except external-change suppression of stale-basis, while the dispatch forbids behavior changes. Also, the literal FIX `postRowMenuItems<Row>(...post: Row...)` leaves Row unconstrained although the verbatim body reads post.status. Needs a decision on those suppression guards and an explicit status constraint; no cast or extra row contract added.
- **097 LEFT — dependent.** Requires 095's rules and row-menu contract.
- **099 STOP — unlisted product-copy binding.** Tovu use-publish-content-confirm.hooks.ts:1211 calls t("is on an older Tovu and can't overwrite these yet. Update it, then publish again."). The named deps include scope copy, policy, error description and clock, but none owns this product-specific unavailable-overwrite line; existing PublishReportPolicy covers report rows, not this sentence. A verbatim move leaks product identity; rewriting the key breaks copy/translation parity; adding a new copy callback is forbidden. Needs an explicit copy seam/disposition. CORRECTION: hooks/criteria-publish-result.ts DOES exist; its different public export spelling is not a blocker.
- **101 LEFT — dependent.** Requires 099 helpers/controller/view contract.
- **103 STOP — prerequisite absent.** Typed builders/field/default-promotion collaborators from J15/J16 are required; J16 deployment rules/descriptor leaf is absent. Do not recreate those rules in Integrations.
- **105 LEFT — dependent.** Requires 103 controllers/rules.
- **111 STOP — host-policy inputs absent from named helper contract.** Tovu settings-tabs.ts:199–215 branches on "classic" and reads DEFAULT_APPEARANCE.accentColor from exported adminThemeAccent/withAdminThemeAccent. 112 expressly keeps Classic and accent defaults in Tovu; the 111 helper contracts retain only existing inputs plus normalizeAccentColor, so the standalone exports cannot access host policy. Factory defaults alone cannot supply dependencies to standalone exports. Needs explicit named helper inputs or a different approved ownership split; no extra options added.

All 18 even-numbered Tovu sheets are outside this Jini-only dispatch. There are no REJECT or pre-labelled NEEDS-OPUS Jini sheets in this set.

## Completed logical commits, in sheet order (coordinator commits; all untested)

### 107 — Live Secrets shell
- packages/admin/src/security/react/live/Security.tsx
- packages/admin/src/security/react/live/__tests__/Security.site-key-affordance.unit.test.tsx
- packages/admin/package.json
- .changeset/admin-extraction-107.md
- Test was written before the implementation. It renders direct site-key entry while denied, then grants permission, then downgrades it; both the button and body must be absent and Access Tokens present when denied.
- Review mutations: **M-trust-query-over-permission** (always use SECURITY_TAB_IDS); **M-render-site-key-body-when-denied** (mount SiteKey independent of the resolved active tab).
- @jini-ai/admin/security/react/live/Security (browser): Security, SecurityProps → api-baseline/jini-ai__admin.json.

### 109 — BYOK footer status rule
- packages/integrations/src/react/admin-credentials/byok-footer-status.ts
- packages/integrations/src/react/admin-credentials/__tests__/byok-footer-status.endpoint-precedence.unit.test.ts
- packages/integrations/package.json
- .changeset/admin-extraction-109.md
- Test written first. Tests saving → saved → non-idle silent → other endpoint → stored/unset with bound copy.
- Review mutation: **M-show-stored-for-other-endpoint** (put the stored branch ahead of the endpoint mismatch).
- @jini-ai/integrations/react/admin-credentials/byok-footer-status (universal): AdminByokSaveState, resolveByokFooterStatusLine → api-baseline/jini-ai__integrations.json.
- Required local symbol audit done: there is no AdminByokKeyPanel.tsx in packages/integrations/src/react/admin-credentials on this round-1 tree. When J04's view lands, import ./byok-footer-status.js or supply it through its approved prop; Tovu's real footer binds the five translated strings in 110. No second credential controller was added.

### 113 — Non-secret execution ledger
- packages/admin/src/shell/lib/execution-settings-ledger.ts
- packages/admin/src/shell/lib/__tests__/execution-settings-ledger.no-secrets.unit.test.ts
- packages/admin/src/shell/lib/__tests__/execution-settings-ledger.partial-rollback.unit.test.ts
- packages/admin/package.json
- .changeset/admin-extraction-113.md
- Both test files written before implementation: sentinel in loaded/current/previous configs never reaches a diff write; only in-memory refresh retains it; Local CLI fields use user scope; other fields use workspace scope; third-write failure reverses only the two successful keys, and a restore failure is reported without replacing the original failure.
- Review mutations: **M-write-api-key-to-ledger**, **M-write-local-cli-at-workspace-scope**, **M-rollback-in-forward-order**, **M-persist-api-key-via-previous-config**.
- @jini-ai/admin/shell/lib/execution-settings-ledger (universal): EXECUTION_NAMESPACE, hasUsableAdminKey, hasTypedAdminKey, readExecutionMode, readByokProtocol, readByokProviderId, buildByokConfigFromLedger, buildLocalCliConfigFromLedger, selectedLocalCliModel, selectedLocalCliReasoning, reconcileExecutionConfigRefresh, createExecutionSettingsLedger → api-baseline/jini-ai__admin.json.
- 114 binds the effective-row envelope and the port's named-object writes; classifier remains host-owned (404 policy), as does scrubbed reportRestoreFailure. Factory load/save signatures use required/options objects. Existing runtime adapter, defaults, credential storage, legacy storage and bus remain in Tovu.

### 115 — Settings layout, locale bridge and About panel
- packages/admin/src/react/settings/SettingsPageLayout.tsx
- packages/admin/src/react/settings/__tests__/SettingsPageLayout.loading-locale-and-tab.unit.test.tsx
- packages/admin/package.json
- .changeset/admin-extraction-115.md
- Test written first: loading mounts no provider/tab tree; null locale uses the supplied fallback; nested provider cannot write document locale; unknown active tab prop is omitted; descriptor order, inline-only shell, load-error/defaults report and saved live region are retained.
- Review mutations: **M-show-fallback-tab-during-loading** (remove loading return), **M-write-document-locale-from-nested-provider** (remove syncDocumentAttributes={false}).
- @jini-ai/admin/react/settings/SettingsPageLayout (browser): SettingsPageLayout, SettingsPageLayoutProps, SettingsAboutPanel → api-baseline/jini-ai__admin.json.
- 116 supplies all nine panel nodes and translated descriptors, root theme/data attributes, dictionaries and locale hook, and binds onTabChange({ tabId }, {}). Product version/hint are inputs to SettingsAboutPanel.

## Static review / deletions

- Re-read added source and tests and tracked package diff; runtime and type correctness remain unverified by explicit dispatch instruction. Six test cases added in five named test files; no existing tests deleted or weakened.
- Removed an extra Site key body permission guard introduced during extraction: the original resolved-tab gate already owns it; dispatch forbids new defensive checks.
- Removed incidental JSON Unicode escaping from package manifests; no unrelated formatting changes retained.
- Removed the incorrect criteria-result prerequisite finding after checking source versus export mappings.
- No production files deleted. No baseline JSON hand-edited. No Git index, commit or push writes.
- Every new leaf has exports + jini.entries + existing typesVersions entries, and its sheet-numbered minor changeset.
- Source-map overlap: the existing Admin module-kit SecurityPage/AccessTokensTab remain in place. 107 is a slot-only live shell; retire the old module-kit Access Tokens variant in the separate follow-up specified by the owner, after the rich Integrations tab lands.

## Architecture/verification handoff

Static boundary review: no runtime UI dependency added to Admin, no Node root imports React, no product client or secret storage import added. The ledger reuses core execution types; the shell/layout use narrow Admin kit types; footer state retains the existing structural shape. Functions and files remain under the sheet's 80/500 bounds. No new external I/O endpoint or recurring resource was added.

Validation status: UNRUN as required. Opus must run the five named tests and named mutations, inspect the API baselines, and typecheck before integrating. 107/109/113/115 have implementation plus test sources, not a green claim. Missing prerequisites and contract gaps above must be resolved before resuming their independent/dependent sheets.

Static function-quality handoff (no execution evidence):

| Units | Disposition | Findings / required next action |
| --- | --- | --- |
| Security tab resolution, tab projection, shell | NO_RECORDED_FINDINGS in static review | Permission is read before resolution; both bodies follow the resolved id; test covers direct entry and downgrade. Opus must execute it. |
| resolveByokFooterStatusLine | NO_RECORDED_FINDINGS in static review | Pure fixed-shape precedence, no key input. Execute endpoint-precedence test. |
| Execution readers, projections, diff, save/restore and factory | ADVISORY | Preserve the host reportRestoreFailure sink's non-throwing logging semantics when 114 binds it. No validation/default/try-catch was added beyond the specified map-presence guard. |
| Settings descriptors, locale bridge, layout, shell and About | NO_RECORDED_FINDINGS in static review | Host supplies panel bodies, copy and theme/data facts. Execute loading/locale/tab witness; theme boundary uses the actual two data attributes from the existing host return type. |

Zero-findings skepticism/variable-name review: inspected activeTabId versus requested query, stored versus other-endpoint status, current/loaded configs, written keys versus changed candidates, and locale versus fallbackLocale. No renamed variable changes meaning. Testing remains required; these are static dispositions, not certified results.
