PARTIAL 78076dd571 3e03c9bc4: XC-1, XC-2, XC-3, XC-4 (host-tools, attachment-persistence, xai), XC-5 (cli discovery, media node composer), XC-6a, XC-6c, XC-6d; shared-rendering moves (entry-list-markup, static-render-content, public-page-security-headers, native-folder-picker, platform/routing, site-preview AX-81..88, slug.ts); BX-6/34-61 composer slices

# ex6-fnd-shared-b — FOUNDATION shared rendering + composers (2026-11-23)

Branches: Tovu `codex/ex6-fnd-shared-b-tovu` (code tip `78076dd571`), Jini `codex/ex6-fnd-shared-b-jini` (code tip `3e03c9bc4`).
Unattended run, Opus coordinator, 8 subagent batches (6 Opus, 2 Sonnet), wall clock about 19:34–20:25 UTC.

**Bottom line.** Most of this lane's Tovu files cannot move yet. For every shared-rendering file, at least one importer is changed on an in-flight branch (`ex4-*`, `ex5-{posts,collections,small}-*`, `ex5-fnd-{seams,inject}-*`). Because of that:
- Only 1 Tovu production file left Tovu: files left went **2,404 → 2,403** (2,293 → 2,292 excluding themes).
- The lane's progress is mostly in Jini: the XC-4/5/6b injection cuts and the BX-27 dedupe.
- Three subagent batches (chat XC-1/2, agent-runtime XC-3, node-adapters XC-6a) broke consumers this run may not edit, so they were **reverted** rather than landed.

## Setup
- **Bases, Jini:** `origin/integ/merge-14-2026-11-22` (4902a6a1a), plus `ex5-fnd-kit-jini`, `ex5-fnd-seams-jini`, `ex5-fnd-routes-jini` and `ex3-c0b-jini`.
  - `ex3-c0b` conflicted only in the generated `api-baseline/jini-ai__core.json`; ours was taken.
  - **Skipped:** `ex5-fnd-inject-jini`, which had 23 conflicting files.
- **Bases, Tovu:** `origin/integ/merge-13-2026-11-22` (f7185f153), plus `ex2-tovu-halves`, `ex5-fnd-kit-tovu` and `ex5-fnd-routes-tovu`.
  - `ex5-fnd-routes-tovu` conflicted only in `development/why-comments-debt.json`, resolved as a 3-way union by entry `id`.
  - **Skipped:**
    - `ex2-holds-tovu`: it moves `settings-api` back to `lib/admin-http` against kit's relocation, with conflicts in 3 code files.
    - `ex5-fnd-seams-tovu`: 14 files.
    - `ex5-fnd-inject-tovu`: 63 files.
