Software Architect(Direct): Goal: fix the remaining chat, recovery and server bugs with small, independently buildable changes.

Read-only inspection completed against both `merge-1029` clones. No files changed; no tests, builds, servers or localhost requests ran. “Fixed in code” below does not establish what the installed desktop contains.

**1. Findings**

Paths below belong to the Tovu clone unless marked **Jini**.

1. **Item 17 — activation 503 trigger: UNVERIFIED.** The current activation route probes `/api/active`; readiness failure and upstream refusal are separate 503 paths. See [assistant.ts:201](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/modules/assistant.ts:201) and [assistant-daemon-client.ts:348](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/modules/assistant-daemon-client.ts:348).
   The explicit idle-parking race already has one bounded retry in [daemon-demand-fetch.ts:9](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/lifecycle/daemon-demand-fetch.ts:9). Do not add retries for arbitrary 503s.
   **Evidence needed:** one failed response’s `code`, `reasonCode`, redacted `detail`, timestamp, site/boot identity, and matching readiness/daemon log. That distinguishes startup refusal, missing credentials, closed scope and parking. Nine failures alone cannot identify the trigger.

2. **11-04 interrupted recovery — specific trigger: UNVERIFIED; diagnostic defect remains.** Later code already reconstructs when the session is unconfirmed or lacks a child identity: **Jini** [recover.ts:146](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/server/durable-runs/recover.ts:146). Missing `child_pid` therefore does not itself prevent continuation.
   However, the startup catch still replaces its exception with “could not start this execution attempt” at [agent-daemon-scope.ts:1007](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/assistant/agent-daemon-scope.ts:1007); **Jini** [recover.ts:152](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/server/durable-runs/recover.ts:152) also discards launch rejection details.
   **Evidence needed:** the three attempt IDs, their startup exceptions and launch responses, selected CLI, preparation stage, and a fresh-message outcome on the same site. Existing session fixes do not prove this incident resolved.

3. **Privacy export title — fixed in current code.** [static-download-landing.ts:13](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/site-backup/static-download-landing.ts:13) strips comments before extracting `<title>`. The regression fixture and assertion already exist at [static-copy.unit.test.ts:653](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/site-backup/__tests__/static-copy.unit.test.ts:653). No additional parser change is warranted.

4. **Item 25 — open provider session revocation gap confirmed.** [provider-config-source.ts:158](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/provider-config-source.ts:158) checks grants around fresh reads. Existing clients retain their resolved credentials.
   [provider-plugins.ts:326](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/provider-plugins.ts:326) replaces clients on reapply; [provider-revision-watch.ts:26](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/provider-revision-watch.ts:26) reconciles other processes every 30 seconds. Neither guarantees authorization at the next outbound send.
   Reuse checked: uncached grant lookup, local reapply, lease retirement, SDK transport seams. Disposal can flush queued data, so retirement alone is insufficient.

5. **Item 16 — message defect confirmed.** **Jini** [native-tool-policy.ts:83](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/native-tool-policy.ts:83) names “assistant settings” and hardcodes Claude/Codex. [AgentRuntimePicker.tsx:65](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/features/chat-pane/components/AgentRuntimePicker.tsx:65) renders the paragraph beside picker controls. Existing `InfoTip` presentation is available immediately above it.

6. **Item 20 — two confirmed stale assumptions; original boot timeouts remain UNVERIFIED.**
   - Plugin-directory test passes `env` in the wrong argument: [site-plugin-directories.test.mjs:28](/Users/la/Programming/tovu-integration-clones/prov2-tovu/development/scripts/__tests__/site-plugin-directories.test.mjs:28). The implementation accepts it in the second object: [layout.ts:55](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/layout.ts:55). Fix the fixture.
   - The daemon-token test waits for automatic boot at [serve-command.integration.test.ts:753](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/cli/__tests__/integration/serve-command.integration.test.ts:753), but registration is now cold: [daemon-supervisor.ts:672](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/lifecycle/daemon-supervisor.ts:672). This is an additional deterministic failure after HTTP readiness—not proof of what caused the recorded boot timeout.
   - Memory-script handling is only partially updated: [measure-site-memory.mjs:122](/Users/la/Programming/tovu-integration-clones/prov2-tovu/development/scripts/measure-site-memory.mjs:122) still defaults to running without explicit idle settings. Its synthetic chat uses a fake daemon at line 529 and never demands a real child.
   - **Evidence needed for all three recorded boot timeouts:** quiet cloud rerun, immediate bounded stdout/stderr capture, child exit state and readiness timing. Retain existing load scaling; do not inflate deadlines speculatively.

