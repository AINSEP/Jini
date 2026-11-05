Software Architect(Direct): Loaded [the requested Software Architect persona](/Users/la/Programming/Tovu/AI-Dev-Shop/agents/software-architect/skills.md).

**1. Goal:** Finish the verified error and audit leftovers, then complete the nine folder groups through jobs with separate file ownership.

Read-only inspection completed against both `merge-1029` clones. No files changed; no tests, builds, installs, servers or localhost requests ran. Graph tools were unavailable; findings use bounded source searches. Below, `A = apps/admin/src`, `D = apps/desktop/src`, `W = apps/website/src`, and `J = prov2-jini/packages`.

**2. Findings**

| Area | Verified state |
|---|---|
| Existing error mechanism | Reuse [formatUserFacingError](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/core/src/user-facing-error.ts:31), [ErrorNotice](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/ui/src/features/panel-kit/ErrorNotice.tsx:20), and [sendAdminFailure](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/system/site-share-errors.ts:67). No new abstraction needed. |
| Auth row 6 | **Open.** Login still returns “internal error” at [dev-auth.ts:601](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/dev-auth.ts:601). The same file has three sibling failures at lines 492, 505 and 614. [Login.tsx:43](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/auth/Login.tsx:43) renders only a string. |
| Earlier top-15 migration | **Partial against the full requirement.** Pages now names the failed operation, but its [route:39](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/pages/list.ts:39) supplies no failure details. The [regression suite:26](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/http/__tests__/ranked-user-facing-errors.test.ts:26) deliberately expects no details envelope. Clearer wording does not establish complete “Copy details” delivery. |
| Sweep size | Static census found **236 `sendAdminFailure` calls across 203 production files; 218 omit an operation-specific message**. Separate fallback searches found 67 candidate lines in 34 admin feature files and 25 in 17 desktop files. These are review inventories, not measured failure frequency or confirmed bugs at every match. |
| Skills | **Open, partly translated.** The install confirmation already has a translator and locale tests. [Skills.tsx:20](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/skills/Skills.tsx:20), [SkillRow.tsx:21](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/skills/SkillRow.tsx:21), and [remove dialog:7](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/skills/SkillRemoveConfirmDialog.tsx:7) retain English text and accessible names. |
| Jini LCOV union | **Open.** [lcov.ts:81](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/devops/src/checks/coverage/lcov.ts:81) selects the report with more covered lines. Its parser discards individual coverage identities. Desktop already has [per-entry union logic:373](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/coverage-floors.ts:373), including documented limitations. |
| Cleanup skip | **Open.** Tovu’s [guard:272](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/__tests__/fixtures/vitest-compat.ts:272) throws inside `afterEach`. Jini’s active compatibility fixture still uses the older [throwing file-level `after`:240](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/__tests__/vitest-compat.mjs:240). Reuse the existing [teardown queue:17](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/__tests__/fixtures/teardown.ts:17), which attempts every cleanup before reporting failures. |
| Chrome closes other groups | **Fix UNVERIFIED.** Inspected code enables external Chrome integration through [runtime flags:125](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/defs/claude.ts:125); the separate [DevTools preset:4](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/mcp/src/agent-install/chrome-devtools.ts:4) launches another external tool. No owned tab-closing implementation or ownership enforcement was found. |
| Plugin wrappers | **Done in source.** The named standalone wrappers are absent. Agent guidance uses `agent-plugins/{ui-ux-design,stripe,posthog,opentelemetry,sentry,langfuse}`; executable providers use `provider-plugins/{payments-stripe,analytics-posthog,observability-opentelemetry,observability-sentry,ai-trace-langfuse}`. See [agent exports:191](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/package.json:191) and [provider exports:41](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/provider-plugins/package.json:41). Publication and installed-package behavior remain **UNVERIFIED**. |

The pilot report is stale: **all three forwarding source facades are already gone, and none needs restoring**.

