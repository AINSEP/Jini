PARTIAL ca11694d8 ab7bd7783: 9 owned files blocked or deferred on steps outside this lane (run-start-context: BX-31; SiteAssistantWidget.tsx/.hooks.ts + site-assistant-errors.ts: codex/visitor-chat-tovu held; tool-confirmation.ts + SiteToolConfirmation.hooks.ts + vanilla-tool-confirmation.ts: BX-9..12 + BX-3; loader-host.ts + SiteAssistantActivation.hooks.ts: BX-7/8), plus demo-image-png.ts (no Jini owner). Every other owned file is MOVED, SPLIT or STAYS-HOST.

# w4-assistant — admin assistant runtime + site chat (2026-11-24, 02:25–04:00Z)

- Branches: Tovu `codex/w4-assistant-tovu` @ `ca11694d8` and Jini `codex/w4-assistant-jini` @ `ab7bd7783`. Both are based on `integ/merge-16-2026-11-23` (Tovu `3a9332247`, Jini `7490405a8`). merge-16 did not move during the run (re-checked at 03:56Z), so both heads still contain it and no re-merge was needed.
- Programmer contract: I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. Every builder brief encoded its rules:
  - tests first for behaviour changes
  - named mutations
  - why-comments move with the code
  - pre-completion checklist
  - Architecture Audit as rule self-check
- Setup:
  - Node 24.22.3 (`/opt/node24`); pnpm 10.33.2.
  - Jini: `pnpm install --frozen-lockfile` 0; `pnpm -r build` 0.
  - Tovu: `npm ci --ignore-scripts` returned 0 in root, admin, desktop and site-chat.
  - Linked with `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`; `packages/contracts` tsc 0.
  - Base comparisons ran in a clean Tovu `git worktree` at merge-16, using the same `node_modules`.
- Method: Opus coordinated and Opus builders did the work (16 dispatches, at most 4 at a time, none over 65 calls). A fresh Opus reviewer checked the committed diff against the SELF-CHECK list, and its findings were fixed in batch P.
  - Every builder report was reviewed.
  - One builder change was reverted and redone. BX-4/5 first changed behaviour without a test-first step; batch H redid it with proven parity.
  - One duplicate was deduped by the coordinator (BX-27 `isRecord` → core `isNonArrayRecord`).

## Destination note
`plans/P9-data/k-work.json` and the P9K sheets have **no rows** for the 104 owned files. `plan.mjs` places no file under `apps/website/src/assistant/` or `apps/site-chat/`. So each builder chose the destination next to the closest existing Jini owner, deduping wherever Jini already had the code. Site chat followed `P13-gaps.md` §2 and the `BX` rows in `P9K-combined.md`.

