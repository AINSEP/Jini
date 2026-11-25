PARTIAL f7575b339f 4d306d6cc3: left R01 (rest of the class census), R02 (held validation.ts copy + rest of the ID census), R03 (class-b host injection), K03 (residual AMR/Mimo/vibe/claude-compatible review)

# b-g6b: Part R + Part K (architecture, continuation of g6)

Unattended cloud run, 2026-11-25 09:31 to about 11:30 UTC. Opus coordinated; every builder was a Sonnet subagent at high effort, never more than 4 at a time.

**Branches.** Both are `integ/b-g6b-2026-11-25`, branched from `origin/integ/b-g6-2026-11-25` (Tovu `7c0bfac8b`, Jini `209744ad8`). The SHAs on the first line are the code heads; this report sits one commit on top of each. Untouched: `main`, `plan/*`, `release/*`, `codex/*`, `integ/merge-*`, `integ/b-g6-2026-11-25`, `integ/b-g6c-*`. No force-push, no `--no-verify`, no hooksPath change, no tag, no publish, no codebase-memory tools. G01..G16 were not touched.

**Programmer skills.** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first. Every builder got it through `wt/BUILDER-RULES.md`: test first, root-cause debugging, coverage integrity, why-comments preserved.

**Setup.** Node 24.22.3 (`/opt/node24`). Jini: `pnpm install --frozen-lockfile && pnpm -r build`. Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat; `link:jini`; desktop hooks; build of `packages/{contracts,sdk}`. Each builder worked in its own Jini/Tovu git worktree under `/home/user/wt/`. The coordinator merged each worktree into the integration branch and pushed after every sheet.

## Sheet table

| sheet | status | Jini / Tovu commits (merge or head) | pin + mutation |
|---|---|---|---|
| R01 Prefix Jini CSS | PARTIAL (2 slices) | Jini `e6f5ef22e`..`e63703c9c` (pushed linear), `5df35a620` (R01b merge) | CheckboxField/RadioGroupField own `jini-ui-*` rules (computed-style pins, 4+3 tests); AdminShell boot/topbar/layout/content/main-col/skip-link/backdrop carry `jini-admin-*` plus the legacy host class as a documented alias; Jini selectors match `:is(prefixed, legacy)`. Playwright bbox check of the checkbox row: identical before/after. `M-rename-markup-only`: checkbox 2 red, radio 1, topbar 1, boot alias 1, layout 2, content+skip-link 2. |
| R02 Neutral copy | PARTIAL | Jini `010306325`; Tovu `77e3f20e9`, `5f8edc044` | Consent banner label and site-guide keywords take the host product name through existing args (`consentTranslation({ locale, productName })`, `ConsentFieldsProps.productName`). Tovu binds `"Tovu"` at `consent-ports.ts`. Two-host pins (Acme/Zeta) in cookie-consent, admin and core. `M-leak-default-product-name`: 2 red. R02a: 28 comment-only SPEC/ADR citations replaced with reasons. **Held:** `cookie-consent/src/site/validation.ts:70` ('Choose the Jini banner…') has no reachable args object. |
| R03 Legacy vocabulary | PARTIAL (triage + pins + 1 fix) | Jini `f11195511` | Triage table at `packages/agent-plugins/docs/legacy-vocabulary-triage.md`. 69-test pin file (N-1 `extensions.tovu` manifest, `tovuAuthMode`, scan of bundled manifests) plus a vercel `.tovu.zip` share-key pin. Calendly `mcp.json` now ships canonical `authMode`. `M-drop-legacy-read`: 1 red; dropping the legacy manifest filename: 5 red. **Left (class b):** inject the `tovu` namespace / `tovu*` field names and the `.tovu.zip` suffix from the host. That touches ~10 agent-plugins call sites and Tovu `host-binding.ts`. |
| K01 Capabilities, not CLI names | DONE | Jini `80a6de36d` | `AgentRuntimePort.strategies.for({ def })`, bound in `agent-runtime/src/runtime-strategies.ts` from def declarations (no parallel registry, no daemon→agent-runtime import). `strategy-dispatch.test.ts` (8 tests, two synthetic bindings). `M-hardcode-cli-dispatch`: 1 red. **Vendor guard:** `scripts/check-vendor-neutral.ts` (rule R15) is wired into `pnpm guard`. It is a shrink-only per-file ratchet over `daemon/src` + `server/src` non-test source, with an empty comment-only allowlist; its own test has 6 cases. |
| K03a Receipt/constant moves | DONE | in `80a6de36d` | Gemini/OpenCode receipts and the OPENCODE/MIMO/AMR constants moved to `agent-runtime/src/defs/`. 9 distinct-correlation tests. `M-generic-receipt-id`: 4 red. |
| K02 Codex/Claude/Antigravity staging | DONE (3 vendors) | Jini `36f3a182e` (Antigravity), `d143bb163` + `52ec5df35` (Claude), `4d306d6cc` (Codex) | Slots `mcpBridge`, `filesystem`, `configDir`, `mcpConfigFile`, `subagentStart`, `mcpHome`; code + tests under `defs/{antigravity,claude,codex}/`. Refused starts acquire nothing: each vendor has a pin. The Codex isolation refusal now judges config **before** `mkdtemp`, which was a real acquire-before-refusal bug, fixed test first. `M-stage-before-refusal`: 1 red for each vendor. `auth.json` link ownership and cleanup order are unchanged. smol-toml moved from daemon deps to agent-runtime deps (lockfile regenerated). |
| K03 OpenCode / Pi | PARTIAL | Jini `5fcc52210` | OpenCode `mcp-config.ts` is behind `envContent` / `instructionsDocument` / `httpMcpEnv`; `HTTP_MCP_ENV_ADAPTERS` is gone. `M-generic-receipt-id`: 4 red; dropping the existing-config merge: 4 red. **Pi decision:** `pi-rpc-events.ts` is generic pi-rpc transport (the sibling of `acp-events.ts`, built on daemon internals, no CLI branch), so it stays shared; Pi policy is already in agent-runtime. **Left:** review of residual AMR/Mimo, dispatcher format cases and `defs/{opencode-acp,vibe,claude-compatible-args}.ts`. |
| K04 xAI OAuth + search | DONE | Jini `75534b779` (+ `8b9cafcad`) | Moved to `provider-plugins/src/xai/` (`./xai`, `./xai/routes`, `./xai/preset`, `./xai/oauth-port`), with manifest + catalog entry. `examples/reference-web` mounts it through `httpExtensions` + `onShutdown`. Daemon `http/xai.ts`, `ports/xai-oauth.ts` + subpath and server `xaiFeature` / `options.xai` / listener slot are deleted. A neutral host-mount witness lives in the server tests. Listener/disclosure/timeout pins: 5 new. `M-duplicate-listener-slot`: 15 red. Tovu never mounted xAI routes. |
| K05 Grok media | DONE | Jini `1b972779e`; Tovu `9458fa101`, `fab4934a1` | `provider-plugins/src/xai/media/`: `createXaiMediaContribution({ kit })` with an injected dispatch kit (provider-plugins imports no integrations). Registered at Tovu `host-media-provider-registry.ts` via `deps.ts`. The manifest contributes `media/grok`. Built-in Grok registration and forwarding export are deleted. Pin: 7 tests. `M-media-ignore-injected-registry`: 4 red. |
| K06 Model-proxy policy | DONE | Jini `e7904ca2b` | Daemon `model-proxy.ts` takes required injected `providers`, with no static list. Anthropic/OpenAI/Azure/Google/Ollama are `@jini-ai/provider-plugins/model-proxy-<vendor>`. `server` assembles no vendor (host supplies `proxyProviders`). `minimal-host` and `reference-web` inject. Generic kit is in `core/contracts/agents/proxy-provider{,-kit}`. Pins: 5 characterization + 6 injected-fixture. `M-proxy-static-provider-list`: 5 red. 21 vendor tests moved; daemon still has 313. |