| Former facade | Why unnecessary now |
|---|---|
| `sidecar/src/respawn-policy.ts` | Stable public subpath points directly into `dist/supervision/`; [manifest:32](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/sidecar/package.json:32). |
| `sidecar/src/supervisor.ts` | Same direct mapping; [manifest:37](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/sidecar/package.json:37). |
| `sidecar/src/supervisor-node.ts` | Node-specific public subpath remains intact; [manifest:42](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/sidecar/package.json:42). |

The barrel and package-surface tests already reference the moved files. Keep diagnostics and the shared daemon registry with their existing owners.

**3. Ordered build plan**

Line estimates below distinguish production edits from tests; folder relocation is counted separately. Every behavior fix begins with a failing regression. Existing working edits belong to other jobs and must be reconciled before implementation.

1. **Auth job — finish row 6 and its three same-file siblings.** Own `W/server/inbound/admin-http/dev-auth.ts`, `A/features/auth/**`, and their dedicated tests. Reuse `sendAdminFailure` with approved anonymous-safe explanations, existing redacted logging, operation IDs and opt-in details; render the existing `ErrorNotice`. Preserve invalid-credentials responses, rate limits, session ordering and boot-token rejection equivalence. Never include passwords or raw backend facts in copy text. Estimate **+70–120/−15–30 production lines; +120–200 tests; 3–5 hours**.
   Tests: identity initialization failure, session-store failure, logout failure, both boot-session failures, unchanged 401/429 behavior, matching incident IDs, secret canaries, and translated copy-details rendering.

2. **Error sweep — migrate in this value order.** Each row is a separate job owning its named route directories, corresponding frontend feature files and dedicated tests. Counts include already improved calls; inspect those rather than rewriting them automatically. Preserve existing statuses, safe refusals and domain-specific recovery advice.

| Priority/job | Exclusive route directories | Calls / files | Rough production edits; Codex hours |
|---|---|---:|---|
| E1: recovery and publishing | `database`, `recovery`, `publish-content` | 23 / 17 | +100–180/−30–70; **4–6 h** |
| E2: authoring | `pages`, `posts`, `media`, `taxonomy`, `menus`, `entries`, `content-types` | 53 / 43 | +250–450/−80–160; **7–10 h** |
| E3: assistant and connections | `assistant`, `external-mcp`, `integrations`, `plugins`, `agent-plugins`, `skills` | 44 / 42 | +200–350/−60–130; **6–9 h** |
| E4: site operations | `system`, `sites` | 40 / 27 | +180–300/−60–110; **5–7 h** |
| E5: people and access | `users`, `members`, `workspace`, `api-keys` | 31 / 31 | +140–240/−40–90; **4–6 h** |
| E6: remaining admin domains | All other route directories in the census | 45 / 43 | +180–320/−60–120; **5–8 h** |

   Concrete starting examples: [restore failure:58](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/recovery/restore.ts:58), [form update:113](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/forms/update.ts:113), and [plugin settings:100](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/plugins/provider-settings.ts:100).
   Reuse the formatter at each selected boundary and `ErrorNotice` at its consumer. Do not move the response helper, add a global error registry, or expand every envelope automatically. Tests: injected failures at each changed boundary, preserved refusal/status behavior, useful action, redacted details, and copy rendering. Allow **roughly +1,000–1,800 test lines** across these jobs.
   A single integration owner handles any justified changes to shared `api.ts` or shared error tests; domain jobs do not edit them. Prefer consuming existing `ApiError.body` over extending its public contract.

3. **Jini/public/desktop error job.** Review the remaining boundaries separately from the admin census: [daemon runs:96](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/http/runs.ts:96), [model stream:465](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/http/model-proxy.ts:465), public member/content routes, and desktop fallback candidates. Keep generic explanations/formatting in their existing Jini owners and Tovu-specific wiring in Tovu. Preserve public disclosure limits and machine-readable formats such as XML/text.
   Estimate **+200–400/−70–150 production; +250–450 tests; 6–10 hours**. Test HTTP, stream and IPC consumers before claiming completion; string replacement alone is insufficient.

