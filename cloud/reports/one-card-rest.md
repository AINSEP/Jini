# one-card-rest — completed with known baseline test failures

Started November 6, 2026 at 08:41 PST and finished at 09:07 PST, within the two-hour cap. Both repositories use `cloud/one-card-rest`; pushes to that branch succeeded. No main push, force push, deployment or publication occurred.

## Branches and commits

- Jini base: `f07ae3d6ff55cf4da480acac44cc6f4b7686966b`; code head: `58bf6aca3`.
- Tovu base: `74fedc1320d31431ab4a13d1e38af03a402ca28b`; code head: `6bac338de`.
- The final report-only commit follows the code heads. These are every earlier pushed commit, including progress reports.

Jini:

- `af68beb825cebaafae2503200264e8621308ffd7` — docs: record one-card-rest scope and progress
- `3e17c2ad2ce27d78e9407c520d6259d62ed2a7c0` — fix: retain plugin consent only after Auto persistence succeeds
- `03851b0cd31cbb9ea27cb0eecb1476f3ff8a4d37` — docs: record code-derived approval inventory and verification progress
- `8eaa431382deab27a402331cfeba87987dbf8391` — feat: preserve checked plugin choices in shared approval cards
- `58bf6aca3bcbe40950110342987e5a6077a79182` — fix: preserve hints in grouped approval choices

Tovu:

- `3f090e309d7cf09df3ed30d7fa65b07903a4cf93` — fix: bind mail provider approval to its displayed revision
- `27038dbe70f24181ea421343a8cf3ba3569ae1f5` — fix: guard approved personal Auto preference writes
- `9a0e716b46f803baf9e35477669cd4483d169816` — fix: route automatic plugin choices through fresh access approval
- `a14163e6cf7d13b2aaf23891f2843bffb24fb19e` — fix: return a mail selection conflict without a server error
- `6bac338de3030333a05f7b3b5155370568f09a43` — fix: use private confirmation controls for plugin access choices

## Each requested item

1. **Two remaining cards converted.** Mail provider selection now uses the existing typed access lifecycle, current active-person checks and exact lane/revision disclosure. The approved revision reaches the existing transactional settings writer; concurrent selection changes return a specific HTTP 409. The original title, warning, buttons and split-lane context remain. Automatic plugin selection now uses the same Jini approval lifecycle and common confirmation renderer, with private controls, visible dwell, trusted clicks, one-call locking and a fixed access disclosure. Its checked multi-select layout, Use / Skip / Don't ask again actions and transcript receipts remain. Necessary additions are the collapsed Access details disclosure and wording explaining personal Auto for this site. Personal Auto uses the existing settings revision guard; stale preferences and failed writes grant no retained controller consent. Jini's common renderer gained only checked defaults and the shared group label needed to retain this layout. Existing confirmations without those options have byte-identical HTML/resources to the base.
2. **Secret listing truthfulness verified on the base.** `packages/core/src/settings/tool-registrations.ts` already excludes direct and aliased secret definitions through `isAgentWritable`. Tovu calls this shared builder; no competing projection was found. The direct/alias regressions pass, so no redundant production change was made.
3. **Formspree already present.** `packages/provider-plugins/catalog.json` and `packages/plugin-catalog/catalog.json` already contain its provider entry (`form_collection` v1, provider-plugins 0.6.24). Tovu's bundled agent catalog contains its agent face too. Provider/distribution tests pass; no duplicate entry was added.
4. **Approval inventory delivered below.** It lists 39 native tools, 17 bundled executable Google Workspace tools and 18 bundled admin action tools with a plain reason each, plus conditional cases and runtime external-tool rules. Derived from current code, not memory; installation-specific remote names cannot be enumerated without live account data.
5. **Consent cards and old form answers left alone.** No consent feature file was changed, no old-answer compaction was added, and legacy confirmation output compatibility was directly verified.

Authority: fetched `origin/cloud-plans-1105` and read `cloud/jobs/COMMON.md`, `cloud/jobs/one-card-rest.md`, `cloud/reports/one-card.md`, `cloud/plans/OC-one-card-plan.md` and `cloud/plans/TRIM.md`. Loaded software-architect, programmer and TDD personas from `/workspace/cloud/ai-dev-shop`. Independent source review found the retained-choice-form security gap and Auto failure-state leak; both were fixed and re-reviewed without a remaining production blocker.

## Verification commands and results

Run commands from the named repository after `source /workspace/.tovu-build/env.sh`. Only touched/affected tests ran; no full repository test suite ran. No test, rule, assertion or hash expectation was disabled, weakened or deleted. Temporary test-name filters were used for targeted regression reproduction, not to claim a whole file passed.

### Setup and types

