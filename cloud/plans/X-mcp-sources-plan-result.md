Software Architect(Direct): **Personal config files: recommend YES, after explicit Allow, only when no temporary configuration works.** Tovu should add one credential-free connector, preserve other entries, back up the original, and update only an entry it owns. The card must explain that this changes the agent’s settings outside Tovu too. If the user declines, offer another installed agent; otherwise that CLI cannot receive the site’s tools.

**Turning a tool off mid-answer: recommend YES, stop affected answers immediately.** Revoke bridge access first, cancel their pending cards and processes, then await cleanup. Keep the partial answer, labelled “Stopped because tool access changed.” Letting the answer finish is smoother, but leaves previously granted access active. Stopping cannot undo an action already completed or make the agent forget information it already read.

**1. Goal**

Allow Tovu tools, Jini tools, enabled agentic-plugin tools and all other host-injected tools; exclude the agent’s personal/project MCP list by default, admitting it only through an owner card.

**2. Findings**

Read both `merge-1029` working trees, including current uncommitted source. No files edited, tests run, servers started or localhost requests made. Graph tools were unavailable; evidence below comes from bounded source reads. The clone lacks architecture chapters 13/14; I consulted their canonical `/Users/la/Programming/Tovu` copies.

**The shared delivery path exists; “Tovu only” describes it incorrectly.**

| Tool group | Current path and gates |
|---|---|
| Tovu operations and registered Jini-backed operations | Domain contributors → `buildAssistantToolRegistrations` → website registry/executor. Registration does not bypass authorization or action approvals. [tool-registrations.ts:420](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/tool-registrations.ts:420), [byok-tool-surface.ts:635](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/byok-tool-surface.ts:635) |
| Jini’s MCP-local tools and gateways | `assembleRunToolHost` adds run/catalog/component gateways, delegated execution and waiting. This exposes registered operations; it does not expose every Jini package automatically. [run-tool-host.ts:58](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/mcp/src/server/run-tool-host.ts:58) |
| Installed agentic plugins and plugin contributors | Installed registrar adds plugin guidance, skills, executable contributions and enabled capabilities. Activation/trust, permissions and the existing approval policy remain enforced. [installed-extension-tools.ts:47](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/installed-extension-tools.ts:47), [register.ts:107](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/executable-tools/register.ts:107) |
| Plugin-provisioned external MCP and other injected servers | Federation attaches admitted tools to that registry. Gates include enabled source/plugin, authentication, allowed tools, write grants, schema/admission checks and protected-action confirmation. [external-mcp-federation-runtime.ts:139](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/external-mcp-federation-runtime.ts:139), [registrations.ts:291](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/mcp/src/federation/registrations.ts:291) |

Today the daemon fetches site-tool descriptions from the website and routes execution back to its executor. Its local frontend tools join that catalog. `mcp-injection.ts` supplies the run-authenticated HTTP bridge, with stdio fallback. **None of these host tool groups needs `userMcp=true`.** [agent-daemon-site-tools.ts:74](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/assistant/agent-daemon-site-tools.ts:74), [agent-daemon-scope.ts:409](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/assistant/agent-daemon-scope.ts:409), [mcp-injection.ts:77](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/mcp-injection.ts:77)

**Which CLIs receive those groups:** all four groups share the following transport availability; individual tools still need their normal gates.

| CLI group | Delivery present in code | Default-launch limitation |
|---|---|---|
| Claude | Explicit MCP configuration; HTTP preferred, stdio fallback | Personal MCP OFF requests strict configuration. |
| Codex | Run-scoped `CODEX_HOME`; HTTP or stdio connector | Personal sources disabled; isolation errors still refuse the run. |
| CodeBuddy | Claude-compatible MCP configuration | Native-policy gate still refuses with OFF capabilities. |
| AMR, Devin, Hermes, Trae, Kimi, Kiro, Kilo, Vibe, Reasonix, Cline, Goose, Auggie | ACP `mcpServers` injection | Same native-policy refusal. |
| OpenCode, MiMo | Environment-content injection | Same native-policy refusal. |
| Antigravity | Environment-passthrough connector | **Forces all capabilities ON, including personal MCP.** |
| Amp, DeepSeek, Droid, Crush, Cursor, Qwen, Grok Build, Qoder, aider, pi | No host bridge declared | Cannot receive these host tools through today’s adapter. |

Evidence: the current registry has **28 agents**, with Gemini CLI retired and no Copilot entry; delivery dispatch handles the declared strategies. Presence in source is **not live verification**. [registry.ts:52](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/registry.ts:52), [mcp-bridge.ts:290](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/agent-executor/mcp-bridge.ts:290)