- **Tools:** Node 24.22.3, pnpm 10.28.
- **Jini:** `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0.
- **Tovu:**
  - `npm ci --ignore-scripts` (root, admin, desktop, site-chat): 0/0/0/0.
  - `link-jini.mjs`: 0 (82 links).
  - contracts tsc 0, sdk build 0.
- **Baselines:** gates ran on the unmodified merged trees in clean worktrees: Jini (its own install and build) and Tovu (shared `node_modules`).
- **Avoid sets:** each in-flight and foundation branch diffed against its merge base: 2,296 Tovu files, 953 Jini files.

## Batch table
| batch | subagent | files moved / work | importers repointed | tests | status |
|---|---|---|---|---|---|
| A: theme renderer + fs-files + html verbatim moves | Sonnet | 0 moved (all slices blocked; see Skipped) | — | — | blocked |
| A4: `platform/html/source-edits.ts` (C-platform-html-1.T slice) | coordinator | **1 Tovu file deleted**; it was byte-identical to the Jini `cms/html/site/source-edits` | `site-backup/static-download-html.ts`, `site-export/export-html-policy.ts` | site-export 18/18 | landed `abefea449` |
| B: XC-1 / XC-2 chat injection | Opus | ports built, then reverted | — | — | reverted: broke Tovu `assistant-dock-props.tsx`, the `ddl-parity` test and the `@jini-ai/sqlite` surface; the remaining sites are avoid-listed |
| C: XC-3 agent-runtime host ports | Opus | ports built, then reverted | — | — | reverted: without host wiring (avoid-listed examples, Tovu desktop) it silently dropped toolchain PATH search, proxy env and default provider URLs |
| D: XC-4 / XC-5 daemon, cli, integrations | Opus | `model-proxy` → `deps.toolTurns: ProviderToolTurnPort`; research Tavily → `baseUrlGuard: BaseUrlGuardPort`; saved-requests → `deps.createHttpClient` | server `builtin-features.ts` (bound inline on its existing agent-runtime import; 0 added lines, the file is at its size-debt limit) | daemon 4857, integrations 2082, server 472, cli 606 | landed `36b43653f`, fixes `6d3ef7505`, `3e03c9bc4`. The coordinator reverted host-tools (it needed a new `server → platform/command` edge) and cli discovery (the edge only moved into `main.ts`; new XP2) |
| E: XC-6a node-adapters | Opus | built, then reverted | — | — | reverted: removed `nodeProcessControl`/`nodeFileLock`/`nodeAtomicWriter`, which avoid-listed Tovu, examples and tests consume. It also redoes `ex5-fnd-inject-jini` work that its review (inject-1) undid |
| F: XC-6b server owner-store | Opus | `countLegacyOwnerStore`/`readLegacyOwnerStore` take `ports: LegacyOwnerStorePorts` (kernel opener, owner-store reads, vault repo, legacy decoder); server owner-store imports no db/platform code | Tovu `apps/website/src/cli/commands/owner-store.ts` (`LEGACY_OWNER_PORTS`) | server owner-store 14/14; Tovu owner-store 12+10+2 | landed (Jini wip `71c7d640e`/`43c4b1b88`, Tovu `a3c11b75fe`) |
| G: XC-5 media outbound guarded fetch | Opus | `fetchMediaOutbound` and its carriers require an injected `MediaGuardedFetch`; the platform import moved from `outbound.ts` into the node composer `dispatch/node.ts` | — (internal to media-providers) | media-providers 1119 (was 1115), integrations 2082 | landed (Jini wip `22e4f10e7`). **Compat seam:** `createMediaDispatchEngine` falls back to `nodeMediaGuardedFetch` because avoid-listed hosts (Jini `examples/reference-web/src/daemon.ts:477`, Tovu `media-generation/tool-registrations.ts:163`) don't pass it yet |
| H: BX-27 record-guard dedupe | Sonnet | 4 local guards → `@jini-ai/core/records` (`isRecord` for ask-choice, `isNonArrayRecord` for run-page-context, site/history, desktop smoke-bridge) | — | 17 + 12 + 15 + 21, neighbours 66 | landed `08b6a4b119`, `78076dd571`. `byok-meta-tool-result.ts` left: its exported `isRecord` is imported by avoid-listed `byok-tool-surface.ts` |

Changesets: `.changeset/ex6-xc4-xc5-injected-ports.md`, `ex6-xc6b-owner-store-ports.md`, `ex6-xc5-media-guarded-fetch.md`.
`scripts/injection-debt.json` lost the 4 allowances for the cut imports (a shrink; the guard required it).
Wiring docs:
- `packages/daemon/src/http/README.md` (new)
- `packages/integrations/src/saved-requests/README.md`
- `packages/integrations/src/media-providers/README.md` (+ `API.md`)
- `packages/server/src/owner-store/README.md` (new: `packages/server/README.md` is avoid-listed)

### Named mutations (red, then restored green)
- **D, research:** Tavily skips `baseUrlGuard.validate` → "promise resolved instead of rejecting" → research tests 50/50.
- **D, model-proxy:** openai calls the imported `runOpenAiToolTurn`, not the port → `expected … to contain 'from-port'` → 323/323.
- **D, saved-requests:** builds the client through the imported platform `createHttpClient` → `expected [] to deeply equal [{…}]` → 222/222.
- **F:**
  - Fake-ports test first: red (3 failed).
  - M1, read ignores the injected vault repo → 5 failed.
  - M2, count drops the `readOnly` option → 2 failed.
  - Green: 14/14.
- **G:**
  - outbound calls the platform `guardedFetch` instead of the port → 2 failed / 1119.
  - engine ignores the host's port → 1 failed / 63.
  - Green after restore.
- **H:** swap `isNonArrayRecord` ↔ `isRecord` at each of the 4 sites → the new array-shaped-record test goes red at each → green.
- A4 (deleting a duplicate, identical file) is a verbatim dedupe, so it has no mutation.

## Self-check (Codex 11-22 failures)
1. **No re-export or forwarding files** in either repo: none added. The `byok-meta-tool-result` slice was skipped rather than leaving a forwarding wrapper.
2. **Hooks:** no hooks or components touched.
3. **No Express types or host log formatters added to Jini.**
4. **`jini-*` classes:** no UI touched.
5. **No new debt-list entries:** `injection-debt.json` only shrank, and no size exceptions were added.
6. **New port types:** they live with their owning port modules (`daemon/ports/*`, `media-providers/dispatch/outbound.ts`, `server/owner-store`). No shared wire type was split.
7. **Behaviour-changing slices:** each has a named mutation (listed above).

## Gates (base → final; exit codes; "same" = identical findings after normalising timings)
**Jini:**
- build: 0 → 0
- guard: 0 → 0. It was 1 mid-run (stale injection-debt allowances); fixed in `6d3ef7505`.
- api:check: 0 → 0. It reports changed exports in daemon, integrations and server, covered by the changesets. `api-baseline/*` was not regenerated; those files are avoid-listed.
- check:cross-package: 1 → 1.
  - **6 findings removed** (XP2 in `server/owner-store/index.ts`: db/kernel, db/kernel/sqlite, db/owner-store, db/secrets-vault, platform credential-sets, legacy-owner).
  - **0 new** XP1/XP2/XP4/XP5.
  - XP3 rose 2081 → 2084: these are "absolute JINI_DECLARATION_BASELINE_DIR required" environment errors, one per changed file.
- size: 1 → 1, same.
- complexity: 1 → 1, same.
- why-comments: 1 → 1, same 18 block ids. 2 lost model-proxy comments were restored in `6d3ef7505`/`3e03c9bc4`.
- hooks: 0 → 0.
- typecheck: 0 → 0.

**Tovu:**
- Unchanged, same findings: size 1, boundaries 0, complexity 1, hooks 0, errors 0, typecheck 0, typecheck:scripts 2, typecheck:tests 0, admin tsc 0.
- architecture: 1 → 1. Deep-import edges 2812 → 2810; hub count 313/2248 → 313/2247.
- why-comments:
  - On the main tree it shows 88 blocks, the same as the run taken before BX-27.
  - One new block from BX-27 was restored in `78076dd571`.
  - The worktree base run (1349) can't be compared: the checker can't see the sibling repos from the scratchpad worktree.

**Tests not run:**
- Tovu admin vitest: no admin file changed.
- The full desktop suite: only the smoke-bridge files and `tsconfig.main.json` tsc were run.
- Postgres-backed suites.

## Steps skipped and why
- **Shared rendering (T-theme-1/K5-theme-1 FOUNDATION slices):** blocked by avoid-listed importers. Each slice's blocking importers:
  - `entry-list-markup.ts`: `render/widgets/social-entries.ts`, `render-context/collection-lists.ts`.
  - `static-render-content.ts`: `render-context/post-previews.ts`, plus `media-metadata.ts` and `static-tier.ts` through the theme barrel.
  - `public-page-security-headers.ts`: needs the theme-resource seam; its importer `public-theme-resources.ts` is avoid-listed.
- **X-fs-files-1 `native-folder-picker.ts`:** blocked by `mount-admin-system.ts`. `custom-root-store.ts` is blocked by its `wiring.integration.test.ts`.
- **K5-platform-routing-1:** blocked by `post-slugs.ts`, `seo/index.ts`, `pages/extra-head.ts` and two tests.
- **C-platform-html-1 `slug.ts`:** byte-identical to Jini, but 6 of its 7 importers are avoid-listed.
- **AX-81..85 site preview:** `site-preview-store.ts` is avoid-listed (seams). AX-86..88 desktop preview: `apps/desktop/src/main/index.ts` is avoid-listed (ex4-desktop).
- **C-contracts-headless-1:** the barrel `contracts/headless/index.ts` is avoid-listed.
- **change-sets / content-duplication agent-tools:** their importers are avoid-listed (inject, seams, settings).
- **XC-1:**
  - `recover.ts` is avoid-listed.
  - `rules.ts`/`model-options.ts` are fixed by avoid-listed `rules.test.ts` and admin `kit.tsx`.
  - The assessor injection breaks the Tovu `nativeToolPolicy` prop shape. It needs BX-59/BX-37 in one step with the Tovu admin binding.
- **XC-2:**
  - The redactor injection breaks avoid-listed chat callers.
  - Moving `store/sqlite` into `@jini-ai/db` would create a db→chat edge. Injecting instead breaks the Tovu `ddl-parity` test and the `@jini-ai/sqlite` surface. This needs an **owner decision** or RT-1.
- **XC-3:**
  - Needs host wiring in avoid-listed `examples/{minimal-host,reference-web}` and Tovu desktop.
  - The guarded-reader cut needs a core `RuntimeBuildOptions` seam (security containment, so no fail-open fallback).
  - The pkce cut needs an **owner decision**: an oauth port on `oauth-provider`, or wait for the xai provider-plugin move.
- **XC-4 remainder:**
  - `xai.ts`: the plan moves it to a provider plugin.
  - `attachment-persistence.ts`: its only host is avoid-listed `examples/reference-web`.
  - `host-tools.ts`: needs a new server→platform edge until XC-6c/d moves the binding to the host.
- **XC-5 remainder:**
  - cli discovery: the edge only moves into `main.ts`, which is a new XP2.
  - `media-providers/dispatch/node.ts`: it is the composer, pending the §K5 presets-as-composers decision.
- **XC-6a:** reverted (see batch E); belongs with `ex5-fnd-inject-jini` and XC-6c/d.
- **XC-6c/d:** the preset must take collaborators from hosts. Every host (examples, `node-adapters` consumers) is avoid-listed.
- **BX-51..58, BX-6/34–36/49/50:**
  - The remaining XP1 edges to `@jini-ai/protocol`/`@jini-ai/ui` need new `@jini-ai/core` exports (`packages/core/package.json` is avoid-listed) or protocol-ownership decisions.
  - Their hosts (Tovu AssistantDock, admin kit) are avoid-listed.
- **RT-K1 route families, K4-seam-4..23, contracts-core, admin kit/shell:** out of lane (per dispatch).

**Seen free during the scan but owned by other lanes, so not taken:** every file and importer of these steps is outside all in-flight diffs, so their owning lanes can take them:
- `A-adm-posts-2` (Posts)
- `A-K2-settings-3` (Settings)
- `K5-member-login-1` (Members)
- `X-redirects-1` (Settings)
- `X-skills-1` (Add-ons)
- `X-workspace-1` (Sites)

## Files left (P9 scanner `plans/P9-data/tools/{scan,plan}.mjs`, all areas)
| | production files | excl. themes | tests |
|---|---:|---:|---:|
| before (merged base) | 2,404 | 2,293 | 3,087 |
| after | 2,403 | 2,292 | 3,087 |

## Follow-ups for combine-15
- **Host wiring, once the avoid lists release:**
  - Add `guardedFetch: nodeMediaGuardedFetch` at `examples/reference-web/src/daemon.ts:477` and Tovu `media-generation/tool-registrations.ts:163`, then make `MediaDispatchEngineRequired.guardedFetch` required and drop the engine fallback.
  - Bind the daemon `toolTurns`/`baseUrlGuard` from hosts instead of the server preset (XC-6c).
- **api-baseline:** regenerate for daemon, integrations and server at combine.
- **Commit history:** the Jini branch has `wip:` checkpoints. Per batch:
  - D: `36b43653f`, `6d3ef7505`, `3e03c9bc4`.
  - F: `71c7d640e`, `43c4b1b88`.
  - G: `22e4f10e7`, `e0748feee`.
  - Changesets and docs: `8d8116b44`, `a4ef10142`.
  - Earlier wip commits `a2e944e4c` and `0fa205446` contain batches later reverted in the same branch; the net diff of those packages is zero.