4. **Skills job.** Own only `A/features/skills/**`; E3 owns its backend routes. Extend `skills-i18n.ts` and reuse the existing locale hook/translator for page text, rows, removal dialog, accessible names and hook fallbacks. Include formatted failures here so a second error job need not edit these files.
   Estimate **+250–450/−50–90 production; +100–180 tests; 3–5 hours**. Extend the existing locale-picker-driven tests to loading, empty, installed, add, remove and error states. Translation quality remains **UNVERIFIED** without language review.

5. **LCOV job.** Own `J/devops/src/checks/coverage/lcov.ts` and its dedicated tests. Preserve per-line/function/branch identities during parsing, union compatible images, then calculate summaries. Use desktop’s existing algorithm and fixtures as prior implementation evidence; do not import Tovu into Jini or blindly merge different runner layouts. Summary-only records must remain explicitly incapable of proving a union.
   Estimate **+100–180/−15–35 production; +130–220 tests; 4–6 hours**. RED cases: complementary coverage, equal-hit complementary reports, duplicate records, repeated function names, untaken branches, incompatible layouts and summary-only inputs. Desktop consumer replacement is optional.

6. **Cleanup job.** Own both compatibility fixtures and their dedicated regression suites. Replace the guard’s throwing global hook with per-test verification ordered through cleanup that attempts every registered step before reporting failure. Reuse the existing teardown policy; put any additional generic logic in Jini and keep Tovu registration thin.
   Estimate **+25–60/−5–15 implementation; +90–150 tests; 2–3 hours**. Use a child-process regression: catch forbidden fetch, record later `afterEach` and file cleanup, require every marker, and still require a failing exit. Also cover cleanup failure and a clean following test.

7. **Chrome evidence job, before a product fix.** Trace the actual tool invocation and identify which external tool closed the groups. **No runtime file change is justified yet: +0/−0; 1–2 hours investigation.** A later regression must create two independent groups and prove one worker cannot close the other’s tabs. Do not disable Chrome integration or substitute tools silently.

8. **Folder jobs — only after the merge gate below.** Updated remaining groups:

| Group / job | Move and caller rewrites | Lines relocated; import edits added/removed |
|---|---|---|
| 2 / F-main | Four root update modules → `D/main/updates/`; [updater imports:7](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/main/updates/desktop-updater.ts:7). | 288; ±25–45 |
| 7 / F-main | Four root telemetry modules plus telemetry boot → `D/main/product-telemetry/`; [boot:11](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/main/updates/product-telemetry-boot.ts:11). Same job as group 2 because both edit main/settings callers. | 556; ±35–65 |
| 3 / F-editors | Three `A/lib/widget-embed-*` files plus placement fields → `A/components/WidgetEmbed/`; include the previously missed [post-editor caller:25](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/posts/hooks/use-post-editor.hooks.ts:25). | 521; ±35–60 |
| 6 / F-editors | Standing-draft hook, backup and recovery text → `A/integrations/jini-admin/standing-drafts/`; [existing Jini delegation:1](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/hooks/use-standing-draft-autosave.hooks.ts:1). Same job as group 3 because editor callers overlap. | 42; ±30–60 |
| 4 / F-MCP | Settings External MCP components/hooks/translations and dedicated CSS → `A/features/providers/external-mcp/`; [documented move:24](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/providers/hooks/use-providers.hooks.ts:24). Preserve CSS import position. | 5,576; ±100–180 |
| 5 / F-dock | Typed-answer, A2UI-action and daemon-activation adapters → existing `AssistantDock/`; [registry:12](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/components/AssistantDock/hooks/use-dock-renderer-registry.hooks.ts:12). | 102; ±20–40 |
| 8 / F-renderer | Workspace/start panels and workspace/live-view hooks → `D/renderer/app/site-workspace/`; [workspace:4](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/renderer/app/SiteWorkspace.tsx:4). | 1,120; ±35–65 |
| 9 / F-renderer | Creation host, onboarding, form/directory hooks and policy → `D/renderer/app/create-website/`; [onboarding:8](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/renderer/CreateWebsiteOnboarding.tsx:8). Same job as group 8 because `App.tsx` overlaps. | 647; ±35–65 |
| 10 / F-webmcp | Four page/navigation/screenshot adapters → existing `A/features/webmcp/`; [shell callers:13](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/App.hooks.ts:13). | 510; ±30–55 |

   These are **six jobs**, with one separately revertible commit per group. Move dedicated tests too; add no artificial import tests. Reuse installed ts-morph to calculate rewrites and `git mv` to record moves. Preserve bodies, why-comments, `.js` suffixes, mock paths, storage keys and registration order. Net behavior/logic change: **zero**.

