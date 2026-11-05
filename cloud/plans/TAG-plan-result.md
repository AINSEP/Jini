Software Architect(Direct): Loaded the Software Architect, Programmer, and TDD skills. **Goal: default-on tags across Jini and Tovu, with human-only approval decisions and secret controls.**

Both clones are on `merge-1029`. Static inspection only; no files changed or tests run. References below point to the inspected clones.

**1. Findings**

- **Reuse the existing handle contract.** Jini already has validated handles, bounded ID fingerprints and component sub-handles. Keep `agentHandle?: string | false`; cut a universal `agentKey` and new `AgentScope` provider unless an actual consumer cannot use its existing item ID and component namespace. Labels describe controls; they must not determine identity. [handle.ts:69](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agentic/src/core/handle.ts:69)
- **There is no universal wrapper spread.** ui-kit has a common facade and injected `AgentAttrsPort`; other UI wrappers render native controls themselves. Extend those owners rather than migrating every wrapper to a new component system. ui-kit explicitly avoids importing an agent runtime. [Kit.hooks.ts:66](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/ui-kit/src/react/Kit.hooks.ts:66), [attrs.ts:5](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/ui-kit/src/attrs.ts:5)
- **The Reveal bypass is confirmed.** The driver adopts untagged descendant buttons and links. `security-site-key-status` contains Reveal. Private text redaction does not prevent that click. [driver:470](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agentic/src/core/dom/dom-page-driver.ts:470), [SiteKeyTab.tsx:132](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/security/SiteKeyTab.tsx:132)
- **Removing descent has compatibility work.** Menu Editor’s untagged “Copy HTML embed” button and Git Backup’s untagged fields can currently be reached through their parent handles. Give these controls direct handles. Email Template Save already has its own handle. **UNVERIFIED:** complete runtime parity across every page. [MenuEditor.tsx:418](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/menus/MenuEditor.tsx:418), [GitBackupCard.tsx:62](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/import-export/GitBackupCard.tsx:62), [EmailTemplateEditor.tsx:189](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/email/EmailTemplateEditor.tsx:189)
- **Self-approval is confirmed in two test suites**, not just the named test. Remove the registered response capability and replace assertions that endorse it; preserve their validation, cancellation and replay coverage. [admin-page-tools.ts:93](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/webmcp/admin-page-tools.ts:93), [approval-input test:40](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/webmcp/__tests__/admin-page-approval-input.unit.test.ts:40)
- **Chat cards require wiring, not a new approval system.** Daemon page tools deliberately bypass the existing chat approval wrapper and use the browser dialog. WebMCP has no run/principal. Both facts must be handled when replacing that dialog. [agent-daemon-scope.ts:387](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/assistant/agent-daemon-scope.ts:387), [WebMCP README:25](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/webmcp/README.md:25)
- **Hard exclusions need stronger enforcement.** Existing secret primitives forward supplied handles, including a Tovu password-reveal handle. Suppression must survive reveal-to-text and caller attributes. [SecretInput.tsx:25](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/ui-kit/src/react/SecretInput.tsx:25), [CreateSiteOnboarding.tsx:341](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/sites/CreateSiteOnboarding.tsx:341)
- **The audit’s old-checkout warning is stale for these clones.** This driver already has optional publication filtering. Reuse its visibility/private checks universally, but retain manifest-specific authorization separately: enabling that whole filter for admin would also restrict supported actions. [publication-filter.ts:4](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agentic/src/core/dom/publication-filter.ts:4)

**2. Ordered implementation plan**

Line estimates are production **added/removed**, followed by test additions. Every bug regression starts failing in the later cloud run before its fix.

1. **Close driver bypasses before expanding tagging.**  
   Files: Jini `dom-page-driver.ts`, `publication-filter.ts`; their existing DOM tests.
   Remove button/link/summary adoption from generic regions. Preserve direct controls, editable regions, native details’ direct summary, and an unambiguous label-associated input fallback. Refuse ambiguous fallback.
   Apply existing visibility/private checks without requiring a publication manifest; reject hidden, inert, disabled and inactive controls before effects. Respect the active modal; hosts mark inactive panels hidden/inert.
   **Why no smaller:** fixing Reveal locally would leave the same bypass in every other tagged region.
   **Proof:** extend `dom-page-driver-elements.test.ts`, `dom-page-driver-private.test.ts` and `visitor-publication.test.ts`: Reveal/link never fires through a region; label+checkbox still toggles; closed dialogs, hidden ancestors, disabled fieldsets and background modal controls refuse; explicit visitor publication remains binding.
   **Size:** +80–140 / −20–45; tests +180–280.

