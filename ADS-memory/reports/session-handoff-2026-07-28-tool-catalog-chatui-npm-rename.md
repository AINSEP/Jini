# Handoff: tool catalog + chat UI + AG-UI/A2UI/MCP-UI research + npm publish attempt

Generated: 2026-07-28T21:19:19Z
Source agent/session: Claude Code (Opus 5) — Programmer(Execution) / Coordinator(Handoff Mode)
Target: a fresh session, likely in a **new repo** (user's stated intent: check this out
elsewhere for audits and code review)

## Next-Agent Prompt

> Read `AI-Dev-Shop/AGENTS.md` first (mandatory startup — if this landed in a repo that still
> has it), then this file. If you're reviewing this as a standalone checkout without
> `AI-Dev-Shop/`, at minimum read `AGENTS.md` at the repo root for the architecture map.
>
> This handoff closes out a long session that: shipped a v0 tool catalog end-to-end, fixed a
> real schema-on-error gap, rebuilt the chat pane's shipped CSS theme, did real spec research
> on WebMCP/MCP-UI/MCP-Apps/A2UI (dispatched as three adversarial stress-test subagents in
> isolated worktrees), transferred the GitHub repo to a new org, removed a stale governance
> gate, and renamed the npm scope from `@jini` to `@injini` after discovering `@jini` was
> already owned by an unrelated third party. **Real npm publish is not done** — blocked by a
> persistent `EOTP` wall on a brand-new npm account; the user is now deciding whether to delete
> that account rather than resolve it. None of that blocks anything else in this repo.

## Current State

- **Branch:** `feat/agentic-capability-layer`. **HEAD:** `eb9104f68` — pushed to
  `origin` (`https://github.com/AINSEP/Jini.git`).
- **Working tree:** clean except one untracked stray file, `landing.png` (143KB, dated
  Jul 25, provenance unclear — not part of this session's described work, deliberately left
  uncommitted; investigate or delete).
- **`pnpm guard`:** clean. **`pnpm typecheck`:** clean repo-wide (verified after a full
  `pnpm -r run build` post-rename).
- **npm:** package scope is now `@injini/*` everywhere (was `@jini/*`). **Nothing is actually
  published** — `npm install @injini/core` today returns 404. See "npm publish saga" below.
- **GitHub:** repo now lives at `AINSEP/Jini` (transferred this session from
  `leonaburime-ucla/Jini`); every package's `repository.url` points there.
- **Three sibling branches, pushed but unmerged** — real work from three parallel stress-test
  subagents, never reviewed. See "Unmerged worktree branches" below.

## Completed Work (this session, chronological, all on `feat/agentic-capability-layer`)

| commit | what |
|---|---|
| `337c017b8` | Separated real AG-UI (`src/ag-ui.ts`) from the de-branded copy that had wrongly absorbed it (`src/gen-ui/`); gated WebMCP confirmations; fixed guard |
| `0c46042aa`, `1bdfed75c` | Capability survey of 10 OSS repos, Cedar/Rego policy-language evaluation (parked, not adopted), tool-catalog vertical-slice plan |
| `3da02b7c8` | **v0 durable tool catalog**: SQLite FTS5 + `bm25()` search, `search_tools`/`describe_tool` MCP tools, `GET /api/tools/search`/`GET /api/tools/:id` HTTP routes, seeded from `zeroConfigToolRegistry.list()` in `createLocalNodeDaemon`. Deliberately **not** wired into the main migration path — opt-in via `ensureToolCatalogTables`, to avoid repeating a prior "tables nobody reads" mistake |
| `c3724a764` | **schema-on-error fix**: every `page.*` capability's validation error now carries the JSON schema, found via live testing (an agent kept guessing field names instead of self-correcting) |
| `efba35692` | **Chat pane UI overhaul**, fixed at the theme's actual source (`packages/chat-react/src/features/chat-pane/react/styles.ts`'s `CHAT_PANE_STYLES`), not duplicated app-side: user/assistant bubble distinction, tool-call accordion cards (`DelegatedToolCard`/`SearchToolsCard`/`DescribeToolCard` in `ToolCard.tsx`) replacing raw JSON dumps, a `Done · 6m 29s · 2612 out · $0.4028` summary line sourced from the real `kind:'usage'` event (never client-estimated) |
| `766496ae2` | GitHub repo transfer to `AINSEP` org + every `package.json`'s `repository.url` updated |
| `be135e77b` | Removed the "locked 14 package" admission gate — the R7 boundary rule and `jini.admission` tiering are gone entirely, per explicit user instruction |
| `a2a71299b` | Repaired dead user-bubble CSS selectors found via a second round of live screenshot review |
| `f73c289d3` | `scripts/pack-for-external-use.ts` — local tarball-based external-consumption path, **verified end-to-end** with a genuine external `npm install` outside the repo |
| `eb9104f68` | **`@jini` → `@injini` scope rename**, all 25 packages, `publishConfig.access` → `public`, `files` arrays extended with dist-test-output exclusion globs, `scripts/publish-all.ts` added |