Remaining gaps:

- **Antigravity violates the new default:** `fullCliAccessOnly` overrides the host-filtered capabilities. Replace that silent grant with prelaunch consent. Other unsupported CLIs still need refusals converted to actionable cards. [native-tool-policy.ts:71](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-runtime/src/native-tool-policy.ts:71), [launch.ts:1061](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/agent-executor/launch.ts:1061)
- **Personal-config repair already exists**, before consent, in Tovu. It can overwrite the named connector and lacks the proposed ownership/lock/backup protections. Move and harden this owner in Jini; do not add another installer. [ensure-json-agent-install.ts:82](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/assistant/ensure-json-agent-install.ts:82)
- `byAgent`, the planner/isolation metadata and run-bound settings tool remain absent. The permissions parser discards additional fields; the owner-grant write still omits revision comparison. [subagent-settings.ts:33](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/subagent-settings.ts:33), [assistant-owner-grant.ts:57](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/system/assistant-owner-grant.ts:57)
- **The re-check’s terminal-cancellation gap is partly fixed:** delegated calls now abort on terminal completion. Reuse that watcher; retain a final live-run check before a new permission card commits. [delegated-tool-bridge.ts:116](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/delegated-tool-bridge.ts:116)
- CLI discovery is a launch snapshot. Newly admitted tools can remain absent from an already running CLI’s search until its next launch; execution still uses current server gates. [agent-daemon-site-tools.ts:80](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/assistant/agent-daemon-site-tools.ts:80)
- **UNVERIFIED:** live isolation, sibling environment exposure and new vendor delivery claims. The old Codex scanner location is stale: current home parsing/staging is split into `codex/*`, and explicitly leaves organization-managed layers outside its guarantee. [home-staging.ts:100](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/agent-executor/codex/home-staging.ts:100)

**11-04 work to keep:** fresh enable consent, one enable card disclosing sources/tools/writes, OFF-plugin catalog-only visibility, activation checks and frozen-schema grant refresh are present. Do not rebuild items 1/24/26. [tool-registrations.ts:913](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/plugin-runtime/tool-registrations.ts:913), [enable-access.ts:67](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/enable-access.ts:67), [reload.ts:134](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/mcp/src/federation/reload.ts:134)

**3. Ordered implementation plan**

Line estimates are production code, excluding tests.

1. **W1 remains: planner and launch enforcement.** In Jini `agent-runtime/src/{types,native-tool-policy}.ts` and a small planner module, return RUN/ASK/SETUP; call it from daemon `agent-executor/launch.ts` before HTTP preparation, credentials or persistent repair. Remove Antigravity’s implicit personal-MCP grant. Reuse Codex parsing/staging through a dry preflight; do not recreate the obsolete scanner. Unknown isolation stays conservative; only confirmed missing authentication blocks. Preserve host restrictions and filesystem boundaries. **+150–210 / −35–65 lines.** Tests: all current definitions, host locks, auth unknown, Antigravity default, zero spawn/token/write before consent.

2. **W2 remains: per-agent consent and truthful visibility.** Extend Tovu `assistant-subagents-policy.ts`, `subagent-settings.ts`, `assistant-subagents.ts`, `assistant-owner-grant.ts`, `agent-daemon-scope.ts` and admin `AdminSubagents.tsx`. Patch only the selected entry in the **raw** permissions blob; preserve siblings. Reuse the existing card/exchange and settings writer, passing `expectedRevisionSeq`; stale state opens a fresh card. Bind the originating run server-side and recheck owner/host/live-run status before commit. Add small redacted run facts for guidance and argument-free `chat_settings_get`. **+180–260 / −25–50.** Tests: stale/replayed/cancelled/cross-site clicks, raw-field preservation, host locks and secret redaction.

3. **W2 lowering remains separate from ordinary reload.** Wire successful permission reductions and source/plugin OFF changes to the affected live runs; reuse daemon credentials, cancellation, terminal watchers and cleanup reporting. Revoke → cancel cards/process trees → await cleanup → acknowledge. Keep partial text. The existing roster notifier swallows failures, so it cannot alone certify “stopped”; use an awaited authenticated control call and report failed cleanup explicitly. **+80–130 / −0–20.** Tests: ordering, concurrent launches, source-specific targeting, cleanup failure, unrelated runs continue.

4. **W3 remains small.** Add the selected-agent settings write tool through existing contributors: lowering applies directly; raising invokes the same W2 card. Keep generic Full CLI write fences. Explain that the choice affects this agent’s other chats on the site. **+60–90 / −0.** Tests: selected-entry scope, concurrent revision conflict and raise/lower classification.

