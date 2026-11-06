# one-card-rest — in progress

Started 2026-11-06 16:41 UTC; hard stop 18:41 UTC. Branch in both repositories: `cloud/one-card-rest`.

Bases: Jini `f07ae3d6ff55cf4da480acac44cc6f4b7686966b`; Tovu `74fedc1320d31431ab4a13d1e38af03a402ca28b`.

Authority: fetched `origin/cloud-plans-1105`, read `cloud/jobs/COMMON.md`, `cloud/jobs/one-card-rest.md`, and `cloud/reports/one-card.md`. Loaded software-architect, programmer, TDD personas from `/workspace/cloud/ai-dev-shop`.

## Work in progress

Pushed checkpoints: Tovu `3f090e309`, `27038dbe7`, `9a0e716b4`, `a14163e6c`; Jini `af68beb82`, `3e17c2ad2`. Final checks and independent review are still in progress.

- Convert automatic plugin choice and mail provider cards through the existing common access lifecycle; preserve presentation and existing effect owners.
- Correct secret-setting writability in discovery listings.
- Check the provider catalog for Formspree; add only if absent.
- Inventory approval tools from current source with plain reasons.
- Leave consent cards and historical form answer copies unchanged.

## Verification

Dependency refresh, full Jini base build, rebuilt Tovu contracts, and Jini relink succeeded. Jini agent-plugin typecheck and strict complexity lint passed. Tovu root `npx tsc -p tsconfig.json --noEmit` and strict lint pass (three unchanged nesting warnings in composition/deps.ts).

Focused verification so far: settings listings 57 passed; Formspree/distribution 12 passed; mail/settings 60 passed; personal preference snapshot 4 passed; automatic choice 4 passed; automatic access 4 passed; automatic plugin integration 31 passed; recovery bounds 9 passed; common human lifecycle 18 passed; preflight RPC 2 passed; BYOK surfaces 3 passed; ordinary ask-choice 28 passed; common access transport 6 passed; Jini automatic-use/cancellation 54 passed.

The mail route file has 8 passed / 1 unchanged failure. Its existing project-key mail save returns 500 instead of 200; reproduced independently on archived `origin/cloud/combine`. The new conflict route regression passes. Full commands and final results follow at closeout.

## Bugs found

ALREADY FIXED ON BASE: Secret definitions and aliases are excluded from agent-writable listings; direct/alias regressions pass. No new fix needed.

FIXED: Mail provider approval could overwrite a selection changed while the card was open; the displayed revision now reaches the existing transactional writer.

FIXED: Mail provider action cards did not perform fresh active-person access checks.

FIXED: Automatic plugin choice could return an access grant without the common active-person checks; the original form now runs through the common fresh-access lifecycle.

FIXED: Automatic Auto choice could overwrite a personal Off/Ask preference changed while the card was open.

FIXED: Failed Auto persistence left a retained controller decision, allowing a retry to use the rejected grant; the Jini owner now commits local consent only after persistence succeeds.

FIXED: The new mail stale-selection error initially lacked an HTTP status mapping; it now returns a specific 409 conflict with a regression test.

OPEN MINOR: Mail plugin-disable cleanup reads lanes and writes without a revision guard, so it can overwrite a simultaneous provider selection. Outside these two card conversions.

BASELINE TEST FAILURE: Existing project-key mail credential save returns HTTP 500 instead of 200, from attachedOnlyVault refusal; reproduced on archived `origin/cloud/combine`.

OPEN MINOR (static trace): Custom-domain static publishing appears to ask twice: generic publish policy then domain-publish confirmation. No changes in this job.

OPEN MINOR: Google Workspace admin status/list actions omit effect declarations and inherit conservative write approval. No changes in this job.

## Tools that always require approval

Derived from the current source, including this job's mail-card conversion. “Always” means a fresh human approval is required before the executable effect. Invalid input, missing targets, setup refusals, aborts, unavailable services, and harmless no-ops can return without opening a card. Approval does not replace authorization.