## Batch table
| batch | model | owned files moved / split (→ Jini) | importers | tests | status |
|---|---|---|---|---|---|
| A site chat | Opus | `site-chat-comparison.ts` SPLIT → `chat/browser/embed-send-bridge` (P13-S3); `visitor-site-path.ts` DEDUPE → core `checkSiteRelativeTarget` (BX-16); 11 STAYS (P13); 6 SKIPPED | `vanilla-host.ts`, `SiteAssistantActivation.hooks.ts` | Jini +11 (embed-send-bridge); Tovu +2 path tests (red first); mutations: busy guard, query/fragment | done |
| B persistence / settings / daemon | Opus | MOVED (Tovu file deleted): `daemon-call-context` → `daemon/daemon-call-context`, `byok-meta-tool-result` → `daemon/byok-meta-tool-result`, `cli-probe-cache` → `agent-runtime/cli-probe-cache` (queue now instance-owned), `custom-instructions` → `agent-runtime/custom-instructions` | about 15 | Jini +34; mutation: shared probe queue | done |
| C MCP / routes | Opus | MOVED `page-approval-context` → `daemon` root (`navigationQuery` injected); SPLIT `run-active-context` store → `daemon/http` | about 10 | Jini 23 (moved); mutation: fixed navigation query | done |
| D tools / visitor site | Opus | MOVED `tool-family-port` → `daemon/http` `createPrefixToolFamilyPort`; DEDUPE `tool-catalog-live-query` onto registry `createLiveToolCatalogQuery`; removed the forwarding re-exports from `batch-tool-inputs` (18 importers now import `@jini-ai/core`) | 22 | Jini +4 (moved) | done |
| E follow-ups | Opus | SPLIT `lost-frontend-binding` → `daemon/http`, `rewrap-page-navigate-error` → `agentic/core/page-navigate-error`, `ask-choice-custom-answer` → `mcp/tools/ask-choice/custom-answer`; dead aliases removed from `tool-contribution-registry` | 8 | Jini +26; 3 mutations | done |
| F big-file splits | Opus | SPLIT `tool-catalog-query` → registry `createRefreshingToolCatalogQuery`; `mcp-ui-tool-calls-route` (349→263) → `daemon/http/surface-callback-request`; `a2ui-actions-route` (195→119) → `daemon/http/a2ui-actions` (Express shells stay host) | 3 | Jini +15; 2 mutations; 42/42 catalog goldens byte-identical | done |
| G BYOK / model cache / tenant | Opus | MOVED `live-model-cache` → `agent-runtime/model-catalog/live-discovery`; SPLIT `persistence/tenant-scope` → `chat/store/runtime/chat-principal` | 10 | Jini +14 | done |
| H session store (BX-4/5) | Opus | `session-store.ts` DEDUPE onto `chat/browser/session-store`. Jini store gained `overCapReads` + `onFailure` (default unchanged). | 0 | Jini +3 (red first); Tovu 49/49 unchanged; 9-case base-vs-new differential probe: 0 differences; 3 mutations | done |
| I roster-change bus | Opus | SPLIT `external-mcp-roster-change` → `mcp/federation` `createMcpRosterChangeBus` (instance-owned; lowering error injected) | 6 | Jini 9 (5 moved + 4 new); mutation: module-level map | done |
| J settings | Opus | SPLIT `cli-permission-layer` (37→23), `subagent-settings` (81→74) → `core/settings` guarded reads + `agent-runtime` `patchNativePermissionLayer`; 4 STAYS | 0 | Jini +19; 3 mutations | done |
| K tool definitions | Opus | SPLIT `content-read-tool` (697→560) → `core/tool-read-cards`; `tool-search-keywords` → registry `declared-keywords`; `demo-a2ui-tool` (297→241) → agentic render-surface; DEDUPE `component-catalog-tool` descriptions (mcp defs) and `admin-screen-link-tool` (core `httpOriginOf`) | 1 | Jini +25; 4 mutations; goldens byte-identical | done |
| L BYOK dedupe | Opus | MOVED (deleted) `byok-provider-turn` → `agent-runtime` `runProviderToolTurn` + `resolveProviderProtocol` | 4 prod + 9 tests (call shapes only; every assertion kept; 179 → 178 + 1 in Jini) | done |
| M credential / persistence | Opus | SPLIT `persistence/agent-session-store` → `daemon/store/agent-sessions/kernel`; `persistence/chat-expiry-sweep` → `chat/store/runtime/chat-maintenance`; `persistence/store-factory` → `chat/store/runtime/lazy-run-ledger`; 9 STAYS | 1 | Jini +19; 3 mutations | done |
| N federation / visitor / daemon-access | Opus | SPLIT `external-mcp-federation-runtime` (241→78) → `mcp/federation/runtime`; DEDUPE `mcp-federation/bootstrap` (256→179); SPLIT `site/visitor-page-tools` (120→91) → agentic published-page gates; `daemon-access` → `daemon/run-credentials` `adoptAndEnsureDaemonSecret` | 4 | Jini +14; 3 mutations | done |
| O re-export sweep | Sonnet | DELETED forwarding barrels `agent-discovery`, `prompt-guidance`, `runtime-settings`, `session-services`, `visitor-services`; removed re-export lines from 6 host files | about 40 | wiring pins only | done |
| P review fixes | Opus | Removed lane-added Tovu forwarders (`agent-daemon-port`, `assistant/index`, `byok-tool-surface`). custom-instructions now takes object args + injected `warn`; live discovery takes injected `warn`, so the host log bytes are unchanged. Record guards → core `isNonArrayRecord`. | 5 | 2 mutations | done |
| final | Opus | API baselines regenerated (8 packages, additive) + changeset; 2 complexity splits; why-comment audit (97 moved, 16 obsolete, 3 restored verbatim) | — | — | done |

**Owned-file outcome (104):**
- **14 deleted from Tovu.** 9 moved or deduped into Jini; 5 forwarding barrels.
- **26 split.** Their generic logic is now in Jini, with Tovu keeping the binding and product data.
- **54 STAYS-HOST** (below).
- **10 SKIPPED.**

## STAYS-HOST (one-line reasons)
- **site-chat (P13 §2.1):**
  - `SiteAssistantHeader.tsx`: header-slot adapter (OWNER-Q-4).
  - `jini-kits.ts`: kit composition.
  - `loader-entry.ts`, `vanilla-entry.ts`: build entries.
  - `main.tsx`: self-mounting IIFE whose `MOUNT_ID` must match the server markup.
  - `remixicon-override.ts`: host URL; the work is already Jini `installRemixIconStylesheet`.
  - `vite-env.d.ts`: ambient types.
  - `vite-public-guard.ts`: ADR-054.
  - `vite.config.ts`, `vite.lazy.config.ts`, `vite.vanilla.config.ts`: product build config.
