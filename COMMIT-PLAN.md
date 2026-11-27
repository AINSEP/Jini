# Y5 adm Round 2 — Jini working-tree delivery

G0 satisfied: final merge-25 Jini 948f772f1; final Tovu e2655d7e04. Jini-only; no .git changes, no Tovu writes, no subagents. Tests are written before their implementation changes. No installs, builds, tests, mutations, typechecks, linters, or counter run, as explicitly dispatched. Mutation descriptions are static kill criteria, not claimed executed evidence.

## Ordered sheet commits

1. adm-shell-lib: existing Round 1 six codecs/factory and y5-settings-tabs.test.ts retained. Mutation DEFER_WITHDRAWAL_UNTIL_WRITE: delayed denial fails the immediate-withdrawal event-order assertion.
2. adm-shell-hooks: existing Round 1 bindAdminAppearance and y5-appearance-binding.test.tsx retained. Mutation RETIRE_NEWER_DRAFT: reversed comparison fails the second-theme draft assertion after an older read.
3. adm-shell-components: existing media content editor and execution binder/filter retained. Mutation ADOPT_AFTER_DISPATCH still needs dock transport characterization.
4. adm-security: existing removal/custom-dialog hooks retained. Mutations REMOVE_DEFAULT_WITHOUT_PROMOTION and REVOKE_UPSTREAM_ON_LOCAL_REMOVE require controller assertions.
5. adm-other: existing email/storage/MCP controller retained. Mutation EXTERNAL_MCP_LOST_UPDATE is asserted by y5-external-mcp.test.tsx's exact expectedVersion 7 body check.
6. adm-deployment: existing static-export binder retained. Mutation ACCEPT_STALE_PREVIEW requires publish controller characterization.
7. adm-pages: existing route rules/public-path/preview retained. Mutation BODY_WRITE_BEFORE_CAS is covered by the existing metadata-first rejection assertion; editor/controller work remains.
8. adm-posts: existing list controller/input rules retained. Mutation DROP_POST_EXPECTED_VERSION is covered by the existing exact status-toggle payload assertion. Trash CAS blocked: pinned Tovu deletePost({ id }) and Jini PostsListPort.deletePost accept no version; adding one changes behavior.
9. adm-publish-content: existing report rules export retained. Mutation EXECUTE_BEFORE_CONFIRM requires ceremony characterization.

## Binding/counter boundary

Tovu is read-only task input. No Tovu paths can be counted as deleted or pure bindings by this Jini-only checkout. No keep entries are asserted here; the Tovu builder must re-read each final binding under G3, update plans/count-1125/y5-adm-keeps.md there, redirect source probes, prune literal baselines, and run the true counter.

## Diff pruning

No deletions yet.