2. **Add one default-tagging contract at existing shared owners.**  
   Files: Jini ui-kit `attrs.ts`, React types/facade hooks; UI’s React adapter; existing agentic handle helpers.
   Default shared interactive primitives on. Precedence: **secret/approval exclusion → explicit opt-out → existing supplied handle → generated handle**. Preserve existing explicit names.
   Generate identity from a stable React instance ID plus fixed control-part suffix; namespace independent roots. It stays stable across rerenders and keyed reordering. Remount/reload may produce a new automatic handle; durable automation uses an explicit handle. Composite items use existing IDs through `agentHandleSegment`, never translated labels or array positions.
   Keep ui-kit’s runtime dependency inversion through `AgentAttrsPort`; supply metadata defaults without importing agentic there.
   **Why no smaller:** changing the pure optional-base helper alone cannot supply React identity or cover ui-kit’s separate attribute seam.
   **Proof:** facade/handle contract tests cover default-on, explicit preservation, opt-out precedence, duplicate labels, multiple roots, keyed reorder, length/grammar and rerenders. Duplicate publication warns and refuses the ambiguous action; it never refuses application startup.
   **Size:** +100–170 / −10–25; tests +160–240.

3. **Repair forwarding only where it is missing.**  
   Files: Jini `PillButton`, `PopoverMenu`, `PopoverItem`, `CustomSelect`, `TabStripItem`, shadcn `CheckboxField`/`SelectField`, admin `EntityField`, ui-kit native Controls/Navigation/Dialog hooks.
   Apply defaults at the shared facade/spread first. Add narrow forwarding seams to independent renderers. Put handles on actual controls; `PopoverMenu` remains a descriptive container. Derive option/menu/tab/close handles from the component base and existing item ID. Fix `EntityField` at `commonProps` plus its Select branches.
   Reuse existing portal-container seams and ui-kit overlay context. Portals must remain inside the allowed driver root and retain page identity; do not widen the root to `document`.
   **Why no smaller:** these independent renderers cannot inherit a facade change they never call.
   **Proof:** table-driven wrapper tests assert caller handle preservation and opt-out; real-driver interaction tests open/select menu options, activate/close tabs and close Dialogs, including portalled controls and repeated instances.
   **Size:** +120–220 / −40–80; tests +220–340. [EntityField.tsx:22](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/admin/src/react/entities/EntityField.tsx:22), [Dialog.hooks.ts:35](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/ui-kit/src/react/native/Dialog.hooks.ts:35)

4. **Give Composer and AgentRuntimePicker the same tagging API.**  
   Files: Jini `Composer.tsx`, `AgentRuntimePicker.tsx`, chat-pane props and immediate forwarding call sites.
   Accept a base/opt-out and derive handles for textarea, send/stop, attachments, runtime selection and picker menus. Use runtime IDs for rows. Preserve existing accessibility/test attributes.
   Tagging grants no driving permission: Tovu may keep chat outside its driver root; approval decisions remain excluded under every host policy.
   **Why no smaller:** tags on the outer chat component cannot identify its separate controls.
   **Proof:** extend existing Composer/picker tests: two instances have distinct handles; overrides and opt-outs reach leaves; runtime reorder preserves identity; permitted ordinary controls work through the driver; host root exclusion still blocks them.
   **Size:** +60–110 / −10–25; tests +120–180. [Composer.tsx:441](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/components/Composer.tsx:441), [AgentRuntimePicker.tsx:141](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/features/chat-pane/components/AgentRuntimePicker.tsx:141)

5. **Replace page approval dialogs with the existing human chat-card exchange.**  
   Files: Tovu WebMCP tools/store/dialog wiring, `App.hooks.ts`, daemon composition and frontend metadata; Jini frontend-control/chat bridge adapters.
   Preserve `directPageAction`: reviewed direct actions run; **every other opaque click asks**, including permanent deletion, overwrite, secret replacement, escalation and publishing. Do not infer safety from labels, generated handles or button colour. [policy.ts:28](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/assistant-tool-approval-policy.ts:28)
   Apply the existing server approval wrapper to daemon page actions and remove their browser-dialog gate together, so one click produces one card.
   For runless WebMCP, add one narrow authenticated request adapter: derive the principal from the admin session, bind the originating tab using existing `bindRequest`, and execute through the same ToolExecutor/card path. Generic adapter mechanics belong in Jini; Tovu supplies auth, policy and chat wiring. [frontend-control.ts:110](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/http/frontend-control.ts:110)
   Reuse `requireHumanConfirm`, the shared exchange store, sandboxed confirmation renderer and authenticated callback. Remove `admin.respond_page_approval`, its descriptions/response metadata and self-approval tests. Delete obsolete modal-only plumbing after both paths use cards.
   **Why no smaller:** deleting the response tool alone leaves a modal, while WebMCP cannot safely borrow an unrelated run or principal.
   **Proof:** WebMCP and daemon integration tests show one card, zero effects before a human answer, one effect after acceptance, and no effect after decline/abort/navigation/disabled access. Reject synthetic card clicks, agent replies, typed “yes,” wrong-principal callbacks, replay and mutated proposal arguments. Verify existing AG-UI and ordinary chat rendering paths.
   **Size:** +220–360 / −150–260; tests +280–420.