Paths below are relative to the named repository. `T` = `Tovu/apps/website/src`; `J` = `Jini/packages`. This is a static source inventory, not an assertion that every plugin or external connection is active on a particular site.

The common policy owner is `T/assistant/tool-approval-policy.ts` (`applyToolApprovalPolicy`); `T/assistant/assistant-tool-approval-policy.ts` permits only read/edit/trash classes directly. Domain-owned `confirmation: 'plan'` handlers use `T/contracts/core/human-confirm.ts` (`approvalToolHandler`), whose default asks freshly. Each metadata reference below is under `T/contracts/core/tool-metadata/` unless another source is given.

### Native tools: 39

- `agent_plugins_update` — Replaces installed plugin code and its executable access. Source: `agent-plugins.ts`, publish/escalation policy owner above.
- `change_sets_revert` — Replaces current data with an older change set. Source: `change-sets.ts`.
- `comments_set_provider` — Changes where this site handles comments. Source: `T/features/comments/tool-registrations.ts`, `buildCommentsRegistrations`.
- `consent_update_settings` — Saves a changed visitor consent policy draft. Source: `T/features/consent/tool-registrations.ts`, `buildConsentRegistrations`.
- `consent_publish_settings` — Applies the reviewed visitor consent policy publicly. Source: `T/features/consent/tool-registrations.ts`, `buildConsentRegistrations`.
- `database_execute_migrate_forward` — Applies schema migrations that can alter stored data. Source: `T/features/database/tool-registrations.ts`, migration `humanConfirmedToolHandler`.
- `deployment_ops_deploy` — Starts a deployment on an external hosting service. Source: `deploy-ops.ts`.
- `deployment_ops_unset_secret` — Removes an existing hosting secret that cannot be restored here. Source: `T/features/deployments/deploy-ops/secrets.ts`, `runUnsetSecret` and `confirmOrRefuse`; an absent secret returns a no-op.
- `deployment_execute_static_publish` — Uploads the site to an external hosting destination. Source: `deployments.ts`.
- `fs_write_files` — Writes files into the owner-picked folder outside this site. Source: `fs-files.ts`.
- `identity_policy_delete` — Permanently removes an access policy. Source: `T/features/identity/tool-registrations.ts`, `confirmedDelete`.
- `identity_role_delete` — Permanently removes a role and its policy links. Source: `T/features/identity/tool-registrations.ts`, `confirmedDelete`.
- `mail_set_provider` — Changes the service receiving this site's outgoing mail. Source: `T/features/mail-status/tool-registrations.ts`, `buildMailStatusRegistrations`; access plan, no remembered grant.
- `mail_send_test` — Sends a real test email, or captures it under the selected test mode. Source: `T/features/mail-status/tool-registrations.ts`, `buildMailStatusRegistrations`.
- `mail_remove_suppression` — Allows email to reach a previously blocked recipient again. Source: `T/features/mail-status/delivery-tool-registrations.ts`, `buildMailDeliveryRegistrations`.
- `newsletter_resume_campaign` — Resumes delivery to the campaign's remaining subscribers. Source: `T/features/newsletter/delivery/tool-registrations.ts`, shared delivery approval handler.
- `newsletter_schedule_campaign` — Records future subscriber-send intent. Source: `T/features/newsletter/delivery/tool-registrations.ts`, shared delivery approval handler; automatic timed delivery is not wired.
- `newsletter_send_campaign` — Starts sending the newsletter to real subscribers. Source: `T/features/newsletter/delivery/tool-registrations.ts`, shared delivery approval handler.
- `comments_purge_comment` — Permanently deletes the selected comment. Source: `permanent-delete.ts`; `T/features/permanent-delete/tool-registrations.ts`, `buildPermanentDeleteRegistrations`.
- `custom_credential_delete` — Permanently removes a saved custom credential. Source: `permanent-delete.ts`; same permanent-delete handler.
- `deployment_delete_provider_credential` — Permanently removes a saved hosting credential. Source: `permanent-delete.ts`; same permanent-delete handler.
- `external_mcp_delete` — Permanently removes the saved external-tool connection. Source: `permanent-delete.ts`; same permanent-delete handler.
- `identity_user_delete` — Permanently deletes the selected user account. Source: `permanent-delete.ts`; same permanent-delete handler.
- `media_purge_asset` — Permanently deletes the selected media file. Source: `permanent-delete.ts`; same permanent-delete handler.
- `source_control_delete_credential` — Permanently removes a saved repository credential. Source: `permanent-delete.ts`; same permanent-delete handler.
- `trash_empty` — Permanently deletes the selected Trash contents. Source: `permanent-delete.ts`; same permanent-delete handler.
- `trash_purge_item` — Permanently deletes the selected trashed item. Source: `permanent-delete.ts`; same permanent-delete handler.
- `plugin_source_delete` — Permanently deletes a plugin draft file. Source: `T/features/plugin-runtime/source-tools.ts`, `buildPluginSourceRegistrations`.
- `plugins_uninstall` — Removes an installed plugin; optional memory deletion is separately disclosed. Source: `T/features/plugin-runtime/tool-registrations.ts` and `T/features/agent-plugins/uninstall-tool.ts`, both families' uninstall approval handlers.
- `publish_content_execute_pull` — Replaces local content with content from the source site. Source: `T/features/publish-content/tool-registrations.ts`, pull `humanConfirmedToolHandler`.
- `publish_content_publish` — Sends content to the destination and can replace its content. Source: `publish-content.ts`.
- `backup_execute_restore` — Replaces current data with a backup. Source: `T/features/recovery/tool-registrations.ts`, restore `humanConfirmedToolHandler`.
- `search_reindex` — Writes every public document to the search provider. Source: `T/server/runtime/composition/site-search-tools.ts` and `J/search/src/tools.ts`; Tovu supplies no remembered store.
- `search_set_provider` — Moves search indexing to another provider and copies public documents there. Source: the same search host/package owners; never remembered.
- `taxonomy_execute_merge_term` — Merges taxonomy data and rewrites affected relationships. Source: `T/features/taxonomy/tool-registrations.ts`, merge `humanConfirmedToolHandler`.
- `theme_set_active` — Changes the theme serving the live site. Source: `theme.ts`.
- `webhooks_delete_subscription` — Permanently removes the selected webhook subscription. Source: `T/features/webhooks/tool-registrations.ts`, deletion approval handler.
- `commerce_resolve_unknown` — Records a verified payment outcome that can fulfill an order. Source: `T/server/runtime/composition/tool-catalog-manifest.ts` and `J/commerce/src/payments/tools/resolve-unknown.ts`; a missing order returns without approval or effect.
- `site_restart` — Restarts the site and interrupts running chats and unsaved work. Source: `T/features/project-keys/tools.ts`; no available restart operation returns without a card.