7. **Item 23 — most named immediate wins already exist.**
   Desktop servers use the flag at [tovu-server.ts:254](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/tovu-server.ts:254); shared daemons at [desktop-agent-service.ts:105](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-agent-service.ts:105). **The locally supervised/fallback daemon still omits it:** [daemon-supervisor.ts:434](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/lifecycle/daemon-supervisor.ts:434).
   Size-based 1/3/10-second checkpoints and guarded deltas already exist: **Jini** [checkpoint-interval.ts:7](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/core/checkpoint-interval.ts:7), [run-ledger.ts:158](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/store/runtime/run-ledger.ts:158).
   **Remaining:** SQL still reconstructs/replaces the full JSON column ([events-json.ts:10](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/store/runtime/events-json.ts:10)); fallback still reads/parses/serializes it. Connection-wide SQLite invalidation can reduce delta hits ([read-version.ts:19](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/store/sql/read-version.ts:19)). Images remain inline base64 ([tool-result-media.ts:43](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/tool-result-media.ts:43)).
   Recommendation: close the missing flag path, then measure current code before changing storage.

8. **11-04 site-card memory — later fix present; incident closure UNVERIFIED.** Current code invalidates the resource cache on site/PID changes at [desktop-resources.ts:208](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-resources.ts:208), and the renderer requests readings on lifecycle changes at [ResourcesPanel.tsx:131](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/renderer/ResourcesPanel.tsx:131). Start/restart regressions already exist at [desktop-resources.test.ts:622](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/desktop-resources.test.ts:622).
   No new patch now. If reproduced, capture snapshot `siteId`, root PID, card ID and sampler membership; the total can work while one root is absent.

**2. Ordered implementation plan and independent jobs**

Every implementation starts with a failing regression. New public contracts use `(requiredObj, optionalObj)`; complexity ceilings remain desktop ≤9, elsewhere ≤10.

| Order / job | Files owned; smallest change | Rough source delta; tests |
|---|---|---|
| **A — daemon/chat** | `assistant-daemon-client.ts`, `assistant.ts`, `agent-daemon-scope.ts`, `daemon-supervisor.ts`; Jini `daemon/session-coordination.ts`, `chat/server/durable-runs/recover.ts`. Preserve bounded, redacted startup stage/cause through existing failure events and recovery notices. Keep uncertain launches probe-first. Add the missing fallback-daemon flag before the script path. Apply trigger-specific fixes only after evidence identifies them. | **+60–120 / −15–30**, plus conditional trigger fix. Tests: pre-spawn rejection survives reload; unconfirmed session reconstructs; uncertain launch cannot duplicate execution; fallback argv has one flag. Reuse activation parking tests. |
| **B — shared-key revocation** | Tovu `provider-config-source.ts`, `provider-plugins.ts`; Jini `plugins/host/provider-config-source.ts` and affected `provider-plugins` transport adapters. Carry the resolved credential’s provenance into an injected authorization callback. Check the current grant at every actual outbound send, including batches/retries/shutdown flushes. Denial retires that client and reports a specific shared-key status. | **+180–320 / −20–40**. Tests: open client → revoke in another store handle → next send blocked; queued flush blocked; regrant works; independent site key unaffected; store-read failure denies shared sends. No schema change. |
| **C — OpenCode message** | Jini `agent-runtime/native-tool-policy.ts`, `chat/react/.../AgentRuntimePicker.tsx` and their tests. Correct navigation text; replace the paragraph with existing accessible `InfoTip` presentation. | **+15–30 / −5–15**. Test exact navigation, keyboard/touch disclosure and absence of a toolbar paragraph. Suggested copy: “OpenCode needs ‘Your MCP servers’ on. Open gear → More settings → Agent permissions, or choose an available agent that supports these limits.” |
| **D — test/profiler repair** | `serve-command.integration.test.ts`, `site-plugin-directories.test.mjs`, `measure-site-memory.mjs` and its tests. Fix the argument placement. Authenticate and demand daemon readiness before the 401 assertion, reusing `loginAsOwner`. Default cold/synthetic measurements to absent/parked; retain explicit running-state assertions. | **+30–60 / −15–30**. Tests: inherited environment cannot affect explicit layout fixture; cold daemon absent until demand; profiler defaults reflect actual launch behavior. |
| **E — verification only** | Existing Privacy, resources and memory checks. Quiet cloud execution after D; current packaged two-site recovery/card journey after integration. Profile delta/fallback rate and latency alongside memory. | **0 source lines** initially. Reuse existing regressions and deterministic chat workload; add a regression only when new evidence exposes an uncovered failure. |