## Research Completed (verified against real specs, not memory — partially implemented, see worktrees)

- **WebMCP**: real IDL is `document.modelContext.registerTool()` (moved off `navigator.*`),
  returns `Promise<void>`, has `exposedTo`; `unregisterTool` is **not** in the spec (aborting the
  signal is the only mechanism). No native Chromium/Playwright support (origin-trial gated) — a
  **real polyfill exists**, `@mcp-b/webmcp-polyfill` (npm, `WebMCP-org`), used instead of a
  hand-rolled one after the user specifically asked "isn't there a polyfill online?"
- **MCP-UI vs MCP Apps**: MCP-UI (community, `mcpui.dev`) informed the official MCP Apps SEP
  (`@modelcontextprotocol/ext-apps`, SEP-1865, Stable 2026-01-26) — related lineage, **not the
  same protocol**. `mcp-ui.ts` renamed to `mcp-ui-apps.ts` to stop implying they're identical.
- **A2UI**: real spec is `a2ui-project/a2ui`, v1.0 release candidate — 6 agent→renderer + 3
  renderer→agent envelope types, JSON Pointer data binding, catalog-based component/function
  whitelisting as the security boundary. Confirmed this session: `packages/agentic/src/gen-ui/`
  is actually a de-branded **AG-UI** port (CopilotKit's protocol), **not A2UI at all** — a real
  naming/scope confusion that predates this session and was only caught now.
- **OpenAPI audit of `@injini/http`**: no OpenAPI tooling exists today, 78 routes total. Zod
  adoption recommended *if* OpenAPI is ever pursued; not urgent for an internal engine API.

## Unmerged Worktree Branches (pushed to origin, NOT reviewed, NOT merged)

Three adversarial stress-test subagents were dispatched in isolated git worktrees (needed real
filesystem isolation — each ran its own live daemon + Vite dev server concurrently). All three
did real, substantial work but **never committed it themselves**; this session committed each
one's diff as a `wip(...)` checkpoint on its own branch purely to stop it being at risk of loss,
then pushed all three to origin. **None of this has been code-reviewed.**

| branch | contents | known caveat |
|---|---|---|
| `worktree-agent-a4940c179c2f8f632` (commit `7d08e4ee6`) | WebMCP: real-polyfill integration, `WebMcpLab.tsx` live imperative-registration fixture, a `frontend-session-registry.ts` prefix-match bugfix | Base commit is on this branch's history before the rename — will need the `@injini` scope rename re-applied on top before it can build |
| `worktree-agent-a5a117c30cd730739` (commit `ffc3e40b7`) | MCP-UI/Apps: message-direction fix + `id`-validation bugfix in `mcp-ui-apps.ts`, `McpUiLab.tsx`/`McpUiLabHost.tsx` live iframe-hosted fixture (separate `mcpui-view` Vite build) | Same rename issue. Also: a second-opinion model flagged `MCP_UI_HOST_NOTIFICATIONS` as possibly listing some notifications in the wrong direction vs the real spec — **unverified**, check against `@modelcontextprotocol/ext-apps` before trusting |
| `worktree-agent-ae825eb0a6140ca64` (commit `7c71af401`) | New `packages/a2ui/` package (full A2UI implementation: catalog, interpreter, JSON Pointer resolve, agent↔renderer envelopes) + `A2uiLab.tsx` fixture | **Built on a stale base** (`9cb4ffc50`), from *before* the `src/agui` → `src/gen-ui` + `src/ag-ui.ts` split landed on main. Needs real reconciliation, not just a rebase — package naming, import paths, and the gen-ui/ag-ui split all moved out from under it. Also predates the `@injini` rename |

All three need, in order: rebase/reconcile onto current `main`/`feat/agentic-capability-layer`,
the `@injini` scope rename applied, a real test run, and a code review — before any merge.

## npm Publish Saga (important context for an auditor reading the chat history)

1. Attempted a real public `npm publish` of all packages under `@jini/*`. First call: `E404`.
2. Root-caused: **`@jini` was already registered by an unrelated third party** on the public npm
   registry — not something in our control. Renamed the entire scope to `@injini` (commit
   `eb9104f68`), verified clean (`pnpm guard`, `pnpm typecheck`, full rebuild).
3. Significant npm-account/org confusion followed: an npm **org name must match the package
   scope** (`injini`), not the personal username or the GitHub org name (`ainsep`/`AINSEP`) —
   this tripped the user up twice.
4. Discovered npm is mid-rollout on a real policy change (verified via a dated GitHub changelog
   the user linked): granular tokens with 2FA-bypass are being restricted starting ~August 2026,
   full removal ~January 2027. Recommended replacements are Trusted Publishing (OIDC) and Staged
   Publishing — **not adopted this session**, `publish-all.ts` still uses a plain authenticated
   `pnpm publish` loop.
5. **⚠️ Security note for anyone auditing this chat history**: during troubleshooting, the user
   pasted at least two live npm auth tokens and a full set of npm 2FA recovery codes directly
   into the conversation, and mentioned a local file (`~/Downloads/npm_recovery_codes.txt`)
   containing more. The recovery codes were **not** used for login and that file was **not**
   read. All of that material should be treated as **compromised** regardless of what happens to
   the account — rotate/revoke the pasted tokens and regenerate the recovery codes independently
   of any account-deletion decision.
6. Even with a fresh, verified-owning, `auth-only`-2FA-confirmed account, every `pnpm publish`
   call still hit `EOTP` on the very first package. Working theory (**not confirmed via primary
   source**): a probationary anti-abuse window on brand-new npm accounts that requires OTP
   per-publish regardless of the account's own 2FA setting.
7. **As of this handoff, the user is leaning toward deleting the npm account entirely** rather
   than resolving the OTP wall. Flagged to them: this likely won't fix the root cause (the theory
   above ties the wall to account *age*, not username), so a fresh account would likely hit the
   same wall again on its first publish. **Not their call for us to make** — their account,
   their decision.