5. **W4 is partly redundant and should shrink.** Move Tovu’s automatic JSON repair into Jini’s existing `mcp/agent-install` owner; extend `applyJsonInstall` with ownership checking and reuse platform locking/atomic writes plus the existing backup helper. Cover both Antigravity connector registration and its permission-file update, after Allow; persist no run credentials. Tovu retains only composition. **+90–140 / −90–120.** Tests: foreign entry preserved, concurrent repair, symlink, backup, idempotence and credential-free output. Other vendor bridges remain explicitly deferred below.

6. **Update validation rather than recreate it.** Rewrite `every-cli-default-settings.contract.test.ts`, which currently accepts refusals, and extend existing consent/plugin/federation suites. **L1:** personal home, project and native-plugin canaries excluded while host tools work. **L2:** Antigravity sibling-token exposure. **L3, Claude/Codex/Antigravity:** invoke a Tovu operation, Jini gateway, enabled plugin tool and separately injected MCP tool; prove personal-MCP OFF does not block them, source OFF does, and protected actions retain their cards. Exercise HTTP and stdio fallback. All execution is future work.

Replace **“Tovu only”** with **“Tools provided here”**: “Tovu and Jini tools, enabled plugin tools, and connected servers.” The separate option is **“Also use {Agent}’s personal MCP servers.”**

**4. Added I/O cost**

`B` = permissions blob bytes; `C` = CLI config bytes; `P` = permission-file bytes; `A` = affected live runs. Sizes below are proposed bounds or formulas, not measurements.

| Addition | Frequency × payload |
|---|---|
| Planner | Zero I/O; fixed capability checks per launch. |
| Codex preflight | At most 1 extra config read × `C` per Codex launch; reuse parsed validation, retain spawn-time backstop. |
| Permission card/patch | 1 raw blob/revision read at preview + 1 at approval; 1 blob write × `B` plus existing ledger revision. Direct lowering needs one read/write cycle. |
| Run facts | 1 bounded block per launch; 1 response per explicit settings query, target ≤16 KiB with explicit truncation. No secret/config reads. |
| Immediate lowering | 1 authenticated change command ≤1 KiB per change; up to `A` cancellation/cleanup results ≤1 KiB each. In-memory run selection; no polling. |
| Owned config repair | Existing verification reads retained; under repair lock, 1 fresh read × `C`, 1 replacement write × `C`, first-backup copy × `C`, fixed lock/rename metadata. Antigravity permission repair has corresponding `P` costs only when changed. |
| Federation | No added remote listing, handshake or polling for existing connected-source grant refresh. |
| L3 fixtures | Minimum 3 CLIs × 4 tool-group calls; bound each canary request/result to 2 KiB, plus existing protocol envelopes. |

**5. What this will not do; CUT-CANDIDATES**

- No new approval store, schema, migration, federation runtime, filesystem framework or vendor code in core.
- No host-tool allowlist based on the name “Tovu”; no automatic permission escalation.
- **CUT-CANDIDATE:** new Amp/DeepSeek config-path delivery and Droid/Crush/Cursor/Qwen owned entries. Keep W4 follow-ups parked until their actual headless delivery is verified.
- **CUT-CANDIDATE:** Copilot support—it is absent from today’s registry. Grok/Qoder bridges and aider/pi workarounds also remain later work.
- **CUT-CANDIDATE:** same-answer discovery refresh, full settings inspector, personal-server inventory and new notice protocol. Use current status events and disclose next-message availability.
- Generic additions stay in Jini with `(requiredObj, optionalObj)` ports; plugin packages remain `@jini-ai/agent-plugins/<subpath>`, without plugin-to-plugin imports. Complexity ceilings remain 9 desktop / 10 elsewhere. Setup failures warn or offer an alternative without preventing application boot.

**6. Effort and dependencies**

**20–30 hours of Codex work**, including failing regression tests first, implementation and focused validation: W1 4–6h; W2 consent/facts 5–7h; lowering 3–4h; W3 2–3h; W4 hardening 3–4h; final integration/live checks 3–6h.

W1 contracts precede W2; W2 precedes W3 and consent-gated W4. Lowering builds on W2’s run facts. Live checks follow matching Jini package/consumer integration. Optional vendor bridges add roughly **6–12h**, subject to probe results.

**7. Owner questions**

Only the two product choices at the start require owner acceptance: **allow the disclosed personal-config change**, and **stop affected answers when access is removed**. I recommend both. They remain recommendations in this read-only plan; neither is treated as authorization to implement.