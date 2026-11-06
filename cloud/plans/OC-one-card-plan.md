Loaded both requested skills. **Goal: one owner click approves the exact access needed, directly from chat.**

Read-only plan against Tovu `5358aa594` and Jini `b0cc1371b`. No files changed, fetches, tests, installs or servers. Apple’s Git wrapper unexpectedly invoked Xcode tooling and attempted cache writes; subsequent reads used the direct Git binary.

For paths below, **T** means `prov2-tovu/apps/website/src`; **J** means `prov2-jini`, under `/Users/la/Programming/tovu-integration-clones/`.

**Findings**

- Reuse the combined plugin preview. It already checks plugin/source identity, includes exact tool/write lists, and fingerprints the proposed access: [enable-access.ts:67](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/enable-access.ts:67).
- Reuse the lifecycle. It freezes input and prevents `run` after decline or abandonment: [Jini approval.ts:97](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/core/src/approval.ts:97). Tovu already maps expiry to “Nothing was changed”: [human-confirm.ts:124](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/contracts/core/human-confirm.ts:124).
- A typed `HumanConfirmer` alone proves nothing: the handler constructs `kind: "user"` from the delegating ID. [registration-kit.ts:127](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/core/src/registration-kit.ts:127). The browser callback needs the real-person check.
- `requireAdminSession` accepts several credential kinds. Reuse `rejectUnlessSessionCredential`, then check the resolved principal’s real kind, active status and authority. [dev-auth.ts:336](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/dev-auth.ts:336).
- Settings currently reuse remembered plugin approvals; access changes must require a fresh click. [settings/tool-registrations.ts:135](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/settings/tool-registrations.ts:135).
- Already-signed-in `agent_plugin_connect` can rerun default grants without showing a fresh approval. Route that widening through the common card. [tool-registrations.ts:1021](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/tool-registrations.ts:1021).
- No new MCP reload system is needed. Jini refreshes grants using frozen remote definitions: [frozen-grants.ts:75](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/mcp/src/federation/frozen-grants.ts:75).

**Smallest design**

Keep the existing narrow tools. They submit one typed access plan to the existing approval lifecycle; they no longer build separate permission cards. Add no universal execution tool, approval database, registry framework or background worker.

Each plan fixes the resource identity, person/site/chat scope, previous value, proposed value and revision. Plugin enable expands into its declared sources, tools and write grants before rendering. Any required personal-mode or chat-use change appears explicitly on that same card.

Add an `access` variant to Jini’s existing `ApprovalPlan`: it always asks and cannot carry remembered approval. Reuse the current confirmation renderer, including its trusted-click checks and non-clickable agent discovery mirror.

**What gets absorbed and deleted**

| Existing entry point/card | Delete or replace |
|---|---|
| `plugins_set_enabled`, both families | Delete its separate enable renderer; retain the tool and disable behavior. |
| `external_mcp_save`, access-only changes | Replace the setup form with the common card. Remove editable “Allowed tools”/“May write” fields; show the fixed typed proposal instead. |
| `settings_set_value`, `settings_clear_value` | Delete bespoke confirmation construction and plugin-memory shortcuts for access changes. |
| Automatic plugin “Use / Don’t ask again” | Delete its separate choice-card ceremony; preserve explicit chat-use and personal Auto choices. |
| CLI prelaunch tool consent | Replace its bespoke card builder; retain the existing launch planner and revision-checked writer. |
| `visitor_tool_configure` | Delete its separate access-card formatter; retain management validation and apply. |
| `comments_set_provider`, `mail_set_provider` | Replace their separate cards; preserve disclosures, permissions and domain writers. |
| `consent_update_settings`, `consent_publish_settings` | Replace their separate card descriptions; preserve draft/publication rules. Enabling a requested configuration must disclose and approve the required draft/publication effects together. |
| Signed-in connection repair and token-save access summaries | Remove silent chat-triggered widening and manual Settings instructions; use the same typed access proposal. |