- **Credentials:**
  - `execution-credential-store.memory.ts`, `site-credential-store.memory.ts`: map Tovu records onto Jini `InMemoryVaultRepo`.
  - `execution-credential-repo(.sqlite).ts`, `site-credential-repo(.sqlite).ts`: bind the Tovu content kernel to `SqlSecretsVaultRepo`.
  - `byok-credential.ts`: one Jini factory call.
- **Persistence:** `persistence/chat-history-store.ts`, `persistence/durable-run-store.ts`: one Jini factory call plus Tovu's `isDaemonRunId`.
- **Durable runs:** `durable-runs/accept.ts`: binds the host `redactAdminRunContextRef`.
- **Daemon:**
  - `daemon-core-protocol.ts`: Tovu's private RPC schema.
  - `daemon-respawn-policy.ts`: Tovu retry budgets over the sidecar policy.
  - `agent-session-preset.ts`: the `AGENT_DEFS` lookup and refusal copy.
- **Settings:** `execution-mode-settings.ts`, `public-assistant-settings.ts`, `public-assistant-availability.ts`: product settings data/copy over Jini primitives.
- **MCP federation:**
  - `mcp-federation/{adapter.http,adapter.memory,presets,reload-adapter}.ts`, `desktop-mcp-runtime.ts`, `server-federation-diagnosis.ts`: bind Tovu client info, secrets, messages and redactor.
  - `mcp-injection.ts`: Tovu Electron launch plus a self-referential bin path.
- **Express adapters:** `mcp-ui-sandbox-proxy-route.ts`, `surface-answer.ts`, `server/error-mapping/respond.ts`, `server/http/request-cookie.ts`, `cookie.d.ts`.
- **Tool and copy files:**
  - `mcp-ui-tool-calls.ts`: allowlist from Tovu `nativeToolMetadata`.
  - `read-only-tool-constraint.ts`: already only copy over `daemon/read-only-tools`.
  - `render-ui-tool.ts`, `tool-search-doc2query.ts`, `tool-contribution-registry.ts`, `batch-tool-inputs.ts`: product tool data.
  - `credential-guidance.ts`, `site-guide-pointer.ts`: prompt copy.
  - `credential-chat-intake.ts`: Tovu run envelope plus `run-page-context`.
  - `demo-image-tool.ts`: product demo tool over the PNG fixture.
- **Visitor site:**
  - `site/mode.ts`: `TOVU_*` env.
  - `site/client-directives.ts`: Tovu website ↔ site-chat wire.
  - `site/visitor-confirmations.ts`, `site/visitor-confirmation-gate.ts`: Tovu bindings over Jini `createBoundConfirmations` / `createBoundConfirmationGate`.
  - `site/capability-registry.ts`: the reviewed literal capability list.

## Skipped, with exact reasons
- `run-start-context.ts`: P9K-combined I03 orders BX-32 after BX-31 (`site/visitor-executor`, not in this lane). It parses Tovu's envelope through Tovu's `run-page-context`.
- `SiteAssistantWidget.tsx`, `SiteAssistantWidget.hooks.ts`, `site-assistant-errors.ts`: P13 §2.1 defers them for `codex/visitor-chat-tovu`, which combine-15 merged and then reverted (held).
- `tool-confirmation.ts`, `SiteToolConfirmation.hooks.ts`, `vanilla-tool-confirmation.ts`: BX-13 needs BX-9..12, and Jini has no challenge contract or confirmation lifecycle yet. It also needs BX-3, because the deferred `site-assistant-transport.ts` imports `tool-confirmation.ts`.
- `loader-host.ts`, and the BX-7/8 half of `SiteAssistantActivation.hooks.ts`: they wait for the deferred widget files. Only the P13-S3 import repoint landed.
- `demo-image-png.ts`: a generic PNG encoder with no natural Jini owner (no image/media package). It stays as a demo fixture unless a home is named.