6. **Adopt safely in Tovu and close discovered reachability gaps.**  
   Files: Tovu dependency manifests/lockfile, admin root/overlay wiring, `SiteKeyTab`, `GitBackupCard`, `MenuEditor`, existing secret adapters; Jini secret primitives.
   Strip addressing attributes from secret inputs, textareas and reveal/copy controls even when supplied explicitly; keep semantic privacy after reveal. Approval-card decision controls get no handles. Ensure defaults cannot recreate a suppressed confirmation handle.
   Add direct handles to the identified ordinary controls losing parent reachability. Use the existing tagging helper at raw native controls; do not invent wrappers solely to add attributes.
   **Why no smaller:** a dependency upgrade cannot repair native Tovu controls or remove already supplied secret handles.
   **Proof:** extend existing users/media/taxonomy agent-drive suites; add Menu Editor/Git Backup regressions and Site Key parent-click tests. Assert no secret/approval handles before or after reveal, rerender or portal mounting. Run visitor-page-control regressions to retain its stricter published-site boundary.
   **Size:** +60–130 / −30–80; tests +180–280.

All new generic public functions use `(requiredObj, optionalObj)`. Keep complexity ≤10, or ≤9 for any desktop wiring. No schema change is needed.

**3. Cost**

Let **N** be eligible mounted descriptors, **ΔN** newly tagged controls, **D** serialized descriptor bytes, **C** existing card-resource bytes.

| Added work | Frequency × payload/work |
|---|---|
| Tag attributes | Each affected render × roughly 80–250 bytes/control; local DOM only, no network write |
| Discovery response | Each `page.find_elements` × **ΔN × D**; illustrative D=180–300 bytes gives 54–90 KB for 300 added controls |
| Eligibility checks | Each scan × N controls × ancestor checks; each action rechecks its target; no service reads |
| Stateful discovery | Existing maximum 50 state observations/read; descriptor count itself is uncapped |
| WebMCP protected request | One request/action × approximately 0.2–1 KB target/binding envelope |
| Card and answer | One card/action × C; one human callback × approximately 0.2–0.5 KB; existing execution/result exchange |
| Waiting stream | If using existing NDJSON transport: 4 heartbeats/minute × 21 bytes, plus framing |
| Persistence/polling | No new table or polling. Reuse existing transcript/event persistence; exact write batching and C are **UNVERIFIED**, measure in cloud |

The daemon already caps frontend output at **64 KiB**. Preserve it and existing query/role filters; oversized discovery must explain how the agent can narrow its query, never silently discard controls. [output cap:374](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/assistant/agent-daemon-scope.ts:374), [state cap:54](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agentic/src/core/page-executor.ts:54)

**4. Exclusions and CUT-CANDIDATES**

- **CUT-CANDIDATE:** new `AgentScope`, universal `agentKey`, handle registry, mutation observer, persisted automatic IDs, pagination or a new approval engine. Existing identities, ports and filters cover this plan.
- No automatic tagging of arbitrary native/generated/user HTML; no Open Marketing changes, navigation redesign, new plugin or vendor dependency.
- Ordinary feature-confirmation buttons remain distinct from **human approval decisions**; destructive page clicks still pass the chat gate.
- Do not move the sign-in card as part of TAG. The planned callback extraction should own generic dispatch/streaming; Tovu retains session authorization and CMS grants. Both approval and sign-in cards retain private controls and principal-bound exchanges.
- **UNVERIFIED:** the exact destination and schedule of those planned moves. TAG should depend on their ports, not copy their implementation.

**5. Effort and dependencies**

Estimate **18–26 hours of Codex work**, including later cloud verification: driver 3–4h; defaults/forwarding 5–7h; chat tags 2–3h; approval integration 5–8h; adoption/verification 3–4h.

Dependency order: safety → defaults → forwarding/chat → adoption. Approval work can proceed independently, but expanded driving ships only with its human-only gate. In the Node 24 container, record an untouched baseline, run the named failing regressions, implement, then run affected package suites and Tovu integration/browser checks using both repos and local PostgreSQL.

**6. Owner questions**

None blocking. Recommendation: automatic handles identify the current mounted control; explicit handles support automation that must survive reopening or refreshing a page. Keep the existing conservative rule that unreviewed clicks ask a human.