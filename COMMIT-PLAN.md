# Jini DOM isolation dispatch

Working tree only; coordinator commits. No tests, builds, installs, typechecks, or linters run.
Source: Tovu reviewed `origin/integ/w3-ext-a-2026-11-25` (1099eb856382c0d6c24ad380748e1cb021b8a977); all 11 specified blobs match round-one anchors. Jini HEAD ff4b06a1c956a1c592ca0631555b95f952761636 = origin/codex/adm-j.
The dispatch approves the existing CMS leaf/optional-peer convention and agentic two-compiler pattern; no seed approval required.
Boundaries: React leaves use core contracts and injected host collaborators; no admin or Node implementation imports, no barrels. Keep behavior/statement/effect order and private boundaries. No Tovu edits or API baseline generation.

## Ordered commits

1. J04-panel integrations prep: completed. Files: packages/integrations/{package.json,tsconfig.json,tsconfig.react.json,vitest.config.ts}, pnpm-lock.yaml. Existing hint source/export/assertions unchanged.
2. J04-panel feature: completed. Files: packages/integrations/src/react/admin-credentials/{AdminByokKeyPanel.tsx,__tests__/AdminByokKeyPanel.status.unit.test.tsx}, packages/integrations/package.json, .changeset/admin-extraction-04.md.
   API baseline record (Opus): ./react/admin-credentials/AdminByokKeyPanel exports AdminByokMigrationPrompt, AdminByokKeyFooter, AdminByokSettingsFooter, resolveByokSettingsStatusLine and all three *Props.
   Mutation M-show-mask-for-other-endpoint: remove storedKeyIsForOtherEndpoint from the resolver options at the footer call. The current-provider copy assertion must fail.
3. J09: completed. Files: packages/integrations/src/react/webhooks/{rules.ts,Integrations.tsx,IntegrationDeliveries.tsx,hooks/use-integrations.hooks.ts,hooks/use-integration-deliveries.hooks.ts,__tests__/Integrations.confirm-delete.unit.test.tsx,hooks/__tests__/IntegrationDeliveries.subscription-key.unit.test.tsx}, packages/integrations/package.json, .changeset/admin-extraction-09.md. API baseline record (Opus): exact leaves/symbols listed in the changeset.
   M-delete-from-row-menu: pass onDelete instead of setPendingDelete to renderIntegrationsTable / the row delete handler; the dialog/zero-delete assertion must fail.
   M-share-delivery-key-across-subscriptions: remove subscriptionId from KEYS.deliveries; the B rows/two-key assertion must fail.
4. J14: completed. Files: packages/integrations/src/react/site-key/{SiteKeyTab.tsx,SiteKeyRecoveryCard.tsx,hooks/use-site-key.hooks.ts,hooks/use-site-key-recovery.hooks.ts,__tests__/SiteKeyTab.agent-secrecy.unit.test.tsx,hooks/__tests__/use-site-key-recovery.confirmation.unit.test.ts}, packages/integrations/package.json, .changeset/admin-extraction-14.md. API baseline record (Opus): exact leaves/symbols listed in the changeset. Only the two named closure extractions were added.
   M-render-revealed-key-in-agent-tree: remove AGENT_PRIVATE_ATTRIBUTE spreads from the revealed value code element and wrapper; the private-boundary and filtered-agent-tree assertions must fail.
   M-execute-start-fresh-without-confirmation: remove `if (!canConfirmStartFresh) return` from startFresh; the zero-write assertion for lower-case confirmation must fail.
5. J20 DB prep: completed. Files: packages/db/{package.json,tsconfig.json,tsconfig.build.json,tsconfig.react.json,tsconfig.react.build.json,vitest.config.ts}, pnpm-lock.yaml. All 24 pre-existing exports explicitly marked node. React peers optional. Lock importer entries copied from already-resolved CMS records; no install run.
6. J20 feature: completed. Files: packages/db/src/react/recovery/{Recovery.tsx,Recovery.restore-steps.tsx,__tests__/Recovery.restore-ceremony.unit.test.tsx,__tests__/Recovery.direct-tab.unit.test.tsx}, packages/db/package.json, .changeset/admin-extraction-20.md. API baseline record (Opus): ./react/recovery/Recovery exports only Recovery, RecoveryProps, RestoreFlowProps. CSS remains host-owned (T20).
   M-bypass-disclosure-ack: remove !acknowledged from RestoreIdleStep's disabled expression; the disabled/zero-plan assertion must fail.
   M-execute-without-confirmation-token: remove && confirmationToken from the confirmed branch; Execute becomes visible during token-pending confirmation and must fail the witness.
   M-force-list-on-direct-restore: give SettingsDialogShell activeTabId based on missing selected instead of navigation's activeTabId; the direct restore prompt/list assertion must fail.

