# MCP sources design v2.1: every agent runs, Tovu-only by default

2026-10-27 · Opus (software-architect + security personas) · design only, no code · replaces `2026-10-27-mcp-sources-design.md` · next: owner → Opus builds.
Inputs: debate r1–r3 (Codex, Argon, Sonnet), Codex checks of v1 and v2 (`reports/2026-10-27-d0-check-mcp-design-v2/out/check-mcp-design-v2.md`), the five 8b lot handoffs (fed-security + presets, codex-isolation, gemini-chat, agy-install-path, all-clis-test).

## Summary (30 seconds)
1. **No agent is refused for a setting.** One pure Jini planner returns RUN, ASK, or SETUP for every agent. REFUSE is deleted (D1). A host lock (non-owner, hosted, env lock) gives an explanatory SETUP, never an Allow that can't work.
2. **Tovu only by default.** If an agent can't keep its own MCP list out, or can't honor a switch that's off (shell, file write, Full CLI), Tovu shows a card **before it starts** (D2, D3).
3. **One setting:** today's `{enabled, capabilities}` gets a per-agent override, `byAgent`. "Allow" on the card saves that agent's choice. The click itself works once.
4. **The chat edits only its own agent's entry.** Lowering applies directly. Any raise goes to the owner's card every time (D6). Mid-chat server adds say "whole site" (D7). Other namespaces keep the existing settings tools.
5. **4 waves, about 670 lines (estimate).** The agent can always read its own run's effective settings and why a card appeared, with no card and nothing secret (D9). Agents with no MCP run with their own tools and get one notice. Agents with MCP but no bridge get one through 2 generic strategies (D4, D5).

### v2.1 changes
- **Chat self-settings simplified (§1, W3):** the write touches only `byAgent[selected]`; raises go to the existing owner card, which recomputes and compares on click. No cross-agent raise check, no new CAS through set/clear, no cost rule, no deny removal. W3 ~180 → ~70. Codex's patch kept as Option B.
- **Host locks before planning (§2):** non-owner / hosted / env-locked runs stay all-off; the planner returns SETUP(`host_locked`) instead of an Allow.
- **D9 corrected (§1b):** raw read needs `settings.read.raw`; non-owner launches use all-off. Facts come from the host-filtered launch snapshot; `chat_settings_get` is bound to its run.
- **Auth tri-state (§2):** only `missing` gives SETUP; `unknown`/no probe runs.
- **Codex isolation errors planned before consent (§2):** a def preflight turns them into ASK.
- **agy installer claim fixed (§4):** extend Jini's installer owner with ownership check + the shared lock/backup/atomic primitives; nothing run-specific persisted.
- **W4 table (§4):** Amp → `config-path` (`--mcp-config`); Qwen → `owned-user-entry`, delivery unverified.
- **Stdio save-form copy (§3)** and **lowering contract (§1)** made precise; test 8 fixed.
- **Token disclosure** stays conservative for every inherited-env strategy until L2 says otherwise.

## 1. The rule
- **Setting (Tovu, `core.assistant-full-cli`/`permissions`):** `{enabled, capabilities, byAgent?: {[agentId]: Partial<{enabled, capabilities}>}}`. The effective value is `site ⊕ byAgent[agent]`, read through the existing resolver, **after** the structural host gate (`resolveAssistantCliPermissions`): non-owner, hosted and env-locked runs are all-off whatever is stored. No migration: a site-wide `userMcp:true` already means "own list for all", and `byAgent` starts empty. One per-agent value, generalized to every switch, so native-switch refusals use the **same** card and storage.
- **Def field (Jini):** `mcpIsolation: {perRun: '<cli-version>@<date>'} | 'none' | 'no-client'`. Missing or unknown means `'none'`. `perRun` needs a live-probe stamp. Claude `perRun` once L1 passes. Codex `perRun` only after L1 passes on the codex-isolation lot; until then it shows the card but still runs. CodeBuddy and the rest: `'none'`. aider, pi: `'no-client'`.
- **Card first, never notice-after.** ASK and SETUP spawn nothing and mint no token.
- **Token rule (every inherited-env strategy, agy first):** the run token reaches only processes the user consented to: env-inherited delivery happens only when the planner says `loadsOwn`, which needs Allow. Existing bounds stay (per run, revoked at end, route-allowlisted). **Until L2 proves otherwise, every inherited-env card carries the token line** (sibling exposure is unprobed).
- **Project config counts.** "Own list" means the agent's config **or this project's** (`.mcp.json`, `.codex/`, `crush.json` …). The copy says so. Site chats run in the site dir, which Tovu controls.
- **Chat self-settings (D6, simplified):**
  - The chat's write tool takes `{key, value}` and changes **only** `byAgent[selected]`. It never writes site defaults, another agent's entry, or a whole blob. The server merges that one entry into the freshly read blob and writes through the existing `set` with the existing addressed-layer `expectedRevisionSeq` (already supported; no new plumbing).
  - Available on owner runs only; non-owner runs are all-off, so there is nothing to lower or raise.
  - `raise ⇔` the selected agent's effective value, after the change, turns any switch on (including `userMcp`), or the key is unknown. Otherwise it is a lowering and applies directly.
  - A raise posts the existing owner card showing effective before/after. On click, the existing owner-grant route checks (owner principal, `canEdit`/hosted, `settings.*.write` authorize) run, then the server recomputes the effective values fresh. It writes only if they still equal what the card showed; otherwise the card says "This changed since I asked" and re-asks. Planner ASK cards use the same click path.
  - Unchanged: `extraDeniedSettings` (Full CLI) and the HTTP `touchesAssistantSubagents` fence still block generic writes to this blob; model/effort keep `alwaysAsk`.
  - Saved vs v2 W3: no effective-authority comparison across agents, no dependency CAS, no cost rule, no owner-writer extraction, no deny removal (~110 lines).