Newsletter mail-off refusals return without a card or effect. Jini can optionally remember a reindex approval, but Tovu's search composition passes no such store, so runnable reindexes ask freshly.

### Bundled executable tools: 17 Google Workspace tools

All admitted, active executable Agent Plugin tools declared `write` or `destructive` ask freshly; reads run directly. Source: `T/features/agent-plugins/executable-tools/register.ts` (`adapt`) and `T/contracts/headless/assistant-tool-approval-policy.ts` (`EXTENSION_TOOL_APPROVAL_POLICY`). Names use `J/plugins/src/host/contributions.ts` (`pluginToolIdFor`); the installed ID comes from `manifest.name` in `J/agent-plugins/src/lifecycle/installed-package-index.ts`, not the publisher identity in `extensions.tovu.id`.

The bundled names and declared effects come from `J/agent-plugins/google-workspace/tovu-agent-tools.json`:

- `p_google_workspace__sheets_create` — Creates a spreadsheet in the connected Google account.
- `p_google_workspace__sheets_copy` — Creates another spreadsheet in the connected Google account.
- `p_google_workspace__sheets_copy_tab` — Copies a tab into another spreadsheet.
- `p_google_workspace__sheets_values_append` — Appends rows to an external spreadsheet.
- `p_google_workspace__sheets_values_update` — Replaces existing spreadsheet values.
- `p_google_workspace__sheets_values_batch_update` — Replaces values across multiple spreadsheet ranges.
- `p_google_workspace__sheets_values_clear` — Clears spreadsheet values.
- `p_google_workspace__sheets_values_batch_clear` — Clears values across multiple spreadsheet ranges.
- `p_google_workspace__sheets_values_by_data_filter` — Its declaration is destructive because it can overwrite or clear matched values; even its get action currently receives this gate.
- `p_google_workspace__sheets_find_replace` — Replaces matching text in the spreadsheet.
- `p_google_workspace__sheets_tab_modify` — Can alter or remove spreadsheet tabs.
- `p_google_workspace__sheets_sort` — Rearranges existing spreadsheet rows.
- `p_google_workspace__sheets_basic_filter` — Changes an external spreadsheet's filter.
- `p_google_workspace__sheets_filter_views` — Can replace or delete saved filter views.
- `p_google_workspace__sheets_format` — Changes external spreadsheet formatting.
- `p_google_workspace__sheets_named_ranges` — Can replace or delete named ranges.
- `p_google_workspace__sheets_batch_update` — Can perform destructive spreadsheet updates.