## Rule-break counts, before → after

- **Vendor names in Jini `daemon/src` + `server/src`** (codex|claude|opencode|gemini|antigravity|xai|grok, non-test): **699 hits / 50 files → 185 / 26**. xAI: **434 → 0**. The R15 ratchet debt file shrank with each merge, and no count was ever raised.
- **Daemon id-keyed vendor dispatch maps** (`HTTP_MCP_ENV_ADAPTERS`, `HTTP_MCP_HOME_ADAPTERS`, `FILESYSTEM_ADAPTERS`, `MCP_BRIDGE_PREPARERS`, `kind`-selected receipts): **5 → 0**.
- **Jini product defaults in live copy** (R02): 2 fixed, 1 held. `\bTovu\b|Open Design` in non-comment, non-test source: 0 → 0 by the builder's criterion.
- **SPEC/ADR-only citation lines, non-test** (R02a): cms 192 → 169, user-management 140 → 138, admin 51 → 46.
- **Unprefixed class literals** (rough rg): ui 1442 → 1439. admin is unchanged by design, because the legacy aliases are kept for host selectors.
- **Jini guard:** 1 → 1 (the pre-existing HW3 `admin/src/shell/lib/shell-failure-log.ts`). **Complexity ratchet:** 0 new. **Hooks:** ok.

## Gates (final heads)