- **Option B (not chosen):** Codex's patch keeps whole-blob chat writes: pass `expectedRevisionSeq` through both `set` and `clear`; bind and atomically revalidate every dependency used to classify (site layer, user layer, every `byAgent` entry, definition revision); compute the raise for **every** agent the write affects; cost tier in the rule. Roughly **+130 lines** on W3 (~200 total) and a mandatory security review. Flip if the owner wants the chat to edit site defaults.
- **Lowering contract (chat write, Settings, or source off mid-chat):** for the affected agent's live runs: (1) revoke their bridge credentials first; (2) cancel each run and its pending cards through the existing Stop path (process-tree termination); (3) await the existing cleanup; (4) report any cleanup failure in the notice, never "done" on failure. Next message: `perRun` agents spawn with `loadsOwn=false`; `'none'` agents get ASK again (no spawn). *Immediate stop = Q2, pending owner.*
- **Builds on, not redone:** may-write enforcement and presets, escalate-only host confirmation, the post-approval recheck (fed-security), Codex layer staging (codex-isolation), the agy path constant (agy-install-path).

## 1b. The agent can always see its own chat settings (D9)
- **Checked:** the blob is **not blocked** for reads. `extraDeniedSettings` and `touchesAssistantSubagents` gate writes only. `settings_get_effective` needs `settings.read`; `settings_get_raw` needs `settings.read.raw`. Both are card-free.
- **But they mislead.** `permissions` is user-scoped and defaults to `{}`; the run values come from code (`readAssistantCliPermissions` legacy fallback, `assistantCliPermissions` fills `userMcp:false`). Non-owner launches skip the settings read and use **all-off**. Isolation, verdict and tool list aren't settings.
- **Fix: one run-bound facts object.**
  - Source: the launch snapshot after the host gate (`nativeCapabilities` in `launchAgentRun`) plus `planRun`'s `facts` (effective values per key with source site/`byAgent`/default/`host_locked`, `source: 'tovu' | 'tovu+own'`, `mcpIsolation`, verdict, card keys/reason). Stored on the run.
  - Run start: one block in the existing runtime guidance (`assistant-runtime-guidance.ts`). Cards render from the same object.
  - Tovu: read-only `chat_settings_get`, confirm class `none`, **no arguments**. It resolves its run from the authenticated bridge credential and rejects any caller-supplied site, principal or run. Returns explicit fields only: the facts, agent, model, effort, admitted Tovu tool ids, and federated server ids with **parsed hostname only** (stdio: "local command").
  - Redaction by construction: no env values, headers, tokens, args or URLs; personal servers never named (C2). "Loads its own list: yes" is all it says.
- Kept: `settings_get_effective` and `settings_get_raw` unchanged for every namespace.