Other installed plugins can contribute additional names under the same rule; their runtime roster is installation-specific.

### Bundled admin action tools: 18 Google Workspace tools

`J/agent-plugins/src/admin-surfaces/action-tools.ts` (`buildAdminSurfaceActionTools`) exposes every declared action and defaults an omitted effect to write. Every action in `J/agent-plugins/google-workspace/tovu-admin-surfaces.json` currently omits effect, including reads; therefore all these names ask freshly when admitted and active:

- `p_google_workspace__connection_status` — The action defaults to write, so reading connection status asks.
- `p_google_workspace__connection_sign_in` — Starts a connection sign-in or scope-change flow.
- `p_google_workspace__connection_confirm_switch` — Applies the selected Google-account switch.
- `p_google_workspace__connection_cancel_switch` — Cancels the pending account switch.
- `p_google_workspace__connection_disconnect` — Revokes this site's Google connection.
- `p_google_workspace__connection_set_product` — Changes a connected product's enabled state.
- `p_google_workspace__picker_list_picked` — The action defaults to write, so listing selected files asks.
- `p_google_workspace__picker_verify_picked` — Records a selected spreadsheet.
- `p_google_workspace__picker_start_system_picker` — Starts the system file-selection flow.
- `p_google_workspace__picker_finish_system_picker` — Completes the file-selection flow.
- `p_google_workspace__form_destinations_list_picked` — The action defaults to write, so listing selected files asks.
- `p_google_workspace__form_destinations_verify_picked` — Records a selected spreadsheet for destination setup.
- `p_google_workspace__form_destinations_start_system_picker` — Starts destination file selection.
- `p_google_workspace__form_destinations_finish_system_picker` — Completes destination file selection.
- `p_google_workspace__form_destinations_list_destinations` — The action defaults to write, so listing delivery destinations asks.
- `p_google_workspace__form_destinations_list_tabs` — The action defaults to write, so listing spreadsheet tabs asks.
- `p_google_workspace__form_destinations_save_destination` — Saves where future form submissions are delivered.
- `p_google_workspace__form_destinations_remove_destination` — Removes a form-delivery destination.

Other installed admin surfaces can add names under the same effect/default rule.

### Conditional cases, not unconditional approval tools