**When folder moves are safe:** after the final `integ/desktop-mem-1103` and `merge-1029` changes land in both mains, relevant working edits are reconciled, and pilot verification is recorded. The [owner’s gate](/Users/la/Programming/Tovu/development/todos.md:39) is not satisfied by cached refs: Tovu/Jini integration heads remain 326/177 commits ahead of their respective `origin/main`. Remote freshness and a calendar date are **UNVERIFIED**. Finish relevant error jobs before moving their callers.

**4. Cost**

| Change | Added frequency × payload |
|---|---|
| Error UI/transport | **0 new requests or polls.** Each migrated failed response carries its bounded formatted details; approximately ≤100 KiB additional JSON in the worst escaped case using current field caps. Do not append details to successful responses or poll histories. |
| Auth diagnostics | Per unexpected failure: **1 redacted log + at most 1 configured tracker event**, each containing the redacted diagnostic and small operation metadata. No success-path I/O; diagnostic size depends on the existing redactor. |
| Clipboard | Per explicit click: **1 clipboard write × ≤8,192 characters**, using the existing helper. |
| LCOV | Per coverage invocation: **same artifact reads × existing artifact sizes**; additional in-memory work proportional to unique coverage entries. No new polling or artifact pass. |
| Skills, cleanup, folder moves | **0 added production reads/writes/polls × 0 bytes.** Regression fixtures perform only test-local work. |

**5. Exclusions and CUT-CANDIDATES**

No schema changes, new platform modules, global envelope migration, vendor relocation, plugin cross-imports, auth recovery redesign or folder-move behavior fixes. Keep complexity at ≤9 in desktop and ≤10 elsewhere; no new boot refusals or manual repair instructions.

**CUT-CANDIDATES:** recreating pilot facades; adding barrels or move tooling; desktop LCOV adoption during the Jini fix; rewriting already migrated plugin packaging; broad translation cleanup outside Skills; changing Chrome tooling before identifying the failing tool. Existing features remain parked.

**6. Effort and dependencies**

Approximately **61–95 Codex hours** for the full sweep, specified leftovers, investigation and remaining folder groups, including focused verification during later authorized builds. Folder work accounts for **11–18 hours**. Actual error frequency is unknown, so prioritization uses consequence and shared-path reach.

Auth, Skills, LCOV and cleanup can proceed independently. Error jobs partition domain files; one integration owner controls shared adapters/tests. Folder jobs wait for the merge gate and relevant behavior jobs. Any new public Jini helper must use `(requiredObj, optionalObj)` and injected effects.

**7. Owner questions**

- **Should Chrome isolation become a separate external-tool investigation?** Recommendation: yes—time-box the initial trace to 1–2 hours, retain the current integration, and keep the bug open until the responsible tool and reproduction are established.
- No other owner decision is needed to prepare these jobs. Keep the existing agent-guidance/provider-runtime packaging split and enforce the stated folder merge gate.