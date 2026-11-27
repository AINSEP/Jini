# y5p-plugpub — Jini working-tree handoff

HEAD: `525b62432` (`codex/y5p-plugpubj`, `origin/codex/y5-adm-3j`). Git metadata is read-only; do not commit this file.

## Source and checks

The authoritative source pin is Tovu `48f6802924`. Every named anchor for the four dispatched files matches that pin. The Tovu main checkout is at `685039d820d60977a5369aeb7503bd24f3ad050e`; its shifted line numbers are NOT an anchor failure against the explicit source pin.

No installs, tests, mutation runs, builds, typechecks, linters, or counter commands are authorized in this job. All test and mutation execution is deferred to Opus. Tovu is read-only and outside the edit scope.

## Ordered design commits

### 1. adm-other (scoped to AgentPlugins, Plugins, Providers)

COMPLETED SUBSTEP (not the whole sheet): extend the existing Providers binder to capture the required External MCP hook and compose the existing Jini useProviders controller internally. The previous round's binder still required a host-composed useProvidersHook, leaving the host file impure under G3.

Tests first: `packages/admin/src/screens/__tests__/y5-admin-surfaces.test.tsx`, existing providers localization/inert-tabs case, changed to supply the External MCP hook directly.

Named Providers mutation: **DROP_EXTERNAL_MCP_RESTART_REQUIRED** — replace the captured External MCP controller's restartRequired with false. The localized restart-label assertion must fail. Execution not performed.

Changed files: `packages/admin/src/screens/providers/Providers.tsx`, `packages/admin/src/screens/__tests__/y5-admin-surfaces.test.tsx`, `.changeset/y5-adm-other.md`. The existing changeset package/version rows and prior release description are retained. Existing Providers export and browser jini.entries registration already exist; no new dependency edge or public subpath is needed for this completion.

AgentPlugins and Plugins: pending the comment-rule clarification below. Required mutations when implemented: **DROP_AGENT_PLUGIN_EXPECTED_DIGEST** (omit expectedOldDigest when calling the injected update hook) and **ALLOW_UNAVAILABLE_PLUGIN_ADD_TAB** (retain add among valid tab ids when canInstall is false). Neither is implemented or verified.

### 2. adm-publish-content (confirm hook only)

Pending the comment-rule clarification below. The controller is absent, while its PublishContentConfirmView types, report rules and PublishContentDialog are already present. Reuse those leaves; do not duplicate them.

Required test path: packages/cms/src/react/publish-content/__tests__/y5-publish-ceremony.test.tsx. The existing file tests the dialog with an injected view; it does not characterize the missing ceremony controller.

Named mutation: **EXECUTE_BEFORE_CONFIRM** — let a planned phase initiate execution without a confirmation token. Not implemented or verified.

## Binding instruction conflict awaiting clarification

The dispatch simultaneously requires existing why-comments to move VERBATIM and no case-insensitive “tovu” text in Jini. The pinned confirm-hook source L39–43 contains this rationale:

> The ceremony's *rules* — which rows a run writes, what each outcome is called, and when a plan may
> be confirmed or executed — live in `@tovu/publish-content-ui` (`apps/website/src/features/
> publish-content/ui/`), next to the planner whose behaviour they restate. This file is the React
> shell around them: state, effects, and the three port calls. A rule that could drift from
> `planner.ts` does not belong in this package.

AgentPlugins also has product-named rationale at L331–338; Plugins has product-named file rationale at L37 onward. These are comments, not injectable runtime copy. A clarification question asks whether to neutralize product mentions or preserve the comments verbatim. Do not silently delete/rewrite these comments or add product identity to Jini.

## Closeout

No Tovu G3/keep/counter completion is claimed by this Jini-only job. Tovu must bind each delivered factory, repoint the listed consumers/source probes, and add the exact keep entry only after reviewing its final host file against G3.

Deletions during diff review: none. Removed no production behavior or test cases. One existing test case was updated before the binder implementation; test-case count is unchanged (six in y5-admin-surfaces.test.tsx). No new helper/type/file beyond the named binder's moved `useWiredProviders` seam and this handoff was introduced.

### Tovu handoff for the completed Providers substep

Use the existing `@jini-ai/admin/screens/providers/Providers` subpath and `bindProviders`. Its required `hooks` object now takes `useExternalMcp`, `useAdminThemeBoundary`, `useAdminLocale`, and `useIntegrationsHook`. Pass the live hook references directly. `useWiredProviders` composition is inside the binder; remove that host hook body. Raw `ProvidersProps.hooks.useProvidersHook` and the bound component's existing explicit override props remain available. No subpath/export/dependency additions were needed. No host keep rule is added by this Jini-only change.

### Static architecture review and limits

The diff adds only an internal admin import and a required structurally typed External MCP hook to the existing binder, reusing the existing useProviders implementation. No cross-package dependency is added. The new binder is 23 lines; its moved composition is 3 lines. Manifests were read to confirm the Providers source export and browser entry already exist. Source changes and the complete diff were read back; no verification command was run.

Architecture status: WARNING — the unmodified Providers source already contains product-named historical rationale, so a full no-product-text claim cannot be made under the unresolved verbatim-comment rule. No new product text was added to production code. The remaining three target implementations, their test additions and mutations, and runtime/mutation evidence are NOT COMPLETE. No whole sheet or G3 count completion is claimed.

Checks explicitly not run: tests, mutation checks, installs, builds, linters, typechecks, counter. The task forbids these commands; Opus owns the follow-up. No PASS or mutation-red evidence is claimed.