## Gates (final tree vs merge-16 base; no new red)
| gate | base | final |
|---|---|---|
| Jini build (`pnpm -r build`) | 0 | 0, 0 `error TS` |
| Jini typecheck | 0 | 0 |
| Jini api:check | 0 | 0, after `api:update` (additive: agent-runtime, agentic, chat, cms (core/settings re-export), core, daemon, mcp, registry) + changeset `w4-assistant-extraction` |
| Jini guard | 1 (HW3 `admin/shell-failure-log`) | the same 1 |
| Jini check:cross-package (XP) | exit 1, same output | exit 1, same output (no diff) |
| Jini check:size | 1 base violation (`cms/redirects`) | the same |
| Jini check:complexity | 4 base violations | the same 4; the lane's `parseTranscript` (11) was split |
| Jini check:why-comments | 10 | 10 (1 restored, 1 recorded) |
| Jini check:hooks / check:errors | 0 / 0 | 0 / 0 |
| Tovu typecheck | 0 at merge-16 (combine-16) | 0 |
| Tovu tsconfig.tests | — | 0 |
| Tovu admin tsc / site-chat tsc | 0 / 0 | 0 / 0 (admin untouched) |
| Tovu check:complexity | 0 | 0; the lane's `allowsVisitorPath` (11) was split |
| Tovu check:size / architecture / typecheck:scripts | base-red | identical output |
| Tovu check:hooks | 0 | 0 |
| Tovu check:why-comments (`--other-root` Jini) | 78 | 78. 112 entries were recorded with per-id locations, and 3 rationales were restored verbatim in Jini. |

**Tests:**
- **Jini:** the 32 changed or added test files are green. Full suites of all 7 touched packages are green: core 3056/3056; chat 4538 + 1 skipped; daemon 4935 + 1 skipped; agent-runtime 4566 + 1 skipped; agentic 1167/1167; mcp 1920/1920; registry 400/400.
- **Tovu:** 799 test files (every changed test, plus every test importing a changed or deleted module) each ran alone under a 5-minute watchdog. 780 are green. The other 19 are red with **pass/fail counts identical to the clean base**:
  - 18 are listed BASE-RED in `cloud-results/combine-15-raw/tovu-node-red-files-vs-base.txt`.
  - `site-assistant-transport.test.ts` is red on the clean base worktree too, from a react 19.2.8 / react-dom 19.2.7 link mismatch in this environment.
- **Admin vitest:** not run, because `apps/admin` has 0 changed files.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`, themes excluded)
| | moving | shells | FILES LEFT | excl. themes |
|---|---|---|---|---|
| before (merge-16 `3a9332247`) | 2,187 | 0 | 2,187 | 2,076 |
| after (`ca11694d8`) | 2,187 | 0 | 2,187 | 2,076 |

This lane cannot move the measured number: `plan.mjs` has no area covering `apps/website/src/assistant/` or `apps/site-chat/`. Owned-file progress is 14 of 104 deleted, 26 split, 54 STAYS-HOST and 10 skipped. Net diff: Tovu −2,384 lines over 174 files; Jini +5,397 over 97 files.

## Wiring
- Jini `## Wiring` sections were added or extended in the READMEs of core, chat, daemon, agent-runtime, agentic, mcp (plus `mcp/src/tools/ask-choice/README.md`) and registry.
- Tovu: new `apps/site-chat/INFO.md` (OWNER-Q-7) with a file map and `## Wiring`. `apps/website/src/assistant/` has no INFO.md.

## Open items / recommendations (no new owner decision required to merge)
1. **BX-4/5 behaviour notes.** These are parity-proven, but there are two follow-ups to consider:
   - Tovu's `onFailure` re-throws `serialize` failures to keep base behaviour, where circular data threw despite the "never throws" doc. Recommend making the save fail-soft later, test-first.
   - An empty load now returns a fresh object instead of the shared module-level `EMPTY_STATE`. The two are deep-equal.
2. **BX-16 tightening.** Core now also refuses `/admin/..%2fpublic` and `/.//admin`. This was tested first; it is a security tightening.
3. **`assistant-vault-compat.ts` (not owned).** Its singleton CAS row writes are generic and fit `@jini-ai/platform/secrets/credential-sets` with the id factory injected.
4. **`modules/assistant.ts` (not owned).** About lines 480–502 re-implement `parseSurfaceCallbackRequest` inline; bind it to Jini, test-first for the empty-string `exchangeId` case.
5. **`read-only-tool-constraint.ts`.** Its executor-layer copy is product-neutral and could become a Jini default message set (owner call; recommend yes).
6. **Naming.** The Tovu binding `createFederationRuntime` shares its name with the Jini engine function. Optional rename to `createTovuFederationRuntime`, which touches 7 test importers.
7. **Stale reference.** `development/e2e/journeys/byok.pins.journey.ts:683` still names the deleted `byok-provider-turn.ts` in a comment about a past bug.
8. **Checkpoint commits.** The `wip(w4-assistant)` commits are unreviewed checkpoints, pushed every few minutes per the standing rules. Each batch's reviewed state is the next `feat(...)` commit; squash freely.