8. **The working alternative that doesn't depend on any of this**: `scripts/pack-for-external-use.ts`
   builds real tarballs to `dist-tarballs/` and was verified end-to-end with a genuine external
   `npm install` — this fully satisfies "try Jini in another project" without npm registry
   involvement at all.

**Net effect for an auditor**: `@injini/*` packages exist correctly-named and publish-ready in
this repo, but **are not live anywhere on the public npm registry**. Anyone attempting
`npm install @injini/core` today gets a 404. Import syntax, once published, is `@injini/<name>`
— the org name (`injini`) is what matters, not the personal account username.

## Decisions And Constraints (carry forward)

- **BM25/FTS5 first, embeddings optional and later** for tool-catalog search — independently
  agreed with a second model this session; not a fixed embeddings mandate.
- **The tool catalog is an index, not an ACL.** Finding a tool id via `search_tools` grants
  nothing; execution still goes exclusively through `ToolExecutor` via `execute_delegated_tool`.
- **No "locked 14 package" tier anymore.** Package admission is unrestricted; `UNLOCKED.md` is a
  historical record only.
- **Package scope is permanently `@injini/*`.** `@jini` is not recoverable (owned by a third
  party) and reclaiming it was not pursued.
- **Repo boundary rules unchanged**: `packages/@injini/**` must not import `foundry/**`,
  `examples/**`, `AI-Dev-Shop/**`; no product-identity strings; enforced by `pnpm guard`
  (`scripts/check-engine-boundaries.ts`).

## Risks And Open Questions

1. **`landing.png`** at repo root — untracked, unexplained, not part of any described task this
   session. Investigate provenance or delete before anyone treats this repo as clean.
2. **Real npm publish is unresolved** — the `@injini/*` packages don't exist on the registry yet.
   Anything downstream that assumes `npm install @injini/x` works will fail until this is
   resolved (or the tarball path is used instead).
3. **Three worktree branches are unreviewed and partly stale** — see table above. The A2UI one
   in particular needs real reconciliation work, not a mechanical rebase.
4. **MCP-UI-Apps notification direction** — possibly-wrong `MCP_UI_HOST_NOTIFICATIONS` direction
   flagged by a second-opinion model, never independently confirmed against
   `@modelcontextprotocol/ext-apps`. Don't trust it either way without checking.