Credential entry and OAuth sign-in remain necessary when credentials are missing. They must not create an additional access-approval ceremony. Ordinary questions and confirmations for sending, publishing, deleting or restoring remain separate actions.

**“Any setting” has these bounds**

A card may change an existing, active, schema-valid setting that the host permits the caller to change, at the displayed scope. Aliases resolve before policy checks. Personal changes address only the confirming person.

That includes execution settings, agent/model/effort, personal Auto/Ask/Off, Chrome access, privacy consent, custom instructions and form routing. Dedicated settings—comments/mail provider, visitor tools and cookie consent—use their existing domain writers through injected ports.

It cannot grant:

- Secrets, passwords, API keys, OAuth tokens or new identity/owner/RBAC privileges.
- New setting definitions, bulk namespace resets, another person’s preferences or global settings.
- Arbitrary commands, SQL, code installation, unknown tools or undeclared plugin sources.
- Bypasses of authentication, approval, endpoint trust, tool classification or schema validation.
- Mail test-mode changes or permanent-delete policy/risk acknowledgment under this proposed boundary.
- Raw replacement of `core.assistant-full-cli`; only the existing typed runtime-capability writer may change its named grants.

Auto never approves a new escalation. Ask and Off remain personal. An Off→Ask/Auto change requires its own visible row on the same card.

**Ordered changes**

Line counts are estimates, excluding tests.

1. **Define the typed plan and common presentation — about +120/−5.**  
   Change `J/packages/core/src/approval.ts`; add `J/packages/ui/src/features/mcp-ui/surfaces/access-approval.ts`; export it from `J/packages/ui/src/features/mcp-ui/surfaces/index.ts`. Enforce fresh approval for access plans and format their shared disclosure.  
   **Why no smaller:** shared styling alone would leave remembered approvals and inconsistent grant descriptions.

2. **Secure and bind the click — about +60/−10.**  
   Change `T/contracts/core/human-confirm.ts`, `T/server/runtime/composition/modules/assistant.ts`, and `T/contracts/core/tool-metadata/settings.ts`, `plugin-runtime.ts`, `external-mcp.ts`. Require a session-authenticated, active human; bind the answer to the existing principal/tool exchange; keep access callbacks exchange-only. Recheck authority before effects.  
   **Why no smaller:** labeling a principal “user” does not authenticate a person.

3. **Reuse plugin planning and remove its separate ceremony — about +130/−200.**  
   Change `T/features/agent-plugins/enable-access.ts`, `apply-connect-defaults.ts`, `grant-signed-in-defaults.ts`, `connect-tool.ts`, `tool-registrations.ts`, `access-token-tool.ts`, `switch-on-saved-token.ts`, `service-ports.ts`; change `T/features/plugin-runtime/tool-registrations.ts`, `agent-tools.ts`; change `T/server/runtime/composition/plugin-host.ts`. Delete `T/features/plugin-runtime/set-enabled-confirmation-ui.ts`, moving its remaining family type into `agent-tools.ts`. Carry the approved snapshot into grant application.  
   **Why no smaller:** this must close the signed-in repair path as well as replace the visible enable card.

4. **Apply MCP access without overwriting credentials — about +180/−65.**  
   Change `T/features/external-mcp/contracts.ts`, `external-mcp-repo.ts`, `external-mcp-store.memory.ts`, `external-mcp-store.ts`, `tool-registrations.ts`, `save-form.ts`, `agent-tools.ts`. Add a conditional access-only update against the approved snapshot; preserve credential columns. Support source enable and exact tool/write selections through the existing save tool.  
   **Why no smaller:** a reread followed by whole-row upsert can overwrite concurrent changes. No schema change is needed.

5. **Unify settings approval — about +50/−65.**  
   Change `T/features/settings/tool-registrations.ts`, `tool-deps.ts`, and `J/packages/core/src/settings/agent-value-write-tools.ts`. Remove remembered access approval, preserve dedicated-writer restrictions, and pass the existing expected revision into the transactional writer.  
   **Why no smaller:** the current pre-write comparison alone leaves a race before the write.