- Jini: `CI=true pnpm install --frozen-lockfile --store-dir /workspace/.tovu-build/pnpm-store --cache-dir /workspace/.tovu-build/pnpm-cache` — passed. Initial builds exposed stale dependency links (missing provider jsdom/CMS imports); dependency refresh resolved them.
- Jini: `pnpm -r build` — passed on the requested base after dependency refresh.
- Jini after changes: `npm --prefix packages/agent-plugins run build` and `npm --prefix packages/ui run build` — passed.
- Jini: `npm --prefix packages/agent-plugins run typecheck` and `npm --prefix packages/ui run typecheck` — passed.
- Tovu: `npm --prefix packages/contracts run build` — passed.
- Tovu after Jini rebuilds: `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` — passed.
- Tovu: `npx tsc -p tsconfig.json --noEmit` — passed on final source. Earlier missing-export diagnostics cleared after rebuilding/relinking the base; the new missing mail conflict mapping was fixed.
- Both repositories: `git diff --check` — passed.

### Jini focused tests

| Exact command from Jini | Result |
| --- | --- |
| `npm --prefix packages/core run test -- src/settings/__tests__/tool-registrations.set-value.test.ts src/settings/__tests__/tool-registrations.reads.test.ts` | 57 passed; includes direct/alias secret writability |
| `npm --prefix packages/provider-plugins run test -- src/formspree/__tests__/provider.test.ts src/__tests__/distribution-manifest.test.ts` | 12 passed |
| `npm --prefix packages/agent-plugins run test -- src/lifecycle/__tests__/unit/automatic-use.unit.test.ts src/lifecycle/__tests__/unit/automatic-cancellation-m1.unit.test.ts` | 54 passed |
| `npm --prefix packages/ui run test -- src/features/mcp-ui/__tests__/surfaces/confirmation.test.ts src/features/mcp-ui/__tests__/surfaces/access-approval.test.ts` | 69 passed / 6 unchanged baseline hash-pin failures |
| `node --import tsx /workspace/work/one-card-rest/check-confirmation-compat.mjs` | Workspace differential probe: 3 legacy specs and full resource wrappers byte-identical to requested-base renderer |

The new UI cases execute the real emitted script: host-checked defaults, trusted uncheck/recheck, Use/Auto, untrusted reversals, arbitrary IDs, single-call locking, escaped labels/hints and shared grouped layout. The harness selector was extended to exercise trusted events on grouped inputs; product click protections were not bypassed.

### Tovu focused tests

Exact prefixes used from Tovu; append the FILE in the table. Each file was run directly, so named Node assertions and counts were observed. RPC/HTTP listeners ran with localhost network access enabled after the sandbox initially refused `listen`.

```sh
# A
node --import tsx FILE
# B
node --import tsx --import ./development/test-support/composed-bundle-env.ts FILE
# C
node --import tsx --import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks FILE
```

| Prefix | FILE | Result |
| --- | --- | --- |
| A | `apps/website/src/assistant/__tests__/automatic-agent-plugin-choice.test.ts` | 4 passed |
| A | `apps/website/src/assistant/__tests__/automatic-plugin-access.test.ts` | 4 passed |
| B | `apps/website/src/assistant/__tests__/automatic-agent-plugins.integration.test.ts` | 32 passed; includes real active-principal revocation, late/retried answers, stale personal Off and real CAS-failure retry |
| B | `apps/website/src/server/runtime/composition/__tests__/agent-plugin-preferences.unit.test.ts` | 4 passed |
| B | `apps/website/src/features/mail-status/__tests__/mail-status-tool.test.ts` | 15 passed |
| B | `apps/website/src/features/mail-status/__tests__/provider-tools.unit.test.ts` | 10 passed |
| B | `apps/website/src/features/mail-status/__tests__/provider-operations.unit.test.ts` | 11 passed |
| B | `apps/website/src/server/runtime/composition/__tests__/site-mailer.unit.test.ts` | 17 passed; real card to transactional CAS refusal |
| B | `apps/website/src/features/settings/__tests__/mail-provider.unit.test.ts` | 7 passed; absence/set/cleared-row snapshots |
| C | `apps/website/src/server/__tests__/routes/mail-providers-route.test.ts` | 8 passed / 1 unchanged baseline failure; new 409 conflict regression passes |
| B | `apps/website/src/server/__tests__/assistant-chat-recovery-bounds.unit.test.ts` | 9 passed |
| A | `apps/website/src/contracts/core/__tests__/human-confirm.lifecycle.test.ts` | 18 passed |
| C | `apps/website/src/server/runtime/composition/modules/__tests__/assistant-agent-plugin-preflight.integration.test.ts` | 2 passed |
| B | `apps/website/src/server/runtime/composition/modules/__tests__/assistant-byok.history-and-surfaces.unit.test.ts` | 3 passed |
| C | `apps/website/src/assistant/__tests__/byok-tool-surface.test.ts` | 85 passed |
| A | `apps/website/src/assistant/__tests__/ask-choice-tool.test.ts` | 28 passed |
| A | `apps/website/src/assistant/__tests__/access-approval.integration.test.ts` | 6 passed |

RED evidence preceded the bug fixes: absent active-person verification/common disclosure limits; stale mail revision; personal Auto overwrite; Auto-save failure retaining local consent through prepare/load; missing HTTP409 mapping; and grouped defaults/hint preservation. No assertions were weakened to reach GREEN.

### Complexity lint

Every changed production file was checked with the repository ESLint config plus the strict ceiling:

```sh
# Jini
pnpm exec eslint packages/agent-plugins/src/lifecycle/automatic-use.ts packages/ui/src/features/mcp-ui/surfaces/confirmation.ts --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'

# Tovu
npx eslint apps/website/src/assistant/ask-choice-tool.ts apps/website/src/contracts/core/human-confirm.ts apps/website/src/features/agent-plugins/automatic-agent-plugins.ts apps/website/src/assistant/tool-registrations.ts apps/website/src/server/runtime/composition/modules/assistant-byok.ts apps/website/src/server/runtime/composition/agent-plugin-service-ports.ts apps/website/src/features/agent-plugins/service-ports.ts apps/website/src/features/mail-status/provider-operations.ts apps/website/src/features/mail-status/tool-registrations.ts apps/website/src/features/settings/mail-provider.ts apps/website/src/platform/mail/mail-status.ts apps/website/src/server/runtime/composition/deps.ts apps/website/src/server/runtime/composition/site-mailer.ts apps/website/src/server/inbound/admin-http/routes/system/mail-providers.ts --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'
```

Passed with zero errors. Tovu retains three unchanged `sonarjs/no-nested-functions` warnings in composition/deps.ts. No suppression was added. All materially changed logic stays within the job's complexity ceiling.

### Validation limits

- Chrome visual review was not performed: no configured browser automation tool or installed Chromium was available. Common renderer DOM/runtime tests and compatibility probes passed; the owner-requested Chrome look check remains external follow-up.
- No external provider account, live owner data, deployment or published-package adoption was exercised. Tovu consumes the paired rebuilt Jini branch locally for these checks.
- Local dependency setup left untracked `packages/plugin-ui-ux-design/` material; it was not included in any commit.
- Workspace logs and the temporary base renderer/probe are under `/workspace/work/one-card-rest`, not committed as artifacts.

## State cost and ownership

- Mail: per displayed access card, one canonical-definition lookup plus one addressed workspace-row read; up to two active-person projections per accepted card. Its accepted write adds one addressed-row comparison inside the existing transaction. Existing credential/provider checks remain unchanged; no email is sent by selection.
- Automatic choices: per actual card, one personal snapshot before display and one after an accepted answer; each snapshot uses a definition lookup, addressed user row and existing effective-settings read. Up to two active-person projections. Accepted Auto adds the existing writer's one revision comparison. The pre-existing initial mode read remains. Decline writes no preference.
- The card payload is bounded by the existing 128 KiB access-plan cap. Its two typed resources cover chat selections and the optional personal Auto choice. Rendering/selection storage scales with displayed matches; no per-plugin query was added.
- Failed Auto persistence now retains neither a decision nor exclusions/mode. There is no extra durable state, schema migration, table, poll, worker or network request. Existing transcript receipts remain; no historical answer compaction was added.
- Generic lifecycle and renderer behavior stays in Jini behind existing ports; Tovu supplies site/person/chat scope, wording, reads and existing writers. New UI options are additive and old output compatibility is verified.

## Bugs found

ALREADY FIXED ON BASE: Secret definitions and aliases are excluded from agent-writable listings. Focused tests prove it; no redundant fix.

FIXED: A stale mail-provider card could overwrite a newer provider selection; exact snapshot revision now reaches transactional CAS.

FIXED: Mail-provider action cards did not perform fresh active-person access checks.

FIXED: Automatic plugin choices lacked the shared access lifecycle, active-person checks and common private/dwell confirmation controls.

FIXED: Personal Auto could overwrite a preference changed while the card was open; snapshot/recheck/CAS now prevent it.

FIXED: Failed Auto persistence left selected consent in a retained controller; retry can no longer use that rejected decision.

FIXED: New mail conflict errors initially lacked an HTTP status mapping; the route now returns a specific 409 conflict, with a red-first regression.

FIXED: The new grouped confirmation layout initially dropped existing per-choice hints; hints now remain visible and escaped.

BASELINE TEST FAILURE: Six existing Jini confirmation exact-output hashes disagree with the requested base. They failed before implementation, and their Received hashes remain identical on the compatibility-preserving final source. Expectations were not updated.

BASELINE TEST FAILURE: Existing project-key mail credential save returns HTTP500 instead of 200 from the attached-only vault refusal. Reproduced against archived `origin/cloud/combine` source with the same installed dependencies. Exact archive command: `node --import tsx --import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks --test-name-pattern='mail card saves attach the project key immediately' apps/website/src/server/__tests__/routes/mail-providers-route.test.ts`. No unrelated fix.

OPEN MINOR: Mail plugin-disable cleanup reads lanes then writes without a revision guard, so it can overwrite a simultaneous provider selection. Outside these two card conversions.

OPEN MINOR (static trace): Custom-domain static publish appears to ask twice: generic publish-policy approval followed by domain-publish confirmation. Runtime not exercised; no changes in this job.

OPEN MINOR: Google Workspace admin status/list actions omit effects and inherit conservative write approval; no declaration was changed.

OPEN MINOR: Existing standalone unchecked confirmation choices use a plain-object ID map and can mishandle the arbitrary ID `__proto__`. The new grouped/default path uses a null-prototype map; old output remains unchanged per the consent-card exclusion.

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