5. **Tool catalog v0 has zero principal scoping, versioning, or schema narrowing** — documented
   in-code as a stated v0 limitation (`tool-catalog-tools.ts`'s module doc), not a bug, but real
   for anyone auditing security posture.
6. **`ToolExecutor`'s audit trail is still in-memory only**, not durable — a known gap from the
   original tool-catalog plan, unaddressed this session.
7. **The backend service spine is still the load-bearing gap** (per `AGENTS.md`'s port-status
   banner — `server.ts`, `cli.ts` bootstrap, `routes/`, `mcp.ts`, `db.ts` schema, `plugins/` host,
   ~49K lines). Nothing this session changed that overall picture; don't read the tool-catalog/
   chat-UI work as closing it.
8. **Chat pane usage line format is untranslated arithmetic** — `formatDuration`/cost formatting
   in `MessageRow.tsx` are plain JS, fine for now, but note if i18n of number/duration formatting
   ever matters.

## Suggested Skills / Process Notes For A New Repo

- `honest-testing` (`.claude/skills/honest-testing/SKILL.md`) should travel with the repo if the
  planned audits/code reviews touch test coverage — it's the anti-cheating checklist used to
  brief the three stress-test subagents this session.
- The three local code indexes (`codebase-memory-mcp`, Graphify, `understand-anything`,
  see `AGENTS.md`'s "Codebase search" section) are keyed to **this repo's absolute path**. If
  checked out to a new location or a genuinely new repo, they need re-indexing before they can be
  trusted — don't assume search results are current without checking `index_status`/manifests.

## Carried-Over Task List (from the coordinating session's tracker — reproduce here since a new repo won't have it)

Still open, not started or only partially covered by the worktree branches above:

- Build a WebMCP imperative-registration test fixture page vs. AgentLab's declarative
  `data-agent-*` tags — **partially done** in `worktree-agent-a4940c179c2f8f632` (`WebMcpLab.tsx`),
  unreviewed/unmerged.
- Run a broader/harder multi-step stress test (e.g. an expense-claim flow) now that the chat UI
  fixes are in.
- Scope (not build) the multi-project capability-discovery question honestly.
- Investigate `/Users/la/Programming/Tovu`'s admin section via subagent to inform a new example
  app — status unclear, may have been dropped mid-session when the npm publish thread took over.
- Verify `webmcp.ts` against the real spec beyond Jini's own `data-agent-*` tags — **mostly done**
  this session (see "Research Completed" above), though the polyfill integration itself lives
  only in the unmerged WebMCP worktree branch.
- Build exercises/tests for `daemon.db.*` and `chat.*` tools — currently zero live coverage.
- Build a new complex multi-page example app, informed by the (incomplete) Tovu investigation.
- Reorganize `packages/agentic/src/` into `webmcp/`, `a2ui/`, `mcpui/` subdirectories per an
  earlier explicit user request — not done; current layout is flat files
  (`webmcp.ts`, `mcp-ui-apps.ts`, standalone `gen-ui/`/`ag-ui.ts`) plus a *separate*
  `packages/a2ui/` package built in the unmerged worktree (not under `agentic/` at all — worth
  resolving which layout is actually wanted before merging that worktree).

## Handoff Contract

- **Inputs used**: full session transcript (this conversation, including its own summarized
  prefix), `git log`/`status`/`diff` across the main worktree and all three subagent worktrees,
  `pnpm guard` output, direct reads of `MessageRow.tsx`/`tool-catalog-tools.ts`/package.json
  diffs, real spec verification via WebSearch/WebFetch during the session (WebMCP, MCP Apps,
  A2UI, npm's 2FA policy changelog).
- **Output summary**: lets a fresh session — especially in a new repo, without this
  conversation's history — pick up code review or further work without replaying the npm saga,
  re-deriving what's actually committed vs. merely researched vs. stress-tested-but-unmerged, or
  re-discovering the three at-risk worktree branches.
- **Risks**: see "Risks And Open Questions" above; chiefly that npm publish is unresolved, three
  substantial branches are unreviewed (one on a stale base), and a stray untracked file sits at
  the repo root.
- **Suggested next assignee**: Code reviewer / auditor (per the user's stated intent to check
  this into a new repo for exactly that), then Programmer for anything the review surfaces.