| gate | base | final |
|---|---|---|
| desktop `npm run gates` | 5/6: tests output truncated; standalone `npm test` passed | **6/6 PASS** after `f7575b339`. The run before the fix failed tests + coverage because a desktop pin expected the old `hostEnvNames()` list. |
| Tovu `tsc` / admin `tsc` | 0 / 0 | 0 / 0 |
| Tovu hooks / boundaries / errors / architecture | ok | ok. Architecture still carries the non-blocking runtime propagation warning 3.06 → 3.54, unchanged from g6. |
| Tovu why-comments (base `7c0bfac8b`) | — | ok |
| Tovu admin vitest (consent) | — | 3 files / 62 pass |
| Tovu website node tests (changed files + importers, 229 files) | — | 1671 pass / 39 fail (see bugs) |
| Jini build / typecheck | ok | ok |
| Jini api:check | ok | ok. 9 changesets (`k01`..`k06`, `k02a/b/c`, `r02`); owner sign-off on the API surface is pending. |
| Jini guard | 1 (HW3) | 1 (HW3) |
| Jini hooks / complexity | ok | ok / ok |
| Jini why-comments (base `209744ad8`) | — | ok. 15 blocks allow-listed with reasons for owner review: 10 K04 rows, 4 K06 rows, 1 K02b split. |
| Jini size / log-safety | red (pre-existing) | Still red. Size has 3 entries (`admin/react/kit.tsx`, `admin/screens/plugins/rules.ts`, `cms/redirects/redirects.ts`); log-safety has 2 (`user-management/.../users/{access-shared,shared}.ts`). This run did not touch any of those files. |
| Jini changed-package vitest | — | daemon agent-executor 847, model-proxy 313; agent-runtime defs + `__tests__` 2465 (+1 skip); server 502 (+1 skip); provider-plugins xai + pack + model-proxy pass, except 4 observability tests that also fail before K04; ui interactive-ui 130; admin shell 97/98 (`theme-boundaries` fails on base). |

**Desktop gates, final (pre-push on `f7575b339`): 6/6 PASS** (tree-quiet, tests, typecheck, coverage, complexity, js-backslide).

## UNVERIFIABLE-IN-CLOUD

- Postgres tests need a running server; no socket is available here: 10 of the 39 website failures (`move-site-storage`, `open-site-store`, `create-site-route-deps` `.postgres`).
- Real CLI model-freshness probes (`codex`, `agy`) were skipped by guard.
- Daemon `http/__tests__/characterization/{uploads,paths-queries-state}` fails 15 tests identically on the unmodified base (sandbox HTTP).
- Provider-plugins OTel/Sentry tests (4) fail identically on the pre-K04 tree.

## Bugs

- **Fixed:**
  - The Codex isolation refusal created a scratch home before refusing (`mkdtemp` then remove). It now judges config before acquiring (K02c, pin written first).
  - The xAI manifest contract id was invalid (`xai-routes` → `xai_routes`).
  - A provider-plugins runtime-deps regression from the first K04 pass was reverted.
  - Stale pins after K01/K02 moved env keys into the runtime binding (`runtime-port-bindings.test.ts`, desktop `desktop-agent-runtime.test.ts`).
  - The xAI pack spec now expects both manifest contributions.
  - Tovu media fixtures now use the host-composed registry.
  - Tovu consent tests now pass the product name.
- **Logged here, not fixed:**
  - Tovu website: 39 failures across 21 files. 10 are postgres (above). The rest are route-table pins (`create-app-route-table.pin` 7), `l244-characterization` 4, composition wiring/boot tests, `tool-registrations.contracts` (listed in open-bugs `g6-stale-test-imports`), `tool-contribution-registry` ('agent-pause' contributor), `byok-google-catalog`, newsletter import, and media upload cap. None of these files or their subjects were changed by this run. They were **not re-run against the base here** (Tovu resolves `@jini-ai/*` to the one modified Jini checkout), so "pre-existing" is probable, not proven; g6 logged 44–45 failures in the same style.
  - `packages/core/package.json` has duplicate `./contracts/site/cms-trash` keys (pre-existing; esbuild warns).
  - **Owner decisions pending:**
    - `dist/xai/routes.js` imports `@jini-ai/core` at runtime without declaring it: the pack tests require the shared package to have no runtime deps.
    - The Codex refusal message is now worded generically ("disabling personal configuration requires run-scoped CODEX_HOME staging").
    - 57 daemon model-proxy tests still drive the real five registrations through a daemon devDependency on provider-plugins.

## Run notes

- **rsync was missing.** The first worktree script failed at rsync, and builders copied build output by hand. The script was rewritten to copy gitignored outputs with `cp`.
- **Caps.**
  - Coordinator: about 190 tool calls and about 2 h of wall-clock; never more than 4 subagents at a time.
  - Several first-pass builders ran past 50 calls or 120k tokens (K01 67, K05 62, K04b 56, K02b 44, K06 45). Each stopped and handed back, and a fresh builder resumed from its commits.
  - One builder used `git stash` despite the shared stack; the stack is empty now.
- **Process change.** The early `git pull --rebase` flattened the R01 merge commit into its 4 linear commits. That is harmless, but later pushes used `--rebase=merges`.