6. **Absorb remaining cards — about +100/−120.**  
   Change `T/assistant/ask-choice-tool.ts`, `T/features/agent-plugins/automatic-agent-plugins.ts`, `T/server/inbound/assistant/assistant-tool-consent.ts`, `T/features/settings/visitor-tools-registrations.ts`, `T/features/comments/tool-registrations.ts`, `T/features/mail-status/tool-registrations.ts`, `T/features/consent/tool-registrations.ts`. Replace card construction with typed plans; retain existing effect owners.  
   **Why no smaller:** leaving these forms would preserve parallel ways to grant access.

7. **Prove behavior and adopt published Jini packages — about +450/−20 test lines.**  
   Add `J/packages/core/src/__tests__/access-approval.test.ts`, `J/packages/ui/src/features/mcp-ui/__tests__/surfaces/access-approval.test.ts`, `T/assistant/__tests__/access-approval.integration.test.ts`, and `T/features/external-mcp/__tests__/access-grants.contract.test.ts`. Extend `T/server/__tests__/admin-mcp-ui-tool-calls-route.test.ts`, `T/features/settings/__tests__/settings-write-tools.test.ts`, and `T/assistant/__tests__/mcp-ui-allowlist-completeness.test.ts`. Update Tovu root `package.json` and `package-lock.json` to published compatible Jini versions.  
   **Why no smaller:** this crosses authentication, persistence and CLI transports.

Tests must demonstrate one card/one click for each target; zero access writes before approval; zero writes on decline, expiry, abort, stale revision, wrong person, API-key reply, forged input or synthetic click; unchanged credentials; and preserved Auto/Ask/Off. Parameterize transport acceptance across every registered agent CLI and BYOK. These tests were **not run**.

**Added runtime cost**

Let `P` be the human/authority projection, `G` the affected grant snapshots, `D` setting definitions, `V` setting values, and `M` plugin manifest bytes. Proposed maximum plan: 128 affected resources and 128 KiB of normalized disclosure; retain existing 64-tool list limits.

| Operation | Frequency × size |
|---|---|
| Human/authority validation | At preparation and before apply: `2 × P`; callback reuses session resolution. |
| Plugin/source preview and revalidation | `2 × (M + G)` per requested enable; existing reads reused. |
| Setting preview and revalidation | `2 × (D + V)` per changed setting; existing writer adds its revision-check read. |
| Accepted writes | `1 × changed access row` per source; existing activation-file rewrite and setting value/revision writes remain. |
| Card and answer | `1 × ≤128 KiB` disclosure; `1 × decision/allowed choice IDs`. |
| Discovery refresh | One existing notification after committed access changes; existing listeners read their roster. Frozen-source grant refresh adds no remote `tools/list`. |
| Polls/background work | `0 × 0 bytes` added. |

Physical database reads, existing reload fan-out and byte measurements remain **UNVERIFIED** until instrumented tests. Declined/expired cards perform no provisioning or grant writes. After an accepted multi-store change, a failure may leave partial success; report exact results without silently retrying.

**Collisions**

- `cloud/small-fixes`: direct overlap in Tovu `features/agent-plugins/automatic-agent-plugins.ts`. Preserve its guidance changes. Jini’s automatic-use owner is a behavioral dependency; this plan need not edit it.
- `cloud/consent-declare`: direct overlap in Tovu `features/consent/tool-registrations.ts`. Use that branch’s revised consent disclosures.
- Available `forms-left`, `release-fixes` and Jini `om-chat-3` refs show no overlap with the proposed files.
- **UNVERIFIED:** Tovu `om-chat-3` and both `ui-fixes` refs are absent locally. No fetch was performed.

I will not add a new approval engine, general execution tool, persistence layer, polling, cross-plugin imports, vendor code in core, boot refusal or complexity-ceiling exceptions. Public additions use `(requiredObj, optionalObj)`. Any later schema necessity requires ADR-066 TypeScript migrations.

**Effort:** approximately **14–20 Codex hours**, including focused verification.

**Owner-only question:** should permanent-delete grants and mail test mode remain excluded? This plan keeps both excluded.