## 2. Planner (Jini, pure, total)
```
planRun(def, eff, host):        // eff = host-gated resolve(site, byAgent[def.id]); host = precomputed readiness
  if !host.installed(def)            return SETUP('not_installed')       // detectAgents
  if host.auth(def) == 'missing'     return SETUP('not_signed_in')       // 'ok' | 'unknown' | none → continue
  need = []
  if !def.supportsNativeToolAccess:                                       // can't limit native tools
    if !eff.enabled                  need.push('enabled')
    for k in NATIVE_KEYS if !eff.caps[k]  need.push(k)
  iso = host.isolationBlocked(def) ? 'none' : (def.mcpIsolation ?? 'none')   // e.g. CodexMcpIsolationError
  loadsOwn = iso == 'no-client' ? false : isPerRun(iso) ? eff.caps.userMcp : true
  if loadsOwn && !eff.caps.userMcp   need.push('userMcp')
  if need.length && host.locked      return SETUP('host_locked', {reason: host.locked, keys: need})
  if need.length                     return ASK({keys: need, why: iso != def.mcpIsolation ? 'isolation_blocked' : null})
  bridged = runtimeSupportsExternalTools(def)
  return RUN({ loadsOwn, bridged, delivery: bridged ? deliveryFor(def) : null,
               notices: bridged ? [] : ['no_tovu_tools'] })
```
- `host.locked` is `'not_owner' | 'hosted' | <env key>` from the same `resolveFullCliAccess` snapshot the launch uses. Locked runs never save anything.
- `host.isolationBlocked` comes from an optional def preflight (`isolationPreflight`, Codex: the existing layer scan without staging). Spawn-time `CodexMcpIsolationError` stays as the backstop.
- `unknown`/no-probe auth runs; a real auth failure shows the existing inferred-auth message. No SETUP loop.
- Alternatives ("Use {Agent2}") are computed by the caller: installed, auth not `missing`, `planRun` is RUN. Shown on ASK and SETUP. "Allow" writes `byAgent[def.id][k] = true` for exactly `keys`.

## 3. Wording (terse)
- **Settings row "Tools for this chat":** ○ **Tovu only**: "Tovu's tools, plus servers you add here." (default) · ○ **Tovu + {Agent}'s own**: "Also loads MCP servers set up in {Agent} or this project. Tovu doesn't approve or log those." Each agent row shows "Uses: Tovu only / Tovu + its own" with a link to change it.
- **Card, MCP:** **{Agent} can't hide its own tools.** "It also loads the MCP servers set up in {Agent} or this project. Tovu doesn't approve or log them." · Inherited-env strategies (until L2 clears it): "Those servers can see this chat's run key while it runs." · `isolation_blocked`: "A managed config here can't be turned off."
- **Card, native:** **{Agent} can't turn off {Bash/shell, File edit}.** "It would run with them on. Only you can allow this."
- **Buttons:** **Allow for {Agent}** · **Use {Agent2}** (only qualified agents; hidden if none) · **Cancel**.
- **Setup:** "{Agent} isn't installed. Install it or pick another agent." / "{Agent} isn't signed in. Sign in once ({hint}), then send again." / `host_locked`: "{Agent} needs {keys} on, and {only the owner can turn them on | they're off on hosted sites | {env key} turns them off here}." No Allow button.
- **Notices (re-landed `run_notice`):** `no_tovu_tools`, once per chat: "{Agent} can't use Tovu's tools. It works with its own." · `source_lowered`: "Stopped {Agent}. Applies from your next message." · on cleanup failure: "Couldn't stop everything {Agent} started. Check running processes."
- **Raise card:** **Give the assistant more access?** "Turns on for {Agent}: {list}. Only you can approve." **Allow** / **Not now**. Stale click: "This changed since I asked." + fresh card.
- **Mid-chat add (existing cards), one line added:** "Saved for the whole site: every chat and agent can use it, with approvals."
- **Stdio save form:** before Save: "Saving lets chats start `{command}` on this computer as your OS user." · Allowed tools hint: "Comma-separated. The assistant can call only these tools."

## 4. Unbridged agents with MCP (D4): 2 generic strategies, data per def
- **`config-path`:** a run-scoped file passed by flag or env var (generalizes the `claude-mcp-json` writer). Preferred whenever the CLI has one; no personal write.
- **`owned-user-entry`** (Q1, *pending owner*): only after Allow and only where no config-path exists. Extends Jini's installer owner (`agent-install/install.ts`, whose merge today overwrites the named entry) with: an ownership check (absent, or deep-equal to what Jini would write; anything else → SETUP "A different `jini` entry exists"), foreign entries preserved, and the platform primitives `antigravity-permissions.ts` already uses (file lock, backup-once, atomic write with `refuseSymlink`) moved to one shared place, not copied. The entry is credential-free: no run token, run id or daemon credential; those arrive by inherited env per run.