A–D have separate file ownership and can run concurrently. One integration job alone owns package-version/lockfile updates after required Jini releases.

**3. Cost**

- **A:** no new poll. At most one additional redacted diagnostic per failed attempt/activation, capped at **2 KiB**: nine activation failures ≈ **18 KiB/session**; three recovery failures ≤ **6 KiB**. Flag change adds no I/O.
- **B:** **one indexed grant lookup × each shared-credential outbound request/batch/retry**; scalar result, conservatively budget **≤128 bytes** excluding driver overhead. At 10 sends/s: ≤**1.28 KiB/s** returned metadata. No secret reread/decrypt, inventory scan or new timer. Revocation retains the existing single grant deletion.
- **C:** zero added reads, writes or polls.
- **D:** runtime product cost unchanged. The integration test adds one login and activation sequence per test; activation’s existing probe returns a small response. Profiler default correction adds no request.
- **E:** no additional product polling. Use existing measurement cadence and retain compact summaries.
- **Memory arithmetic:** historical 30 MB checkpoints every 1–5 seconds meant **6–30 MB/s** of logical projection writes; the reported ~5× allocation factor implies **30–150 MB/s** of temporary allocation.
- At the current ≥5 MB cadence, a 30 MB projection rewritten every 10 seconds is still **3 MB/s logical column data per run**, or **9 MB/s for three runs**. Delta success avoids transferring/parsing the saved prefix in JS; it does not make database work proportional to the suffix. Actual WAL/page traffic needs measurement.
- Historical flag savings of ~200 MB/chatting server imply **~600 MB across three servers**. Those savings are already partly implemented; do not count them again as a new release gain.

**4. What this plan will NOT do / CUT-CANDIDATES**

No shared-server redesign, new credential package, shared OAuth, global disconnect, blanket retries, increased recovery budget or automatic permission changes.

**CUT-CANDIDATE:** append-only chat schema. Measure current fallback/write cost first; any necessary schema change requires ADR-066 TypeScript migrations.

**CUT-CANDIDATE:** image externalization and lazy older-message events. Valid next candidates, but separate work. Existing upload attachments expire/are cleaned after runs, so they cannot simply become durable transcript image references.

**5. Effort and dependencies**

Approximately **23–37 Codex hours**: A 6–10, B 10–16, C 2–3, D 3–5, E 2–3. Unknown activation/recovery trigger fixes may add **2–8 hours** once evidence exists.

D precedes trustworthy profiler/integration results. Jini changes precede consumer dependency updates. Final packaged verification follows integration; cloud queue/build elapsed time is additional.

**6. Owner questions**

None required. Recommendation: proceed with A–D, verify existing Privacy/resource fixes, and keep larger memory changes parked until current-build measurements justify them.