- `settings_set_value` — Asks for protected setting changes; ordinary permitted settings run directly. Source: `T/features/settings/tool-registrations.ts` and `J/core/src/settings/agent-value-write-tools.ts`.
- `settings_clear_value` — Asks when clearing a protected setting override. Source: the same settings owners.
- `plugins_set_enabled` — Asks when enabling introduces access; disable/refused/no-change cases can run directly. Source: `T/features/plugin-runtime/tool-registrations.ts` and `T/features/agent-plugins/enable-access.ts`.
- `agent_plugin_connect` — Asks when a signed-in or saved-token repair widens access; OAuth/credential entry has its separate human flow. Source: `T/features/agent-plugins/connect-tool.ts` and `enable-access.ts`.
- `external_mcp_save` — Asks when an access-only proposal changes enabled/tool/write grants; credential setup is a separate form. Source: `T/features/external-mcp/tool-registrations.ts`.
- `visitor_tool_configure` — Asks when the prepared changes require access approval. Source: `T/features/settings/visitor-tools-registrations.ts`.
- `database_transfer_run` — Asks only when the destination contains an earlier copy (`plan.replaces !== null`); a first copy runs directly. Source: `J/db/src/tools/transfer-tools.ts`, `handleRun`.
- `deployment_ops_set_secret` — Asks before replacing a different or unreadable existing secret; create, unchanged, and dry-run paths avoid replacement approval. Source: `T/features/deployments/deploy-ops/secrets.ts`, `runSetSecret`.
- `custom_credential_make_request` — Asks for HTTP DELETE requests. Source: `T/features/custom-credentials/tool-registrations.ts`, DELETE handler.
- `source_control_execute_commit` — Asks for a real commit, not `dryRun: true`. Source: `T/assistant/tool-approval-policy.ts`, export-commit classifier.
- `theme_duplicate` — Asks when duplication also activates the new theme (`activate: true`). Source: `T/assistant/tool-approval-policy.ts`, theme-activation classifier.
- `page.click` — Asks for handles outside the reviewed direct-action allowlist; DOM context can refuse unsafe targets. Source: `T/assistant/assistant-tool-approval-policy.ts`, `directPageAction`, and `T/assistant/page-approval-context.ts`.
- `files_copy` — Asks when the prepared destination uses a site-file write batch; theme/media/Library copies run directly. Source: `T/features/asset-transfer/copy-tool.ts`, `buildFilesCopyRegistrations`.
- `image_transform` — Asks for site/picked-file output batches; inspection and theme/media outputs run directly. Source: `T/features/image-transform/tool.ts`, `buildImageTransformRegistrations`.
- Automatic plugin selection — Asks in Ask-first mode for proposed plugin use and any offered personal Auto change; it is run orchestration, not another named approval tool. Source: `T/features/agent-plugins/automatic-agent-plugins.ts` and `T/assistant/ask-choice-tool.ts`.

`theme_reset_file` is not an always-approval tool: `T/contracts/core/tool-metadata/theme.ts` explicitly declares `confirmation: 'direct'`, despite its restore-over-existing class; the common wrapper returns it unchanged. `assistant_ask_choice`, password/credential forms, browser OAuth, and provider setup forms collect human input; they are not automatically action approval gates.

### Runtime external MCP cases

External names come from connected servers' runtime catalogs, so repository source cannot enumerate a site's complete list. Calls classified as trash, delete, restore-over-existing, or publish, plus protected write-shaped calls, require fresh per-call approval and cannot use remembered approvals. Other eligible external calls can offer chat-scoped or persistent approval. Sources: `T/assistant/external-mcp-call-confirmation.ts`, `T/assistant/mcp-federation/registrations.ts`, and Jini's federation confirmation owner.

### Inventory method and limits

Searched production `Tovu/apps` for the common approval functions, domain handler constructors, policy metadata, surface exchange openers, and requiresConfirmation; traced central metadata projection and registration wrapping, Jini search/transfer/commerce owners, dynamic executable tools, and bundled declarations. No usable Tovu graph index was present; used freshness-sensitive rg and direct source reads. This was a static read-only inventory, not a live-site/plugin-account test. Consent code was inspected only.

### Bugs found during inventory

OPEN: A custom-domain `deployment_execute_static_publish` appears to ask twice: its publish/policy metadata first invokes the generic approval wrapper, then `T/features/deployments/publish-agent-tools.ts` calls `domainPublishTool`, whose `humanConfirmedToolHandler` in `T/features/deployments/static-publish/domain-publish-tool.ts` asks again. Static trace verified; runtime not exercised; left outside this job.

OPEN MINOR: All 18 Google Workspace admin action declarations omit effect, so status/list operations inherit write approval. The generic default is deliberately conservative; no declaration was changed by this job.