| Agent | MCP client | Evidence | Plan |
|---|---|---|---|
| copilot | `--additional-mcp-config @file`, session-only, augments | **verified** [GitHub docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) | config-path (flag), `'none'` |
| amp | `--mcp-config`; also `amp.mcpServers` | Codex check cites [Amp docs](https://ampcode.com/docs/customize/mcp); def comment predates it; augment vs replace **unverified** | config-path (flag), `'none'` |
| deepseek | `DEEPSEEK_MCP_CONFIG=<path>` | **unverified** (def comment) | config-path (env), `'none'` |
| droid | `~/.factory/mcp.json` + project | **verified** [Factory docs](https://docs.factory.ai/cli/configuration/mcp) | owned-user-entry, `'none'` |
| crush | global + project `crush.json`, merged; `$(...)` runs at load | **verified** [Charm docs](https://mintlify.com/charmbracelet/crush/configuration/mcp) | owned-user-entry, `'none'` |
| cursor-agent | `~/.cursor/mcp.json`, `--approve-mcps`; headless approval buggy | **verified** [Cursor docs](https://cursor.com/docs/cli/mcp), forum | owned-user-entry + flag, `'none'` |
| qwen | `mcpServers` in `~/.qwen/settings.json`; no confirmed path flag (def `qwen.ts`) | settings file **verified** [Qwen docs](https://qwenlm.github.io/qwen-code-docs/en/developers/tools/mcp-server/); delivery **unverified** | owned-user-entry (settings key), `'none'`; `mcp.allowed` as isolation **unverified** |
| grok-build | reads `.mcp.json`/Claude/Cursor configs | **unverified** (def comment) | later; ASK + own tools |
| qoder | project `.mcp.json` only | **unverified** (def comment) | later; never write the project file |
| aider, pi | no | **unverified** (def comments) | run as-is + `no_tovu_tools` |

Every MCP-capable agent without a bridge still gets the ASK card for `userMcp`, because it loads its own list. All isolation classes stay conservative (`'none'`) until a live probe stamps them.

## 5. Tests (incident test first; live only for Claude, Codex, agy)
| # | Name | Asserts | Where |
|---|---|---|---|
| 1 | `every-cli-default-settings.contract` (rewritten) | All 29 `AGENT_DEFS` × Tovu's real defaults give RUN/ASK/SETUP, never a refusal. Claude RUN; agy ASK(userMcp). The rewritten test is RED against today's code (today's test accepts named refusals) | CI Tovu |
| 2 | `host-defaults.fixture.contract` | Defaults fixture published in Jini; Jini: planner × fixture never refuses; Tovu: live defaults equal the fixture | CI both |
| 3 | `plan-run.property` | Total over all defs and host states. Own list never loads without effective `userMcp`. Every off switch a def can't honor is in `keys`. Unknown isolation → ASK. `host.locked` + need → SETUP, never ASK. Auth `unknown`/none never SETUP. `isolationBlocked` → ASK(`isolation_blocked`) | CI Jini |
| 4 | `isolation-claims.snapshot` | One class per def; `perRun` needs a stamp; a CLI version bump drops it | CI Jini |
| 5 | `consent-before-spawn` | ASK and SETUP spawn nothing and mint no token | CI Jini |
| 6 | `consent-card.integrity` | Forged, replayed, altered, non-owner, hosted, cross-site and stale-effective clicks rejected (stale → re-ask). Single-use; writes only `byAgent[id][keys]` | CI Tovu |
| 7 | `card.alternatives-qualified` | "Use {Agent2}" lists only installed, auth-not-missing, RUN agents; hidden when none | CI Tovu |
| 8 | `lowering.contract` | Credential revoked before cancel; affected runs and their cards cancelled; cleanup awaited; a fake cleanup failure is reported. Next message: `perRun` def spawns with `loadsOwn=false`; `'none'` def gets ASK and no spawn | CI Tovu |
| 9 | `chat-self-settings.scope` | Tool writes only `byAgent[selected]`; site keys, other agents and whole blobs rejected. Lowering direct; any switch on or unknown key → card. Concurrent write → existing revision conflict. Non-owner run has no write tool. `extraDeniedSettings`/fence still block generic writes | CI Tovu |
| 10 | `notices.no-tools-and-setup` | `no_tovu_tools` once per chat; not-installed, not-signed-in and `host_locked` texts appear | CI Jini |
| 11 | `bridge-delivery.<strategy>` | Fake CLI records argv/env/files per strategy (`config-path`, `owned-user-entry`). Inherited-env token only when `loadsOwn` | CI Jini |
| 12 | `owned-user-entry.installer` | Temp HOME: foreign entries kept; foreign `jini` refused; symlink refused; backup once; idempotent; no token/run id in the written file | CI Jini |
| 13 | `copy.site-wide-and-stdio` | Mid-chat add cards carry the site-wide line; stdio save form shows the OS-user line and the tool-call hint | CI Tovu |
| 14 | `agent_reads_own_chat_settings_and_plan_reason` | `chat_settings_get` returns the launch-snapshot values (`userMcp:false`, not `{}`), source mode, isolation, verdict and keys, tool ids, hostnames only. Rejects caller site/principal/run. Non-owner run shows all-off with `host_locked`. Sentinel token, header, env and URL-path values appear nowhere. Run-start block equals card facts | CI Tovu |
| L1 | `live.isolation.{claude,codex}` | Home, project and plugin canaries don't start; bridge works. Pass ⇒ stamp | live |
| L2 | `live.agy.sibling-env` | Does a sibling server see the token? Can only remove the card line | live |
| L3 | `live.bridge-e2e.{claude,codex,agy}` | After Allow, Tovu and federated tools work end to end | live |
| L4 | `live.opencode.smoke` (later, light) | Starts after Allow, bridge answers | live |

Already written and kept as-is: fed-security, fed-presets, codex-mcp-sources-isolation, agy install tests.

## 6. Waves (lines exclude tests; all estimates)
- **W1 Jini planner (~180, same):** `planRun` with host lock, auth tri-state and `isolationPreflight` hook; `mcpIsolation` on defs; ASK/SETUP replace `enforceNativeToolPolicy`; re-land `run_notice` (~120 re-landed); `no_tovu_tools`. Tests 1–5, 10, L1.
- **W2 Tovu consent + visibility (~250, was 260):** `byAgent` + resolver after the host gate, card + copy, alternatives, Settings row, lowering contract (wires existing revoke/Stop/cleanup), setup text, stdio copy; run-bound facts + `chat_settings_get` (~50). Tests 6–8, 13, 14.
- **W3 chat self-settings (~70, was 180; gated on fed-security + presets green):** selected-entry write tool, raise → existing owner card with click-time recompute, mid-chat site-wide line. Test 9. Security review (light; no deny removed).
- **W4 bridges (~170, was 190):** `config-path` (copilot, amp, deepseek), `owned-user-entry` = installer ownership check + shared primitives (agy first, then droid/crush/cursor/qwen), def data, L2, L3, then L4. Tests 11–12.
- **Total ~670 (was ~810).** Option B would make it ~800.

## 7. Deleted
- REFUSE verdicts for picker-visible agents: `refusedCapabilityLocks`; the `nativeToolPolicyRefusal` "turn it on / choose Claude" paths; the Codex "can't run with 'Your MCP servers' off" refusal (becomes ASK).
- Interim B (`inherentUserMcp`, parity treating `userMcp:false` as inherent) and the `user_mcp_inherent` run-then-notice.
- v1/v2: W2 inspector, counts, duplicate cleanup; `mcp_source_fallback`, `personal_mcp_count`, `duplicate_bridge`; the parity fallback; the boolean `raises(previous,next)`; W7 app-to-app (own spec); the debate's picker filter and "Chat-only" badge (D5).
- v2 → v2.1: the cross-agent effective-authority raise rule, the cost rule, settings-revision CAS on cards, the owner-writer extraction, and replacing the Full CLI deny / model-effort `alwaysAsk` (both kept as they are).

## 8. Open owner questions (design assumes the recommended YES; both *pending owner*)
1. **Writing into personal configs:** after explicit Allow, only where config-path is unavailable, ownership-checked, foreign entries preserved, credential-free (Droid, Crush, Cursor, Qwen, agy). Without it these agents get no Tovu tools.
2. **Lowering mid-answer:** stop immediately: revoke the credential first, then terminate the process trees, report cleanup failures. The answer in progress is lost; otherwise its servers keep running.

## 9. Build constraints from Codex re-check of v2.1 (GO WITH CHANGES, 11:00 AM; reports/2026-10-27-d0-check-mcp-design-v21)
1. Raise card keeps CAS: the click reads the addressed layer fresh, compares, and passes that revision to the existing `set`; conflict → fresh card (new exchange). No dependency CAS, no Option B.
2. Run-bound clicks: keep the originating run server-side; reject terminal/cancelled runs before commit; close the card on terminal completion (exchanges bind tool/principal/channel only — surface-exchanges.ts:69).
3. Wording: "Tools for {Agent}", and say the choice applies to its other chats on this site (storage is byAgent, no chat dimension).
4. Merge doc for the byAgent patch = the RAW blob (the effective reader drops byAgent — subagent-settings.ts:33); preserve untouched raw fields.
5. Reuse only: isolationPreflight calls the existing Codex scanner (mcp-bridge.ts:587), injected from daemon composition (agent-runtime must not import daemon). Owned entry extends applyJsonInstall; lock + atomic write already in platform; extract only the backup-once helper. No second scanner/installer/approval lifecycle/fs abstraction.