## Deletions / audit
No source deletions in Jini; host sources remain for T sheets. No extra abstractions or comments planned. Generated baselines and all execution/mutation verification belong to Opus.

## Handoff

All four assigned J sheets implemented; no source/blob mismatches and no stopped sheets. All seven named witnesses were written before their feature bodies, covering eight named mutations. They have NOT been run, either normally or mutated. No test, install, build, typecheck, lint, guard, API-generation, git mutation, or network command was run. All changes remain in the working tree.

Static architecture audit: new production imports are React, the named core leaves, and browser siblings only. No admin imports, Node implementation imports, root/React barrel, host client, permission, restore-engine, owner-recovery, or Tovu changes were added. Source effect/statement order, confirmation guards, private attributes, error precedence and separate cache namespaces were retained. Only the sheet's two site-key closure extractions and private recovery-body split were added. All new source files are below 500 lines. Automated function/complexity checks remain with Opus; no additional split helpers were invented to change the verbatim JSX bodies.

Review corrections: removed incidental JSON Unicode escaping from both manifests; resolved the copied disclosure count type inline; retained explicit undefined support on the existing badge option; restored moved DI why-comments while updating stale host wiring descriptions. No production/test files or assertions deleted. No out-of-sheet code retained.

Host importer review used the reviewed Tovu ref above, including both production mounts and the named test importers. The delivery-hook and status-hook host test files are `.tsx` (the latest shared sheet's `.*` paths); older ledger `.ts` spellings are stale. No source anchors differ.

Tovu follow-up: T04-panel binds required locale, createTranslator and resolveByokFooterStatusLine. T09 keeps wired hooks host-side and binds query/refresh/error/translation, kit, labels, viewer zone and the lazy delivery mount. T14 binds the existing SecretInput, copy/locale/reveal-copy hooks, query hooks, formatters, refusal classifier and host strings; Generate stays hidden. T20 binds hooks/navigation/kit/dictionaries/copy/viewer zone, owns the CSS import, and adds DB at its existing root range. Use the release containing the new minor changesets as the floor; no file range or new integrations dependency.

Opus owns both package compilers, guard, emitted JS/declaration inspection and React compilation isolation proof, the seven normal witnesses and eight mutation runs, generated API baselines, and T-sheet integration. Other J/T sheets in the dispatch are outside this Jini-only task.

## Exact working-tree inventory
- .changeset/admin-extraction-04.md
- .changeset/admin-extraction-09.md
- .changeset/admin-extraction-14.md
- .changeset/admin-extraction-20.md
- packages/db/package.json
- packages/db/src/react/recovery/Recovery.restore-steps.tsx
- packages/db/src/react/recovery/Recovery.tsx
- packages/db/src/react/recovery/__tests__/Recovery.direct-tab.unit.test.tsx
- packages/db/src/react/recovery/__tests__/Recovery.restore-ceremony.unit.test.tsx
- packages/db/tsconfig.build.json
- packages/db/tsconfig.json
- packages/db/tsconfig.react.build.json
- packages/db/tsconfig.react.json
- packages/db/vitest.config.ts
- packages/integrations/package.json
- packages/integrations/src/react/admin-credentials/AdminByokKeyPanel.tsx
- packages/integrations/src/react/admin-credentials/__tests__/AdminByokKeyPanel.status.unit.test.tsx
- packages/integrations/src/react/site-key/SiteKeyRecoveryCard.tsx
- packages/integrations/src/react/site-key/SiteKeyTab.tsx
- packages/integrations/src/react/site-key/__tests__/SiteKeyTab.agent-secrecy.unit.test.tsx
- packages/integrations/src/react/site-key/hooks/__tests__/use-site-key-recovery.confirmation.unit.test.ts
- packages/integrations/src/react/site-key/hooks/use-site-key-recovery.hooks.ts
- packages/integrations/src/react/site-key/hooks/use-site-key.hooks.ts
- packages/integrations/src/react/webhooks/IntegrationDeliveries.tsx
- packages/integrations/src/react/webhooks/Integrations.tsx
- packages/integrations/src/react/webhooks/__tests__/Integrations.confirm-delete.unit.test.tsx
- packages/integrations/src/react/webhooks/hooks/__tests__/IntegrationDeliveries.subscription-key.unit.test.tsx
- packages/integrations/src/react/webhooks/hooks/use-integration-deliveries.hooks.ts
- packages/integrations/src/react/webhooks/hooks/use-integrations.hooks.ts
- packages/integrations/src/react/webhooks/rules.ts
- packages/integrations/tsconfig.json
- packages/integrations/tsconfig.react.json
- packages/integrations/vitest.config.ts
- pnpm-lock.yaml

COMMIT-PLAN.md is the uncommitted coordinator handoff and must not be committed.
