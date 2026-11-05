Software Architect(Direct): Loaded all three requested skills.

**1. Goal**

Fix Open Marketing’s shared-chat blockers in Jini, cover Tovu’s restricted Codex launches, and preserve every existing host approval requirement.

**2. Findings**

Both clones are on `merge-1029`. This was static inspection only; no files changed or tests, builds, servers, installs, or application launches ran.

- **P0 is missing from Jini.** `McpJsonInjectionOptions` has no host-owned approval option. Codex’s serializer emits transport, credentials, and timeout but no bridge approval setting. Reuse this injection contract and the existing private `CODEX_HOME` staging. ([contract:398](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/agent-executor/contracts.ts:398), [serializer:65](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/agent-executor/codex/home-config.ts:65), [staging:214](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/agent-executor/codex/home-staging.ts:214))
- **Tovu is exposed too when native access is off.** Site chat derives native grants, passes `nativeToolAccess` and `cliParity`, and uses Jini’s executor. Locked Codex selects `sandbox_mode="read-only"` and `approval_policy="never"`—the same relevant combination as OM. Local owner defaults explain a different launch policy; they do not cover hosted, non-owner, or explicitly locked chats. ([site launch:1073](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/assistant/agent-daemon-scope.ts:1073), [grant resolution:1119](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/assistant/agent-daemon-scope.ts:1119), [Codex policy:219](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/defs/codex.ts:219))
- **Desktop has a separate affected bridge.** It configures its own injection and passes the same native-access dimensions. Include this launch site in adoption. ([desktop injection:253](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-agent.ts:253), [launch:377](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-agent.ts:377))
- **Host approval remains independent.** Site registrations receive `applyToolApprovalPolicy`; confirmation-required actions call `requireHumanConfirm`, which refuses execution without a human channel. Existing policy already permits reversible edits/trash directly. Desktop deliberately excludes destructive tools until confirmation transport exists. Preserve those distinctions. ([registration:464](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/tool-registrations.ts:464), [confirmation:82](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/contracts/core/human-confirm.ts:82), [classification:7](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/assistant-tool-approval-policy.ts:7), [desktop restriction:66](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-agent-tools.ts:66))
- **Item 1: yes, the clone still overwrites duration.** Lines 104–117 sum reported duration correctly; `messageSummary` subsequently calls `fillRunDuration`, whose line 183 replaces it. An existing test explicitly expects replacement. `/Users/la/Programming/Jini` differs: its line 114 checks `usage.durationMs === undefined`. This clone needs a source correction, not merely publication. ([clone aggregation:104](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/core/turn-usage.ts:104), [overwrite:180](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/core/turn-usage.ts:180), [conflicting test:101](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/core/__tests__/turn-usage.test.ts:101), [other checkout:114](/Users/la/Programming/Jini/packages/chat/src/core/turn-usage.ts:114))
- **Item 2 is confirmed:** delete/rename callbacks and their controls are unconditional. ([ConversationList:45](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/components/ConversationList.tsx:45), [controls:340](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/components/ConversationList.tsx:340))
- **Item 3 is confirmed:** the grid constrains rows, but declares no column. ([styles:28](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/features/chat-pane/styles.ts:28))
- **Item 4 is confirmed:** Codex’s union includes `default`, but model-specific validation replaces that union with `model.reasoning`. The shared picker currently displays the agent-wide list. Reuse these existing owners for one consistent projection. ([union:164](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/defs/codex.ts:164), [validation:39](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/models.ts:39), [picker:229](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/features/chat-pane/components/AgentRuntimePicker.tsx:229))
- **Item 8 is confirmed:** the component uses `.jini-chat-settings-*`; its presentation lives in Tovu. Jini’s reference stylesheet explicitly excludes visual styling, making a separate supported stylesheet the cleaner fit. ([component:68](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/components/ChatSettingsDialog.tsx:68), [Tovu CSS:1781](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/styles/assistant.css:1781), [reference contract:8](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/styles/reference.css:8))
- **UNVERIFIED:** actual refusal/success in these clones, installed Codex support for the named setting, and browser geometry. The request supplies live evidence; this session did not reproduce it. The architecture chapters were absent from the clone, so their named Tovu-checkout copies supplied guidance.

**3. Ordered plan**

Line estimates below separate production changes from tests; they exclude generated lockfile churn. Each bug starts with a failing behavioral test in the later cloud build.

1. **P0: add one explicit bridge approval option in Jini.**
   Files: daemon `agent-executor/contracts.ts`, `codex/home-staging.ts`, `codex/home-config.ts`.
   Add optional `toolApprovalOwner: 'host'` to `McpJsonInjectionOptions`; omission preserves existing behavior.
   Thread it through staging and emit `default_tools_approval_mode = "approve"` inside **only** `[mcp_servers.jini]`, for HTTP and stdio, before nested headers/env tables.
   Document that this delegates CLI permission prompting to the host’s authorization/confirmation path; it grants no target-tool permission.
   **Size:** approximately +35–55/−5–10 production lines; +100–150 test lines.
   **Tests:** extend `home-config.test.ts`, `home-http-staging.test.ts`, and launch integration fixtures: omitted versus opted-in, both transports, create/resume, unrelated MCP servers untouched, private-home cleanup, truthful executor annotations, read-only sandbox and all native capabilities still OFF.
   **Why no smaller:** a serializer-only patch cannot express trusted host intent or cover both delivery paths safely.

2. **Adopt P0 at Tovu’s two bridge compositions.**
   Files: site `agent-daemon-scope.ts:481` and desktop `desktop-agent.ts:253`; corresponding existing wiring/approval tests.
   Set the host-owned option there. Leave native grants, permission modes, approval classifications, credentials, and tool membership intact.
   **Size:** +2–6/−0 production lines; +70–110 test lines.
   **Tests:** exercise a confirmation-required site action through delegated execution: pending means zero effects; approve executes once; reject, expiry, cancellation, and missing channel execute zero times. Retain desktop’s destructive-tool exclusion.
   **Why no smaller:** site and desktop construct independent bridges; package-only tests cannot prove either host adopted the option.
   **Required invariant:** the CLI’s bridge approval never substitutes for a person’s approval card.

3. **Item 1: restore reported-duration precedence.**
   Files: chat `core/turn-usage.ts`, existing `turn-usage.test.ts`.
   Add the missing-duration guard; correct the comments describing precedence.
   **Size:** +2–4/−3–5 production lines; +25–45/−5–10 test lines.
   **Tests:** reported zero and positive durations survive conflicting timestamps; timestamps fill only absent duration; retain invalid-timestamp and multi-reply cases; cover serialized/restored messages.
   Replace the contradictory timestamp-wins expectation explicitly as the requested behavior change.
   **Why no smaller:** publication alone would ship the clone’s current regression.

4. **Item 2: make callback presence define conversation actions.**
   Files: `ConversationList.tsx` and its existing component tests.
   Make `onDelete`/`onRename` optional; omit unsupported buttons, rename tooltip, double-click editor entry, and associated handler invocation. Preserve search/new/select and existing confirmation behavior.
   **Size:** +15–25/−8–15 production lines; +60–90 test lines.
   **Tests:** neither callback, either independently, both; keyboard interaction and double-click without rename support.
   **Why no smaller:** optional types alone would leave misleading controls and callable undefined handlers. No separate capability object is needed.

5. **Item 3: constrain the pane’s grid column.**
   File: chat-pane `styles.ts:29`; add a regression to the existing browser test setup.
   Add `grid-template-columns: minmax(0, 1fr)`.
   **Size:** +1/−0 production line; approximately +20–35 test lines.
   **Test:** a 379px dock with a long unbroken host header keeps header/composer tracks within the dock; verify computed geometry in a browser.
   **Why no smaller:** this is already a one-declaration fix; clipping alone hides the overflow without sizing the track.

6. **Item 4: publish one model-effort projection.**
   Files: agent-runtime `models.ts` and tests; chat-pane `types.ts`, `rules.ts`, `AgentRuntimePicker.tsx` and existing tests.
   Add a pure two-object helper that combines the registry’s advertised `default` with the selected model’s levels, deduplicated; use registry levels when model levels are absent.
   Reuse it for validation and shared picker selection/rendering. Carry optional model-level reasoning through the existing picker type.
   Preserve suffix-based runtimes and Codex’s existing omission of an effort flag for `default`.
   **Size:** +45–70/−10–20 production lines; +70–110 test lines.
   **Tests:** default survives projection and selection; no duplicate default; no invented default where none is advertised; model narrowing, absent versus empty levels, suffix runtimes, unsupported explicit effort refusal.
   **Why no smaller:** correcting display alone leaves validation rejecting the same selection.

7. **Item 8: publish the existing settings presentation.**
   Files: new chat `react/styles/chat-settings.css`, chat `package.json` export/browser metadata/build copy, Tovu `assistant.css` and `AssistantDock.tsx`.
   Extract component-scoped rules into token-based Jini CSS; replace Tovu-specific values with neutral tokens/fallbacks. Tovu imports it and retains only its token bindings.
   Reuse the component’s existing native-dialog focus lifecycle, tabs, radios, switches, and tooltips.
   **Size:** +135–175/−120–140 production lines across both repos; +35–60 test lines.
   **Tests:** packed stylesheet resolves; standalone dialog has styled border/fieldset, bounded scrolling, visible focus, and usable narrow-screen layout; rerun existing focus-return tests.
   **Why no smaller:** structural reference CSS cannot supply the missing presentation; retaining two full stylesheets would duplicate ownership.

8. **Validate and prepare one compatible release set.**
   Files: affected Jini package versions/changelogs; Tovu root/admin/desktop/site-chat manifests where applicable and root lockfile.
   In cloud, record the baseline, then run affected tests/builds and consume packed daemon/agent-runtime/chat packages together in Tovu.
   Verify the installed Codex recognizes the bridge setting; perform a restricted real-run smoke proving an approval-required action reaches its card and cannot execute before confirmation.
   **Size:** roughly +10–25/−10–25 metadata lines, plus generated lockfile changes; reuse existing smoke fixtures.
   **Why no smaller:** Tovu currently locks older published packages; source-local green does not establish consumer adoption. ([lockfile:2796](/Users/la/Programming/tovu-integration-clones/prov2-tovu/package-lock.json:2796), [chat:2872](/Users/la/Programming/tovu-integration-clones/prov2-tovu/package-lock.json:2872))
   Publication and OM manifest/lockfile adoption remain a separate authorized release action.

All generic behavior stays in Jini; Tovu supplies wiring and theme tokens. New exported functions use `(requiredObj, optionalObj)`. Keep complexity ≤9 in desktop and ≤10 elsewhere. No database schema change or new platform module is needed.

**4. Added read/write/poll cost**

| Change | Frequency × payload |
|---|---|
| Bridge setting | Existing config write once per launched run × **40 additional UTF-8 bytes**; zero extra filesystem operations |
| Host option/wiring | Once per launch × one small in-memory enum; zero database reads |
| Newly reachable execution | Per attempted tool call × existing input/result payload; uses the existing bridge callback, without an extra approval-probe request |
| Required host card | Per confirmation-required call × existing card bytes plus answer bytes; sizes depend on the action, unchanged by this plan |
| Duration/list/effort fixes | Per existing projection/render × existing in-memory data; zero additional network or persistence operations |
| Settings CSS | Per uncached page load × approximately **4–7 KiB raw CSS**; normally bundled/cached; replaces Tovu’s duplicated rules |
| Polling/background work | **0 added polls, timers, discovery sweeps, or refresh loops** |

Actual tool/card payload sizes are **UNVERIFIED**; retain existing bounds and measure representative cloud fixtures rather than inventing a fixed average.

**5. Exclusions and CUT-CANDIDATES**

- **Item 5 — later.** Discovery already caches probes and refreshes expired catalogs; its public batch API lacks selected-agent/cancellation controls. Extend that owner later if measured send latency warrants it. ([cache:412](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/detection.ts:412), [API:495](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/detection.ts:495))
- **Item 6 — later.** Reuse existing `imageContents`, `imagePaths`, and `readOnlyExtraDirs` when OM has trusted host adapters. No staging service, OS-picker lifecycle, or inert folder control now. ([delivery contract:191](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/agent-executor/contracts.ts:191))
- **Item 7 — later, separately scoped.** Keep required-HTTP policy, parser bounds, exact-selection/clamping cleanup, and Antigravity registration out of this change. Existing exact-selection validation should be reused; HTTP fallback still exists. ([validation:49](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/models.ts:49), [fallback:71](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/agent-executor/http-mcp.ts:71))
- **CUT-CANDIDATES:** new approval infrastructure, compatibility-probe framework, conversation capability object, additional elapsed-time metric, settings redesign, broad CSS cleanup.
- No global MCP approval, native capability expansion, false read-only annotations, raw argv escape hatch, user-config edits, manual user repair, schema migration, or runtime substitution.

**6. Effort and dependencies**

Approximately **15–24 hours of Codex work**: P0 and host proof 5–8; duration/list/grid 3–4; effort projection 2–4; settings extraction 3–5; package integration 2–3.

Step 2 depends on step 1. Steps 3–7 are independent. Step 8 depends on all included fixes. OM benefits only after a released package set and its authorized dependency update.

**7. Owner questions**

- **May the later delivery publish the tested packages and update Open Marketing’s dependencies?** Recommendation: approve that as one release follow-up after cloud verification; leave publication outside this read-only planning task.
- **Duration meaning:** recommend adopting the request’s reported-duration precedence, accepting that Tovu’s displayed number may exclude CLI startup wait. Any separate “time from Send to finish” display stays parked.