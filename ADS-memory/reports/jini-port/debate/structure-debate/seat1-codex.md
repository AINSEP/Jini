Reading prompt from stdin...
OpenAI Codex v0.144.3
--------
workdir: /Users/la/Desktop/Programming/OSS-Repos/open-design
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: read-only
reasoning effort: high
reasoning summaries: none
session id: 019f6bfa-a909-7c71-8125-378bd35f11be
--------
user
# Jini Structure Debate — Adversarial Critique (blind, independent)

You are ONE independent expert reviewer. You will NOT see other reviewers' critiques. Be adversarial and specific — your job is to find where this proposed structure is wrong, over-engineered, under-engineered, or secretly OD-tilted, and to improve it. Praise is worthless here; sharp objections and concrete fixes are the deliverable.

## Read first

- THE SUBJECT (critique this): `/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/proposed-structure.md`
- Grounding recon/design docs (optional, same dir `.../jini-debate/recon/`): r1b-daemon-design, r2b-packages-design, r2c-repo-skeleton, r3b-sidecar-design, r4b-webui-design, r4c-vite-reference, r5b-consumers-matrix, r6-project-runner, r1c-discovery-capabilities.
- You may inspect any repo READ-ONLY: /Users/la/Desktop/Programming/OSS-Repos/open-design, /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic, /Users/la/Desktop/Programming/{Zana,Open-Marketing,Tovu-Runner,Jini}.

## Verified ground truth

4 real consumers: Open Design (design), Open-Marketing (OD fork w/ marketing tilt + working Vite path + an existing product-neutrality.test.ts guard), Zana (independent bolt/lovable/replit desktop clone; @chassis/* monorepo; ZERO @open-design imports — re-derived the arch), Tovu-Runner (reuses engine, swaps only apps/web/src). open-design-agentic is the most advanced OD trunk: already has a Vite server option, ChatPane+ChatComposer decomposed into feature slices, and a full AI automation harness (AI-Dev-Shop pipeline + ADS-memory durable governance/memory with specs_as_built/architecture.md + dependency-graph.yaml). Binding constraint: NO OD tilt; Vite not Next; refactored ChatPane/ChatComposer (not CopilotKit; AG-UI only as interop).

## Produce exactly these sections (concise, decisive; ~1,200-1,800 words)

1. **Verdict** — one paragraph: is this structure fundamentally right, right-with-fixes, or wrong? State your single biggest concern.
2. **Strongest objections** — the 4-6 sharpest problems, each: the flaw, why it bites, the concrete fix. Prioritize: hidden OD tilt; wrong package granularity (too many/too few of the ~19 packages — name specific merges/splits); boundary/layering errors; anything that breaks for Zana (the zero-OD-import consumer — the hardest test) or Tovu-Runner (swap-only-web-slice).
3. **The open questions** — give a decisive answer to each with reasoning: (a) is workspace-react engine or per-product? (b) code-exec/terminal/capability-registry in v1 or parked? (c) ~19 packages — which merge? (d) does automation/ (AI-Dev-Shop+ADS-memory+project-runner) belong IN the Jini repo or a separate repo? (e) monorepo-with-integrations vs each consumer in its own repo consuming published @jini/*?
4. **Automation layer** — given AI-Dev-Shop + ADS-memory already exist in open-design-agentic, is folding them under `automation/` right? What's the correct relationship between AI-Dev-Shop (pipeline), ADS-memory (durable memory/ledger), and the new project-runner (execution runtime)? Any duplication or missing piece?
5. **What's missing** — capabilities/ports/risks the structure omits entirely.
6. **Revised top-level tree** — your corrected version of the tree (only what you'd change), plus the ordered first 5 extraction tasks.

Ground claims in the actual repos where you can. Distinguish verified from inferred. Read-only: no edits, no git writes. Your entire final message IS your critique.

codex
I’ll use the repository’s codebase-understanding guidance and keep the inspection strictly read-only. I’m first reading the proposed structure and the applicable skill instructions, then I’ll pressure-test the package boundaries against Zana, Tovu-Runner, Open-Marketing, and the agentic trunk.
exec
/bin/bash -lc "sed -n '1,240p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md && sed -n '1,280p' /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/proposed-structure.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
---
name: understand
description: Analyze a codebase to produce an interactive knowledge graph for understanding architecture, components, and relationships
argument-hint: ["[path] [--full|--auto-update|--no-auto-update|--review|--language <lang>]"]
---

# /understand

Analyze the current codebase and produce a `knowledge-graph.json` file in `.understand-anything/`. This file powers the interactive dashboard for exploring the project's architecture.

## Options

- `$ARGUMENTS` may contain:
  - `--full` — Force a full rebuild, ignoring any existing graph
  - `--auto-update` — Enable automatic graph updates on commit (writes `autoUpdate: true` to `.understand-anything/config.json`)
  - `--no-auto-update` — Disable automatic graph updates (writes `autoUpdate: false` to `.understand-anything/config.json`)
  - `--review` — Run full LLM graph-reviewer instead of inline deterministic validation
  - `--language <lang>` — Generate all textual content (summaries, descriptions, tags, titles, languageNotes, languageLesson) in the specified language. Accepts ISO 639-1 codes (`zh`, `ja`, `ko`, `en`, `es`, `fr`, `de`, etc.) or friendly names (`chinese`, `japanese`, `korean`, `english`, `spanish`, etc.). Locale variants supported: `zh-TW`, `zh-HK`, etc. Defaults to `en` (English). Stores preference in `.understand-anything/config.json` for consistency across incremental updates.
  - A directory path (e.g. `/path/to/repo` or `../other-project`) — Analyze the given directory instead of the current working directory

---

## Progress Reporting

Throughout execution, report progress to the user at each phase transition and during batch processing. This keeps users informed on large codebases where analysis can take a long time.

- **Phase transitions:** At the start of each phase, print a status line:
  > `[Phase N/7] <phase name>...`
  >
  > Example: `[Phase 2/7] Analyzing files (12 batches)...`

- **Batch progress:** During Phase 2, report each batch with its index and total:
  > `Analyzing batch X/N (files: foo.ts, bar.ts, ...)` (list up to 3 filenames, then `...` if more)

- **Phase completion:** When a phase finishes, briefly confirm:
  > `Phase N complete. <one-line summary of result>`
  >
  > Example: `Phase 1 complete. Found 247 files across 3 languages.`

---

## Phase 0 — Pre-flight

Determine whether to run a full analysis or incremental update.

1. **Resolve `PROJECT_ROOT`:**
   - Parse `$ARGUMENTS` for a non-flag token (any argument that does not start with `--`). If found, treat it as the target directory path.
     - If the path is relative, resolve it against the current working directory.
     - Verify the resolved path exists and is a directory (run `test -d <path>`). If it does not exist or is not a directory, report an error to the user and **STOP**.
     - Set `PROJECT_ROOT` to the resolved absolute path.
   - If no directory path argument is found, set `PROJECT_ROOT` to the current working directory.
   - **Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), redirect output to the main repository root. Worktrees managed by Claude Code are ephemeral — `.understand-anything/` written there is destroyed when the session ends, taking the knowledge graph with it (issue #133). Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ and the parent of `--git-common-dir` is the main repo root.

     ```bash
     COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
     GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
     if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
       COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
       GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
       if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
         MAIN_ROOT=$(dirname "$COMMON_ABS")
         if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
           echo "[understand] Detected git worktree at $PROJECT_ROOT"
           echo "[understand] Redirecting output to main repo root: $MAIN_ROOT"
           echo "[understand] (Set UNDERSTAND_NO_WORKTREE_REDIRECT=1 to keep PROJECT_ROOT as the worktree.)"
           PROJECT_ROOT="$MAIN_ROOT"
         fi
       fi
     fi
     ```

     Set `UNDERSTAND_NO_WORKTREE_REDIRECT=1` if you intentionally want a per-worktree graph (rare — most users want the redirect).
1.5. **Ensure the plugin is built.** Later phases invoke Node scripts that import `@understand-anything/core`. On a fresh install `packages/core/dist/` does not exist yet — build once.

   **Important:** do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/understand` is a symlink into the real plugin checkout. Prefer runtime-provided plugin roots first (for Claude), then fall back to universal symlinks, skill symlink resolution, and common clone-based install paths.

   Resolve the plugin root like this:

   ```bash
   SKILL_REAL=$(realpath ~/.agents/skills/understand 2>/dev/null || readlink -f ~/.agents/skills/understand 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand 2>/dev/null || readlink -f ~/.copilot/skills/understand 2>/dev/null || echo "")
   COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

   PLUGIN_ROOT=""
   for candidate in \
     "${CLAUDE_PLUGIN_ROOT}" \
     "$HOME/.understand-anything-plugin" \
     "$SELF_RELATIVE" \
     "$COPILOT_SELF_RELATIVE" \
     "$HOME/.codex/understand-anything/understand-anything-plugin" \
     "$HOME/.opencode/understand-anything/understand-anything-plugin" \
     "$HOME/.pi/understand-anything/understand-anything-plugin" \
     "$HOME/understand-anything/understand-anything-plugin"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
       PLUGIN_ROOT="$candidate"
       break
     fi
   done

   if [ -z "$PLUGIN_ROOT" ]; then
     echo "Error: Cannot find the understand-anything plugin root."
     echo "Checked:"
     echo "  - ${CLAUDE_PLUGIN_ROOT:-<unset CLAUDE_PLUGIN_ROOT>}"
     echo "  - $HOME/.understand-anything-plugin"
     echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/understand>}"
     echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/understand>}"
     echo "  - $HOME/.codex/understand-anything/understand-anything-plugin"
     echo "  - $HOME/.opencode/understand-anything/understand-anything-plugin"
     echo "  - $HOME/.pi/understand-anything/understand-anything-plugin"
     echo "  - $HOME/understand-anything/understand-anything-plugin"
     echo "Make sure the plugin is installed correctly."
     exit 1
   fi

   if [ ! -f "$PLUGIN_ROOT/packages/core/dist/index.js" ]; then
     cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @understand-anything/core build
   fi
   ```

   If `pnpm` is missing, report to the user: "Install Node.js ≥ 22 and pnpm ≥ 10, then re-run `/understand`."

2. Get the current git commit hash:
   ```bash
   git rev-parse HEAD
   ```
3. Create the intermediate and temp output directories:
   ```bash
   mkdir -p $PROJECT_ROOT/.understand-anything/intermediate
   mkdir -p $PROJECT_ROOT/.understand-anything/tmp
   ```
3.1. **Purge stale trash dirs.** Phase 7 cleanup `mv`s scratch dirs into `.trash-<timestamp>/` rather than `rm -rf`ing them directly (see issue #301), so that destructive-action gates on hardened hosts don't trip on just-created paths. Reclaim the space here once the trash is older than 7 days — by this point any freshness-window check has long since stopped caring about those dirs:
   ```bash
   find $PROJECT_ROOT/.understand-anything/ -maxdepth 1 -type d -name '.trash-*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true
   ```
3.5. **Auto-update configuration:**
    - If `--auto-update` is in `$ARGUMENTS`: write `{"autoUpdate": true}` to `$PROJECT_ROOT/.understand-anything/config.json`
    - If `--no-auto-update` is in `$ARGUMENTS`: write `{"autoUpdate": false}` to `$PROJECT_ROOT/.understand-anything/config.json`
    - These flags only set the config — analysis proceeds normally regardless.

 3.6. **Language configuration:**
    - Parse `$ARGUMENTS` for `--language <lang>` flag. If found, extract the language code.
    - **Language code normalization:** Map friendly names to ISO codes:
      - `chinese` → `zh`, `japanese` → `ja`, `korean` → `ko`, `english` → `en`, `spanish` → `es`, `french` → `fr`, `german` → `de`, `portuguese` → `pt`, `russian` → `ru`, `arabic` → `ar`, etc.
      - Locale variants: `zh-TW`, `zh-HK`, `zh-CN`, `pt-BR`, etc. are preserved as-is.
    - If `--language` is NOT specified:
      - **Stored preference wins.** If `$PROJECT_ROOT/.understand-anything/config.json` has an `outputLanguage` field, set `$OUTPUT_LANGUAGE` to it and skip the rest.
      - **Otherwise detect (first run only).** Infer the predominant language of the user's conversation as an ISO 639-1 code (`$DETECTED_LANG`). If it is `en` or cannot be confidently determined, set `$OUTPUT_LANGUAGE=en` and proceed silently — no prompt (English users see no change).
      - **If `$DETECTED_LANG` ≠ `en`, confirm once before analyzing:** tell the user you detected `<language>` and ask whether to generate all content in it; they press Enter/"yes" to accept, or type another language code/name to override (normalize via the friendly-name map above). If running non-interactively (no reply possible), skip the wait, use `$DETECTED_LANG`, and print a one-line notice instead of blocking.
      - **Persist** the resolved `$OUTPUT_LANGUAGE` (including `en`) into `config.json` so it never re-prompts for this project.
    - If `--language` IS specified:
      - Update `$PROJECT_ROOT/.understand-anything/config.json` with the new language: merge `{"outputLanguage": "<lang>"}` into existing config.
      - Store as `$OUTPUT_LANGUAGE` for use throughout all phases.
    - **Language directive template:** Store as `$LANGUAGE_DIRECTIVE`:
      ```markdown
      > **Language directive**: Generate all textual content (summaries, descriptions, tags, titles, languageNotes, languageLesson) in **{language}**. Maintain technical accuracy while using natural, native-level phrasing in the target language. Keep technical terms in English when no standard translation exists (e.g., "middleware", "hook", "barrel").
      ```

 4. **Check for subdomain knowledge graphs to merge:**
   List all `*knowledge-graph*.json` files in `$PROJECT_ROOT/.understand-anything/` **excluding** `knowledge-graph.json` itself (e.g. `frontend-knowledge-graph.json`, `backend-knowledge-graph.json`). If any subdomain graphs exist, run the merge script bundled with this skill (located next to this SKILL.md file — use the skill directory path, not the project root):
   ```bash
   python <SKILL_DIR>/merge-subdomain-graphs.py $PROJECT_ROOT
   ```
   The script discovers subdomain graphs, loads the existing `knowledge-graph.json` as a base (if present), and merges everything into `knowledge-graph.json` (deduplicating nodes and edges). Report the merge summary to the user, then continue with the merged graph.

5. Check if `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` exists. If it does, read it.
6. Check if `$PROJECT_ROOT/.understand-anything/meta.json` exists. If it does, read it to get `gitCommitHash`.
7. **Decision logic:**

   | Condition | Action |
   |---|---|
   | `--full` flag in `$ARGUMENTS` | Full analysis (all phases) |
   | No existing graph or meta | Full analysis (all phases) |
   | `--review` flag + existing graph + unchanged commit hash | Skip to Phase 6 (review-only — reuse existing assembled graph) |
   | Existing graph + unchanged commit hash | Ask the user: "The graph is up to date at this commit. Would you like to: **(a)** run a full rebuild (`--full`), **(b)** run the LLM graph reviewer (`--review`), or **(c)** do nothing?" Then follow their choice. If they pick (c), STOP. |
   | Existing graph + changed files | Incremental update (re-analyze changed files only) |

   **Review-only path:** Copy the existing `knowledge-graph.json` to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`, then jump directly to Phase 6 step 3.

   For incremental updates, get the changed file list:
   ```bash
   git diff <lastCommitHash>..HEAD --name-only
   ```
   If this returns no files, report "Graph is up to date" and STOP.

8. **Collect project context for subagent injection:**
   - Read `README.md` (or `README.rst`, `readme.md`) from `$PROJECT_ROOT` if it exists. Store as `$README_CONTENT` (first 3000 characters).
   - Read the primary package manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`) if it exists. Store as `$MANIFEST_CONTENT`.
   - Capture the top-level directory tree:
     ```bash
     find $PROJECT_ROOT -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -100
     ```
     Store as `$DIR_TREE`.
   - Detect the project entry point by checking for common patterns (in order): `src/index.ts`, `src/main.ts`, `src/App.tsx`, `index.js`, `main.py`, `manage.py`, `app.py`, `wsgi.py`, `asgi.py`, `run.py`, `__main__.py`, `main.go`, `cmd/*/main.go`, `src/main.rs`, `src/lib.rs`, `src/main/java/**/Application.java`, `Program.cs`, `config.ru`, `index.php`. Store first match as `$ENTRY_POINT`.

---

## Phase 0.5 — Ignore Configuration

Set up and verify the `.understandignore` file before scanning.

1. Check if `$PROJECT_ROOT/.understand-anything/.understandignore` exists.
2. **If it does NOT exist**, generate a starter file by invoking the bundled script (delegates to `generateStarterIgnoreFile` in `@understand-anything/core`, which reads `.gitignore`, deduplicates against built-in defaults, and emits language-grouped test-file suggestions). Pass `$PLUGIN_ROOT` via the env so the script doesn't have to re-derive it from its own path (which breaks for copied skill installs):
     ```bash
     PLUGIN_ROOT="$PLUGIN_ROOT" node <SKILL_DIR>/generate-ignore.mjs $PROJECT_ROOT
     ```
   - Report to the user:
     > Generated `.understand-anything/.understandignore` with suggested exclusions based on your project structure. Please review it and uncomment any patterns you'd like to exclude from analysis. When ready, confirm to continue.
   - **Wait for user confirmation before proceeding.**
3. **If it already exists**, report:
   > Found `.understand-anything/.understandignore`. Review it if needed, then confirm to continue.
   - **Wait for user confirmation before proceeding.**
4. After confirmation, proceed to Phase 1.

---

## Phase 1 — SCAN (Full analysis only)

Report to the user: `[Phase 1/7] Scanning project files...`

Dispatch a subagent using the `project-scanner` agent definition (at `agents/project-scanner.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project README (first 3000 chars):
> ```
> $README_CONTENT
> ```
>
> Package manifest:
> ```
> $MANIFEST_CONTENT
> ```
>
> Use this context to produce more accurate project name, description, and framework detection. The README and manifest are authoritative — prefer their information over heuristics.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

# Jini — Proposed Structure (debate subject, v1)

Grounded in read-only recon of open-design (OD), open-design-agentic, and the four consumers. This is the CURRENT PROPOSAL to be adversarially critiqued — not settled.

## Goal (binding)

Jini = a general-purpose reusable engine for MANY products, with NO Open Design tilt. OD is one consumer. Confirmed consumers: **Open Design** (design tool), **Open-Marketing** (OD-for-marketing; a full engine fork), **Zana** (bolt/lovable/replit-on-desktop; independent, re-derived the arch with zero @open-design imports), **Tovu-Runner** (desktop operator host; reuses engine, swaps only apps/web/src). Frontend must move to **Vite** (not Next; less memory). Chat UI = **refactored ChatPane/ChatComposer**, NOT CopilotKit (AG-UI only as an interop protocol via the existing agui-adapter).

## Harvest source

Primary source = **open-design-agentic** (most advanced trunk): already has Vite server option, ChatPane+ChatComposer decomposed into `features/chat-pane`+`features/chat-composer`, providers/dom split, agent-tools/browser-actions, plus the AI-Dev-Shop + ADS-memory automation harness. Fall back to OD main only where agentic lacks something.

## Repo strategy

Fresh empty `git init` (NOT gut-down of the 1.6GB OD copy). Preserve valuable branches via `git bundle` first. Populate package-by-package in dependency order with `git filter-repo`/`format-patch` to preserve authorship. Apache-2.0 + NOTICE crediting nexu-io/open-design. OD referenced for ongoing sync via a sibling blobless mirror (`--filter=blob:none`), never submodule/in-tree. Per-package `source-map.md` watermark + `scripts/sync-upstream.ts`.

## Top-level tree

```
jini/
├── packages/                         # THE ENGINE (@jini/*), product-neutral
│   ├── protocol/                     # generic DTOs/events/SSE carved from OD contracts (~8 pure files + agent-tools/)
│   ├── agent-runtime/                # runtimes/ registry + 25 CLI defs + 4 stream parsers + discovery + capability unions
│   ├── daemon-core/                  # createDaemon({ports}) composition root; 10 typed ports replacing any-typed ServerContext
│   ├── persistence/                  # SQLite run/event/conversation stores behind ports
│   ├── platform/                     # OS process/file primitives (verbatim lift)
│   ├── sidecar/                      # NDJSON-IPC runtime (verbatim lift)
│   ├── sidecar-proto/                # neutral; identity injected
│   ├── desktop-host/                 # host-adapter iface → electron + tauri impls; RenderService port
│   ├── chat-core/                    # framework-free types + pure parsers (no React/DOM)
│   ├── chat-react/                   # REFACTORED ChatPane/ChatComposer → headless hooks + presentational + slots
│   ├── artifacts-react/              # RendererRegistry + srcDoc sandbox
│   ├── workspace-react/              # app-shell layer: layout/panels/command-palette/settings/theming (candidate)
│   ├── components/                   # generic primitives
│   ├── agui-adapter/                 # AG-UI event encoder (existing, de-OD'd) — interop seam
│   ├── plugin-runtime/ registry-protocol/ metatool/ download/ diagnostics/ release/
│   ├── code-exec/                    # sandboxed exec + live dev-server preview (Zana needs; OD lacks) — CANDIDATE
│   ├── terminal/                     # PTY port (Zana/OM) — CANDIDATE
│   └── capability-registry/          # auth/storage/payments/db providers (Tovu/Zana) — CANDIDATE
│
├── integrations/
│   └── open-design/                  # THE OD ADAPTER (product-coupled)
│       ├── contracts/                # @od/contracts (~85 OD DTOs/prompts/analytics) → depends on @jini/protocol
│       ├── identity/                 # product name/appId/OD_* env/--od-stamp-* (injected)
│       ├── daemon/                   # OD product daemon (harvested decomposition) → consumes @jini/*
│       ├── web/                      # OD full feature-sliced Vite app (shell, providers, state, all OD features)
│       └── launcher-proto/
│
├── examples/reference-web/               # Vite+React reference host w/ fake transport
├── examples/minimal-host/            # ~35 lines, imports ONLY @jini/* — reusability proof + lint target
│
├── automation/                       # THE AI AUTOMATION LAYER (adopted from open-design-agentic)
│   ├── AI-Dev-Shop/                  # multi-agent delivery pipeline + skills + routing + spec-providers (adopt as-is)
│   ├── ADS-memory/                   # durable committed memory: governance/(constitution,adrs,contracts), sessions/, specs_as_built/(architecture.md+dependency-graph.yaml)
│   └── project-runner/               # the MISSING durable execution runtime: leases (git-ref CAS), queue, sandbox, resumable claim, sync-od, refresh-context
│
├── docs/ (architecture.md, extraction-plan.md, extraction-provenance.md, AGENTS.md)
├── scripts/ (guard.ts, check-engine-boundaries.ts, check-protocol-purity.ts)   # R1-R6 boundary rules incl. product-neutrality string scan
├── pnpm-workspace.yaml  package.json  tsconfig.base.json  LICENSE(Apache-2.0)  NOTICE
```

## Key architecture decisions

1. **Ports/adapters daemon.** `createDaemon({ports})` factory; OD product routes register via a `routeModules` opt-in array from foundry/integrations/open-design. `PortsCoverRoutes<>` compile-time check.
2. **Engine needs ports OD lacks** (code-exec/live-preview, terminal/PTY, capability-registry) so it isn't OD-shaped — driven by Zana/Tovu/OM.
3. **Boundary lint from commit 1** (R1 engine isolation, R3 protocol purity downward-only, R5 product-neutrality string scan — harvest Open-Marketing's existing `product-neutrality.test.ts`).
4. **Frontend = hybrid**: engine ships headless packages; each product is a Vite feature-sliced app implementing slots. Frontend restructuring (App shell, providers, state, router, all features) is a MAJOR workstream, not just ChatPane/Composer.
5. **Automation adopted, not invented**: AI-Dev-Shop + ADS-memory come from open-design-agentic; project-runner is the thin durable execution/lease runtime on top.
6. **Extraction = strangler**: OD stays green until the final adapter-wiring flip; every task carries characterization tests + mock-replay parity.

## Dependency-ordered extraction (high level)

protocol → agent-runtime ∥ persistence → daemon-core → generic routes → OD adapter wiring; in parallel: platform/sidecar/components leaves → desktop-host; chat-core → chat-react/artifacts-react → workspace-react → reference-web/minimal-host. Automation layer (AI-Dev-Shop/ADS-memory adopt + project-runner build) can proceed independently.

## Known open questions

- Is `workspace-react` (reusable app-shell) engine, or should the shell stay per-product?
- Are code-exec/terminal/capability-registry v1, or parked until a consumer needs them?
- ~19 engine packages — too granular? Should some merge?
- Does the automation/ layer belong IN the Jini repo, or as a separate repo consumed by it?
- Monorepo-per-product vs each consumer in its own repo consuming published @jini/*.

codex
The full graph-generation skill is incompatible with the explicit read-only constraint because it creates `.understand-anything/` artifacts. I’m therefore using its read-only chat/query variant and existing repository artifacts where available; no graph or repository files will be created or changed.
exec
/bin/bash -lc "sed -n '1,320p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand-chat/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
---
name: understand-chat
description: Use when you need to ask questions about a codebase or understand code using a knowledge graph
argument-hint: [query]
---

# /understand-chat

Answer questions about this codebase using the knowledge graph at `.understand-anything/knowledge-graph.json`.

## Graph Structure Reference

The knowledge graph JSON has this structure:
- `project` — {name, description, languages, frameworks, analyzedAt, gitCommitHash}
- `nodes[]` — each has {id, type, name, filePath?, summary, tags[], complexity, languageNotes?}
  - Code node types: file, function, class, module, concept
  - Non-code node types: config, document, service, table, endpoint, pipeline, schema, resource
  - Domain/knowledge node types: domain, flow, step, article, entity, topic, claim, source
  - IDs use the node type as prefix, e.g. `file:path`, `function:path:name`, `config:path`, `article:path`
- `edges[]` — each has {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on, configures, documents, deploys, triggers, contains_flow, flow_step, related, cites
- `layers[]` — each has {id, name, description, nodeIds[]}
- `tour[]` — each has {order, title, description, nodeIds[]}

## How to Read Efficiently

1. Use Grep to search within the JSON for relevant entries BEFORE reading the full file
2. Only read sections you need — don't dump the entire graph into context
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow imports and calls for dependency chains

## Instructions

1. Check that `.understand-anything/knowledge-graph.json` exists in the current project root. If not, tell the user to run `/understand` first.

2. **Read project metadata only** — use Grep or Read with a line limit to extract just the `"project"` section from the top of the file for context (name, description, languages, frameworks).

3. **Search for relevant nodes** — use Grep to search the knowledge graph file for the user's query keywords: "$ARGUMENTS"
   - Search `"name"` fields: `grep -i "query_keyword"` in the graph file
   - Search `"summary"` fields for semantic matches
   - Search `"tags"` arrays for topic matches
   - Note the `id` values of all matching nodes

4. **Find connected edges** — for each matched node ID, Grep for that ID in the `edges` section to find:
   - What it imports or depends on (downstream)
   - What calls or imports it (upstream)
   - This gives you the 1-hop subgraph around the query

5. **Read layer context** — Grep for `"layers"` to understand which architectural layers the matched nodes belong to.

6. **Answer the query** using only the relevant subgraph:
   - Reference specific files, functions, and relationships from the graph
   - Explain which layer(s) are relevant and why
   - Be concise but thorough — link concepts to actual code locations
   - If the query doesn't match any nodes, say so and suggest related terms from the graph

mcp: codebase-memory-mcp/list_projects started
mcp: codebase-memory-mcp/list_projects (completed)
exec
/bin/bash -lc "for d in /Users/la/Desktop/Programming/OSS-Repos/open-design /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic /Users/la/Desktop/Programming/Open-Marketing /Users/la/Desktop/Programming/Zana /Users/la/Desktop/Programming/Tovu-Runner /Users/la/Desktop/Programming/Jini; do printf '%s ' \""'$d"; if [ -f "$d/.understand-anything/knowledge-graph.json" ]; then printf '"'graph=yes\\n'; else printf 'graph=no\\n'; fi; done
find /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon -maxdepth 1 -type f -print | sort" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
/Users/la/Desktop/Programming/OSS-Repos/open-design graph=no
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic graph=no
/Users/la/Desktop/Programming/Open-Marketing graph=no
/Users/la/Desktop/Programming/Zana graph=no
/Users/la/Desktop/Programming/Tovu-Runner graph=no
/Users/la/Desktop/Programming/Jini graph=no
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r1-daemon.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r1b-daemon-design.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r1c-discovery-capabilities.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r2-packages.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r2b-packages-design.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r2c-repo-skeleton.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r3-sidecar.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r3b-sidecar-design.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r4-webui.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r4b-webui-design.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r4c-vite-reference.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r5-tovu.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r5b-consumers-matrix.md
/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r6-project-runner.md

codex
The indexed graph covers Open Design, Open-Marketing, and open-design-agentic, but not Zana or Tovu-Runner. I’ll use graph queries for the indexed repos and direct read-only inspection for the two hardest consumers. The key test is whether the proposed “engine” matches actual shared seams or merely renames OD’s current folders.
exec
/bin/bash -lc "wc -l '/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r1b-daemon-design.md' '/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r2b-packages-design.md' '/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r2c-repo-skeleton.md' '/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r3b-sidecar-design.md' '/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r4b-webui-design.md' '/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r4c-vite-reference.md' '/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r5b-consumers-matrix.md' '/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r6-project-runner.md' '/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r1c-discovery-capabilities.md'
for d in /Users/la/Desktop/Programming/Zana /Users/la/Desktop/Programming/Tovu-Runner /Users/la/Desktop/Programming/Open-Marketing /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic; do printf '\\n== %s ==\\n' \""'$d"; find "$d" -maxdepth 3 -name package.json -not -path '"'*/node_modules/*' -print | sort | head -80; done" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 1483ms:
/Users/la/Desktop/Programming/Open-Marketing/apps/daemon/package.json
/Users/la/Desktop/Programming/Open-Marketing/apps/desktop/package.json
/Users/la/Desktop/Programming/Open-Marketing/apps/landing-page/package.json
/Users/la/Desktop/Programming/Open-Marketing/apps/packaged/package.json
/Users/la/Desktop/Programming/Open-Marketing/apps/telemetry-worker/package.json
/Users/la/Desktop/Programming/Open-Marketing/apps/web/package.json
/Users/la/Desktop/Programming/Open-Marketing/e2e/package.json
/Users/la/Desktop/Programming/Open-Marketing/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/agui-adapter/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/components/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/contracts/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/diagnostics/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/download/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/host/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/launcher-proto/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/metatool/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/platform/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/plugin-runtime/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/registry-protocol/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/release/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/sidecar-proto/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/sidecar/package.json
/Users/la/Desktop/Programming/Open-Marketing/tools/dev/package.json
/Users/la/Desktop/Programming/Open-Marketing/tools/pack/package.json
/Users/la/Desktop/Programming/Open-Marketing/tools/release/package.json
/Users/la/Desktop/Programming/Open-Marketing/tools/serve/package.json

== /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic ==
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/desktop/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/landing-page/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/packaged/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/telemetry-worker/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/e2e/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agui-adapter/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/components/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/contracts/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/diagnostics/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/download/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/host/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/launcher-proto/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/metatool/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/platform/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/plugin-runtime/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/registry-protocol/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/release/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/sidecar-proto/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/sidecar/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/dev/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/pack/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/release/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/serve/package.json

exec
/bin/bash -lc "sed -n '1,240p' /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r5b-consumers-matrix.md
sed -n '1,220p' /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r2b-packages-design.md
sed -n '1,280p' /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r4b-webui-design.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# R5b — 4-consumer capability matrix (read-only)

Consumers of the extracted engine ("Jini" = the open-design engine):
1. **OD** — Open Design, the design tool (our `open-design` checkout / engine baseline).
2. **Open-Marketing (OM)** — `/Open-Marketing`, "Open Design for marketing".
3. **Tovu-Runner** — `/Tovu-Runner`, desktop operator host (from R5).
4. **Zana** — `/Zana`, "bolt/lovable/replit on the desktop" (code-gen + live preview).

Legend: **[V]** verified from a file · **[I]** inferred. Consumption model matters
as much as feature list, so it leads each profile.

---

## 1. What each new consumer IS

### Open-Marketing (OM) — a FULL FORK of the OD engine, marketing-tilted
**[V** `package.json`**]** name `open-marketing` **v0.12.1** (ahead of the OD
checkout's 0.10.x), `packageManager pnpm@10.33.2`, description: *"Local-first
marketing workspace: detects installed code-agent CLIs, drafts campaign work, and
keeps design templates and brand systems available for creative production."*
- **Stack:** identical to OD. `apps/{daemon,web,desktop,packaged,landing-page,
  telemetry-worker}` **[V]**. Web is `@open-design/web` on **Next 16 + turbopack**
  (dev), with a **Vite alternative path** (`dev:vite`, `OD_WEB_DEV_SERVER=vite`,
  `tools/dev-vite.ts` spawns daemon :5288 + vite :5274) **[V]**. Node ~24, `od`+`om`
  bins **[V** `bin`**]**.
- **Consumption model = whole-monorepo FORK, not a src-swap.** It ships its OWN
  copy of the engine packages: `packages/{contracts,components,host,platform,
  sidecar,sidecar-proto,plugin-runtime,agui-adapter,download,release,diagnostics,
  metatool,registry-protocol,launcher-proto}` and depends on `@open-design/*`
  `workspace:*` **[V** grep found 27 `@open-design/*` refs**]**. It also keeps OD's
  content dirs: `design-systems/ skills/ design-templates/ craft/ plugins/
  figma-plugin/ mocks/ story/` **[V]**. So OM ≈ OD engine + marketing product
  layer; it is the strongest evidence the engine can be product-neutral.
- **Marketing/divergent surfaces vs OD [V]:** `agui-adapter` (AG-UI/CopilotKit),
  `telemetry-worker`, `apps/landing-page`, `clipper/` (MV3 browser web-clipper into
  the Library), `deploy/` (Dockerfile + docker-compose + aws/ + azure/ self-host),
  `metatool`. Web deps add `@copilotkit/react-core`, `@lexical/*` (rich text),
  `@xterm/xterm` (**terminal**), `jspdf`, `@anthropic-ai/sdk`, `openai` **[V]**.
- **Product-neutrality is already enforced [V** `scripts/product-neutrality.test.ts`,
  `guard`**]:** guard rejects named-orchestrator/product copy on public surfaces
  (`packages/contracts`, `apps/web/app/page.tsx`). This is the live mechanism that
  keeps the engine from re-acquiring an OD (or OM) tilt — directly relevant to Jini.

### Zana — INDEPENDENT lovable/bolt/replit desktop clone (code-gen + live preview)
**[V** `open_source_lovable_bolt_replit_copy.md`, `app-chassis/README.md`, `TODO.md`**]**
- **No root package.json / README** (it is a research workspace). The buildable
  thing is **`app-chassis/`** = a fresh pnpm monorepo, name `app-chassis`,
  `@chassis/*`, `pnpm@9`. **It does NOT reference `@open-design/*` at all** **[V**
  grep empty**]** — fully independent, built by *studying* OD/payload/directus/
  wordpress/open-webui/dify as reference repos (`open-design-learnings.md`) **[V**
  TODO.md**]**.
- **Stack [V** `app-chassis`**]:** `apps/{daemon,web(Next, SSR/SEO),studio(Vite
  builder UI),desktop(Electron)}`; `packages/{core,ai,db,auth,storage,payments,
  plugins,themes,ui,admin,cli,templates}`; `providers/supabase`. Daemon boots on
  :4000, `GET /capabilities`. Most packages are stubs; built slice = core+db+ai+daemon.
- **Architecture thesis [V** README "Core principles"**]:** "Rigid core, flexible
  edges." **Capability ports + providers** (`db/auth/storage/realtime/llm/payments`;
  a provider declares which capabilities it implements — `sqlite`→`db`, Supabase→
  `db+auth+storage+realtime`). **`actions.ts` in every package** registers
  AI-callable tools so chat drives everything. **`ToolRegistry` with only
  `search_tools`+`call_tool` meta-tools** (avoid tool overload). **MCP/AG-UI/A2A are
  transport adapters, never core.** This is remarkably close to OD's own trajectory
  (tools.ts registry, web-MCP) but re-derived independently → high-confidence seam.
- **Zana's distinctive need vs OD [V** vision md §10, lines 78-81, 501-522**]:**
  **live preview + dev server + sandbox/container/WebContainer runtime + terminal/
  shell + secure code execution** (E2B, Daytona, Docker, Firecracker microVMs,
  StackBlitz WebContainers, Sandpack). This is the row OD does NOT have (OD only
  does *static* sandboxed-iframe artifact preview) — see §3.

### OSS-Marketing-Repos — NOT a consumer, reference material only
`/OSS-Marketing-Repos` **[V** ls**]** is a library of upstream OSS marketing tools
(chatwoot, dittofeed, formbricks, inngest, jitsu, listmonk, matomo, novu, posthog,
rudder-server, trigger.dev, unomi). It is domain *reference* Open-Marketing mines
for its marketing capabilities (analytics, email/newsletter, CDP, event pipelines,
workflow/cron) — not an engine consumer. Note `trigger.dev`/`inngest` are durable
job-runner references relevant to the Jini project-runner (§4).

---

## 2. THE 4-CONSUMER CAPABILITY MATRIX (key deliverable)

Marks: **C** = present as engine-level capability · **P** = present but product-
specific content/domain · **A** = needs an adapter/port not yet in OD · **—** = absent.
"Engine core?" = shared by ALL 4 (or by 3 with the 4th plausibly).

| Capability | OD | OM | Tovu-Runner | Zana | Engine core? |
|---|---|---|---|---|---|
| **Daemon HTTP API** (`/api/*`) | C | C (fork) | C (reuses OD daemon) | C (`@chassis/daemon` :4000) | **CORE — all 4** |
| **CLI binary** (`od`/`om`, embeddability) | C | C (`om`+`od`) | C (runs engine `cli.js`) | C (`packages/cli`, `/capabilities`) | **CORE — all 4** |
| **Headless chat runtime** | C (but monolith ChatComposer) | C (+`agui-adapter`/CopilotKit) | C (CopilotKit rebuild, rejects ChatComposer) | C (chat drives `actions.ts`) | **CORE — all 4 (all trending headless/AG-UI)** |
| **Agent runtimes** (spawn CLI agents, BYOK) | C (21 CLIs, AMR) | C (detects code-agent CLIs) | C (via engine) | C (LLM gateway + agent loop) | **CORE — all 4** |
| **Tool registry** (`search_tools`/`call_tool` + per-domain actions) | C (tools.ts registry, web-MCP) | C (fork) | ~ (via engine) | C (central thesis) | **CORE — convergent** |
| **Sandboxed artifact / preview render** (iframe, HTML/PDF/PPTX/MP4) | C | C (fork) | C (media/websites preview) | C (live preview central) | **CORE — all 4** |
| **Multi-project / workspace** (`workspaceId`) | C (projects) | C | C (websites, workspaceId) | C (desktop manages many projects) | **CORE — all 4** |
| **Themes / appearance** | C (≈design systems) | C | C (`themes/`,`appearance/`) | C (`packages/themes`) | **CORE — all 4** |
| **Plugin runtime** (signed ESM + manifest) | C (261 plugins) | C (`plugin-runtime`) | C (`plugins/`) | C (`packages/plugins`) | **CORE — all 4** |
| **Settings** | C | C | C (`settings/`) | C | **CORE — all 4** |
| **i18n** | C (18 locales) | C (`i18n:check`) | C (`i18n/`) | ? (unseen) | core-likely (3/4) |
| **Observability / telemetry** | C | C (`telemetry-worker`) | C (`observability/`) | ? | core-likely (3/4) |
| **Media gen — image** | C (14 providers) | C | C (MediaStudio stills) | — | shared-3 (design lineage), engine port |
| **Media gen — video** | C (HyperFrames/MP4) | C | C (MediaStudio motion) | — | shared-3, engine port (NOT universal) |
| **Design-systems** (`DESIGN.md` brand contracts) | P (150) | P (fork) | — (uses themes, not DESIGN.md) | — | **PRODUCT (OD/OM only) — classic OD tilt** |
| **Brands** | P | P | — | — | PRODUCT (OD/OM) |
| **Figma** (`figma-plugin`) | P | P | — | — | PRODUCT (OD/OM) |
| **Code-gen + live dev-server + sandboxed EXEC** | — (static preview only) | — | — | **A (core need)** | **ZANA-ONLY → must become engine port (§3)** |
| **Terminal / PTY** (xterm) | ~ | C (`@xterm` in web) | — | A (shell panel) | shared-2 → engine port |
| **Capability-provider model** (auth/storage/payments/db swappable) | thin | thin | C (ports+sqlite/memory) | C (ports+Supabase) | **CORE-convergent (Tovu+Zana explicit) → engine port** |
| **Marketing domain** (campaigns, CDP, email, deploy/self-host) | — | P (only) | — | — | PRODUCT (OM adapter) |
| **CMS / website ops** (posts/comments/newsletter/members) | — | ~ | P (hosts Tovu product) | ~ (member-directory app) | PRODUCT (Tovu adapter) |
| **Project-runner / cloud agent work + ledgers** | — | — | — | — | future engine capability; prototyped by AI-Dev-Shop (§4) |

**Confirmed engine CORE (shared by all 4):** daemon HTTP API · CLI · headless
chat runtime · agent runtimes · tool registry (search/call + actions) · sandboxed
preview render · multi-project/workspace (`workspaceId`) · themes · plugin runtime ·
settings. **Core-likely (3/4):** i18n, observability, capability-provider ports.

**Product adapters (NOT engine):** design-systems/brands/figma (OD+OM) · media
gen image/video (design-lineage 3, absent in Zana) · marketing/deploy (OM) ·
CMS/website (Tovu) · code-gen/live-exec (Zana).

---

## 3. What Zana / OM need that OD does NOT — must be first-class engine ports

Designing to OD alone would miss these; all are load-bearing for a non-OD-tilt engine:

1. **Sandboxed code execution + live dev-server preview (Zana, load-bearing).**
   OD's preview is a *static* sandboxed iframe of a finished artifact. Zana needs a
   **running project**: file-write loop → dev server (Vite/Next) → hot-reload → live
   iframe, plus a **secure exec sandbox** (E2B / Daytona / Docker / Firecracker /
   WebContainer). Jini needs a **"workspace runtime / sandbox-exec port"** with a
   preview-URL contract — orthogonal to the artifact renderer. **[V** vision §10**]**
2. **Terminal / PTY port (Zana + OM).** OM's web already bundles `@xterm/xterm`;
   Zana wants a shell panel. A generic PTY/terminal stream belongs in the engine,
   not a product. **[V]**
3. **Capability-provider registry with auth / storage / payments / db / realtime
   (Zana + Tovu, convergent).** OD models these thinly; Zana and Tovu both built an
   explicit port+provider layer (Supabase, sqlite/memory). This should be an engine
   primitive (`ports.ts` + provider registry declaring capabilities), so products
   swap Supabase/SQLite/Stripe without touching core. **[V** both READMEs**]**
4. **Self-host / deploy target (OM).** OM ships `deploy/` (Docker/AWS/Azure). A
   headless server-deploy path (not just a desktop app) should be an engine mode.
5. **AG-UI / CopilotKit as the blessed chat transport.** OM (`agui-adapter`),
   Tovu-Runner (CopilotKit rebuild), and Zana (AG-UI adapter) independently chose
   AG-UI/CopilotKit over OD's ChatComposer — the engine's chat seam should target
   this, and OD's monolithic composer should NOT be the reusable artifact.

---

## 4. Is AI-Dev-Shop the right prototype for the Jini project-runner? (one paragraph)

`AI-Dev-Shop` is dropped into **three** of the four repos (Open-Marketing,
Tovu-Runner, Zana each vendor their own `AI-Dev-Shop/`) **[V]**, which makes it the
de-facto shared orchestration substrate across the family — a strong vote of
confidence. As a *design prototype* for the runner it is right: it already models a
**staged multi-agent pipeline** (analyzer→spec→red-team→architect→TDD→programmer→
QA→review→security→docs), with `framework/{memory, reports, routing, governance,
workflows}` and `harness-engineering/{agent-evals, harness-evals, hooks, policy}` —
i.e. exactly the **stage model + memory/ledger + governance-gate + routing
vocabulary** a Jini `project-runner` (cloud agent work + ledgers) needs. BUT it is a
**prompt/agent-instruction framework dropped into a repo**, not a runnable control
plane: no durable queue, no sandbox pool, no persisted run-ledger service, no
concurrency/retry engine. So use AI-Dev-Shop as the **conceptual/vocabulary blueprint**
for the runner's pipeline and ledger schema, but the actual runtime should be a real
service (durable job queue + sandbox-exec pool + artifact/run ledger) — the OSS
references already sitting in `/OSS-Marketing-Repos` (`trigger.dev`, `inngest`) are the
better shape for that execution substrate. Net: AI-Dev-Shop = the *what/stages*;
trigger.dev/inngest-style durable runner = the *how/runtime*.

---

## Caveats / unverified
- Zana's `app-chassis` is an early prototype (most `packages/*` and `apps/{web,
  studio,desktop}` are stubs per its README); its capability marks reflect stated
  architecture + built core slice, not a finished product.
- OM is a living fork ahead of the OD checkout; a few OM-only packages
  (`agui-adapter`, `metatool`, `telemetry-worker`) may or may not exist in the OD
  checkout — treat them as engine candidates OM has already pulled forward.
- i18n/observability marks for Zana are unverified (dirs not seen) — listed 3/4.
- Media image/video for Zana marked absent from its vision; not exhaustively ruled out.
# R2b — `@jini/*` engine package design (extraction blueprint)

Builds on `r2-packages.md`. All partition/edge claims verified by grep over `packages/contracts/src`; effort/verdicts are inferred judgment. Read-only; no edits made.

Fresh-repo layout assumption:
- `packages/@jini/*` — the reusable engine (generic, product-neutral).
- `foundry/integrations/open-design/*` — OD-specific product contracts + identity adapters that consume `@jini/*`.

---

## 1. Final `@jini/*` package list

| `@jini/*` name | OD origin | One-line responsibility | Allowed deps | Forbidden | Stays in `foundry/integrations/open-design`? |
|---|---|---|---|---|---|
| `@jini/platform` | `platform` | Generic OS process/file primitives: stamp serialization, cmd parse, process match, atomic copy, toolchain bin discovery | Node builtins only | react, next, product constants | no (pure lift) |
| `@jini/components` | `components` | Headless React UI primitives (Button/Dialog/Input/Select/Textarea/VisuallyHidden) | react (peer) | Node, product logic, `.od-*` names | no |
| `@jini/metatool` | `metatool` | Build-metadata hash/check/write for tool dist outputs | zod, Node builtins | product constants | no (may be optional) |
| `@jini/registry-protocol` | `registry-protocol` | Zod schemas + backend types for a marketplace/registry protocol | zod | Node, product | no |
| `@jini/download` | `download` | Managed download store (atomic copy/lock/prune/manifest) | `@jini/platform`, Node builtins | product constants | no (rename sentinels) |
| `@jini/diagnostics` | `diagnostics` | Diagnostics bundle: JSON/text redaction + zip builder | jszip, Node builtins | product endpoints | no (rename prefix) |
| `@jini/sidecar` | `sidecar` | Generic sidecar runtime: JSON-IPC transport, path/runtime resolution, launch env | Node builtins | hardcoded product paths/env | no (parameterize paths) |
| `@jini/sidecar-proto` | `sidecar-proto` | **Neutral** sidecar business protocol: stamp descriptor (5 fields), namespace validation, IPC message schema, status shapes — with injectable product identity | `@jini/release` | hardcoded OD identity strings | identity values injected by OD adapter |
| `@jini/release` | `release` | Channel/version parse+format algorithms; app-identity via injected config | none | hardcoded product name/appId | identity data supplied by OD adapter |
| `@jini/protocol` | `contracts` (generic core) | Product-neutral wire core: JSON value types, error taxonomy, SSE transport envelope, task shapes, agent-tool registry | zod | `api/*` OD DTOs, prompts, analytics | no — this is the extraction prize |
| `@jini/plugin-runtime` | `plugin-runtime` | Pure plugin/skill manifest parse/merge/resolve/validate + adapters | `@jini/protocol` (plugin types), zod, `node:crypto` | fs, network, sqlite | no (retype off protocol, not OD contracts) |
| `@jini/host` (optional) | `host` | Neutral renderer host-bridge protocol (`window.__host__`) | `@jini/release` | OD capability names | rename `OpenDesignHost*`; drop if no desktop host |
| `@jini/agui-adapter` (optional) | `agui-adapter` | Map a native event union onto AG-UI canonical wire | `@jini/protocol` event union | OD-only event names | re-point input to engine events |

**Stays entirely in `foundry/integrations/open-design` (NOT `@jini/*`):**
| OD package | Reason |
|---|---|
| `@open-design/contracts` OD half (40 `api/*` DTOs, `prompts/*`, `design-systems/*`, `analytics/*`) | OD product ontology; consumes `@jini/protocol` |
| `launcher-proto` | Packaged desktop-launcher glue (`--od-launcher-*`); pure OD packaging |
| OD identity config for `release`/`sidecar-proto`/`host` | Product name, appIds, `OD_*` keys injected here |

---

## 2. THE CONTRACTS SPLIT (the prerequisite)

Verified internal import graph of the generic-core candidates:
- `common.ts` — **zero imports** (defines `JsonValue` etc.). Pure root.
- `errors.ts` — imports only `type JsonValue from './common'`. Generic.
- `tasks.ts` — zero imports. Generic.
- `execution-profile.ts` — zero imports. Generic.
- `sse/common.ts` — zero imports; defines `SseTransportEvent` envelope. Generic root.
- `agent-tools/*` — internal only + `type JsonValue from '../common'`; `registry.ts` docblock says "MUST NOT import apps/*". Generic cluster.
- `critique.ts` — imports `zod`; deliberately **re-mirrors** `SseTransportEvent` locally instead of importing it (comment confirms). Generic, self-contained.
- **`sse/chat.ts` / `sse/proxy.ts`** — import `SseTransportEvent` (generic) BUT ALSO `../api/chat`, `../api/proxy`, `../api/live-artifacts`. → **OD-bound**: the transport envelope is generic, the concrete chat/proxy unions are OD.
- **`examples.ts`** — imports ~9 `api/*` modules. → OD.

### Partition — file by file

**→ `@jini/protocol` (generic core, moves to engine):**
- `src/common.ts` (JsonValue + shared scalars) — root, no edges.
- `src/errors.ts` (error taxonomy) — depends on `common` only.
- `src/tasks.ts` (task shapes) — no edges.
- `src/execution-profile.ts` — no edges.
- `src/critique.ts` — self-contained (local SSE mirror), zod only.
- `src/sse/common.ts` (`SseTransportEvent` transport envelope) — no edges.
- `src/agent-tools/` **entire dir** (`actions, descriptor, manifest, registry, task, index`) — internal + `common` only. High-value: the agent-tool registry port.
- `src/index.ts` — split into a generic barrel (engine) + an OD barrel (product).

**→ stays OD (`foundry/integrations/open-design`, becomes `@od/contracts` consuming `@jini/protocol`):**
- `src/api/` — **all 40 files** (agent-sessions, amrWallet, app-config, artifacts, attribution, automations, brands, chat, comments, community, connectionTest, connectors, context, export, figma, files, finalize, github, handoff, host-tools, library, live-artifacts, mcp, media, memory, orbit, plugin-candidates, projects, providerModels, proxy, reasoningExecution, registry, research, routines, run-completeness, social-share, terminals, version, whats-new, workspaces).
- `src/prompts/` — all (OD system prompts, deck-framework, discovery, official-system, media-contract, directions, atom/plugin blocks).
- `src/design-systems/` — all (components-manifest, token-schema, derived-token-outputs).
- `src/analytics/` — all (OD event names/taxonomy, observability, public-params, artifact-id).
- `src/plugins/` — all (OD plugin/marketplace DTOs).
- `src/artifacts/od-card.ts`, `src/runtime/deck-stage-fallback.ts`.
- `src/sse/chat.ts`, `src/sse/proxy.ts` — OD-specific SSE unions (import `api/*`).
- `src/examples.ts` — OD example payloads (imports 9 `api/*`).

### Forced dependency edges (the split's contract)
- `@od/contracts` **→ depends on `@jini/protocol`**: `sse/chat.ts`/`sse/proxy.ts` need `SseTransportEvent`; `errors` `SseErrorPayload` is referenced by SSE unions; `agent-tools` `JsonValue`. This is the intended single downward edge (product → engine).
- No engine file imports any `api/*` — verified: the generic-core files import only `common`, `zod`, or nothing. **The core is cleanly severable.**
- Watch item: `SseErrorPayload` lives in `errors.ts` (generic) and is consumed by both OD SSE unions and generic `critique.ts` (via its local mirror) — keep it in `@jini/protocol` so both sides depend downward, never sideways.

**Verdict:** ~8 files/1 dir (`common, errors, tasks, execution-profile, critique, sse/common, agent-tools/*`) lift cleanly into `@jini/protocol`; the other ~85 files stay as OD product contracts. The core has zero inbound edges from OD DTOs, so it can be extracted first without touching the 40 api files.

---

## 3. De-OD-identity rename campaign

Verified constants by package, with disposition:

### `sidecar-proto` (the OD-identity chokepoint)
| Constant (verified) | Disposition |
|---|---|
| `OD_SIDECAR_BASE / IPC_BASE / IPC_PATH / NAMESPACE / SOURCE`, `OD_PORT`, `OD_DAEMON_CLI_PATH`, `OD_WEB_PORT/DIST_DIR/TSCONFIG_PATH`, `OD_TOOLS_DEV_PARENT_PID` env keys | **(a) parameterize** — make env-key prefix a config the OD adapter supplies (`JINI_*` default, OD passes `OD_*`). |
| `--od-stamp-{app,ipc,mode,namespace,source}` flags | **(a) parameterize** flag prefix (default `--jini-stamp-*`; OD adapter overrides to `--od-stamp-*`). |
| `ipcBase: "/tmp/open-design/ipc"`, `windowsPipePrefix: "open-design"` | **(a) inject** as product path config, not a hardcoded default. |
| `OPEN_DESIGN_PRODUCT_NAME = "Open Design"`, `OD_REQUIRE_DESKTOP_AUTH` | **(c) keep in OD adapter** — pure product identity. |

### `sidecar`
| `/tmp/open-design/ipc/<ns>/<app>.sock` path layout (`paths.ts`), `OD_JSON_IPC_TRACE` env, `[open-design sidecar]` log tag | **(a) parameterize** — path builder + trace-env + log-tag become injected config. `paths.ts` header already flags "Open Design-specific strings hardcoded here" → the exact seam. |

### `release`
| `PRODUCT_NAME = "Open Design"`, `DEFAULT_NAMESPACE = "open-design"`, `appId: "io.open-design.desktop.*"`, channel identity | **(c) keep in OD adapter** as an identity-config object; `@jini/release` keeps only channel/version *algorithms* and takes identity as input. Channel enum names (beta/prerelease/preview/stable) → **(b) neutral** (generic release vocabulary, keep). |

### `host`
| `OPEN_DESIGN_HOST_GLOBAL`, `OPEN_DESIGN_HOST_VERSION`, `OpenDesignHostBridge` + all `OpenDesignHost*` types, `window.__od__` | **(b) rename** to `@jini/host` neutral (`JINI_HOST_GLOBAL`, `JiniHostBridge`, `window.__host__`) IF Jini ships a desktop host; capability namespaces (project/pdf/capture/updater/pet/shell) that are OD-specific → **(c) OD adapter**. Otherwise **drop** the package. |

### `download` / `diagnostics` (cosmetic)
| `.open-design-download-root.json`, `open-design-managed-download-root`, `open-design-managed-download` | **(b) neutral** (`.jini-download-root.json`, etc.). |
| `DIAGNOSTICS_FILENAME_PREFIX = "open-design-diagnostics"` | **(b) neutral** (`jini-diagnostics`). |

### `contracts` generic core
| `analytics` event names, `prompts` product strings | **(c) stay OD** — not in `@jini/protocol` at all. Generic core carries no OD identity. |

Principle: **(a) parameterize** anything that is a runtime path/env/flag prefix (so one engine binary serves any product); **(b) rename** cosmetic sentinel/type names; **(c) keep in OD adapter** anything that is product identity data (name, appId, capability set).

---

## 4. Dependency-ordered extraction sequence

Roots = `release`, `contracts`(→`@jini/protocol` core). Clean leaves = platform/components/metatool/registry-protocol.

1. **`@jini/platform`** — zero deps, cleanest leaf. Unblocks download.
2. **`@jini/components`** — zero deps (react peer). Independent.
3. **`@jini/metatool`** — zero deps. Independent (build tooling).
4. **`@jini/registry-protocol`** — zero deps (zod). Independent.
5. **`@jini/release`** — zero deps once identity is injected; needed by sidecar-proto/host. Extract early.
6. **`@jini/protocol`** — the generic core carved from contracts (`common, errors, tasks, execution-profile, critique, sse/common, agent-tools/`). Depends on nothing but zod. Unblocks plugin-runtime, agui-adapter, and the OD contract layer.
7. **`@jini/download`** — needs (1) `@jini/platform`.
8. **`@jini/sidecar-proto`** — needs (5) `@jini/release`.
9. **`@jini/sidecar`** — zero workspace deps, but do after (8) so the neutral proto/config seam exists to inject paths.
10. **`@jini/diagnostics`** — zero workspace deps; any time after leaves. (jszip only.)
11. **`@jini/plugin-runtime`** — needs (6) `@jini/protocol` (retype plugin types off it).
12. **`@jini/agui-adapter`** (optional) — needs (6) `@jini/protocol` event union.
13. **`@jini/host`** (optional) — needs (5) `@jini/release`; do only if desktop host is in scope.
14. **`foundry/integrations/open-design/contracts`** — the OD half (40 api DTOs + prompts + analytics + design-systems + OD SSE unions); depends on (6) `@jini/protocol`. Last, since it consumes the engine.

Nothing blocked: steps 1–6 have no cross-`@jini` edges; 7–14 each depend only on earlier-numbered packages.

---

## 5. Per-package effort + single riskiest de-coupling

| `@jini/*` | Effort | Riskiest de-coupling |
|---|---|---|
| `@jini/platform` | **S** | Almost none; only scrub doc-comment OD references. Risk: toolchain bin-list may encode OD agent CLIs — verify `toolchain.ts` search list is product-neutral. |
| `@jini/components` | **S** | Renaming `.od-*` CSS classes without breaking consumers' selectors. |
| `@jini/metatool` | **S** | None (0 coupling); risk is it's simply unneeded, adding surface for nothing. |
| `@jini/registry-protocol` | **S** | Confirm its schemas aren't secretly OD-marketplace-shaped before assuming Jini reuses them. |
| `@jini/download` | **S** | Sentinel-string rename is a data migration risk for existing stores (breaks discovery of old roots) — but greenfield Jini has none. |
| `@jini/diagnostics` | **S** | Prefix rename only; redaction rules may be tuned to OD secret shapes — audit `redaction.ts` patterns. |
| `@jini/release` | **S–M** | Cleanly separating channel/version *algorithm* from the interleaved identity constants in a single 236-LOC file. |
| `@jini/sidecar` | **S–M** | `paths.ts` hardcodes the `/tmp/open-design` socket layout as defaults — injecting a path/env config without breaking the IPC socket contract (both ends must agree). |
| `@jini/sidecar-proto` | **M** | Turning ~a dozen `OD_*`/`--od-stamp-*`/product-path constants into injectable config while keeping the 5-field stamp invariant and namespace validation intact; every downstream launcher reads these. |
| `@jini/protocol` | **M** | Splitting `contracts/src/index.ts` barrel cleanly so `SseErrorPayload`/`SseTransportEvent`/`JsonValue` stay in the engine while OD SSE unions (`sse/chat`,`sse/proxy`) re-import downward — a mis-split creates a sideways engine→OD edge. (Core files themselves are edge-free, so risk is barrel hygiene, not logic.) |
| `@jini/plugin-runtime` | **M** | It imports OD `PluginManifest`/`PluginPipeline` from contracts and speaks skill/design-system/craft vocabulary; re-typing against `@jini/protocol` without smuggling OD semantics into the engine. |
| `@jini/agui-adapter` | **M** | The OD-native event union is the mapping's whole input; defining a neutral engine event union it can map from without losing OD-specific event coverage. |
| `@jini/host` | **M** | Deciding which of project/pdf/capture/updater/pet/shell namespaces are generic host capabilities vs OD-desktop-only (likely most are OD → package may not be worth extracting). |

Riskiest overall: **`@jini/protocol` barrel split** (correctness of the downward-only edge) and **`@jini/sidecar-proto` parameterization** (identity invariants + many downstream readers). Both are the load-bearing seams.
# R4b — Jini Reusable Frontend Layer: Design

Design for the fresh Jini repo's reusable chat/artifact frontend, extracted from
`open-design/apps/web`. Grounded in verified OD shapes (§sources cite real files
+ line counts). "Verified" = read the actual code; "Design" = proposed for Jini.

Verified anchor shapes:
- Transport handler: `DaemonStreamHandlers` (`providers/daemon.ts:261`) = `{ onAgentEvent(ev), onToolInputDelta?(id,name,delta), ...StreamHandlers(onError,onDone) }`; entry `streamViaDaemon({...})` (`daemon.ts:628`).
- Event union: `PersistedAgentEvent` (`packages/contracts/src/api/chat.ts:568`) — generic variants (`status`,`text`,`thinking`,`tool_use`,`tool_result`,`usage`,`raw`) MIXED with OD variants (`live_artifact`,`live_artifact_refresh`,`plugin_candidate`,`conversation_title`,`diagnostic`).
- `ChatMessage` (`chat.ts:642`) = `{ id, role, content, agentId?, agentName?, events?: PersistedAgentEvent[], runId?, runStatus?, resumable?, ... }`.
- Tool render props: `ToolRenderProps` (`runtime/tool-renderers.ts:24`) = `{status,name,args,result,isError}`, status ∈ `inProgress|executing|complete|error`.
- Artifact renderer: `ArtifactRenderer` (`artifacts/renderer-registry.ts:11`) = `{id, supportsStreaming, renderPartial?, canRender(ctx)}`.

---

## 1. Three-package specs

### `@jini/chat-core` — framework-free types + pure parsers
- **Source origin (lift from):**
  - Event/message types: the *generic subset* of `packages/contracts/src/api/chat.ts` (`PersistedAgentEvent` minus OD variants; `ChatMessage`, `ChatRole`, `ChatRunStatus`).
  - Pure parsers: `apps/web/src/artifacts/{parser,strip,validate,manifest,question-form,recover,pointer}.ts` (~2,000 lines), `apps/web/src/runtime/{todos,tool-events,chat-events,partial-json}.ts`, `deriveToolStatus`/`toRenderProps` from `runtime/tool-renderers.ts:101-124`, transcript helpers from `providers/daemon.ts:73-245` (`latestUserPromptFromHistory`, `buildTranscript`, `sanitizePriorAssistantTurn`).
- **Public API surface:**
  - Types: `AgentEvent` (generic union + `{kind:'ext'; name:string; data:unknown}` escape hatch for host-specific events), `ChatMessage`, `ChatRole`, `RunStatus`, `ChatAttachment`, `ToolStatus`, `ToolRenderProps`, `ArtifactManifest`, `QuestionForm`/`DirectionCard`/`FormOption`.
  - Fns: `parseArtifacts()`, `splitStreamingArtifact()`, `stripArtifact()`, `validateArtifact()`, `parseQuestionForm()`, `splitOnQuestionForms()`, `formatFormAnswers()`, `deriveToolStatus()`, `toRenderProps()`, `dedupeToolUsesById()`, `parseTodoWriteInput()`, `latestTodoWriteInput()`, `parsePartialJson()`, `buildTranscript()`.
- **Allowed deps:** none beyond TypeScript stdlib. Pure functions only.
- **Forbidden:** React, DOM (`window`/`document`/`fetch`/`EventSource`), Next.js, any `@open-design/*` or product package, node fs/process.
- **Behind slots:** nothing — this is the shared vocabulary every layer + host speaks.

### `@jini/chat-react` — headless hooks + presentational + slots
- **Source origin:**
  - Presentational leaves already near-clean: `components/ToolCard.tsx` (582, 0 design refs), `QuestionForm.tsx` (890), `QuestionsPanel.tsx` (521), `NextStepActions.tsx` (1069, prune OD actions), `runtime/markdown.tsx`, `runtime/todos.ts` pinned-card logic.
  - Headless hooks: extracted from the three god-shells' state (see §3/§4).
  - Transport port: generalize `providers/daemon.ts` `streamViaDaemon` + `DaemonStreamHandlers`.
- **Public API surface:**
  - Hooks: `useConversation`, `useRunStream`, `useComposer`, `useToolTimeline`, `usePinnedTodos`, `useQuestionForms`, `useArtifactStream` (§4).
  - Components (all presentational, props-in/JSX-out): `<MessageList>`, `<MessageRow>`, `<ToolCard>`, `<Composer>`, `<AttachmentTray>`, `<QuestionForm>`, `<QuestionsPanel>`, `<TodoCard>`, `<NextStepActions>`.
  - Context providers + slot registries: `<JiniChatProvider>` (wires transport, project, analytics, i18n, tool/artifact registries), `registerToolRenderer()` (re-export of `runtime/tool-renderers.ts` as-is — already 0 OD refs).
  - All slot interfaces from §2.
- **Allowed deps:** `react`, `react-dom` (portals only), `@jini/chat-core`, `@jini/artifacts-react`.
- **Forbidden:** direct `fetch`/`EventSource`/`localStorage`/`window` (transport reaches host via `ChatTransport` port), Next.js, any product package (`@open-design/*`), OD `providers/registry`, OD `state/*`, OD `router`.
- **Behind slots:** all OD-domain widgets (OdCard, design-toolbox, brand-browser, pluginFolders, sketch preview, comments/annotation, AMR billing, model/agent picker, file preview) — host injects via slots (§2).

### `@jini/artifacts-react` — RendererRegistry
- **Source origin:** `apps/web/src/artifacts/renderer-registry.ts` (108) + `artifacts/markdown.ts` + `runtime/srcdoc.ts` (3,101 — the sandbox srcdoc host, strip OD bridges) + `runtime/shiki.ts` + `components/file-viewer-render-mode.ts` (the url-vs-srcDoc decision).
- **Public API surface:** `RendererRegistry`, `ArtifactRenderer`, `ArtifactRendererContext` (generified — replace `ProjectFile` with `ArtifactFile = {name, kind, content?, url?, manifest?}`), built-in renderers (`HtmlRenderer`, `MarkdownRenderer`, `SvgRenderer`, `ReactComponentRenderer`; deck-html left to OD as a registered plugin), `<ArtifactView file registry slots>`, `<SrcDocSandbox>`, `renderMarkdownToSafeHtml()`, `UrlLoadDecision` port.
- **Allowed deps:** `react`, `@jini/chat-core`, a markdown lib, shiki. Optional peer for react-component eval.
- **Forbidden:** `@open-design/*`, OD providers, Next.js server APIs.
- **Behind slots:** deck rendering, OD design-kit preview, and every srcDoc bridge (deck/comment/inspect/palette/edit/tweaks — verified OD-only in AGENTS.md "Chat UI conventions") become host-registered `SrcDocBridge` plugins, not built-ins.

---

## 2. Slot / adapter interfaces (concrete TS)

```ts
// ---- @jini/chat-core: the event/message vocabulary (generic subset) ----
export type AgentEvent =
  | { kind: 'status'; label: string; detail?: string; code?: string }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number; stopReason?: string }
  | { kind: 'raw'; line: string }
  | { kind: 'ext'; name: string; data: unknown }; // host-specific (OD live_artifact/plugin_candidate ride here)

// ---- ChatTransport port (generalizes providers/daemon.ts streamViaDaemon) ----
export interface RunHandlers {
  onEvent: (ev: AgentEvent) => void;
  onToolInputDelta?: (id: string, name: string, delta: string) => void; // ephemeral, never persisted
  onError: (err: Error) => void;
  onDone: (finalEvents: AgentEvent[]) => void;
}
export interface StartRunInput {
  history: ChatMessage[];
  agentId?: string;
  conversationId?: string | null;
  attachments?: ChatAttachment[];
  context?: RunContext;              // opaque per-host payload (OD: projectId/skillIds/designSystemId)
  signal: AbortSignal;               // stops the browser subscription; run continues host-side
  cancelSignal?: AbortSignal;        // explicit user cancel
}
export interface ChatTransport {
  startRun(input: StartRunInput, handlers: RunHandlers): Promise<{ runId: string }>;
  reattachRun(runId: string, handlers: RunHandlers): Promise<void>;
  fetchRunStatus(runId: string): Promise<RunStatus | null>;
  stopRun(runId: string): Promise<void>;
  reportFeedback?(change: FeedbackChange): Promise<void>;
}

// ---- ProjectContext (replaces threaded Project/ProjectFile/Workspace props) ----
export interface ProjectContextValue {
  projectId: string | null;
  files: ArtifactFile[];
  resolveFileUrl: (path: string) => string;      // was providers/registry.projectFileUrl
  resolveRawUrl: (path: string) => string;       // was projectRawUrl
  uploadFiles?: (files: File[]) => Promise<ChatAttachment[]>;
  linkedDirs?: string[];
}

// ---- Model / agent picker slot ----
export interface ModelAgentPickerSlot {
  value: { agentId: string; model?: string; sessionMode?: string };
  onChange: (next: { agentId: string; model?: string; sessionMode?: string }) => void;
  render?: (props: { value; onChange; agents: AgentOption[] }) => ReactNode; // host owns the UI
}

// ---- Composer plugin + attachment slots ----
export interface ComposerPlusItem {          // generalizes ComposerPlusMenu / LibraryPicker / Figma / plugins
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void | Promise<ChatAttachment | null>;
}
export interface ComposerSlots {
  plusMenuItems?: ComposerPlusItem[];
  mentionSources?: MentionSource[];           // @-mention providers (skills, files, plugins)
  leadingAccessories?: ReactNode;             // e.g. SessionModeToggle, DesignSystemSwitchPicker
  onAttach?: (a: ChatAttachment) => void;
  annotationAdapter?: AnnotationAdapter;      // below
}
export interface AttachmentTraySlot {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
  renderItem?: (a: ChatAttachment) => ReactNode; // host renders exotic attachment kinds
}

// ---- Tool-renderer registry (SHIP AS-IS, runtime/tool-renderers.ts) ----
export type ToolRenderer = (props: ToolRenderProps) => ReactNode; // {status,name,args,result,isError}
export function registerToolRenderer(name: string, r: ToolRenderer): () => void;
export function getToolRenderer(name: string): ToolRenderer | undefined;

// ---- Artifact renderer registry (generify ProjectFile -> ArtifactFile) ----
export interface ArtifactFile { name: string; kind: string; content?: string; url?: string; manifest?: ArtifactManifest; }
export interface ArtifactRenderer {
  id: string; supportsStreaming: boolean;
  renderPartial?: (content: string) => string;
  canRender: (ctx: { file: ArtifactFile; hints?: Record<string, unknown> }) => boolean;
}
export class RendererRegistry { resolve(ctx): ArtifactRenderMatch | null; }

// ---- Comments / annotation adapter (optional; OD comments.ts + PreviewDrawOverlay) ----
export interface AnnotationAdapter {
  enabled: boolean;
  toAttachment: (selection: unknown) => ChatAttachment;     // was buildVisualAnnotationAttachment
  displayName: (a: ChatAttachment) => string;               // was commentTargetDisplayName
}

// ---- Feedback callback ----
export type FeedbackChange = { messageId: string; runId?: string; rating: 'positive' | 'negative'; reasonCode?: string; note?: string };
export type OnFeedback = (change: FeedbackChange) => void;

// ---- File-preview slot (host supplies; OD's FileViewer/FileWorkspace are huge & product-specific) ----
export interface FilePreviewSlot {
  render: (props: { file: ArtifactFile; onClose?: () => void }) => ReactNode;
}

// ---- Analytics adapter (default no-op; OD analytics/provider.tsx already a context) ----
export interface AnalyticsAdapter { track: (event: string, props?: Record<string, unknown>) => void; }

// ---- i18n adapter (default passthrough; OD useT/Dict already a context) ----
export interface I18nAdapter { t: (key: string, vars?: Record<string, string | number>) => string; locale: string; }

// ---- One provider wires them all ----
export interface JiniChatProviderProps {
  transport: ChatTransport;
  project?: ProjectContextValue;
  analytics?: AnalyticsAdapter;   // default no-op
  i18n?: I18nAdapter;             // default passthrough (returns key)
  toolRegistry?: ToolRegistry;    // default = module registry
  artifactRegistry?: RendererRegistry;
  slots?: { modelPicker?: ModelAgentPickerSlot; composer?: ComposerSlots; filePreview?: FilePreviewSlot; annotation?: AnnotationAdapter };
  onFeedback?: OnFeedback;
  children: ReactNode;
}
```

---

## 3. Extraction sequence for the three god-shells (no visual change)

Universal loop per shell: **(0) characterize → (1) lift pure helpers → (2) transport port → (3) slot extraction → (4) presentational split**, each step behavior-preserving and guard/typecheck-green. Follows ADR 0002's "one file, one complete pass, behavior-preserving" rule.

### ChatComposer.tsx (5,608 lines — the hardest; 641 design/plugin refs, 99 analytics)
1. **Characterize:** snapshot tests for submit, attachment add/remove, @-mention popover, session-mode toggle, plus a Playwright pin of the composer visual. (Concurrent OD work already decomposed this to 1,774 lines / 27 commits per memory — reuse that as the starting baseline.)
2. **Lift pure helpers:** `inlineMentions`, `composer-detail-position`, `composer-flyout-placement`, upload-cohort derivation → `@jini/chat-core`/local pure files.
3. **Transport/state port:** replace direct `providers/registry` (uploadProjectFiles, openFolderDialog, dirExists), `state/projects` (patchProject, listPlugins), `state/mcp`, `router.navigate` with `ProjectContextValue` + `ComposerSlots` callbacks.
4. **Slot extraction:** `ComposerPlusMenu`/`LibraryPicker`/`FigmaImportModal`/`PluginsSection`/`DesignSystemSwitchPicker`/`pet` → `ComposerPlusItem[]` + `leadingAccessories` slots; `PreviewDrawOverlay` annotation → `AnnotationAdapter`.
5. **Presentational split:** headless `useComposer` (draft/attachments/mentions state) + dumb `<Composer>` (Lexical input + tray + send).

### ChatPane.tsx (4,342 lines — 455 design refs)
1. **Characterize:** message-list render + pinned-todo slot + jump-button + question banner snapshots; ChatPane already has memory-noted auto-scroll ResizeObserver/MutationObserver behavior to pin.
2. **Lift pure helpers:** `splitOnQuestionForms`, `stripArtifact`, todo pinning (`latestTodoWriteInputForPinnedCard`), `agentDisplayName` → chat-core/utils.
3. **Transport port:** replace `providers/daemon` reattach + `providers/registry.projectRawUrl` + `amrLoginPolling` with `useRunStream(transport)` + `ProjectContextValue`.
4. **Slot extraction:** `OdCard`, `design-files/*`, `SketchPreview`, `design-system-auto-prompt`, `runtime/design-toolbox`, `comments` → host slots / `NextStepActions` variants; AMR billing UI → `ext` event + host slot.
5. **Presentational split:** headless `useConversation` (message array + scroll intent) + dumb `<MessageList>`/`<PinnedTodoSlot>`.

### AssistantMessage.tsx (3,317 lines — 239 design refs)
1. **Characterize:** render tests for text/thinking/tool-group/question-form/od-card/file-ops per message; strip TodoWrite groups invariant.
2. **Lift pure helpers:** `deriveFileOps`, `dedupeToolUsesById`, `stripTodoToolGroups`, `filterImplicitProducedFiles`, `splitStreamingArtifact` → chat-core.
3. **Transport port:** `providers/registry.projectFileUrl` → `ProjectContextValue.resolveFileUrl`.
4. **Slot extraction:** `OdCardView`, `design-files/pluginFolders`, `brand-browser-bridge`, `design-toolbox` action ids → `ext`-event renderers + `ToolRenderer`/`ArtifactRenderer` registrations; `FileOpsSummary` stays (generic).
5. **Presentational split:** dumb `<MessageRow>` consuming `useToolTimeline` output + tool/artifact registries; question-form rendering already delegates to clean `QuestionForm.tsx`.

**Order across shells:** AssistantMessage first (smallest, most self-contained, feeds the registries) → ChatPane (depends on MessageRow) → ChatComposer last (most tangled with app singletons). This bottom-up order lets each shell's extracted primitives land in the package before the next shell consumes them.

---

## 4. Headless hooks

All hooks own only view/interaction state and take injected ports (never import transport/DOM directly — enforced by the §5 lint). They speak `@jini/chat-core` types.

| Hook | Owns | Transport-agnostic via |
|---|---|---|
| `useConversation()` | message array, optimistic user message, scroll-intent flag, active conversation id | reads `ChatMessage[]` from props/context; mutations go through `useRunStream` |
| `useRunStream(transport)` | current `runId`, streaming flag, accumulated `AgentEvent[]`, error/terminal state, tool-input-delta buffer keyed by tool id | calls `transport.startRun/reattachRun/stopRun`; never touches `fetch`/`EventSource` — the `ChatTransport` port is the only I/O |
| `useComposer()` | draft text, attachments, mention popover state, selected agent/model/sessionMode | attachments via `ProjectContextValue.uploadFiles` + `ComposerSlots`; no direct provider import |
| `useToolTimeline(events)` | per-tool lifecycle rows (dedup by id, status via `deriveToolStatus`), expand/collapse | pure over `AgentEvent[]`; zero I/O |
| `usePinnedTodos(messages)` | latest TodoWrite snapshot, dismissed-key, progress count | pure over messages (`runtime/todos.ts` logic) |
| `useQuestionForms(messages)` | parsed `<question-form>` artifacts, submitted answers, active form | pure parse (`splitOnQuestionForms`); submit returns a next-user-message payload the host posts via transport |
| `useArtifactStream(events, registry)` | streaming artifact buffer, resolved renderer, partial-vs-complete state | pure over events + injected `RendererRegistry` |

Transport-agnostic guarantee: every hook that performs I/O receives a `ChatTransport` (or a `ProjectContextValue` callback) as an argument/context; none constructs an `EventSource`, calls `fetch`, or reads `window`. Accumulating browser subscriptions (SSE reconnection, cross-tab notify) live in the **single-instance orchestrator/provider**, not in feature hooks — matching the memory-slice rule verified in `features/memory` (OAuth poll/popup kept in orchestrator, per `ports.ts` docblock).

---

## 5. Slice-model verdict + engine-core boundary lint

**Confirm the hybrid.** Per-product code that *consumes* Jini stays vertically sliced under ADR 0002 (`features/<capability>/` with `ports.ts` + `dependencies.ts` + public barrel, guard-enforced). The engine is a **published headless package**, and the ADR's within-app "duplicate, don't share / no shared hook layer" rule is deliberately **inverted at the package boundary** — the package IS the shared layer multiple products consume. The port/adapter seam the memory slice proves (transport behind an injectable interface, one binder file, public barrel) is exactly the seam a host swaps to reuse Jini; keep that, drop the anti-sharing stance at the package edge.

**Engine-core boundary lint** — adapt `scripts/check-web-slice-boundaries.ts` (863 lines; already an AST guard using `ts.resolveModuleName`) into `packages/*/scripts/check-engine-boundaries.ts` for Jini, wired into the package's own `guard`. Rules:
1. **No transport/DOM in `@jini/chat-core` and `@jini/artifacts-react` core:** reuse the exact `forbiddenSliceGlobals` set (`fetch`,`EventSource`,`XMLHttpRequest`,`WebSocket`,`localStorage`,`sessionStorage`,`window`,`document`) plus its bare/`globalThis.x`/`self["x"]`/destructure detection. `chat-core` also forbids React. All I/O must reach through the `ChatTransport` port.
2. **No product imports:** any specifier resolving into a product package (`@open-design/*`, an OD `providers/`/`state/`/`router`, or any host app path) is a violation. Reuse `resolveViaTypeScript` against the package tsconfig so `paths`/`baseURL` drift can't reopen the gap; the allow-list is only `react`, `react-dom`, sibling `@jini/*`, and declared peers.
3. **Slot discipline:** the only files allowed to import a concrete adapter are the package's own `dependencies`/provider composition root (the `@jini/chat-react` `<JiniChatProvider>`), mirroring rule 2 of the OD guard ("only `dependencies.ts` may bind a provider"). Everything else depends on the slot *interface*, not an implementation.
4. **Public-barrel boundary:** consumers reach a package only through its `index.ts` (mirrors OD rule 3 outside-in). Deep imports into `@jini/chat-react/src/...` fail.

This is a best-effort static guard (same scope statement as the OD original), not a security boundary — it catches the accidental relapse (a stray `fetch`, a re-imported OD widget) that would re-couple the engine to one product.

exec
/bin/bash -lc "printf '%s\\n' '== agentic automation roots =='
find /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic -maxdepth 3 \\( -iname '*AI-Dev-Shop*' -o -iname '*ADS-memory*' -o -iname '*project-runner*' \\) -print
printf '%s\\n' '== agentic top dirs =='
find /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic -maxdepth 2 -type d -not -path '*/node_modules*' -not -path '*/.git*' | sort | head -160
printf '%s\\n' '== Zana app chassis tree =='
find /Users/la/Desktop/Programming/Zana/app-chassis -maxdepth 3 -type d -not -path '*/node_modules*' -not -path '*/.git*' | sort
printf '%s\\n' '== Tovu Runner tree =='
find /Users/la/Desktop/Programming/Tovu-Runner -maxdepth 3 -type d -not -path '*/node_modules*' -not -path '*/.git*' | sort | head -220" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 513ms:
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/ADS-memory
== agentic top dirs ==
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.claude
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.claude-plugin
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.claude/commands
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.claude/skills
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/artifacts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/brands
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/connectors
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/critique-artifacts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/design-systems
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/design-templates
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/library
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/memory
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/plugins
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/projects
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/runs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/skills
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/workspace-tasks
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.tmp
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.tmp/tools-dev
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.vaunt
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.vaunt/icons
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/knowledge
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/meta
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/reports
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/sessions
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/.claude
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/.gemini
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/ADS-memory
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/agents
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/harness-engineering
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/integrations
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/project-knowledge-template
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/reports
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/skills
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/desktop
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/landing-page
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/packaged
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/telemetry-worker
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/assets
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/assets/community-pets
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/assets/frames
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/assets/prompt-templates
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/charts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/charts/open-design
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/_locales
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/assets
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/icons
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/store
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/data
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/data/cards
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/data/plugin-previews
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/aws
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/azure
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/scripts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/tests
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/_schema
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/agentic
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/airbnb
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/airtable
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/ant
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/apple
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/application
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/arc
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/artistic
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/atelier-zero
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/bento
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/binance
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/bmw
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/bmw-m
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/bold
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/brutalism
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/bugatti
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/cafe
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/cal
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/canva
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/cisco
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/claude
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/clay
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/claymorphism
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/clean
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/clickhouse
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/cohere
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/coinbase
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/colorful
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/composio
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/contemporary
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/corporate
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/cosmic
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/creative
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/cursor
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/dashboard
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/default
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/discord
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/dithered
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/doodle
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/dramatic
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/duolingo
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/editorial
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/elegant
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/elevenlabs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/energetic
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/enterprise
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/expo
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/expressive
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/fantasy
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/ferrari
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/figma
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/flat
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/framer
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/friendly
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/futuristic
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/github
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/glassmorphism
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/gradient
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/hashicorp
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/hud
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/huggingface
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/ibm
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/intercom
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/kami
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/kraken
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/lamborghini
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/levels
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/linear-app
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/lingo
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/loom
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/lovable
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/luxury
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/mastercard
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/material
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/meta
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/minimal
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/minimax
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/mintlify
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/miro
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/mission-control
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/mistral-ai
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/modern
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/mongodb
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/mono
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/neobrutalism
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/neon
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/neumorphism
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/nike
== Zana app chassis tree ==
/Users/la/Desktop/Programming/Zana/app-chassis
/Users/la/Desktop/Programming/Zana/app-chassis/apps
/Users/la/Desktop/Programming/Zana/app-chassis/apps/daemon
/Users/la/Desktop/Programming/Zana/app-chassis/apps/daemon/src
/Users/la/Desktop/Programming/Zana/app-chassis/apps/desktop
/Users/la/Desktop/Programming/Zana/app-chassis/apps/studio
/Users/la/Desktop/Programming/Zana/app-chassis/apps/web
/Users/la/Desktop/Programming/Zana/app-chassis/packages
/Users/la/Desktop/Programming/Zana/app-chassis/packages/admin
/Users/la/Desktop/Programming/Zana/app-chassis/packages/admin/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/ai
/Users/la/Desktop/Programming/Zana/app-chassis/packages/ai/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/auth
/Users/la/Desktop/Programming/Zana/app-chassis/packages/auth/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/cli
/Users/la/Desktop/Programming/Zana/app-chassis/packages/cli/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/core
/Users/la/Desktop/Programming/Zana/app-chassis/packages/core/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/core/tests
/Users/la/Desktop/Programming/Zana/app-chassis/packages/db
/Users/la/Desktop/Programming/Zana/app-chassis/packages/db/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/payments
/Users/la/Desktop/Programming/Zana/app-chassis/packages/payments/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/plugins
/Users/la/Desktop/Programming/Zana/app-chassis/packages/plugins/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/storage
/Users/la/Desktop/Programming/Zana/app-chassis/packages/storage/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/templates
/Users/la/Desktop/Programming/Zana/app-chassis/packages/themes
/Users/la/Desktop/Programming/Zana/app-chassis/packages/themes/src
/Users/la/Desktop/Programming/Zana/app-chassis/packages/ui
/Users/la/Desktop/Programming/Zana/app-chassis/packages/ui/src
/Users/la/Desktop/Programming/Zana/app-chassis/plugins
/Users/la/Desktop/Programming/Zana/app-chassis/providers
/Users/la/Desktop/Programming/Zana/app-chassis/providers/supabase
/Users/la/Desktop/Programming/Zana/app-chassis/skills
/Users/la/Desktop/Programming/Zana/app-chassis/themes
== Tovu Runner tree ==
/Users/la/Desktop/Programming/Tovu-Runner
/Users/la/Desktop/Programming/Tovu-Runner/.claude
/Users/la/Desktop/Programming/Tovu-Runner/.claude/rules
/Users/la/Desktop/Programming/Tovu-Runner/.codebase-memory
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts/external-audit
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts/external-audit/offloads
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts/external-audit/packets
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts/swarm-consensus
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts/swarm-consensus/context
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts/swarm-consensus/offloads
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts/swarm-consensus/prompts
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts/swarm-consensus/runs
/Users/la/Desktop/Programming/Tovu-Runner/.local-artifacts/swarm-consensus/sandbox
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/.local-artifacts
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/.local-artifacts/codebase-memory-mcp-home
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/.local-artifacts/external-audit
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/.local-artifacts/swarm-consensus
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/reports
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/reports/architecture
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/reports/continuity
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/reports/pipeline
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/reports/reverse-spec
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/reports/swarm-consensus
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/specs
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/specs/001-admin-command-gateway
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/tmp
/Users/la/Desktop/Programming/Tovu-Runner/ADS-project-knowledge/tmp/peer-dispatch
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/.claude
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/.claude/commands
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/.gemini
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/.local-artifacts
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/.local-artifacts/claude-transport-debug
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/.local-artifacts/external-audit
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/.local-artifacts/swarm-consensus
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/ADS-project-knowledge
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/ADS-project-knowledge/.local-artifacts
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/ADS-project-knowledge/governance
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/ADS-project-knowledge/memory
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/ADS-project-knowledge/meta
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/ADS-project-knowledge/reports
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/ADS-project-knowledge/specs
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/ADS-project-knowledge/specs_as_built
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/code-review
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/codebase-analyzer
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/coordinator
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/database
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/devops
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/docs
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/observer
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/programmer
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/qa-e2e
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/red-team
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/refactor
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/search-visibility
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/security
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/skills-librarian
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/software-architect
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/spec
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/system-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/tdd
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/testrunner
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/ux-ui-designer
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/agents/vibecoder
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/contracts
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/examples
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/governance
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/memory
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/operations
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/reports
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/routing
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/slash-commands
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/spec-providers
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/templates
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/framework/workflows
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/graphify-out
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/agent-evals
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/archive
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/governance-scenarios
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/harness-evals
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/hooks
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/maintainers
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/maintenance
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/plans
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/policy
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/quality
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/references
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/retrieval-evals
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/runtime
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/sensors
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/skills-inbox
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/harness-engineering/validators
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/integrations
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/integrations/codebase-memory-mcp
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/integrations/codegraph
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/integrations/graphify
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/integrations/ui-scraper
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/project-knowledge-template
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/project-knowledge-template/governance
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/project-knowledge-template/memory
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/project-knowledge-template/meta
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/project-knowledge-template/reports
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/project-knowledge-template/specs
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/project-knowledge-template/specs_as_built
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/adr-governance
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/advanced-frontend-architecture
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/adversarial-test-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/agent-evaluation
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/api-contracts
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/api-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/architecture-decisions
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/architecture-migration
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/backend-implementation
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/backup-strategy
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/browser-live-analysis
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/change-management
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/code-navigation
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/code-review
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/codebase-analysis
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/codebase-graph
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/coding-foundations
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/constitution-compliance
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/context-engineering
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/coordination
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/data-engineering
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/design-patterns
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/developer-documentation
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/devops-delivery
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/disaster-recovery-planning
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/e2e-test-architecture
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/enterprise-spec
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/evaluation
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/experimental-validation
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/expo
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/expo-react-native
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/external-audit
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/feature-slice-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/find-skills
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/focused-test
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/frontend-accessibility
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/frontend-react-orcbash
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/function-quality-assessment
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/general-behavior
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/gstack-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/gstack-ios
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/gstack-release
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/handoff
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/hexagonal-architecture
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/implementation-guardrails
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/implementation-outline
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/incident-response
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/infrastructure-as-code
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/inline-code-documentation
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/interface-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/llm-operations
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/memory-regression
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/memory-systems
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/non-functional-requirements-discovery
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/observability-implementation
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/pattern-priming
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/performance-engineering
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/postgresql
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/rag-ai-integration
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/refactor-patterns
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/reverse-spec
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/secure-input-handling
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/security-review
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/seo-geo
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/shadcn-ui
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/spec-writing
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/sql-data-modeling
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/supabase
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/supabase-postgres-best-practices
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/supabase-upstream
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/superpowers-brainstorming
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/superpowers-dispatching-parallel-agents
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/superpowers-finishing-a-development-branch
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/superpowers-receiving-code-review
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/superpowers-requesting-code-review
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/superpowers-using-git-worktrees
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/superpowers-verification-before-completion
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/superpowers-writing-plans
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/swarm-consensus
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/syntax-aware-editing
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/system-blueprint
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/system-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/systematic-debugging
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/test-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/testable-design-patterns
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/tool-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/ui-loop
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/ux-design
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/vercel-composition-patterns
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/vercel-react-best-practices
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/vercel-react-native-skills
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/vercel-web-design-guidelines
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/vibe-coding
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/skills/web-compliance
/Users/la/Desktop/Programming/Tovu-Runner/docs
/Users/la/Desktop/Programming/Tovu-Runner/docs/design
/Users/la/Desktop/Programming/Tovu-Runner/docs/handoffs
/Users/la/Desktop/Programming/Tovu-Runner/docs/images
/Users/la/Desktop/Programming/Tovu-Runner/integrations
/Users/la/Desktop/Programming/Tovu-Runner/scripts
/Users/la/Desktop/Programming/Tovu-Runner/tmp
/Users/la/Desktop/Programming/Tovu-Runner/tmp/external-audit-dispatch
/Users/la/Desktop/Programming/Tovu-Runner/web
/Users/la/Desktop/Programming/Tovu-Runner/web/apps
/Users/la/Desktop/Programming/Tovu-Runner/web/apps/admin
/Users/la/Desktop/Programming/Tovu-Runner/web/apps/contract-vue
/Users/la/Desktop/Programming/Tovu-Runner/web/apps/desktop
/Users/la/Desktop/Programming/Tovu-Runner/web/dist
/Users/la/Desktop/Programming/Tovu-Runner/web/dist/src

exec
/bin/bash -lc "printf '%s\\n' '== Tovu package =='
sed -n '1,220p' /Users/la/Desktop/Programming/Tovu-Runner/package.json
printf '%s\\n' '== Tovu readme/docs references =='
rg -n --glob '"'!node_modules/**'"' --glob '"'!dist/**'"' '@open-design|Open Design|apps/web/src|swap|engine|cli\\.js|daemon' /Users/la/Desktop/Programming/Tovu-Runner/README* /Users/la/Desktop/Programming/Tovu-Runner/docs /Users/la/Desktop/Programming/Tovu-Runner/scripts /Users/la/Desktop/Programming/Tovu-Runner/integrations 2>/dev/null | head -240
printf '%s\\n' '== Zana readme =='
sed -n '1,280p' /Users/la/Desktop/Programming/Zana/app-chassis/README.md
printf '%s\\n' '== Zana manifests =='
for f in /Users/la/Desktop/Programming/Zana/app-chassis/package.json /Users/la/Desktop/Programming/Zana/app-chassis/packages/*/package.json /Users/la/Desktop/Programming/Zana/app-chassis/apps/*/package.json; do [ -f \""'$f" ] && { printf '"'\\n-- %s --\\n' \""'$f"; sed -n '"'1,160p' \""'$f"; }; done' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
== Tovu package ==
{
  "name": "tovu-workspace",
  "private": true,
  "description": "Tovu — UI on the open-design engine. Run daemon and web as independent foreground processes.",
  "scripts": {
    "daemon": "bash scripts/dev.sh daemon",
    "web": "npm --prefix web run dev:vite",
    "web:next": "bash scripts/dev.sh web"
  }
}
== Tovu readme/docs references ==
/Users/la/Desktop/Programming/Tovu-Runner/docs/handoffs/2026-07-06.md:8:  daemon agent; `tools.ts` `surface` seam; agent detection ported from OD; composer
/Users/la/Desktop/Programming/Tovu-Runner/docs/handoffs/2026-07-06.md:21:- **SQLite big-one:** `npm i better-sqlite3`; `SiteStorePort` in `core/ports.ts`; swap
/Users/la/Desktop/Programming/Tovu-Runner/docs/handoffs/2026-07-06.md:31:- Memories: `tovu-assistant-agui-copilotkit`, `tovu-web-lean-rebuild`, `jini-generic-engine`.
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:2:# Run Tovu's engine processes in the FOREGROUND — each streams its own output
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:5:#   npm run daemon    # terminal 1: backend API on :7456
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:6:#   npm run web       # terminal 2: web UI, proxies /api -> daemon
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:9:# Override with TOVU_ENGINE=/path/to/engine. Ports: OD_PORT (daemon, 7456),
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:19:[ -d "$ENGINE/apps/daemon" ] || { echo "engine not found at: $ENGINE (set TOVU_ENGINE)" >&2; exit 1; }
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:22:  # One-time: preserve the engine's original UI, then point web src at Tovu.
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:23:  if [ -d "$ENGINE/apps/web/src" ] && [ ! -L "$ENGINE/apps/web/src" ] && [ ! -e "$ENGINE/apps/web/src.orig" ]; then
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:24:    mv "$ENGINE/apps/web/src" "$ENGINE/apps/web/src.orig"
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:25:    echo "preserved engine UI -> apps/web/src.orig"
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:27:  ln -sfn "$WEB_SRC" "$ENGINE/apps/web/src"
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:31:  daemon)
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:32:    echo "▶ daemon (foreground) — http://127.0.0.1:$DAEMON_PORT · /api/health · Ctrl-C to stop"
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:33:    cd "$ENGINE/apps/daemon"
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:34:    exec node dist/cli.js --no-open --port "$DAEMON_PORT"
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:38:    echo "▶ web (foreground) — http://127.0.0.1:$WEB_PORT · proxies /api -> daemon :$DAEMON_PORT · Ctrl-C to stop"
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:39:    echo "  (start the daemon first: npm run daemon)"
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:41:    # NODE_PATH mirrors what the engine's orchestrator sets so the symlinked
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:42:    # Tovu src resolves react / @open-design/* from the engine's node_modules.
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:51:    echo "usage: bash scripts/dev.sh {daemon|web}" >&2
== Zana readme ==
# app-chassis (working name)

Open-source, batteries-included **app chassis** — a pre-wired product where AI edits
structured intent instead of an empty repo. One TypeScript runtime, reused across a
single site, a desktop app managing many projects, and hosted. React UI, SQLite/libSQL
default, plugins, themes, MCP/AI built in.

> Working name only — rename freely. Decisions behind this layout live in
> `../ADS-project-knowledge/reports/swarm-debate-2026-06-26/`.

## Core principles (from the design debate)
- **Rigid core, flexible edges.** Clean ports = LLM / payments / storage / auth-provider.
  NOT swappable: the UI platform (React) and the DB *behavior* (capability profiles, not a transparent swap).
- **Capability ports + providers.** A provider declares which capabilities it implements
  (`sqlite` → `db`; Supabase → `db`+`auth`+`storage`+`realtime`). See `packages/core/src/ports.ts`.
- **`actions.ts` in every package.** Each domain registers its AI-callable tools, so a user
  can drive everything from chat ("add a field to members", "switch the theme").
- **Don't overload the LLM with tools.** The model gets only `search_tools` + `call_tool`
  and discovers the rest via the `ToolRegistry`. See `packages/core/src/tools.ts`.
- **MCP / AG-UI / A2A are transports (adapters), never core.**

## What's built (prototype slice)
- `packages/core` — capability ports, provider registry, app manifest (`defineApp`), `ToolRegistry`.
- `packages/db` — SQLite provider implementing `DbPort` + `actions.ts` (ensureTable, addField, list, insert).
- `packages/ai` — the `search_tools` / `call_tool` meta-tools + a BYOK gateway stub.
- `apps/daemon` — boots the cell, materializes a **member directory** app, serves HTTP.

Stubbed/empty (next): `apps/web` (Next.js, SSR/SEO product), `apps/studio` (Vite builder UI),
`apps/desktop` (Electron), `packages/{auth,storage,payments,ui,admin,themes,plugins,cli}`,
`providers/supabase`.

## Run
```bash
cd app-chassis
pnpm install
pnpm dev          # starts the daemon on http://localhost:4000
```
Then:
```bash
curl localhost:4000/capabilities                 # [{ capability: "db", provider: "sqlite" }]
curl 'localhost:4000/tools/search?q=add%20a%20field'   # tool discovery (what the LLM does)
curl -X POST localhost:4000/call -d '{"name":"db.insert","input":{"resource":"member","values":{"name":"Ada","email":"ada@x.com"}}}'
curl localhost:4000/member                        # list rows
```

## Layout
```
apps/      web (Next.js) · studio (Vite) · daemon · desktop (Electron)
packages/  core · db · auth · storage · payments · ai · ui · admin · themes · plugins · cli · templates
providers/ supabase (multi-capability adapter)
plugins/   <name>/ plugin.json · server.ts · ui.tsx · permissions.json
themes/    <name>/ theme.json · tokens.ts · layouts/
skills/    <name>/ SKILL.md · examples/ · tests/
```
== Zana manifests ==

-- /Users/la/Desktop/Programming/Zana/app-chassis/package.json --
{
  "name": "app-chassis",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "pnpm --filter @chassis/daemon dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}

-- /Users/la/Desktop/Programming/Zana/app-chassis/packages/ai/package.json --
{
  "name": "@chassis/ai",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "@chassis/core": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.0" }
}

-- /Users/la/Desktop/Programming/Zana/app-chassis/packages/core/package.json --
{
  "name": "@chassis/core",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.6.0" }
}

-- /Users/la/Desktop/Programming/Zana/app-chassis/packages/db/package.json --
{
  "name": "@chassis/db",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@chassis/core": "workspace:*",
    "better-sqlite3": "^11.3.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "typescript": "^5.6.0"
  }
}

-- /Users/la/Desktop/Programming/Zana/app-chassis/apps/daemon/package.json --
{
  "name": "@chassis/daemon",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@chassis/core": "workspace:*",
    "@chassis/db": "workspace:*",
    "@chassis/ai": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}

exec
/bin/bash -lc "printf '%s\\n' '== Tovu web imports =='
rg -n --glob '"'!node_modules/**'"' --glob '"'!dist/**'"' \"from ['\\\"]@open-design|import\\(['\\\"]@open-design|@open-design/\" /Users/la/Desktop/Programming/Tovu-Runner/web/src /Users/la/Desktop/Programming/Tovu-Runner/web/apps 2>/dev/null | head -180
printf '%s\\n' '== Tovu port definitions =='
rg -n --glob '"'!node_modules/**'"' --glob '"'!dist/**'"' 'interface .*Port|type .*Port|SiteStorePort|AG-UI|CopilotKit|workspaceId' /Users/la/Desktop/Programming/Tovu-Runner/web/src /Users/la/Desktop/Programming/Tovu-Runner/web/apps 2>/dev/null | head -240
printf '%s\\n' '== Agentic chat slices files =='
find /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer -maxdepth 3 -type f 2>/dev/null | sort
printf '%s\\n' '== Agentic Vite config refs =='
rg -n --glob '"'!node_modules/**'"' 'dev:vite|vite|OD_WEB_DEV_SERVER' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/package.json /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/dev /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/package.json | head -180" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
== Tovu web imports ==
== Tovu port definitions ==
/Users/la/Desktop/Programming/Tovu-Runner/web/src/assistant/ChatFab.tsx:7: * AG-UI / CopilotKit chat that will drive the front end ("navigate to Media and
/Users/la/Desktop/Programming/Tovu-Runner/web/src/assistant/ChatFab.tsx:9: * real agent runtime + CopilotKit provider get wired next.
/Users/la/Desktop/Programming/Tovu-Runner/web/src/assistant/ChatFab.tsx:26:            <div className="tovu-chat__sub">AG-UI · controls the screen</div>
/Users/la/Desktop/Programming/Tovu-Runner/web/src/assistant/ChatFab.tsx:36:            The chat input is a clean headless rebuild over CopilotKit — it is not ported from
/Users/la/Desktop/Programming/Tovu-Runner/web/apps/admin/src/lib/api.ts:12:  workspaceId: string;
/Users/la/Desktop/Programming/Tovu-Runner/web/apps/admin/src/lib/api.ts:22:  workspaceId: string;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/events/memory-bus.ts:1:import type { DomainEvent, EventBusPort, OutboxPort, OutboxRecord } from "../ports";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/site/pages.ts:16:        listPublishedPosts({ deps: { repo: deps.postRepo }, input: { workspaceId: deps.workspaceId } }),
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/site/pages.ts:17:        getPresentationSettings({ deps: { repo: deps.presentationRepo }, input: { workspaceId: deps.workspaceId } }),
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/site/pages.ts:37:        getPublishedPostBySlug({ deps: { repo: deps.postRepo }, input: { workspaceId: deps.workspaceId, slug } }),
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/site/pages.ts:38:        getPresentationSettings({ deps: { repo: deps.presentationRepo }, input: { workspaceId: deps.workspaceId } }),
/Users/la/Desktop/Programming/Tovu-Runner/web/src/headless/contracts.ts:5:  workspaceId: string;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/headless/contracts.ts:28:    workspaceId: string;
/Users/la/Desktop/Programming/Tovu-Runner/web/apps/admin/sections/ai/INFO.md:5:Tovu-specific: AI assistant panel (AG-UI/CopilotKit-style control of admin actions), CHANGE-SET REVIEW QUEUE (proposed agent mutations: diff, approve/apply, revert — ADR-008), agent activity audit trail, tool registry browser.
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/types.ts:3:import type { EventBusPort, OutboxPort, UUID } from "../../core/ports";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/types.ts:4:import type { PostRepoPort } from "../../features/post";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/types.ts:5:import type { PresentationSettingsRepoPort } from "../../features/presentation";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/types.ts:6:import type { WorkspaceRepoPort } from "../../features/workspace";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/types.ts:9:  workspaceId: UUID;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/command.ts:9:import type { ChangeSetOperation, ChangeSetRepoPort } from "./change-set";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/command.ts:40:  workspaceId: UUID;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/command.ts:112:      workspaceId: command.workspaceId,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/command.ts:132:      workspaceId: command.workspaceId,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/command.ts:160:      workspaceId: command.workspaceId,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/events/__tests__/outbox-worker.test.ts:20:    workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/change-set.ts:26:  workspaceId: UUID;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/change-set.ts:69:export interface ChangeSetRepoPort {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/change-set.ts:71:  findById(required: { workspaceId: UUID; id: UUID }): Promise<ChangeSetWithItems | null>;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/change-set.ts:73:    workspaceId: UUID;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/change-set.ts:76:  listByWorkspace(required: { workspaceId: UUID }): Promise<ChangeSetRecord[]>;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/repo.memory.ts:22:  async findById(required: { workspaceId: string; id: string }): Promise<ChangeSetWithItems | null> {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/repo.memory.ts:25:        (row) => row.workspaceId === required.workspaceId && row.id === required.id
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/repo.memory.ts:37:    workspaceId: string;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/repo.memory.ts:43:          row.workspaceId === required.workspaceId &&
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/repo.memory.ts:49:  async listByWorkspace(required: { workspaceId: string }): Promise<ChangeSetRecord[]> {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/repo.memory.ts:51:      .filter((row) => row.workspaceId === required.workspaceId)
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__specs__/80-platform/tenancy-and-jobs.spec.md:51:    workspaceId: string | null;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/ports.ts:51:  workspaceId: UUID;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/ports.ts:74:export interface EventBusPort {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/ports.ts:97:   * emitted (workspaceId, aggregateId, actorId, occurredAt, metadata) so
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/ports.ts:119:export interface OutboxPort {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/ports.ts:131:export interface ClockPort {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/ports.ts:137:export interface IdGeneratorPort {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/events/outbox-worker.ts:1:import type { ClockPort, EventBusPort, OutboxPort } from "../ports";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/app.ts:132:      workspaceId: seededWorkspace.id,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/app.ts:142:      workspaceId: seededWorkspace.id,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/app.ts:203:      workspaceId: seededWorkspace.id,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/app.ts:210:    workspaceId: seededWorkspace.id,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/index.ts:8:  type PresentationSettingsRepoPort,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/content/posts/get-by-slug.ts:7:  app.get("/api/content/v1/workspaces/:workspaceId/posts/:slug", async (req, res) => {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/content/posts/get-by-slug.ts:8:    if (String(req.params.workspaceId ?? "") !== deps.workspaceId) {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/content/posts/get-by-slug.ts:17:          input: { workspaceId: deps.workspaceId, slug: String(req.params.slug ?? "") },
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/content/posts/get-by-slug.ts:21:          input: { workspaceId: deps.workspaceId },
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/repo.memory.ts:1:import type { PresentationSettingsRecord, PresentationSettingsRepoPort } from "./presentation";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/repo.memory.ts:10:  async findByWorkspaceId(workspaceId: string): Promise<PresentationSettingsRecord | null> {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/repo.memory.ts:11:    return this.rows.find((row) => row.workspaceId === workspaceId) ?? null;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/repo.memory.ts:15:    const index = this.rows.findIndex((row) => row.workspaceId === record.workspaceId);
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__specs__/90-migration/protocol-surfaces.spec.md:26:- AG-UI or streaming interaction bridges
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__tests__/packet-one-routes.test.ts:60:    post: { title: string; workspaceId?: string; version?: number; status?: string };
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__tests__/packet-one-routes.test.ts:64:  assert.equal(contentPayload.post.workspaceId, undefined);
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/__tests__/presentation.test.ts:12:  workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/__tests__/presentation.test.ts:22:    input: { workspaceId: "workspace-1" },
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/__tests__/presentation.test.ts:35:    input: { workspaceId: "workspace-1", activeThemeId: "glassmorphic" },
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/__tests__/presentation.test.ts:51:          workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/http/__tests__/headless-contracts.test.ts:18:  workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/http/__tests__/headless-contracts.test.ts:28:  workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/http/__tests__/headless-contracts.test.ts:47:      workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/http/__tests__/headless-contracts.test.ts:59:      workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__specs__/00-foundation/request-context.spec.md:62:    workspaceId: string | null;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__specs__/00-foundation/request-context.spec.md:85:    workspaceId: string | null;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/http/shared/post.ts:10:    workspaceId: post.workspaceId,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/presentation/patch-active-theme.ts:11:  app.patch("/api/admin/v1/workspaces/:workspaceId/presentation", async (req, res) => {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/presentation/patch-active-theme.ts:12:    if (String(req.params.workspaceId ?? "") !== deps.workspaceId) {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/presentation/patch-active-theme.ts:21:          workspaceId: deps.workspaceId,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/http/admin/presentation.ts:10:      workspaceId: settings.workspaceId,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/posts/update.ts:6:  app.put("/api/admin/v1/workspaces/:workspaceId/posts/:postId", async (req, res) => {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/posts/update.ts:7:    if (String(req.params.workspaceId ?? "") !== deps.workspaceId) {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/posts/update.ts:16:          workspaceId: deps.workspaceId,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/presentation/get.ts:9:  app.get("/api/admin/v1/workspaces/:workspaceId/presentation", async (req, res) => {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/presentation/get.ts:10:    if (String(req.params.workspaceId ?? "") !== deps.workspaceId) {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/presentation/get.ts:18:        input: { workspaceId: deps.workspaceId },
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:1:import type { ClockPort, UUID } from "../../core/ports";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:7:  workspaceId: UUID;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:12:export interface PresentationSettingsRepoPort {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:13:  findByWorkspaceId(workspaceId: UUID): Promise<PresentationSettingsRecord | null>;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:19:  input: { workspaceId: UUID };
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:30:    workspaceId: UUID;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:44:  const settings = await required.deps.repo.findByWorkspaceId(required.input.workspaceId);
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:47:      `presentation settings for workspace '${required.input.workspaceId}' were not found`
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:68:  const existing = await deps.repo.findByWorkspaceId(input.workspaceId);
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts:71:      `presentation settings for workspace '${input.workspaceId}' were not found`
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/posts/get-by-id.ts:6:  app.get("/api/admin/v1/workspaces/:workspaceId/posts/:postId", async (req, res) => {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/posts/get-by-id.ts:7:    if (String(req.params.workspaceId ?? "") !== deps.workspaceId) {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/posts/get-by-id.ts:15:        input: { workspaceId: deps.workspaceId, id: String(req.params.postId ?? "") },
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/posts/list.ts:6:  app.get("/api/admin/v1/workspaces/:workspaceId/posts", async (req, res) => {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/posts/list.ts:7:    if (String(req.params.workspaceId ?? "") !== deps.workspaceId) {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/admin/posts/list.ts:15:        input: { workspaceId: deps.workspaceId },
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/create.ts:1:import type { ClockPort, DomainEvent, IdGeneratorPort, OutboxPort, UUID } from "../../core/ports";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/create.ts:27:export interface WorkspaceRepoPort {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/create.ts:93:  const event: DomainEvent<{ workspaceId: UUID; slug: string }> = {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/create.ts:98:    workspaceId: id,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/create.ts:99:    payload: { workspaceId: id, slug },
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/index.ts:11:  type WorkspaceRepoPort,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/repo.memory.ts:1:import type { WorkspaceRecord, WorkspaceRepoPort } from "./create";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:1:import type { ClockPort, JsonObject, UUID } from "../../core/ports";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:7:  workspaceId: UUID;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:16:export interface PostRepoPort {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:17:  findById(required: { workspaceId: UUID; id: UUID }): Promise<PostRecord | null>;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:18:  findBySlug(required: { workspaceId: UUID; slug: string }): Promise<PostRecord | null>;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:19:  list(required: { workspaceId: UUID }): Promise<PostRecord[]>;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:24:  workspaceId: UUID;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:46:  input: { workspaceId: UUID; id: UUID };
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:51:  input: { workspaceId: UUID; slug: string };
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:65:  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:82:  const duplicate = await deps.repo.findBySlug({ workspaceId: input.workspaceId, slug });
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:103:  input: { workspaceId: UUID };
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:111:  const posts = await required.deps.repo.list({ workspaceId: required.input.workspaceId });
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:120:  const posts = await required.deps.repo.list({ workspaceId: required.input.workspaceId });
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:128:  const { workspaceId, id } = required.input;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:129:  const post = await required.deps.repo.findById({ workspaceId, id });
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:138:  const { workspaceId } = required.input;
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts:140:  const post = await required.deps.repo.findBySlug({ workspaceId, slug });
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/repo.memory.ts:1:import type { PostRecord, PostRepoPort } from "./post";
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/repo.memory.ts:10:  async findById(required: { workspaceId: string; id: string }): Promise<PostRecord | null> {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/repo.memory.ts:12:      this.rows.find((row) => row.workspaceId === required.workspaceId && row.id === required.id) ??
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/repo.memory.ts:17:  async findBySlug(required: { workspaceId: string; slug: string }): Promise<PostRecord | null> {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/repo.memory.ts:20:        (row) => row.workspaceId === required.workspaceId && row.slug === required.slug
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/repo.memory.ts:25:  async list(required: { workspaceId: string }): Promise<PostRecord[]> {
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/repo.memory.ts:26:    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/INFO.md:34:Keep stable identity, ownership, routing, workflow, and high-frequency query fields as relational columns. Examples include `id`, `workspaceId`, `contentType`, `slug`, `status`, `authorId`, `createdAt`, `updatedAt`, `publishedAt`, `version`, and soft-delete or archival markers.
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/__tests__/create.test.ts:33:  assert.equal(rows[0].event.workspaceId, "id-1");
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/index.ts:11:  type PostRepoPort,
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/__tests__/post.test.ts:9:  workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/__tests__/post.test.ts:25:      workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/__tests__/post.test.ts:56:          workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/__tests__/post.test.ts:77:          workspaceId: "workspace-1",
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/__tests__/post.test.ts:96:        input: { workspaceId: "workspace-1", slug: "hello-world" },
== Agentic chat slices files ==
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/actions.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/attachment-actions.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/DesignToolboxPanel.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/ImportItem.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/MentionPopover.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/SlashPopover.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/StagedCommentAttachments.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/StagedRunContexts.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/ToolboxItemRow.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/ToolsImportPanel.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/ToolsMcpPanel.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/ToolsPluginsPanel.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/components/ToolsSkillsPanel.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/constants.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/dependencies.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/formatters.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useAppliedPlugin.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useCommentAttachments.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useComposerCatalogue.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useComposerDraft.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useComposerModals.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useComposerUpload.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useDesignToolboxDetail.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useMentionPopover.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useSlashPopover.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useStagedRunContext.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useWorkingDirStatus.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/hooks/useWorkspaceContextLinking.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/index.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/ports.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/rules.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer/types.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/ActiveDesignSystemChip.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/ActivePluginChip.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/ActiveWorkspaceContextChip.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/ChatArtifactPreview.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/ChatConversationLoading.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/ChatRows.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/CommentSection.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/CommentsPanel.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/ConversationRow.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/ImportedFolderArtifacts.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/MessageSessionModeChip.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/QueuedSendMetaChips.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/QueuedSendStrip.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/UserMessage.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/components/VirtualChatRow.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/constants.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/dependencies.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/hooks/useChatLogScrollAnchor.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/hooks/useComposerDraftSync.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/hooks/useComposerPortalLayout.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/hooks/useComposerStarterScenarios.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/hooks/useConversationHistory.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/hooks/useMeasuredVirtualWindow.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/hooks/useQueuedSendEditing.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/hooks/useRunErrorState.hooks.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/index.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/ports.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/rules.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane/types.ts
== Agentic Vite config refs ==
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/package.json:23:    "vite.config.ts"
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/package.json:27:    "dev:vite": "vite",
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/package.json:31:    "test": "vitest run -c vitest.config.ts --maxWorkers=2"
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/package.json:68:    "@vitejs/plugin-react": "6.0.3",
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/package.json:73:    "vite": "8.1.2",
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/package.json:74:    "vitest": "4.1.6"
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/dev/src/config.ts:34:  devServer?: "next" | "vite";
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/dev/src/index.ts:490:        // --dev-server wins over an ambient OD_WEB_DEV_SERVER (e.g. from a
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/dev/src/index.ts:496:        ...(options.prod !== true && (options.devServer ?? process.env.OD_WEB_DEV_SERVER) === "vite"
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/dev/src/index.ts:497:          ? { OD_WEB_DEV_SERVER: "vite" }
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/dev/src/index.ts:1104:      "web dev server for local iteration: next (default, Turbopack) or vite (lower dev-mode memory; ignored with --prod)",

mcp: codebase-memory-mcp/get_architecture started
mcp: codebase-memory-mcp/get_architecture (failed)
user cancelled MCP tool call
mcp: codebase-memory-mcp/search_graph started
mcp: codebase-memory-mcp/search_graph (completed)
mcp: codebase-memory-mcp/search_graph started
mcp: codebase-memory-mcp/search_graph (completed)
mcp: codebase-memory-mcp/get_code_snippet started
mcp: codebase-memory-mcp/get_code_snippet (completed)
mcp: codebase-memory-mcp/get_code_snippet started
mcp: codebase-memory-mcp/get_code_snippet (completed)
mcp: codebase-memory-mcp/get_code_snippet started
mcp: codebase-memory-mcp/get_code_snippet (completed)
mcp: codebase-memory-mcp/get_code_snippet started
mcp: codebase-memory-mcp/get_code_snippet (completed)
exec
/bin/bash -lc "sed -n '1,180p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/package.json
find /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src -maxdepth 2 -type f -print -exec sed -n '1,60p' {} \\;
printf '%s\\n' '== package dependencies =='
for f in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/*/package.json; do node -e 'const p=require(process.argv[1]); console.log(p.name+\" -> \"+Object.keys({...p.dependencies,...p.peerDependencies}).join(\",\"))' \""'$f"; done | sort
printf '"'%s\\n' '== package sizes =='
for d in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/*; do [ -d \""'$d/src" ] && printf '"'%-30s files=%-4s lines=%s\\n' \""'$(basename "$d")" "$(find "$d/src" -type f | wc -l | tr -d '"' ')\" \""'$(find "$d/src" -type f '"\\( -name '*.ts' -o -name '*.tsx' \\) -print0 | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print "'$1}'"')\"; done" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 1443ms:
@open-design/agent-tools -> @open-design/contracts,@open-design/release,better-sqlite3
@open-design/agui-adapter -> @open-design/contracts
@open-design/components -> react
@open-design/contracts -> @open-design/release,zod
@open-design/diagnostics -> jszip
@open-design/download -> @open-design/platform
@open-design/host -> @open-design/release
@open-design/launcher-proto -> @open-design/release,@open-design/sidecar-proto
@open-design/metatool -> zod
@open-design/platform ->
@open-design/plugin-runtime -> @open-design/contracts,zod
@open-design/registry-protocol -> zod
@open-design/release ->
@open-design/sidecar ->
@open-design/sidecar-proto -> @open-design/release
== package sizes ==
agent-tools                    files=3    lines=132
agui-adapter                   files=3    lines=312
components                     files=12   lines=244
contracts                      files=94   lines=17900
diagnostics                    files=7    lines=608
download                       files=16   lines=1651
host                           files=6    lines=1030
launcher-proto                 files=1    lines=492
metatool                       files=2    lines=195
platform                       files=7    lines=1502
plugin-runtime                 files=11   lines=1055
registry-protocol              files=3    lines=199
release                        files=1    lines=236
sidecar                        files=9    lines=1160
sidecar-proto                  files=1    lines=933

exec
/bin/bash -lc "for repo in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic /Users/la/Desktop/Programming/Open-Marketing; do printf '\\n== %s ==\\n' \""'$repo"; for p in agent-tools agui-adapter components contracts diagnostics download host launcher-proto metatool platform plugin-runtime registry-protocol release sidecar sidecar-proto; do n=$(rg -l --glob '"'"'!node_modules/**'"' --glob '"'!dist/**'"' --glob '"'!packages/'"'\""'$p"'"'/**' \"@open-design/"'$p" "$repo/apps" "$repo/tools" "$repo/e2e" "$repo/packages" 2>/dev/null | wc -l | tr -d '"' '); printf '%-20s %s files\\n' \""'$p" "$n"; done; done
printf '"'\\n== exact product-neutrality test ==\\n'
sed -n '1,280p' /Users/la/Desktop/Programming/Open-Marketing/scripts/product-neutrality.test.ts
printf '\\n== server context headers ==\\n'
sed -n '1,220p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server-context.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 1842ms:
agent-tools          3 files
agui-adapter         9 files
components           53 files
contracts            529 files
diagnostics          14 files
download             12 files
host                 45 files
launcher-proto       24 files
metatool             2 files
platform             55 files
plugin-runtime       17 files
registry-protocol    12 files
release              51 files
sidecar              88 files
sidecar-proto        84 files

== /Users/la/Desktop/Programming/Open-Marketing ==
agent-tools          0 files
agui-adapter         9 files
components           51 files
contracts            450 files
diagnostics          14 files
download             11 files
host                 41 files
launcher-proto       24 files
metatool             2 files
platform             48 files
plugin-runtime       17 files
registry-protocol    12 files
release              50 files
sidecar              87 files
sidecar-proto        84 files

== exact product-neutrality test ==
import assert from "node:assert/strict";
import test from "node:test";

import {
  collectProductNeutralityViolationsFromSource,
  isProductNeutralityCheckedPath,
} from "./guard.ts";

test("product-neutrality check rejects named orchestrator examples on public surfaces", () => {
  const violations = collectProductNeutralityViolationsFromSource(
    "packages/contracts/src/api/chat.ts",
    "Run-scoped tool bundle supplied by an orchestrator such as Acme.",
    [],
  );

  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.lineNumber, 1);
});

test("product-neutrality check covers web App Router public copy", () => {
  assert.equal(isProductNeutralityCheckedPath("apps/web/app/page.tsx"), true);

  const violations = collectProductNeutralityViolationsFromSource(
    "apps/web/app/page.tsx",
    "This page mentions an orchestrator such as Acme.",
    [],
  );

  assert.equal(violations.length, 1);
});

test("product-neutrality check supports local forbidden terms without committing them", () => {
  const violations = collectProductNeutralityViolationsFromSource(
    "docs/example.md",
    "This private deployment name should not ship.",
    ["private deployment"],
  );

  assert.equal(violations.length, 1);
});

test("product-neutrality check ignores out-of-scope paths", () => {
  assert.equal(isProductNeutralityCheckedPath("tmp/scratch.md"), false);
  assert.deepEqual(
    collectProductNeutralityViolationsFromSource(
      "tmp/scratch.md",
      "A scratch note can mention an orchestrator such as Acme.",
      [],
    ),
    [],
  );
});

== server context headers ==
import type { Express } from 'express';
import type { SkillInfo } from './skills.js';
import type { DesignSystemSummary } from './design-systems/index.js';
import type { RoutineRoutesService } from './routes/routine.js';
import type { OpenDesignPublicMetadataService } from './services/open-design-public-metadata.js';

export interface HttpDeps {
  createSseResponse: (...args: any[]) => any;
  getPublicBaseUrl?: (...args: any[]) => string;
  isLocalSameOrigin: (...args: any[]) => boolean;
  requireLocalDaemonRequest: (...args: any[]) => any;
  resolvedPortRef: { current: number };
  sendApiError: (...args: any[]) => any;
  sendLiveArtifactRouteError: (...args: any[]) => any;
  sendMulterError: (...args: any[]) => any;
}

export interface PathDeps {
  ARTIFACTS_DIR: string;
  BRANDS_DIR: string;
  BUNDLED_PETS_DIR: string;
  CRAFT_DIR: string;
  DESIGN_SYSTEMS_DIR: string;
  // Bundled rendering catalogue (see specs/current/skills-and-design-templates.md).
  // Distinct from SKILLS_DIR so the EntryView Templates surface and the
  // Settings → Skills surface stay decoupled.
  DESIGN_TEMPLATES_DIR: string;
  // Global OD Library data root for owned, content-addressed assets
  // (derived from RUNTIME_DATA_DIR). See apps/daemon/src/library.ts.
  LIBRARY_DIR: string;
  OD_BIN: string;
  PROJECT_ROOT: string;
  PROJECTS_DIR: string;
  PROMPT_TEMPLATES_DIR: string;
  RUNTIME_DATA_DIR: string;
  RUNTIME_DATA_DIR_CANONICAL: string;
  SKILLS_DIR: string;
  USER_DESIGN_SYSTEMS_DIR: string;
  // Mirror of USER_SKILLS_DIR rooted at DESIGN_TEMPLATES_DIR so user
  // imports of templates do not collide with imports of functional skills.
  USER_DESIGN_TEMPLATES_DIR: string;
  USER_SKILLS_DIR: string;
}

export interface ResourceDeps {
  FIRST_PARTY_ATOMS?: Array<any>;
  listAllDesignSystems: () => Promise<Array<DesignSystemSummary & { source?: string }>>;
  listAllSkills: () => Promise<Array<SkillInfo & { source?: string }>>;
  // Mirrors listAllSkills but scans DESIGN_TEMPLATE_ROOTS so the Templates
  // surface only sees rendering-catalogue entries.
  listAllDesignTemplates: () => Promise<Array<SkillInfo & { source?: string }>>;
  // Spans both functional skills and design templates so cross-surface
  // resolvers (chat run system prompt, orbit template resolver,
  // /api/skills/:id/example, /api/skills/:id/assets/*) keep working when
  // a stored project.skillId points at either root.
  listAllSkillLikeEntries: () => Promise<Array<SkillInfo & { source?: string }>>;
  mimeFor: (filePath: string) => string;
}

export interface RoutineDeps {
  routineService: RoutineRoutesService;
}

export interface ProjectPreviewScopeDeps {
  mint: (projectId: string) => string;
  validate: (projectId: string, scope: string) => boolean;
}

export interface TelemetryDeps {
  reportFinalizedMessage: (
    saved: any,
    body?: any,
    options?: {
      analyticsContext?: any;
      projectId?: string;
      conversationId?: string;
      reportTrigger?: 'final_message' | 'terminal_fallback';
    },
  ) => void;
  /**
   * Best-effort Langfuse score emission for assistant-turn user ratings.
   * Returns the categorical outcome so the API surface in chat-routes can
   * report back to the web client whether the report was accepted or
   * skipped (consent off / no sink). The handler must not await this in
   * the request hot path — fire-and-forget.
   */
  reportFeedback?: (req: {
    runId: string;
    rating: 'positive' | 'negative';
    reasonCodes: string[];
    hasCustomReason: boolean;
    customReason: string;
    scoreMetadata?: Record<string, unknown>;
  }) => Promise<{ status: 'accepted' | 'skipped_consent' | 'skipped_no_sink' }>;
  reportRunCompletionTelemetryFallback: (...args: any[]) => any;
  resolveRunProjectKindForAnalytics: (...args: any[]) => any;
  runArtifactBaselines: any;
  runRetryEventsForAnalytics: (...args: any[]) => any;
}

export interface ServerContext {
  db: any;
  design: any;
  http: HttpDeps;
  paths: PathDeps;
  ids: any;
  uploads: any;
  node: any;
  projectStore: any;
  projectFiles: any;
  conversations: any;
  templates: any;
  status: any;
  events: any;
  imports: any;
  exports: any;
  artifacts: any;
  documents: any;
  auth: any;
  liveArtifacts: any;
  deploy: any;
  media: any;
  appConfig: any;
  orbit: any;
  nativeDialogs: any;
  research: any;
  mcp: any;
  plugins: any;
  resources: ResourceDeps;
  routines: RoutineDeps;
  projectPreviewScopes: ProjectPreviewScopeDeps;
  telemetry: TelemetryDeps;
  validation: any;
  finalize: any;
  handoff: any;
  chat: any;
  messages: any;
  agents: any;
  critique: any;
  openDesignPublicMetadata: OpenDesignPublicMetadataService;
  lifecycle: {
    isDaemonShuttingDown: () => boolean;
  };
}

export type RouteDeps<K extends keyof ServerContext> = Pick<ServerContext, K>;

export type RouteRegistrar = (app: Express, ctx: ServerContext) => void;

exec
/bin/bash -lc 'for f in r1b-daemon-design.md r2c-repo-skeleton.md r3b-sidecar-design.md r4c-vite-reference.md r6-project-runner.md r1c-discovery-capabilities.md; do p=/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/$f; printf '"'\\n===== %s =====\\n' \""'$f"; rg -n '"'"'^#{1,4} |Verdict|Recommendation|Risk|Missing|Conclusion|Decision|v1|Phase|Package|merge|separate'"' \""'$p"; done' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:

===== r1b-daemon-design.md =====
1:# R1b — Daemon extraction design (fresh Jini repo)
8:Package layering (fresh repo):
21:## 1. `@jini/agent-runtime` package spec
23:### 1a. Harvest wholesale (product-neutral, move as-is)
38:### 1b. The coupled chat-run trio → ports
110:### 1c. Agent-runtime-env data-root injection (de-brand OD_*)
137:## 2. `@jini/daemon-core` package spec — the composition root
139:### Problem statement
146:### `createDaemon` factory (new)
177:### The ports (typed; each replaces an `any` field or a hardcode cited in r1)
239:### Port-satisfaction check (the compile-time contract, generalized)
265:## 3. Harvest plan from Jini `integrated` `server/`
278:### Clearing the `@ts-nocheck` debt on `agent-runtime-env.ts` (as part of the lift)
293:## 4. Engine-vs-adapter route split
328:## 5. Dependency-ordered extraction task list (resumable)

===== r2c-repo-skeleton.md =====
1:# R2c — Fresh Jini repo skeleton + governance
15:## 1. Top-level Jini folder tree
81:## 2. `pnpm-workspace.yaml` + root `package.json`
117:## 3. Boundary-enforcement guard: `scripts/check-engine-boundaries.ts`
127:- **R3 — Protocol purity (the riskiest edge you flagged).** Delegated to a dedicated `check-protocol-purity.ts` (kept separate like OD splits guards): every file under `packages/protocol/**` MUST NOT import anything that resolves into an OD `api/*` DTO, OD `prompts/*`, OD `analytics/*`, OD `design-systems/*`, or anything under `integrations/**`. The generic core (`common`, `errors`, `tasks`, `execution-profile`, `critique`, `sse/common`, `agent-tools/*`) may import only `zod` and its own internal files. This enforces the **downward-only edge**: `@od/contracts → @jini/protocol` is legal; `@jini/protocol → @od/*` is a build-breaking violation. (This is the exact seam that a sloppy `index.ts` barrel split would reopen.)
139:## 4. Provenance / licensing
144:- **Authorship preservation — use `git format-patch`, not copy+paste.** For each package, in an OD clone: `git log --follow --format=%H -- packages/<pkg>/src` to get history, then `git format-patch` / `git am` (or `git filter-repo --path packages/<pkg> --path-rename packages/<pkg>:packages/<newname>`) to replay commits into the Jini repo so the original author/date/commit trailers survive. `git filter-repo` with `--path-rename` is the cleanest for the leaf packages (platform, components, etc.) that move nearly verbatim. For `@jini/protocol` (a *partial* file-set carved out of `contracts`), filter-repo with a `--path` include-list of exactly the 8 generic files + `agent-tools/` dir preserves their individual histories while dropping the 85 OD files. Renames (identity scrub, `.od-*` CSS) land as *follow-on* commits authored by the extractor, so blame cleanly separates "OD original" from "Jini de-coupling."
148:## 5. Referencing OD for ongoing sync without bloating Jini (`.git` = 1.6 GB)
150:**Do NOT git-submodule OD into Jini** — that drags the full 1.6 GB history into every clone and couples Jini's DX to OD's monorepo weight. Recommendation, in order:
152:1. **Primary: a separate, blobless local OD mirror** kept *outside* the Jini working tree: `git clone --filter=blob:none https://github.com/nexu-io/open-design.git ../open-design-upstream`. Blobless keeps the commit/tree graph (needed for `format-patch`/cherry-pick provenance) but fetches blobs on demand — a fraction of 1.6 GB. Jini's repo stays clean; sync tooling points at this sibling mirror.
160:## 6. Migration bootstrap (Jini currently IS a dirty OD copy on `integrated`)
162:Current reality (verified): this checkout has OD `origin`/`fork` remotes, a 1.6 GB OD `.git`, is on `refactor/web-memory-slice` (coordinator references a separate `integrated` branch carrying the daemon decomposition + `src.orig`), and untracked `ADS-project-knowledge/`, `docs/jini-open-design-porting-plan.md`.
164:**Recommendation: fresh empty repo (gut-down loses nothing and inherits 1.6 GB + OD remotes + OD identity). Steps:**
181:### Verified vs inferred

===== r3b-sidecar-design.md =====
1:# R3b — Jini Sidecar + Desktop-Host Layer Design
13:## 1. `@jini/sidecar` and `@jini/platform` package specs
15:### 1a. `@jini/platform` — verbatim lift of `@open-design/platform`
25:- `createCommandInvocation`, `createPackageManagerInvocation`.
34:### 1b. `@jini/sidecar` — verbatim lift of `@open-design/sidecar`
46:### 1c. OD-identity strings that MUST live in the product descriptor (not engine)
61:### 1d. Exact `SidecarContractDescriptor` a product supplies
96:## 2. `@jini/desktop-host` — host-adapter interface (host-agnostic)
103:### 2a. The host-adapter interface
149:### 2b. IPC message envelope (the wire contract) [V — json-ipc.ts]
165:### 2c. Stamp-argv contract [V — platform/process.ts + sidecar-proto]
175:### 2d. Socket-path formula [V — sidecar/paths.ts l.242-257]
186:## 3. Electron adapter — how apps/desktop maps today (reference impl)
214:## 4. TAURI experiment spec (low priority, concrete)
219:### 4a. Contract surface the Tauri host MUST speak
236:### 4b. What Tauri reimplements in Rust (engine has no Rust build)
243:### 4c. Render/export degradation strategy
250:- **Delegate (v1):** route those messages to a **headless-Chromium `RenderService`
256:### 4d. Minimal milestones to a Tauri shell loading the web URL
275:## 5. Modeling the bidirectional render/export coupling as a port
286:### Recommended: a first-class `RenderService` port
312:### Placement
326:## Key citations

===== r4c-vite-reference.md =====
1:# R4c — Jini Vite Reference App + Reusability Proof
18:## 1. `examples/reference-web` — minimal Vite React host
24:### Structure
45:### What it renders
50:### How JiniChatProvider is wired (stub adapters)
70:### fakeTransport shape (Design)
98:## 2. `examples/minimal-host` — zero-OD-import reusability proof
105:### Allowed imports (the ONLY ones)
115:### What it stubs (inline, no adapter files)
125:### The forbidden set (what the lint fails on if present)
135:## 3. Consumer wiring template (Zana / Open-Marketing / Tovu-Runner)
142:### MUST implement (required)
148:### SHOULD implement (recommended, else defaults)
156:### OPTIONAL
160:### What the product gets for FREE
168:### Minimal mount (any Vite product)
180:## 4. Migration note: Next host → Vite reference host
186:### Clean (moves to Vite with no code change)
198:### Next-bound (shell only — the engine never touches these)
209:### What it takes (the actual work)
220:### Why the engine avoids Next by construction

===== r6-project-runner.md =====
1:# R6 — Jini `project-runner` + Durable Task Ledger + Cloud-Context Export
4:CAS leases, separate engine run-ledger, staleness fail-closed) and seat3-fable.md
32:## 1. `project-runner/` folder layout + bins
45:│   ├── tasks/<TASK-ID>.json        # committed: ONE FILE PER TASK (merge-friendly)
67:### Bins (all `--json`, all deterministic, per the requested set)
88:## 2. Ledger files, task schema, states, lease model
90:### 2a. Committed vs ephemeral
100:### 2b. Task schema (one file per task — merge-friendly JSON)
124:  "compatibilityRefs": ["run-events-v1"],
140:### 2c. Task states + legal transitions (reconciled canonical set)
147:awaiting_review  → done | in_progress | blocked        # human/merge gate
158:### 2d. Lease model — DECISION: git-ref CAS (primary) + local flock (offline only)
195:  disjoint file globs safely. [D — merges seat1 scope-overlap + seat3 disjoint globs]
199:## 3. GitHub upstream-refactor incorporation (`type: incorporate-upstream-refactor`)
205:**reference evidence, not merge candidates.** e.g. `arch/server-startserver-endgame`
207:still moves ~3,400 untyped lines behind `deps: any`. A wholesale `git merge`
212:### Flow: `runner sync-od --branch <b>` (or `--pr <n>`)
247:     human merges; merge marks `done` and refreshes affected context.
252:   This is what proves "reimplemented seam == upstream behavior" without a merge.
259:## 4. Cloud-context export layout (workstream H)
306:## 5. Determinism + resumability (Codex cloud + Claude)
336:  [V — seat1 l.436-460; called out so the two never merge.]
340:## Summary of the reconciliation
343:  evidence not merge candidates," separate engine run-ledger.
352:## Citations

===== r1c-discovery-capabilities.md =====
1:# R1c — Engine agent/CLI discovery + capability negotiation subsystem
22:## 1. Discovery source-of-truth
24:### Location (daemon-owned, under resolved data root — not web, not committed) **(proposed)**
37:### Record schema per agent **(proposed schema, fields grounded in `DetectedAgent`/`AgentAuthProbeResult`)**
67:### One API, both consumers (UI + CLI) **(current endpoint, extended)**
80:## 2. Refresh / invalidation policy **(proposed, extends OD's warm-prefetch)**
87:| **model-catalog freshness** | models / modelsSource | **long (~24h)** | `listModels`/`fetchModels` are expensive (8MB buffers, network) and models rarely change; OD already caches these separately (`models.ts`, `amr-model-cache.ts`) |
112:## 3. Capability model — discriminated unions (preserve richness, don't flatten)
148:    | { kind: 'acp-merge'; envFormat: 'array' | 'map' } // acpMcpEnvFormat (types.ts:249)
160:### Graceful degradation for a generic consumer
184:## 4. Extensibility — new agent CLI, zero switchboard edits **(verified in `registry.ts`)**
211:## 5. Security boundary **(current behavior, verified)**

exec
/bin/bash -lc "sed -n '1,220p' /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r6-project-runner.md
sed -n '220,380p' /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r6-project-runner.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# R6 — Jini `project-runner` + Durable Task Ledger + Cloud-Context Export

Reconciled design (workstreams G+H). Synthesizes seat1-codex-clean.md (git-ref
CAS leases, separate engine run-ledger, staleness fail-closed) and seat3-fable.md
(one-file-per-task JSON, committed index, ADS pipeline reference, staleness
auto-enqueue). **[V] = verified against the repos, [D] = design decision, [I] = inferred.**

Repos glanced [V]:
- `/Users/la/Desktop/Programming/Jini/AI-Dev-Shop` — governance framework:
  `framework/workflows/{job-lifecycle,pipeline-state-format,multi-agent-pipeline,git-strategy,recovery-playbook,trace-schema}.md`,
  role agents under `agents/{coordinator,programmer,code-review,qa-e2e,red-team,…}`,
  and a `todo.md` that is a *framework-improvement* backlog — **not** a per-project
  task list. It already owns an intra-task job lifecycle + pipeline-state format.
- `/Users/la/Desktop/Programming/Tovu-Runner` — a research/CMS scaffold ("thin
  launcher"), NOT the cloud runner. Ignore for this design except as a would-be
  second consumer.

**Core reconciliation principle (settles the ADS overlap):**
- **AI-Dev-Shop governs HOW an agent works a single task** — role pipeline
  (analyze → spec → architect → TDD → implement → review → security → docs), its
  intra-task job-lifecycle state machine, and its pipeline-state format. This is
  *ephemeral working state* that lives inside a task attempt.
- **project-runner governs WHICH task, WHO holds it, WHAT happened** — the queue,
  dependency graph, lease, attempt outcomes, validation results, and resumable
  handoff. This is *durable committed state*.
- They must never keep competing task lists. A runner task **references** an ADS
  pipeline by id (`pipeline: "ads:refactor"`); ADS never enumerates Jini tasks,
  and `AI-Dev-Shop/todo.md` is off-limits as a task ledger [V — it isn't one].

---

## 1. `project-runner/` folder layout + bins

```text
project-runner/
├── config.yaml                     # committed: repos, remotes, lease namespace,
│                                   #   ttl defaults, context staleness threshold
├── schemas/                        # committed: JSON Schemas (fail-closed validation)
│   ├── task.schema.json
│   ├── attempt.schema.json
│   ├── lease.schema.json
│   ├── validation-result.schema.json
│   └── context-manifest.schema.json
├── ledger/
│   ├── tasks/<TASK-ID>.json        # committed: ONE FILE PER TASK (merge-friendly)
│   ├── index.json                  # committed but GENERATED: fast cloud read cache
│   ├── sessions/<TASK-ID>/<attempt-id>/
│   │   ├── attempt.json            # committed: outcome, branch, source/head SHA
│   │   ├── summary.md              # committed: concise resumable handoff
│   │   └── validation.json         # committed: structured validation results
│   ├── decisions.md                # committed: append-only human/agent decisions
│   ├── blockers.md                 # committed: append-only open blockers
│   └── compatibility/*.yaml        # committed: OD ownership/source-map links
├── leases/                         # GITIGNORED: local flock files + lease-token secret
├── src/
│   ├── ledger/     (task parse, transition validation, dep resolver, `next`)
│   ├── leases/     (git-ref CAS + local flock, heartbeat, reap)
│   ├── sessions/   (attempt lifecycle, handoff writer)
│   ├── git/        (worktree/branch/partial-clone, ref CAS primitives)
│   ├── upstream/   (GitHub fetch + triage for incorporate-upstream-refactor)
│   ├── context/    (export/import, manifest, staleness)
│   ├── runners/    (codex / claude execution backends — thin)
│   └── validation/ (run declared commands, capture structured results)
└── tests/
```

### Bins (all `--json`, all deterministic, per the requested set)
| Bin | Job | Writes |
|---|---|---|
| `runner next` | Deterministic task selection (§5) | nothing (read-only) |
| `runner claim <id> --agent codex\|claude` | Acquire git-ref CAS lease + open attempt + branch/worktree from pinned source SHA + materialize task packet | lease ref, `attempt.json`, task `status→claimed` |
| `runner heartbeat <id>` | Renew lease (CAS on old ref SHA); auto-invoked on a timer | lease ref |
| `runner validate <id>` | Run task's declared validation commands | `validation.json` |
| `runner finish <id> --outcome done\|handoff\|failed` | Write handoff summary, push branch/PR, release lease, transition task, refresh affected context, unblock dependents | `summary.md`, task status, index |
| `runner sync-od [--branch <b>] [--pr <n>]` | Pull user's upstream OD refactor branch/PR from GitHub, triage, emit `incorporate-upstream-refactor` tasks (§3) | new task files, triage report |
| `runner refresh-context [--repo od\|jini]` | Regenerate committed cloud-context snapshot for HEAD; refuse dirty tree (§4) | `context/snapshots/<commit>/…` |
| `runner reap` | Detect expired leases, record abandoned attempts, return tasks to `ready` (§2) | attempt records, task status |

Governance boundary in practice: `runner claim` materializes a **task packet**
(instructions + ADR/context refs + scope + validations) and names the ADS
pipeline; the agent then follows `AI-Dev-Shop/AGENTS.md` for *how* to execute.
The ADS pipeline-state file lives in the attempt dir as working state and its
final trace is folded into `summary.md`. The runner enforces ADS approval policy
but does not re-implement it.

---

## 2. Ledger files, task schema, states, lease model

### 2a. Committed vs ephemeral
**Committed** (durable memory, survives every session/machine):
- `ledger/tasks/<id>.json`, generated `index.json`, `attempt.json`, `summary.md`,
  `validation.json`, `decisions.md`, `blockers.md`, `compatibility/*.yaml`,
  schemas, `config.yaml`, and small commit-stamped context snapshots (§4).
**Ephemeral / gitignored / object-storage** (never committed):
- Lease-token secret, credentials/env, raw model transcripts, worktree paths &
  PIDs, full command logs & coverage, graph DBs/embeddings/caches, native runtime
  session handles, `leases/*` flock files. (Both seats agree on this split.)

### 2b. Task schema (one file per task — merge-friendly JSON)
Reconciles seat1's validation/approval richness with seat3's scope allow/forbid
lists and `pipeline` reference:
```jsonc
{
  "schemaVersion": 1,
  "id": "JINI-0007",
  "title": "Extract durable run/event stores",
  "type": "extract",                 // extract | incorporate-upstream-refactor | backport | context | chore | fix
  "phase": "daemon-core",            // maps to migration phase
  "status": "ready",
  "priority": 20,                    // lower = sooner
  "repository": "jini",              // jini | open-design
  "pipeline": "ads:refactor",        // ADS governance pipeline id (NOT a task list)
  "source":  { "branch": "main", "commit": "<exact-sha>" },  // pinned baseline
  "target":  { "branchPrefix": "task/JINI-0007" },
  "scope":   { "include": ["packages/persistence-sqlite/**"],
               "exclude": ["packages/runtime-node/**"] },
  "allowedChanges":   ["add stores", "add migrations"],
  "forbiddenChanges": ["edit @jini/contracts DTO shapes"],   // → human checkpoint if needed
  "goal": "…",
  "dependsOn": ["JINI-0005"],
  "adrRefs": ["docs/adr/0003-durable-stores.md"],
  "contextRequired": true,           // fail closed if context snapshot commit ≠ source.commit
  "compatibilityRefs": ["run-events-v1"],
  "approval": { "required": false }, // true ⇒ needs human gate before finish→done
  "validation": [
    { "id": "stores-test", "cwd": ".", "command": "pnpm --filter @jini/persistence-sqlite test",
      "required": true, "timeoutSeconds": 300 }
  ],
  "attemptLimit": 3,
  "leaseTtlMinutes": 40,             // per-task override (cloud long-runs can raise)
  "lastOutcome": null,
  "upstream": null                   // populated only for incorporate-upstream-refactor (§3)
}
```
`index.json` is a generated projection (id, status, phase, priority, dependsOn,
scope digest, active-lease flag) committed only so cloud agents read the queue in
one file instead of globbing N task files. It is a cache; `tasks/*.json` is truth.

### 2c. Task states + legal transitions (reconciled canonical set)
```text
draft            → ready | cancelled
ready            → claimed | cancelled
claimed          → in_progress | ready(reaped) | blocked
in_progress      → validating | blocked | failed | ready(handoff-requeue)
validating       → awaiting_review | in_progress | failed
awaiting_review  → done | in_progress | blocked        # human/merge gate
blocked          → ready | cancelled
failed           → ready | abandoned                    # abandoned after attemptLimit
done             → ready                                 # human-approved REOPEN only
any nonterminal  → superseded                            # replaced by a new task
```
Terminal: `done`, `cancelled`, `abandoned`, `superseded`. `claimed`/`in_progress`
are backed by an active lease+attempt; if the lease dies they are **reaped** back
to `ready` (never silently dropped). Attempt outcomes: `active | handed_off |
succeeded | failed | abandoned`.

### 2d. Lease model — DECISION: git-ref CAS (primary) + local flock (offline only)
**Chosen: dedicated git-ref compare-and-swap in a `refs/jini-lease/*` namespace.**
Justification (why over the alternatives):
- **Cross-machine is the requirement.** Codex cloud and Claude sessions run on
  *different hosts with no shared filesystem* — a file lock (flock) cannot
  coordinate them. The remote git server is the one shared, atomic, already-
  authenticated coordination point both backends reach. [D]
- **Ref over commit (rejects seat3's "push a claim commit").** A lease is
  transient control state, not history. Pushing lease commits to a branch
  pollutes `git log` and races the branch's real content. A dedicated
  `refs/jini-lease/<task-id>` ref is created/updated/deleted atomically by the
  server, carries a tiny JSON blob, and never touches branch history. `git push`
  with `--force-with-lease`-style expected-old-SHA gives true CAS. [D — adopts
  seat1's ref namespace, drops seat3's commit approach]
- **Flock stays, but only as an offline/single-machine fast path.** Tasks flagged
  `remoteRequired` (default true for cloud) may not be claimed via flock alone.
  [D — reconciles both seats]

Mechanics:
- **Claim** = atomically create `refs/jini-lease/<task-id>` pointing at a blob
  `{owner, agent, attemptId, branch, sourceCommit, scopeDigest, ttlMinutes,
  expiresAt, tokenHash}`. Create-if-absent; loser of the race gets a non-fast-
  forward rejection and picks another task. The secret token lives only in
  gitignored `leases/`; the ref stores its hash.
- **Heartbeat** every `min(10, ttl/4)` min: CAS-update the ref (expected old SHA →
  new SHA with a bumped `expiresAt`). A failed CAS means someone reaped/stole it →
  the agent stops and re-selects.
- **TTL** default 40 min (`leaseTtlMinutes` per-task; long cloud runs raise it).
  Missed heartbeat past `expiresAt` ⇒ eligible for reaping.
- **Reaping** (`runner reap`, also run at the top of `next`/`claim`): for each
  expired lease, record the branch head + an `abandoned` attempt in the session
  dir, delete the lease ref, return the task `→ ready`. Never discard the work
  silently.
- **Scope-overlap conflict prevention:** before granting a claim, compute the
  candidate's `scope.include/exclude` glob digest and reject if it overlaps any
  *active* lease's scope digest. Overlap may be overridden only by an explicit
  coordination record in `decisions.md`. This lets many agents run in parallel on
  disjoint file globs safely. [D — merges seat1 scope-overlap + seat3 disjoint globs]

---

## 3. GitHub upstream-refactor incorporation (`type: incorporate-upstream-refactor`)

The user's explicit want: land their *existing* OD server.ts/daemon refactor
branches & PRs (on GitHub) as ledger tasks — safely, with human checkpoints.

**Key stance (from seat1, verified as the correct posture):** these branches are
**reference evidence, not merge candidates.** e.g. `arch/server-startserver-endgame`
is ~258 commits behind current main and `arch/chat-run-extraction`'s extraction
still moves ~3,400 untyped lines behind `deps: any`. A wholesale `git merge`
would regress. So the task type means **"reimplement the seam against current
source, using the upstream branch as the design/patch reference and porting its
characterization tests,"** not "cherry-pick the diff." [V — seat1 l.177-183]

### Flow: `runner sync-od --branch <b>` (or `--pr <n>`)
1. **Fetch (read-only):** fetch the named upstream branch/PR into a gitignored
   sparse/partial clone (`--filter=blob:none`) under `references/` — no OD tree is
   committed. Record the exact fetched SHA. [V — both seats: no committed checkout]
2. **Triage report:** diff the upstream branch against Jini's current baseline;
   classify each changed region as: `port-test` (characterization test worth
   lifting), `reimplement-seam` (a real extraction to redo against current
   source), `already-superseded` (Jini trunk already did it better — the
   `integrated` daemon is more decomposed than the OD checkout [V seat3 l.5]), or
   `integrated` daemon is more decomposed than the OD checkout [V seat3 l.5]), or
   `product-content-skip` (design-systems/brands/etc., auto-skipped). Emit the
   report to `sessions/` and surface a summary.
3. **Emit ledger tasks:** for each `reimplement-seam`/`port-test` unit, create one
   `incorporate-upstream-refactor` task with:
   ```jsonc
   "type": "incorporate-upstream-refactor",
   "upstream": {
     "repo": "nexu-io/open-design", "ref": "arch/server-startserver-endgame",
     "refCommit": "<fetched-sha>", "prNumber": 42,
     "sourceMapPaths": ["apps/daemon/src/server.ts#startServer"],
     "disposition": "reimplement-seam",         // or port-test
     "referencePatch": "references/patches/JINI-00xx.patch"  // gitignored evidence
   },
   "source": { "branch": "main", "commit": "<current-jini-sha>" },  // reimplement against CURRENT
   "approval": { "required": true }             // human checkpoint (see below)
   ```
   The task's `source.commit` is *current Jini*, not the upstream SHA — you build
   against today's tree; the upstream ref is only cited evidence.
4. **Human checkpoints (required for this type):**
   - **Triage gate:** a human approves the triage dispositions before any tasks
     go `ready` (prevents auto-porting a stale/wrong seam). Recorded in
     `decisions.md`.
   - **Contract/ADR gate:** if the incorporation touches `@jini/contracts` shapes,
     public API, or a security boundary, `approval.required` forces a human
     `awaiting_review → done` gate. [V — both seats list these as human-only]
   - **Merge gate:** the reimplemented seam lands as a review branch/PR that a
     human merges; merge marks `done` and refreshes affected context.
5. **Compatibility anchor:** every incorporate task's validation MUST include the
   ported characterization test (red on the pre-change baseline, green after) and,
   for daemon seams, the **mock-replay parity** check (same `mocks/` traces
   through OD daemon and Jini, normalized streams diffed) [V — seat3 keystone].
   This is what proves "reimplemented seam == upstream behavior" without a merge.

Backport (`type: backport`, Jini→OD fork) is the mirror: red-spec-first PRs to the
user's OD fork — kept as a distinct type so the two directions never share a task.

---

## 4. Cloud-context export layout (workstream H)

Reconciles seat1's per-commit immutable snapshots + fail-closed staleness with
seat3's concrete file list + auto-enqueue. **No export exists today** [V — seat1
l.18, seat3 l.34]; generating the first is an early task (JIN-006-class).

```text
context/                             # (a.k.a. reports/cloud-context/)
├── index.yaml                       # committed: current pointer per repo
├── current/{open-design,jini}.yaml  # committed: → latest snapshot commit + freshness
└── snapshots/<repo>/<commit>/        # committed, IMMUTABLE per source commit
    ├── MANIFEST.json                 # repo URL, branch, EXACT commit, dirty flag,
    │                                 #   tool+version+config, generatedAt, incl/excl
    │                                 #   globs, export hashes, object-store URIs, prev
    ├── overview.md                   # entry doc for a fresh agent
    ├── architecture-map.md           # layers, package graph, composition roots
    ├── seams.md                      # extraction seams + ownership
    ├── hotspots.md                   # god-files, churn, risk
    ├── daemon-symbols.ndjson.zst     # top-symbol index (compressed)
    ├── web-symbols.ndjson.zst
    ├── graphify/summary.json         # ≤5 MB normalized graph export
    └── understand-anything/graph.json# ≤5 MB knowledge-graph slice (+ meta.json)
```

**Committed (small, commit-stamped):** overview/architecture/seams/hotspots docs,
top-symbol indexes, key inbound/outbound call summaries, normalized graph
*summaries*, MANIFEST + freshness. Hard caps: **no single export > 10 MiB, no
snapshot set > 25 MiB** [V seat1]; graph summaries ≤ 5 MB each [V seat3].

**Local-only / object-storage (never committed):** full CodeGraph/CBM SQLite DBs
(157 MB & 587 MB observed [V seat1 l.18]), embeddings, Understand-Anything
intermediate batches, dashboards, raw absolute paths, caches, logs, secrets. Large
blobs referenced by object-store URI + checksum in MANIFEST.

**Staleness policy (fail-closed + advisory tiers):**
- A task with `contextRequired: true` **fails closed** when the pointed snapshot's
  MANIFEST commit ≠ the task's `source.commit` [V seat1 l.533]. Hard gate.
- Advisory: `next`/`claim` computes MANIFEST→HEAD commit distance; **> N commits
  (config default 50) ⇒ warn + auto-enqueue a `type: context` refresh task** [V
  seat3 l.34]. Below N, proceed.
- `runner refresh-context` **refuses a dirty tree**, regenerates for exact HEAD,
  writes an immutable `<commit>/` snapshot, and bumps `current/*.yaml`. Snapshots
  are never edited in place (immutability = reproducibility). Incremental exports
  may describe a commit *range* but must never masquerade as full-current [V seat1].

---

## 5. Determinism + resumability (Codex cloud + Claude)

- **Ledger is memory, not chat.** All durable state is committed files; an agent
  resumes by re-reading `tasks/<id>.json` + the latest `sessions/<id>/*/summary.md`,
  never by replaying a transcript. Any Codex-cloud or Claude session reconstructs
  full state from the repo alone. [V both seats]
- **Deterministic `next` selection** (identical output for any agent, any host):
  1. topo-sort by `dependsOn`;
  2. filter to claimable = `status==ready` ∧ all deps `done` ∧ approvals satisfied
     ∧ `source.commit` still valid ∧ no active lease ∧ no active scope overlap
     ∧ (`contextRequired` ⇒ fresh snapshot);
  3. order by `(priority, phase-rank, id)` — stable, tie-broken by lexical id.
  No randomness, no wall-clock in the ordering. [V — both seats converge here]
- **Atomic, idempotent transitions:** claim = single ref-CAS (loser no-ops and
  re-selects); finish/validate writes are append-or-replace of a named file, so a
  re-run after a crash re-derives the same committed result. `index.json` is always
  regenerable from `tasks/*.json`, so a stale/conflicted index self-heals.
- **Crash/expiry recovery:** dead lease → `reap` records an `abandoned` attempt +
  branch head and returns the task to `ready`; the next agent re-claims from the
  pinned `source.commit`, reads the abandoned attempt's `summary.md` for partial
  progress, and continues. Attempts accumulate (never overwrite) so history is
  auditable across backends. [V — reconciles seat1 reap + seat3 resume]
- **Backend-agnostic:** `runner claim --agent codex|claude` only records identity
  in the lease/attempt; execution semantics are identical. The ADS pipeline
  reference makes "how to work" identical too, so a task started by Codex can be
  finished by Claude with no context loss.
- **Separate engine run-ledger (keep distinct):** the Jini *daemon's* durable run
  store (`runs`/`run_events`/`runtime_sessions`, states
  queued→starting→running→…→succeeded|failed|orphaned) is a DIFFERENT ledger for
  product runtime execution — do not conflate it with the development task ledger.
  [V — seat1 l.436-460; called out so the two never merge.]

---

## Summary of the reconciliation
- **From seat1:** git-ref CAS lease namespace, scope-overlap gating, fail-closed
  `contextRequired`, per-commit immutable snapshots, "upstream branches are
  evidence not merge candidates," separate engine run-ledger.
- **From seat3:** one-file-per-task JSON + committed generated `index.json`, ADS
  pipeline reference (governance/runner split), concrete context file list + size
  caps + >50-commit auto-enqueue, mock-replay parity as the incorporation anchor.
- **New/decided here:** the `incorporate-upstream-refactor` task type + `sync-od`
  triage flow with a mandatory triage human-gate; ref-over-commit CAS justification;
  the unified state machine; the explicit ADS-vs-runner boundary grounded in
  AI-Dev-Shop's actual `framework/workflows/` files.

## Citations
- Governance framework: `AI-Dev-Shop/framework/workflows/{job-lifecycle,pipeline-state-format,multi-agent-pipeline,git-strategy,recovery-playbook}.md`, `AI-Dev-Shop/agents/*`, `AI-Dev-Shop/todo.md` (framework backlog, not a task ledger).
- Prior proposals: `round1/seat1-codex-clean.md` (§"Project Runner and Durable Ledger", "CBM…Export Strategy", "Cloud Agent Workflow"), `round1/seat3-fable.md` (§8-10).

exec
/bin/bash -lc "printf '%s\\n' '== ADS memory files =='
find /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory -maxdepth 3 -type f -not -path '*/.local-artifacts/*' | sort | head -240
printf '%s\\n' '== AI Dev Shop workflow files =='
find /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework -maxdepth 3 -type f | sort | head -260
printf '%s\\n' '== duplicate ADS dirs diff summary =='
diff -qr /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/ADS-memory 2>/dev/null | head -120
printf '%s\\n' '== automation key headers =='
for f in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/README.md /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/architecture.md /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/dependency-graph.yaml /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/job-lifecycle.md /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/pipeline-state-format.md; do [ -f \""'$f" ] && { printf '"'\\n-- %s --\\n' \""'$f"; sed -n '"'1,220p' \""'$f"; }; done' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
== ADS memory files ==
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.gitignore
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/adrs/ADR-INDEX.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/adrs/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/constitution.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/contracts/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/contracts/architecture-fitness.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/contracts/computational-controls.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/contracts/runtime-validation.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/contracts/specs-as-built-freshness.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/governance/contracts/waivers.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/knowledge/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/knowledge/learnings.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/knowledge/memory-store.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/knowledge/project_memory.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/knowledge/project_notes.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/meta/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/reports/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/sessions/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/_meta/freshness-policy.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/_meta/generation-manifest.yaml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/architecture.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/changelog/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/components/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/dependency-graph.yaml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/global-ubiquitous-language.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/system-overview.md
== AI Dev Shop workflow files ==
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/contracts/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/contracts/architecture-fitness.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/contracts/computational-controls.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/contracts/enforcement.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/contracts/runtime-validation.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/contracts/specs-as-built-freshness.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/examples/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/examples/golden-sample/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/examples/golden-sample/adr.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/examples/golden-sample/feature.spec.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/examples/golden-sample/red-team-findings.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/examples/golden-sample/spec-manifest.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/examples/golden-sample/tasks.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/examples/golden-sample/test-certification.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/governance/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/governance/anti-hallucination-policy.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/governance/data-classification.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/governance/escalation-policy.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/governance/knowledge-routing.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/governance/tool-permission-policy.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/memory/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/memory/memory-architecture.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/memory/memory-schema.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/foundation.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/interaction-modes.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/pipeline-quickstart.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/plain-language-explanations.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/react-skill-operations.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/reminders.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/routing-guards.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/scripts/ads-initialization.sh
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/scripts/install-slash-commands.sh
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/scripts/setup-project-knowledge.sh
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/scripts/unstuck_escalation_hook.py
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/operations/startup-info.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/routing/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/routing/agent-index.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/routing/capability-probes.tsv
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/routing/compatibility-matrix.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/routing/file-trigger-table.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/routing/model-routing.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/routing/skills-registry-exceptions.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/routing/skills-registry.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/agent.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/audit-work.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/blueprint.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/clarify.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/code-review.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/consensus.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/cowork.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/debate.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/gstack-design.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/gstack-ios.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/gstack-release.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/handoff.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/implement.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/plan.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/reverse-spec.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/spec.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/slash-commands/tasks.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/active-provider.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/bmad/compatibility.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/bmad/provider.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/core/provider-contract.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/core/provider-selection.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/openspec/compatibility.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/openspec/provider.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/speckit/compatibility.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/spec-providers/speckit/provider.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/adr-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/bootstrap/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/bootstrap/constitution-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/bootstrap/contracts-bootstrap.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/bootstrap/playwright-mcp-setup.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/bootstrap/starter-conventions-typescript.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/bootstrap/workspace-gitignore.template
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/context-offload-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/evaluator-contract-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/evaluator-report-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/governance-adr-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/handoff-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/implementation-outline-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/known-flaky-tests-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/load-bearing-harness-audit-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/progress-ledger-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/red-team-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/research-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/self-validation/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/self-validation/generic-web-app-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/self-validation/node-api-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/self-validation/python-service-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/self-validation/supabase-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/system-blueprint-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/tasks-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/tdd-coverage-triage-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/test-certification-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/templates/verification-packet-template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/conventions.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/git-strategy.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/job-lifecycle.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/multi-agent-pipeline.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/pipeline-state-format.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/recovery-playbook.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/specs-as-built.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/state-validator-checklist.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/status-confidence-taxonomy.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/trace-schema.md
== duplicate ADS dirs diff summary ==
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory: .gitignore
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts: handoff
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts/swarm-consensus/context: CTX-global-assistant-chat-2026-07-12.md
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts/swarm-consensus/context: CTX-global-assistant-chat-scope-2026-07-12.md
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts/swarm-consensus: offloads
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts/swarm-consensus/primary: PRIMARY-global-assistant-chat-scope-2026-07-12.md
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts/swarm-consensus/primary: global-assistant-chat-r1-codex.md
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts/swarm-consensus/prompts: global-assistant-chat-scope-round1.txt
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts/swarm-consensus/prompts: global-assistant-chat-scope-round2.txt
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts/swarm-consensus: runs
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.local-artifacts/swarm-consensus: smoke-tests
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory: README.md
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory: governance
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory: knowledge
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory: meta
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory: reports
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory: sessions
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory: specs
Only in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory: specs_as_built
== automation key headers ==

-- /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/README.md --
# ADS Memory

This is the project-owned AI Dev Shop workspace. Commit retained project artifacts here so teammates and future agents can see the same durable context.

- `governance/`: project rules and the live constitution
- `knowledge/`: stable project memory, learnings, notes, and memory-store entries
- `sessions/`: session summaries (date, participants, models, Q&A, decisions)
- `specs/`: provider-native forward specs and planning artifacts
- `reports/`: retained ADRs, reviews, benchmarks, audits, and pipeline outputs
- `specs_as_built/`: curated current-state implementation knowledge generated from reverse-spec and post-implementation capture
- `meta/`: project-owned workflow notes, migration state, and workspace metadata
- `.local-artifacts/`: local scratch output ignored by git

Do not put secrets in this workspace. Keep short-lived local scratch in `.local-artifacts/`.

-- /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/architecture.md --
# Architecture

Summarize current architecture, dependency shape, storage, integrations, and operational assumptions here.

-- /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/specs_as_built/dependency-graph.yaml --
# Machine-readable component dependency graph.
# Populate during reverse-spec or as-built curation.

version: 1
components: []
dependencies: []
external_systems: []

-- /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/job-lifecycle.md --
# Job Lifecycle

Every agent dispatch is a job. Jobs have explicit lifecycle states. The Coordinator tracks job state in the active `pipeline-state.md` file and applies retry and backoff rules before escalating to a human.

---

## States

```
QUEUED → DISPATCHED → RUNNING → DONE
                              ↘ RETRYING → RUNNING (loop)
                              ↘ FAILED
                              ↘ ESCALATED
                              ↘ WAITING_FOR_HUMAN → RUNNING (after approval)
                              ↘ CANCELLED  (operator decision — terminal)
                              ↘ ABORTED    (external condition — terminal)
```

| State | Meaning |
|-------|---------|
| `QUEUED` | Coordinator has decided to dispatch but has not yet sent context to the agent |
| `DISPATCHED` | Agent context sent; waiting for first output |
| `RUNNING` | Agent is actively producing output |
| `DONE` | Agent produced a valid output satisfying its handoff contract |
| `RETRYING` | Output was rejected (failed validation, missing handoff contract, spec hash mismatch); queued for re-dispatch |
| `FAILED` | Retry budget exhausted; job cannot proceed without human intervention |
| `ESCALATED` | Coordinator has routed to human due to budget exhaustion or blocking condition |
| `WAITING_FOR_HUMAN` | Job is paused at a mandatory human checkpoint |
| `CANCELLED` | Human explicitly stopped the job. Intentional, no error. Record reason in `pipeline-state.md` Notes. |
| `ABORTED` | Job stopped due to external condition (context limit hit, session dropped, system error). Not intentional — resume via recovery playbook. |

---

## Retry Policy

| Stage | Max Retries | Backoff | Escalation Trigger |
|-------|-------------|---------|-------------------|
| `spec` | 2 | None — immediate | Unresolvable [NEEDS CLARIFICATION] after 2 passes |
| `clarify` | 1 | None | Human must provide answers directly |
| `architect` | 2 | None | Constitution violation without Complexity Justification entry |
| `tdd` | 3 | None | Same test failures after 3 cycles |
| `programmer` | 5 total retries across all clusters | Inject failure cluster summary each retry | Same failing cluster after 3 retries (escalate that cluster even if total budget not exhausted) |
| `testrunner` | 2 | None | Infrastructure/tooling failure (not test logic) |
| `code-review` | 1 | None | Rare — escalate if output is malformed |
| `security` | 1 | None | Escalate all Critical/High findings immediately |
| `coverage-loop` (tdd → programmer → testrunner cycle for gap fill) | 3 per High-priority gap cluster | None | Same High-priority gap cluster unresolved after 3 full cycles — escalate; Medium/Low gaps are deferred, not escalated |

**Backoff rule for Programmer retries 3+:**
Before dispatching retry 4 or 5, inject the full failure cluster history and ask the agent to reason about root cause before attempting a fix. Do not just re-dispatch with the same context — that produces the same result.

## Pre-Completion Gate

Before the Coordinator accepts `DONE` for implementation or verification stages, require the pre-completion checklist defined in `<AI_DEV_SHOP_ROOT>/harness-engineering/runtime/tripwires.md`.

Reject the handoff if:

- the checklist is missing
- the evidence is stale or partial
- the claimed completion does not map back to the active task/spec
- runtime-changing work required self-validation evidence and the handoff lacks either a self-validation report path or an explicit reason it was not run
- runtime-changing work claims `Self-Validation = PARTIAL` but does not record the failing step, attempts used, current hypothesis, and offload/report evidence
- verification handoffs omit current spec-hash verification, certified test-file
  hash status, executed vs expected test count, required-suite status, coverage
  status, or flaky-test status when those fields are required by the stage

## Loop-Detection Tripwires

Loop detection fires before budget exhaustion when any of these are true inside one failure cluster:

- the same file is edited 3 times
- the same command/test is rerun 3 times with materially identical failure output
- retry 2 ends without a materially new hypothesis

When a loop trigger fires:

1. keep the job in `RETRYING`
2. require a `Loop Alert` summary plus a different next approach
3. update the progress ledger before another retry
4. escalate early if no different approach exists

---

## Rejection Criteria

A job output is rejected (triggers `RETRYING`) if any of the following are true:

- Output does not reference the active spec version and hash
- Output references a stale spec hash or lacks mechanical hash verification when
  the stage is at or after TDD
- Handoff contract is missing or incomplete (no input refs, output summary, risks, or suggested next)
- Agent operated outside its assigned scope (e.g., Programmer refactored untouched code)
- Output contains a known failure marker (e.g., "[NEEDS CLARIFICATION]" left unresolved by Spec Agent)
- ADR is missing Constitution Check table or has unjustified EXCEPTION entries
- TDD certification lacks a test-file hash inventory or expected runnable test
  count
- TestRunner reports zero executed tests, skipped-only success, stale test-file
  hashes, missing required coverage artifacts, or unapproved flaky tests as a
  pass
- A specialist mutates `tasks.md` task status, `pipeline-state.md`, or another
  shared stage artifact without Coordinator delegation

---

## Escalation Criteria

Escalate to human (set state to `ESCALATED`) when:

- Any stage hits its max retry count
- Programmer: same failing cluster persists after 3 retries — this signals a spec or architecture problem, not a code problem
- Loop trigger fires and no materially different next approach is available
- Self-validation ends in `BLOCKER` because runtime evidence shows a confirmed critical-path, auth/security, data-loss, or migration-stop problem
- Security: any Critical or High finding
- Spec hash changes mid-run
- Certified test-file hashes change without TDD recertification or Coordinator
  waiver
- Required coverage evidence is unavailable for a required suite
- Unapproved flaky tests remain in the advancement path
- Two agents produce directly conflicting guidance
- Constitution violation in ADR without a corresponding Complexity Justification row (same severity as spec hash mismatch)

`Self-Validation = PARTIAL` is not an automatic escalation. If the bounded retry path was used and the failure is recorded clearly, the Coordinator may continue downstream with the warning preserved.

---

## Recording Job State

In `pipeline-state.md`, update the Current Stage Detail block at every state transition:

```markdown
## Current Stage Detail

- stage: programmer
- dispatched_at: 2026-02-22T15:13:00Z
- job_status: RETRYING
- retry_count: 2
- last_output_summary: AC-03 and AC-07 still failing; timeout edge case not handled
```

When a job reaches `DONE`, move it to the Completed Stages table and clear the Current Stage Detail block for the next stage.

---

## Coordinator Modes and Job Lifecycle

- Jobs only exist in **Pipeline Mode**. In Review Mode and Direct Mode, no jobs are created.
- When user switches from Review Mode to Pipeline Mode, a new job is created at `QUEUED` state.
- When user switches to Direct Mode, any in-progress jobs are set to `WAITING_FOR_HUMAN` (not cancelled) — resumable on return to coordinator mode.
- Debug mode does not affect job state — it only controls trace verbosity.

-- /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/framework/workflows/pipeline-state-format.md --
# Pipeline State Format

Every pipeline run writes a `pipeline-state.md` file to the active feature's canonical pipeline folder in the project-owned sibling workspace. The Coordinator reads this file at the start of every session to detect and resume incomplete runs.

**Location:** `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/pipeline-state.md`

Status and confidence labels follow
`<AI_DEV_SHOP_ROOT>/framework/workflows/status-confidence-taxonomy.md`. Pipeline
state records routing consequences; it does not translate source evidence labels
into different confidence systems.

Legacy note: older runs may still use `.pipeline-state.md`. Treat that as the previous filename and migrate it to `pipeline-state.md` when the run is next resumed or updated.

---

## File Format

```markdown
# Pipeline State

- run_id: <uuid or timestamp-based ID, e.g. 2026-02-22T14:30:00Z>
- feature: <NNN>-<feature-name>
- coordinator_mode: review | pipeline | direct
- debug_mode: on | off
- spec_provider: <speckit | openspec | bmad | other>
- provider_native_root: <upstream-native conceptual root, e.g. specs/ | openspec/ | _bmad-output/>
- provider_output_root: <actual durable output root for this run, default under ADS-memory/specs/>
- spec_version: <version>
- spec_hash: <sha256>
- spec_entrypoint_path: <provider-defined planning entrypoint path>
- spec_readiness_artifact: <provider-defined readiness artifact path>
- spec_support_paths: <comma-separated list or N/A>
- spec_mode: greenfield | brownfield | migration | reverse_spec
- provider_mode: <provider-specific mode or compatibility/native track, or N/A>
- validator_result: PASS | FAIL | NOT_RUN
- validator_manual_waiver: <single-line reviewer/timestamp/reason/manual checks string, or N/A>
- spec_hash_verified_at: <ISO-8601 UTC or N/A>
- planning_preflight_status: NOT_RUN | PASS | FAIL
- planning_preflight_checked_at: <ISO-8601 UTC or N/A>
- planning_preflight_spec_hash: <sha256 or N/A>
- planning_preflight_failures: <summary or N/A>
- red_team_status: NOT_RUN | PASS | ADVISORY_ONLY | BLOCKING | CONSTITUTION_FLAG
- red_team_spec_hash: <sha256 or N/A>
- red_team_artifact: <path or N/A>
- red_team_completed_at: <ISO-8601 UTC or N/A>
- red_team_human_decision: APPROVED | REVISE | N/A
- system_blueprint_path: <path or N/A>
- system_blueprint_status: NOT_RUN | DRAFT | APPROVED | REVISE | N/A
- codebase_analysis_reports: <comma-separated ANALYSIS/MIGRATION/TESTABILITY paths or N/A>
- reverse_spec_artifacts: <comma-separated reverse-spec artifact paths or N/A>
- reverse_spec_review_status: NOT_APPLICABLE | PENDING | APPROVED | REVISE
- tasks_artifact: <path or N/A>
- test_certification_artifact: <path or N/A>
- test_certification_hash: <sha256 or N/A>
- verification_packet_artifact: <path or N/A>
- verification_packet_hash: <sha256 or N/A>
- test_file_hash_status: NOT_RUN | PASS | FAIL | N/A
- latest_testrunner_report: <path or N/A>
- testrunner_status: NOT_RUN | PASS | FAIL | UNAVAILABLE | BLOCKED
- executed_test_count: <integer or N/A>
- expected_test_count: <integer or N/A>
- required_suite_status: PASS | FAIL | PARTIAL | N/A
- coverage_status: NOT_RUN | PASS | FAIL | UNAVAILABLE | N/A
- flaky_test_status: NONE | KNOWN_APPROVED | UNAPPROVED | N/A
- code_review_gate_status: NOT_READY | READY | WAIVED
- started_at: <ISO-8601 UTC>
- last_updated_at: <ISO-8601 UTC>
- progress_ledger_path: <ADS_MEMORY_ROOT>/reports/pipeline/.../progress-ledger.md or <ADS_MEMORY_ROOT>/reports/continuity/.../progress-ledger.md
- current_stage: <stage name — see Stages below>
- status: IN_PROGRESS | WAITING_FOR_HUMAN | COMPLETE | FAILED | CANCELLED | ABORTED

## Completed Stages

| Stage | Completed At | Output Artifact | Output Hash |
|-------|-------------|-----------------|-------------|
| spec | 2026-02-22T14:32:00Z | <provider-defined spec entrypoint> | sha256:abc... |
| architect | 2026-02-22T15:10:00Z | ADS-memory/reports/pipeline/001-feature/adr.md | sha256:def... |
| tasks | 2026-02-22T15:12:00Z | ADS-memory/reports/pipeline/001-feature/tasks.md | sha256:ghi... |

## Current Stage Detail

- stage: tdd
- dispatched_at: 2026-02-22T15:13:00Z
- job_status: QUEUED | DISPATCHED | RUNNING | DONE | RETRYING | FAILED | ESCALATED | WAITING_FOR_HUMAN | CANCELLED | ABORTED
- retry_count: 0
- current_hypothesis: <one sentence or N/A>
- last_output_summary: <one sentence>

## Parallel Task Tracking

| Task ID | Owner Agent | Scope / Files | Status | Started At | Completed At | Blocks |
|---------|-------------|---------------|--------|------------|--------------|--------|
| T008 | TDD | `tests/...` | QUEUED | N/A | N/A | T010 |

Only the Coordinator updates task status and checkboxes in `tasks.md`.
Specialist agents may report task progress in handoffs, but do not mutate this
table unless explicitly delegated. Parallel tasks must have non-overlapping
write scopes; if a shared utility, test-certification record, coverage artifact,
or state file needs updates, serialize that update through the Coordinator or a
single owner.

## Iteration Counts

| Stage | Cycle Count | Budget | Status |
|-------|-------------|--------|--------|
| tdd | 1 | 3 | WITHIN_BUDGET |
| programmer | 0 | 5 | NOT_STARTED |

## Failure Clusters

| Cluster | First Seen | Retry Count | Stage | Notes |
|---------|-----------|-------------|-------|-------|
| AC-03 timeout edge case | 2026-02-22T15:20:00Z | 2 | programmer | |

## Human Checkpoints Cleared

- [ ] Spec approval
- [ ] Reverse-spec review digest approval (if applicable)
- [ ] System blueprint approval (if produced)
- [ ] Red-Team clearance
- [ ] Architecture sign-off (includes Constitution Check)
- [ ] Convergence escalation (if triggered)
- [ ] Security sign-off

## Notes

<free-form notes from Coordinator, e.g. "AC-05 deferred to next spec revision", "Security agent flagged Medium finding, tracked in adr.md", "Constitution Article III exception logged in ADR">
```

---

## Field Reference

### `progress_ledger_path` (required for resumable or long-running work)

```markdown
progress_ledger_path: <ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/progress-ledger.md
```

Points to the human/agent-readable resume surface defined in `<AI_DEV_SHOP_ROOT>/harness-engineering/runtime/session-continuity.md`.

- Required when work is expected to cross sessions, handoffs, or retry-heavy loops
- Recommended for any feature that reaches programmer retry 2+
- If absent on a resumable run, the Coordinator should create it before further dispatch

### `coordinator_mode` (required)

```
coordinator_mode: review | pipeline | direct
```

Tracks the Coordinator's current operating mode:
- `pipeline` — full multi-agent pipeline is active; jobs are created and tracked
- `review` — Coordinator is reviewing artifacts or answering questions; no jobs are created
- `direct` — user is working directly with a single agent; in-progress jobs are set to WAITING_FOR_HUMAN, not cancelled

### `debug_mode` (optional, default: off)

```
debug_mode: on | off
```

When `on`, the Observer emits `[DEBUG]` trace entries at every dispatch, gate check, and mode switch. Does not affect job state or pipeline logic — controls trace verbosity only.

### `spec_provider` (required for new runs)

```markdown
spec_provider: speckit | openspec | bmad | other
```

Records which upstream planning provider owns the spec surface for this run.

Legacy runs may omit this field. In that case, treat the run as Speckit compatibility mode unless a human says otherwise.

### `provider_native_root` and `provider_output_root` (required for new runs)

```markdown
provider_native_root: <upstream-native conceptual root>
provider_output_root: <actual durable output root>
```

- `provider_native_root` records the upstream provider's conceptual surface, such as `specs/`, `openspec/`, or `_bmad-output/`
- `provider_output_root` records the actual path AI Dev Shop wrote for this run; the default root is under `<ADS_MEMORY_ROOT>/specs/`
- downstream agents must use recorded actual paths, not infer write targets from upstream-native examples

### `spec_entrypoint_path` and `spec_readiness_artifact` (required for new runs)

```markdown
spec_entrypoint_path: <provider-defined requirements entrypoint>
spec_readiness_artifact: <provider-defined readiness artifact>
```

- `spec_entrypoint_path` is the file used for drift detection and resume hashing
- `spec_readiness_artifact` is the file or artifact used to prove the planning surface is ready for architecture work
- for the default Speckit provider, these typically map to `feature.spec.md` and `spec-dod.md`
- new AI Dev Shop runs should normally place these paths under `<ADS_MEMORY_ROOT>/specs/`

### Planning preflight fields (required before Software Architect dispatch)

```markdown
planning_preflight_status: NOT_RUN | PASS | FAIL
planning_preflight_checked_at: <ISO-8601 UTC or N/A>
planning_preflight_spec_hash: <sha256 or N/A>
planning_preflight_failures: <summary or N/A>
```

The Coordinator writes these fields when `/plan`, manual Software Architect dispatch, or
resume validation reaches the architecture boundary. `PASS` means provider
readiness, hash verification, human approval, Red-Team clearance, blueprint
status, reverse-spec review, and brownfield evidence wiring have all passed for
the same spec hash.

Preflight relies on the primary provider validator and Red-Team fields for
validator and adversarial-review status. Do not duplicate those values into
separate preflight-specific status fields.

### Validator waiver fields (allowed only when the validator runtime is unavailable)

```markdown
validator_result: PASS | FAIL | NOT_RUN

exec
/bin/bash -lc "printf '%s\\n' '== Vite config =='
sed -n '1,260p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/vite.config.ts
printf '%s\\n' '== Next imports under web src/app =='
rg -l --glob '"'!node_modules/**'"' \"from ['\\\"]next/|from ['\\\"]next['\\\"]|require\\(['\\\"]next\" /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web | sort | head -160
printf 'next import files count: '
rg -l --glob '"'!node_modules/**'"' \"from ['\\\"]next/|from ['\\\"]next['\\\"]|require\\(['\\\"]next\" /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web | wc -l
printf '%s\\n' '== chat feature import categories =='
for d in chat-pane chat-composer; do printf '\\n-- %s --\\n' \""'$d"; rg -n '"'"'^import .* from '"' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/"'$d | sed -E "s#.*from ['"'\\\"](["'^'"'\\\"]+).*#\\1#\" | sort | uniq -c | sort -rn | head -80; done
printf '%s\\n' '== chat feature OD/domain terms =='
rg -l -i 'design|plugin|brand|figma|sketch|comment|artifact|project|workspace' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-pane /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/features/chat-composer | wc -l" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
== Vite config ==
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Lightweight dev alternative to `next dev --turbopack`, sharing the same
// src/ tree. Next remains the build (`next build`) and default dev path;
// this exists purely to avoid Next's dev-mode memory footprint for local
// iteration.
//
// Two ways to run it:
//   1. Through tools-dev, in-process (recommended — matches this repo's
//      "tools-dev is the only lifecycle entry point" rule): set
//      OD_WEB_DEV_SERVER=vite and let `pnpm tools-dev run web` start it; the
//      web sidecar (apps/web/sidecar/server.ts) runs Vite in middleware mode
//      and reuses its own daemon-proxy for /api, /artifacts, /frames — the
//      `server` block below is not consulted in that path.
//   2. Standalone, via `pnpm --filter @open-design/web dev:vite` — Vite owns
//      its own port and proxy, driven by the `server` block below. Useful for
//      UI-only iteration against an already-running daemon started separately.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5274,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.OD_DAEMON_URL || 'http://127.0.0.1:17456',
        changeOrigin: true,
      },
      '/artifacts': {
        target: process.env.OD_DAEMON_URL || 'http://127.0.0.1:17456',
        changeOrigin: true,
      },
      '/frames': {
        target: process.env.OD_DAEMON_URL || 'http://127.0.0.1:17456',
        changeOrigin: true,
      },
    },
  },
});
== Next imports under web src/app ==
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/app/[[...slug]]/client-app.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/app/desktop-pet/client.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/app/layout.tsx
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/next.config.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/sidecar/server.ts
next import files count:        5
== chat feature import categories ==

-- chat-pane --
  13 react
  11 ../../../types
  11 ../../../i18n/types
   9 ../rules
   7 @open-design/contracts
   6 ../types
   6 ../../../components/Icon
   4 ../ports
   4 ../dependencies
   4 ../../../analytics/events
   3 ../../../components/ChatComposer
   2 @open-design/contracts/analytics
   2 ./types
   2 ../../runtime/todos
   2 ../../i18n/types
   2 ../../../runtime/todos
   2 ../../../onboarding/recommendation
   2 ../../../lib/copy-to-clipboard
   2 ../../../components/NextStepActions
   2 ../../../comments
   1 ./ports
   1 ./VirtualChatRow
   1 ./UserMessage
   1 ./QueuedSendMetaChips
   1 ./MessageSessionModeChip
   1 ./CommentSection
   1 ./ChatArtifactPreview
   1 ./ActiveWorkspaceContextChip
   1 ./ActivePluginChip
   1 ./ActiveDesignSystemChip
   1 ../hooks/useMeasuredVirtualWindow.hooks
   1 ../constants
   1 ../../types
   1 ../../providers/daemon
   1 ../../components/design-files/designArtifacts
   1 ../../components/OdCard
   1 ../../components/Icon
   1 ../../components/ChatComposer
   1 ../../artifacts/strip
   1 ../../artifacts/question-form
   1 ../../../utils/agentLabels
   1 ../../../state/libraryHandoff
   1 ../../../runtime/design-toolbox
   1 ../../../onboarding/starter-copy
   1 ../../../i18n
   1 ../../../components/home-hero/placeholderScenarios
   1 ../../../components/design-files/pluginFolderActions
   1 ../../../components/SketchPreview
   1 ../../../components/OdCard
   1 ../../../components/AssistantMessage
   1 ../../../analytics/client
   1 ../../../analytics/amr-attribution

-- chat-composer --
  28 react
  13 @open-design/contracts
  10 ../types
  10 ../../../types
  10 ../../../components/Icon
   5 ../rules
   4 @open-design/contracts/analytics
   4 ../ports
   4 ../dependencies
   4 ../../../i18n
   3 ../../types
   3 ../../i18n/types
   3 ../../../i18n/content
   2 react-dom
   2 ./types
   2 ./formatters
   2 ../../utils/inlineMentions
   2 ../../components/workspace-context
   2 ../../components/plugins-home/localization
   2 ../../components/home-hero/placeholderScenarios
   2 ../../components/LibraryAssetMeta
   2 ../../components/Icon
   2 ../../../utils/inlineMentions
   2 ../../../runtime/design-toolbox
   2 ../../../components/plugins-home/localization
   2 ../../../components/composer/LexicalComposerInput
   1 ./rules
   1 ./ports
   1 ./actions
   1 ./ToolboxItemRow
   1 ./ImportItem
   1 ../hooks/useDesignToolboxDetail.hooks
   1 ../formatters
   1 ../constants
   1 ../../state/projects
   1 ../../state/mcp
   1 ../../runtime/design-toolbox
   1 ../../router
   1 ../../providers/dom
   1 ../../i18n/content
   1 ../../components/pet/pets
   1 ../../components/composer/LexicalComposerInput
   1 ../../components/ProjectReferenceModal
   1 ../../components/PreviewDrawOverlay
   1 ../../comments
   1 ../../analytics/upload-tracking
   1 ../../analytics/events
   1 ../../../components/workspace-context
   1 ../../../components/home-hero/placeholderScenarios
   1 ../../../components/connectors-state
   1 ../../../components/DesignSystemSwitchPicker
   1 ../../../components/ComposerPluginPreview
   1 ../../../comments
== chat feature OD/domain terms ==
      49

exec
/bin/bash -lc "sed -n '137,330p' /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r1b-daemon-design.md
sed -n '1,140p' /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r3b-sidecar-design.md
sed -n '275,326p' /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/recon/r3b-sidecar-design.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
## 2. `@jini/daemon-core` package spec — the composition root

### Problem statement
OD's `startServer` is a single ~6600-line closure (server.ts ~1995→8624, 194 imports). Its de-facto DI
container `ServerContext` (server-context.ts:101–144) has 40 fields, **most typed `any`**
(`db/design/projectStore/artifacts/deploy/media/critique/…`), mixing generic + product. Design goal:
turn `startServer` into `createDaemon({ ports })` where every collaborator is an explicit typed port and
route registration is opt-in per adapter.

### `createDaemon` factory (new)

```ts
// @jini/daemon-core
export interface DaemonPorts {
  paths: PathsPort;
  workspace: WorkspaceStorePort;
  artifacts: ArtifactStore;          // from @jini/persistence
  credentials: CredentialStorePort;
  telemetry: TelemetrySink;          // from @jini/agent-runtime
  promptAugmenter: PromptAugmenter;  // from @jini/agent-runtime
  resources: ResourceCatalogPort;
  registry: RegistryBackendPort;
  render: RenderServicePort;
  db: DatabasePort;
}
export interface DaemonOptions {
  ports: DaemonPorts;
  host?: string;
  port?: number;
  routeModules?: RouteRegistrar[];   // generic engine routes + adapter-supplied product routes
}
export interface DaemonHandle {
  url: string;
  server: import('node:http').Server;
  shutdown: () => Promise<void>;
  routeInventory: RouteRegistration[];
}
export function createDaemon(opts: DaemonOptions): Promise<DaemonHandle>;
```

### The ports (typed; each replaces an `any` field or a hardcode cited in r1)

```ts
// 1. Data-root / paths — replaces PathDeps (server-context.ts:18) hardcoding SKILLS_DIR/DESIGN_SYSTEMS_DIR/…
export interface PathsPort {
  runtimeDataDir: string;                    // the ONE truth source (OD_DATA_DIR → RUNTIME_DATA_DIR)
  projectsDir: string;
  artifactsDir: string;
  resolve(key: string): string;              // adapter maps product keys (BRANDS_DIR, DESIGN_SYSTEMS_DIR, …)
}

// 2. Project/workspace store — replaces ServerContext.{projectStore,projectFiles,conversations,messages}:any
export interface WorkspaceStorePort {
  getProject(id: string): Promise<ProjectRecord | null>;
  listProjects(): Promise<ProjectRecord[]>;
  createProject(input: { name: string; baseDir?: string }): Promise<ProjectRecord>; // baseDir = imported-folder exception
  readFile(projectId: string, rel: string): Promise<Buffer>;
  writeFile(projectId: string, rel: string, bytes: Buffer): Promise<void>;
  conversation: ConversationStorePort;       // messages/turns persistence
}

// 3. Artifact store — see @jini/persistence.ArtifactStore + ArtifactTaxonomy (section 1b)

// 4. Credential/token store — replaces ServerContext.auth:any + api-token-auth/tool-tokens/mcp-tokens/xai-tokens
export interface CredentialStorePort {
  getToken(scope: string, key: string): Promise<string | null>;
  putToken(scope: string, key: string, value: string): Promise<void>;
  mintRunToolToken(runId: string): Promise<{ token: string }>;   // was OD_TOOL_TOKEN grant
  oauthProvider?(name: string): OAuthProviderPort | null;        // OD injects xai/vela/composio
}

// 5. Telemetry — see @jini/agent-runtime.TelemetrySink (replaces TelemetryDeps server-context.ts:69)

// 6. Prompt-augmentation — see @jini/agent-runtime.PromptAugmenter (section 1b)

// 7. Resource-catalog — replaces ResourceDeps (server-context.ts:45); OD content catalogs become a provider
export interface ResourceCatalogPort {
  listSkillLikeEntries(): Promise<CatalogEntry[]>;   // OD: skills + design-templates
  listDesignSystems(): Promise<CatalogEntry[]>;
  mimeFor(path: string): string;
  firstPartyAtoms?(): CatalogEntry[];
}

// 8. Registry-backend — replaces registry/{static,github,database,versioning}; split transport from OD manifest
export interface RegistryBackendPort {
  get(id: string): Promise<RegistryEntry | null>;
  publish(req: RegistryPublishRequest): Promise<RegistryPublishOutcome>;
  yank(id: string): Promise<RegistryYankOutcome>;
  // MarketplaceManifest shape stays in the OD adapter's RegistryEntry<TManifest> specialization
}

// 9. Render-service — replaces server/core/types.ts Desktop{Pdf,Slide,Artifact} exporters (desktop-injected)
export interface RenderServicePort {
  exportPdf?(input: unknown): Promise<unknown>;
  renderSlides?(input: unknown): Promise<unknown>;
  exportArtifact?(input: unknown): Promise<unknown>;
}

// 10. Database — replaces ServerContext.db:any; @jini/persistence ships a sqlite default
export interface DatabasePort { /* prepared-statement handle; better-sqlite3 default backend */ }
```

### Port-satisfaction check (the compile-time contract, generalized)

OD's `route-context-contract.ts` intersects every `RegisterXRoutesDeps` and statically asserts
`ServerContext extends AllRegisteredRouteDeps` (via `Assert<T extends true>`). Generalize: each route module
declares the port slice it needs via `RouteDeps<K extends keyof DaemonPorts>`, and the factory asserts the
union of all registered modules' needs is covered by the supplied `DaemonPorts`:

```ts
// @jini/daemon-core (generalized from route-context-contract.ts:22-56)
export type RouteRegistrar<K extends keyof DaemonPorts = keyof DaemonPorts> =
  (app: Express, ports: Pick<DaemonPorts, K>) => void;

type NeededPorts<R> = R extends RouteRegistrar<infer K> ? K : never;
type Assert<T extends true> = T;
// createDaemon is generic over the tuple of routeModules; this line fails to compile if any
// registered module needs a port the caller did not supply — the OD adapter can't ship a route
// that reads ports the engine doesn't grant.
type PortsCoverRoutes<Mods extends RouteRegistrar[]> =
  Assert<NeededPorts<Mods[number]> extends keyof DaemonPorts ? true : false>;
```

This moves the guarantee from "container has an `any` for everything" to "the type system rejects a daemon
whose routes demand an unsupplied port."

---

## 3. Harvest plan from Jini `integrated` `server/`

Verified sizes (`wc -l`): total 1012 lines already extracted from the closure.

| slice | lines | verdict | action |
|---|---|---|---|
| `server/core/types.ts` | 53 | **generic** | Lift → `@jini/daemon-core`. Type-only (StartServerOptions/Result, exporter fn types); rename `StartServerOptions`→`DaemonOptions`, and the OD-branded `Desktop*Exporter` types become `RenderServicePort` methods. Erased at runtime — typecheck-only validation. |
| `server/core/runtime-paths.ts` | 195 | **generic mechanism, OD keys** | Lift the resolver → `PathsPort` default impl; the OD product path keys (SKILLS_DIR/BRANDS_DIR/…) move to the OD adapter's `resolve()`. |
| `server/events/{index,sinks}.ts` | 130 | **generic** | Lift → `@jini/daemon-core` SSE sink layer (`emitChatAgentEvent`, project events). `emitLiveArtifactEvent` is OD-product → route through TelemetrySink/adapter. |
| `server/runtime-env/agent-runtime-env.ts` | 113 | **generic (branded)** | Lift → `@jini/agent-runtime`; de-brand `OD_*` per §1c; **clear @ts-nocheck (below)**. |
| `server/bootstrap/{boot-reconcile,start-listener}.ts` | 364 | **generic + product seed** | `startDaemonListener` (154) → daemon-core wholesale. `runBootReconcileAndSeed` (210) splits: generic boot-reconcile stays; the *seed* content (marketplace/skills) becomes an adapter `onBoot(ports)` hook. |
| `server/marketplace/{index,seed}.ts` | 138 | **OD-PRODUCT** | Do NOT lift to engine. Move to `foundry/integrations/open-design/marketplace`. `OFFICIAL_MARKETPLACE_ID` + seed are product identity. |

### Clearing the `@ts-nocheck` debt on `agent-runtime-env.ts` (as part of the lift)
Verified header: file carries `// @ts-nocheck — carried over verbatim from server.ts's file-level @ts-nocheck`.
Per user-memory `feedback_ts_nocheck_masks_imports`, `@ts-nocheck` hides TS2307, so a moved file can typecheck
while its imports are dead. Lift procedure:
1. Remove `@ts-nocheck`; the two singleton reach-backs are already params (`runtimeDataDir`, `sandboxRuntime`) —
   type them: `runtimeDataDir: string`, `sandboxRuntime: SandboxRuntimeConfig` (import the real type from
   `sandbox-mode.ts`, which also moves/gets a port).
2. Type `baseEnv: NodeJS.ProcessEnv`, `toolTokenGrant: { token?: string } | null`, return `NodeJS.ProcessEnv`
   (signature already annotated — only the `@ts-nocheck` blanket hides the body).
3. `pnpm --filter @jini/agent-runtime typecheck` (src+tests) — MUST pass with zero TS2307, then a real-run/load
   smoke (spawn one agent) per `feedback_daemon_full_validation_gate`; typecheck alone is insufficient.
4. Grep the moved file for dynamic `await import()` before declaring done (moved-file blind spot).

---

## 4. Engine-vs-adapter route split

`routes/` has 32 files registered via ~40 uniform `register<Feature>Routes(app, ctx)` calls
(server.ts:2448–3466). Split by product-meaning:

**Generic engine routes → `@jini/daemon-core` (default `routeModules`):**
`chat.ts`, `runs.ts`, `terminal.ts`, `daemon.ts`, `telemetry.ts`, `memory.ts`, `active-context.ts`,
`static-resource.ts` — these read only engine ports (workspace, telemetry, agents, credentials).

**OD product routes → `foundry/integrations/open-design` (adapter supplies via route-registration API):**
`design-systems.ts`, `design-system-tool.ts`, `deploy.ts`, `media.ts`, `genui.ts`, `handoff.ts`,
`brand-routes.ts`, `live-artifact.ts`, `vela.ts`, `xai.ts`, `social-share.ts`, `attribution.ts`,
`open-design-public-metadata.ts`, `routine.ts`, plus mcp/plugins/import-export.

**Route-registration API (how the adapter injects product routes):**

```ts
// caller side, in foundry/integrations/open-design/daemon.ts
import { createDaemon } from '@jini/daemon-core';
import { genericRouteModules } from '@jini/daemon-core/routes';
import { odProductRoutes } from '@open-design/adapter/routes';   // design-systems, deploy, media, …

await createDaemon({
  ports: openDesignPorts,                                // OD impls of the 10 ports
  routeModules: [...genericRouteModules, ...odProductRoutes],
});
```

Each `RouteRegistrar<K>` declares its port slice; §2's `PortsCoverRoutes` assertion guarantees the OD
product routes only compile when `openDesignPorts` grants every slice they read (e.g. `design-systems.ts`
needs `resources` + `paths`, `deploy.ts` needs `credentials` + `render`). The fixed 40-entry list inside
`startServer` (the copy-and-run blocker from r1 §5.4) is replaced by this per-adapter opt-in array.

---

## 5. Dependency-ordered extraction task list (resumable)

Each task: scope + validation + which r1 §5 copy-and-run blocker it clears.
# R3b — Jini Sidecar + Desktop-Host Layer Design

Companion to `r3-sidecar.md`. Design for a fresh "Jini" repo extracting OD's
sidecar/desktop architecture into a product-agnostic engine + swappable adapter.
**[V] = verified against OD source, [I] = inferred/proposed design.**

Guiding principle from recon: *anything that takes a `contract` argument today is
engine; anything that IS a constant string is adapter.* OD already drew this line
right — Jini just renames the generic packages and formalizes the host seam.

---

## 1. `@jini/sidecar` and `@jini/platform` package specs

### 1a. `@jini/platform` — verbatim lift of `@open-design/platform`
Source of truth: `packages/platform/src/{index,process,command,fs,http,proxy-env,toolchain}.ts`.
**Lift 1:1. No OD strings exist in this tree [V — grep empty].** Public surface:

- Stamp codec (generic over `ProcessStampContract`): `createProcessStampArgs`,
  `readProcessStamp`, `readProcessStampFromCommand`, `readFlagValue`,
  `matchesProcessStamp`, `matchesStampedProcess`.
- Process lifecycle: `spawnBackgroundProcess`, `spawnLoggedProcess`,
  `isProcessAlive`, `waitForProcessExit`, `listProcessSnapshots`,
  `collectProcessTreePids`, `stopProcesses`.
- `createCommandInvocation`, `createPackageManagerInvocation`.
- fs: `atomicCopyFile`, `pathContains`, `readLogTail`, `removePathBestEffort`.
- `waitForHttpOk`; `wellKnownUserToolchainBins`; proxy-env helpers.

Parameterization needed: **none.** The `ProcessStampContract`
(`process.ts` l.22-30) is `{ normalizeStamp, normalizeStampCriteria, stampFields,
stampFlags }` — already product-supplied. Windows `Get-CimInstance` / POSIX `ps`
are OS-generic. **Rename package only.**

### 1b. `@jini/sidecar` — verbatim lift of `@open-design/sidecar`
Source: `packages/sidecar/src/{index,types,paths,bootstrap,json-ipc,ipc-path,port,json-file,net}.ts`.
**Lift 1:1. No OD strings [V].** Public surface (unchanged names):
`SidecarContractDescriptor`, `SidecarRuntimeContext`, all `resolve*` path helpers,
`bootstrapSidecarRuntime`, `createSidecarLaunchEnv`, `createJsonIpcServer`,
`requestJsonIpc`, `allocatePort`, json-file/pointer helpers, `normalizeIpcPath`,
`isWindowsNamedPipePath`.

Parameterization needed: **none in code** — every OD-ism enters via the descriptor
argument. The one thing to *document* for non-Node hosts: `json-ipc.ts` is Node
`net`; its wire format (not its impl) is the cross-language contract (see §2b).

### 1c. OD-identity strings that MUST live in the product descriptor (not engine)
All currently in `packages/sidecar-proto/src/index.ts` [V]. These are the entire
"adapter" — Jini's product supplies them:

| Category | OD value | Descriptor field |
|---|---|---|
| App keys | `{daemon, desktop, web}` | `normalizeApp` + app-key set |
| Modes | `{dev, runtime}` | `normalizeStamp` mode domain |
| Sources | `{packaged, tools-dev, tools-pack}` | `normalizeSource` |
| Env var names | `OD_PORT`, `OD_SIDECAR_*`, `OD_WEB_*` | `env.{base,ipcBase,ipcPath,namespace,source}` |
| Stamp flags | `--od-stamp-{app,mode,namespace,ipc,source}` | `stampFlags` |
| Defaults | `ipcBase=/tmp/open-design/ipc`, `windowsPipePrefix=open-design`, `projectTmpDirName=.tmp`, `host=127.0.0.1` | `defaults` |
| Message catalogue | `SIDECAR_MESSAGES` + all DTOs/validators | product IPC contract (NOT engine) |
| Product name | `"Open Design"` | product const |

### 1d. Exact `SidecarContractDescriptor` a product supplies
This is the seam. Engine functions are all generic over `<TStamp extends
SidecarStampShape>` and take one of these [V, `sidecar/src/types.ts` l.24-43]:

```ts
type SidecarStampShape = { app: string; ipc: string; mode: string; namespace: string; source: string };

interface SidecarContractDescriptor<TStamp extends SidecarStampShape = SidecarStampShape> {
  defaults: {
    host: string;              // "127.0.0.1"
    ipcBase: string;           // posix socket root, e.g. "/tmp/<product>/ipc"
    namespace: string;         // "default"
    projectTmpDirName: string; // ".tmp"
    windowsPipePrefix: string; // "<product>"
  };
  env: {                       // env var NAMES the runtime reads/writes
    base: string;              // "<PRODUCT>_SIDECAR_BASE"
    ipcBase: string;           // "<PRODUCT>_SIDECAR_IPC_BASE"
    ipcPath: string;           // "<PRODUCT>_SIDECAR_IPC_PATH"
    namespace: string;         // "<PRODUCT>_SIDECAR_NAMESPACE"
    source: string;            // "<PRODUCT>_SIDECAR_SOURCE"
  };
  normalizeApp(app: unknown): TStamp["app"];
  normalizeNamespace(namespace: unknown): string;
  normalizeSource(source: unknown): TStamp["source"];
  normalizeStamp(input: unknown): TStamp;
}
```
For the process layer the product also supplies the sibling `ProcessStampContract`
`{ normalizeStamp, normalizeStampCriteria, stampFields, stampFlags }`. In OD one
frozen object (`OPEN_DESIGN_SIDECAR_CONTRACT`) satisfies both — Jini keeps that
convention: **one product contract object, threaded everywhere.**

---

## 2. `@jini/desktop-host` — host-adapter interface (host-agnostic)

New small package. Formalizes what ANY shell (Electron, Tauri, headless, a test
double) must implement to be a `desktop`-app peer in a namespace. It is a
*contract + thin TS helpers built on `@jini/sidecar`*, plus a written wire spec so
a non-Node host can conform.

### 2a. The host-adapter interface

```ts
interface JiniDesktopHost<TStamp extends SidecarStampShape = SidecarStampShape> {
  /** The runtime context resolved from the argv stamp + env (via bootstrapSidecarRuntime). */
  readonly runtime: SidecarRuntimeContext<TStamp>;

  /** Discover a peer sidecar's advertised URL over IPC (poll STATUS on its socket).
   *  Used to find the WEB url to load into the shell's webview. Returns null if peer down. */
  discoverPeerUrl(app: string, opts?: { timeoutMs?: number }): Promise<string | null>;

  /** Send one typed message to a peer's IPC socket and await its result. Generic
   *  request path; discoverPeerUrl and registerWithBackend are built on it. */
  requestPeer<T>(app: string, message: unknown, opts?: { timeoutMs?: number }): Promise<T>;

  /** Stand up THIS host's own IPC server at resolveAppIpcPath(desktop, ns).
   *  Handlers is a message-type→handler map; the server MUST answer status+shutdown
   *  even if it answers nothing else. Returns a closable handle. */
  serveHostIpc(handlers: HostIpcHandlers): Promise<{ close(): Promise<void> }>;

  /** OPTIONAL security handshake: send a per-process secret to the BACKEND (daemon)
   *  app so privileged flows (folder import) can be token-gated. No-op hosts skip it. */
  registerWithBackend?(secret: Uint8Array | string): Promise<{ accepted: true }>;
}

type HostIpcHandlers = {
  status(): HostStatus | Promise<HostStatus>;   // REQUIRED
  shutdown(): void | Promise<void>;              // REQUIRED (ack, then tear down)
  [messageType: string]: (input: unknown) => unknown | Promise<unknown>; // optional caps
};

type HostStatus = {
  pid?: number | null;
  state: "idle" | "running" | "unknown";
  url?: string | null;      // the web URL the shell is showing (echoes discovery)
  updatedAt?: string;
  windowVisible?: boolean;  // shells with a window set this; headless omits
};
## 5. Modeling the bidirectional render/export coupling as a port

Today the daemon calls BACK into the desktop (Electron Chromium) for
PDF/deck/PPTX/image [V]. Crucially, **OD already has the seam** — the daemon does
not import Electron; it receives three async callbacks injected at startup:
`startDaemonRuntime({ desktopPdfExporter, desktopSlideRenderer,
desktopArtifactExporter, ... })` (`apps/daemon/src/sidecar/server.ts` l.122-159),
each of which is just `requestJsonIpc(desktopIpc, {type, input}, {timeoutMs:600_000})`.
So the daemon is already decoupled at the type level; it's only *convention* that
the endpoint answering is Electron.

### Recommended: a first-class `RenderService` port
Promote those three callbacks into one named engine port so no layer is
Electron-locked:

```ts
interface RenderService {
  exportPdf(input: ExportPdfInput): Promise<ExportPdfResult>;
  renderSlides(input: RenderSlidesInput): Promise<RenderSlidesResult>;
  exportArtifact(input: ExportArtifactInput): Promise<ExportArtifactResult>;
  // capability probe so callers can degrade instead of timing out:
  capabilities(): { pdf: boolean; slides: boolean; artifact: boolean };
}
```
The daemon depends on `RenderService` only. Interchangeable impls:

- **`ipcRenderService(desktopIpc)`** — the current behavior: forwards each call
  over NDJSON to whatever `desktop` peer is up. Works for BOTH Electron and Tauri
  hosts that advertise the capability; unaware of which Chromium is behind it.
- **`electronChromiumRenderService`** — lives IN the Electron host as the handler
  set (today's `runtime.ts` capture code). Registered via `serveHostIpc`.
- **`headlessChromiumRenderService`** — a standalone sidecar (Puppeteer/Playwright/
  `chrome --headless`) for Tauri/Linux-server/CI where no Electron window exists.
  Same message types, different engine.
- **`noopRenderService`** — returns `{ok:false, code:"UNSUPPORTED"}`; the daemon's
  export routes surface a clean "unavailable in this shell" instead of hanging.

### Placement
- `RenderService` interface + `ipcRenderService` + `noopRenderService` → engine
  (`@jini/desktop-host` or a sibling `@jini/render`), since they're transport-only.
- `electronChromiumRenderService` → the Electron adapter package.
- `headlessChromiumRenderService` → its own optional sidecar package, shared by any
  host lacking Chromium.

This keeps the daemon (backend) render-agnostic, lets Electron stay the
high-fidelity default, and gives Tauri a concrete non-degraded path without ever
importing Electron. The `capabilities()` probe is the new bit vs today — it turns
the implicit "hope the desktop answers" into an explicit degrade decision.

---

## Key citations

codex
## 1. Verdict

This is **right-with-major-fixes**, but the current proposal is still an OD extraction program disguised as a neutral engine. The biggest concern is that neutrality is being inferred from import purity and renamed packages rather than proved through independently shaped consumers. The proposed daemon ports, “generic” routes, frontend slots, synchronization tooling, and in-repo Open Design integration all preserve OD as the architectural center of gravity. Zana is the decisive counterexample: its useful seams are capability providers and tool discovery, not design-flavored projects, artifacts, registries, renderers, or workspace UI. Jini should begin as a small, versioned runtime kernel validated by external consumers—not as 23 packages mirroring OD’s current directory taxonomy.

## 2. Strongest objections

1. **The daemon abstraction is semantically OD-shaped, and its type guarantee is nearly vacuous.**
   The proposed `DaemonPorts` includes `WorkspaceStorePort` with projects/files/conversations, `ResourceCatalogPort.listSkillLikeEntries()` and `listDesignSystems()`, marketplace publication, artifact rendering, slides, and product credentials. Those are extracted OD concepts, not a minimal daemon kernel. The supposedly generic route set—`memory`, `active-context`, `static-resource`, `terminal`, and `telemetry`—is likewise not universal. Verified: agentic’s current [`ServerContext`](/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server-context.ts:101) has roughly 40 fields, mostly `any`, including explicitly product-bound design/media/deploy/orbit concerns. Compressing those into ten mandatory ports does not neutralize them. Worse, `PortsCoverRoutes` constrains `K extends keyof DaemonPorts` and then checks that `K extends keyof DaemonPorts`; that condition is true by construction.
   **Fix:** make the kernel require only lifecycle, run store, event sink, agent executor, and tool registry. Each optional route pack supplies its own dependency interface. Use a generic composition function that infers the intersection of actual module dependencies, rather than one global port bag.

2. **The claimed “~19 packages” is actually about 23, many reflecting source folders rather than release boundaries.**
   Counting the proposed entries yields protocol, agent-runtime, daemon-core, persistence, platform, sidecar, sidecar-proto, desktop-host, chat-core, chat-react, artifacts-react, workspace-react, components, AG-UI, six utility/plugin packages, and three candidates. Existing package sizes expose the problem: agentic’s `release` is 236 lines, `metatool` 195, `registry-protocol` 199, `components` 244, and `agent-tools` 132. Publishing and versioning each separately creates compatibility matrices without independent consumers.
   **Fix:** merge `sidecar-proto` into `sidecar`; merge `registry-protocol` into `plugin-runtime`; move `release`, `metatool`, `download`, and `diagnostics` into a non-core `tooling` package or leave them parked. Put store interfaces in `core` and SQLite implementations in `sqlite`. Do not create `desktop-host` until a second host exists; put the host contract beside `sidecar`, with Electron as an adapter. Keep `platform` separate only because it already has multiple real consumers.

3. **The frontend plan mistakes slot proliferation for reusable architecture.**
   Verified: agentic’s refactored `chat-pane` and `chat-composer` slices remain heavily connected to `@open-design/contracts`, design systems, plugins, comments, sketches, OD cards, analytics, projects, and workspace context. Forty-nine files in those two slices match product/domain terms. Its Vite path is also development-only: [`vite.config.ts`](/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/vite.config.ts:1) explicitly says Next remains the build and default path. Thus “harvest the advanced Vite/refactored trunk” overstates readiness. A large `JiniChatProvider` with project, artifact, annotation, file-preview, model-picker, analytics, and i18n slots risks becoming a typed OD service locator.
   **Fix:** extract only event reduction, run state, tool timelines, composer state, and transport contracts first. Keep product composition and the workspace shell in consumer apps. Make the agentic app production-build under Vite before treating it as the extraction source. Validate the React layer with a Zana-shaped fixture that has no project-file/artifact assumptions.

4. **The protocol split confuses syntactic purity with semantic neutrality.**
   Moving files because they have zero imports does not prove that `critique`, `execution-profile`, tasks, or agent-tool shapes are general contracts. The Open-Marketing neutrality test is also much weaker than advertised: verified [`product-neutrality.test.ts`](/Users/la/Desktop/Programming/Open-Marketing/scripts/product-neutrality.test.ts:1) checks named-orchestrator copy on a few public surfaces; it does not prevent OD nouns, route semantics, path conventions, or lifecycle assumptions from entering engine APIs. The existing AG-UI adapter is similarly OD-bound: its public encoder is literally `encodeOdEventForAgui`, accepting `OdNativeEvent`.
   **Fix:** define versioned wire contracts from consumer scenarios, with compatibility fixtures for all four products. Neutrality enforcement should include forbidden dependency edges, public-API vocabulary review, API Extractor snapshots, and compiled Zana/Tovu fixtures. String scanning is supplemental.

5. **The repository strategy institutionalizes OD tilt and breaks the real Tovu consumption model.**
   Putting the full OD contracts, daemon, and web app under `foundry/integrations/open-design`, plus `sync-upstream.ts` and OD-specific source maps in every package, makes OD the privileged consumer forever. Verified: Tovu currently mutates an external engine checkout by moving `apps/web/src`, symlinking its own source into that location, and launching the engine’s built daemon via [`scripts/dev.sh`](/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:19). That is brittle, but it proves the required seam: a consumer must replace the web product without living inside the engine repository.
   **Fix:** keep OD, OM, Zana, and Tovu in their own repositories consuming published or packed `@jini/*` artifacts. Jini should contain only reference apps and contract fixtures. During extraction, test consumers against `pnpm pack` tarballs; do not embed an entire favored product.

6. **Zana is being used to justify speculative packages it does not yet validate.**
   Verified: Zana’s built slice is `core + db + ai + daemon`; its web, studio, desktop, auth, storage, payments, plugins, and CLI packages are mostly stubs. Its code-execution/live-preview vision is important, but it is not a stable implementation contract. Creating `code-exec`, `terminal`, and auth/storage/payments capability packages now would encode guessed security and lifecycle semantics.
   **Fix:** extract the capability descriptor/provider-resolution primitive because Zana and Tovu independently demonstrate it. Park terminal and code execution behind design documents until one working consumer supplies cancellation, isolation, filesystem, network, resource-limit, and audit requirements.

## 3. The open questions

**(a) Is `workspace-react` engine or per-product?** Per-product. Tovu replaces the web slice, Zana separates a Vite studio from a Next product site, and OD’s shell contains its product ontology. Jini may provide layout primitives, but not panels, navigation, settings, command palette, or shell state.

**(b) Code-exec/terminal/capability-registry in v1 or parked?** Put only a narrowly named `ProviderRegistry` and capability-negotiation types in v1. Park code execution and PTY. Also avoid the overloaded term “capability registry”: Open-Marketing already uses capabilities for AG-UI actions, while Zana uses them for infrastructure providers.

**(c) Which packages merge?** Merge `sidecar-proto → sidecar`, `registry-protocol → plugin-runtime`, and persistence interfaces into `core`; ship SQLite as `sqlite`. Merge `chat-react` with tiny React primitives unless components acquire independent consumers. Park `release`, `metatool`, `download`, and `diagnostics` as tooling. Remove `workspace-react` and defer `desktop-host`.

**(d) Does automation belong in Jini?** No. It is development control-plane software, not the product runtime. Keep it in a separate automation repository with a Jini integration profile.

**(e) Monorepo integrations or separately published consumption?** Jini should be a monorepo for its own packages, reference app, and fixtures. Every real product remains in its own repository and consumes versioned `@jini/*` releases. That is the only arrangement that genuinely tests API stability and prevents workspace-only imports.

## 4. Automation layer

Folding the existing directories under `automation/` is wrong. Verified: AI-Dev-Shop is predominantly workflow documentation, agents, skills, templates, and policy—not a durable executor. ADS-memory is project-owned state, and agentic currently contains both a top-level `ADS-memory` and a separate `AI-Dev-Shop/ADS-memory`. Its supposedly authoritative `specs_as_built/architecture.md` is a placeholder, and `dependency-graph.yaml` has empty component and dependency arrays. “Adopt as-is” would import duplication and aspirational structure.

The correct relationship is:

- **AI-Dev-Shop:** versioned declarative pipeline definitions, roles, gates, retry policies, and handoff schemas.
- **Project-runner:** authoritative execution service—queue, stage/job instances, leases, cancellation, retries, sandbox assignment, validation, and append-only run events.
- **ADS-memory:** per-project materialized knowledge and curated decisions derived from runner events and human edits; never lease or queue truth.

There must be one canonical job state machine. AI-Dev-Shop already defines `QUEUED → DISPATCHED → RUNNING → ...`; project-runner should execute that schema, not introduce a competing attempt lifecycle and then “enforce ADS policy” separately.

The proposed git-ref lease design also needs a real prototype before adoption. Arbitrary remote ref permissions/fetch behavior are unverified; a `scopeDigest` cannot detect overlapping globs without the underlying normalized scopes; and committed task-status files plus a generated committed index create merge contention. Prefer a transactional SQLite/Postgres event store for authority and export signed summaries to Git for audit. Git should hold artifacts, not serve as a distributed lock database.

## 5. What’s missing

- A first-class CLI package and command registry, despite CLI being common to all four consumers.
- A shared application-service layer used identically by HTTP and CLI; otherwise route modules become the business layer.
- Protocol versioning, event ordering, replay cursors, idempotency keys, cancellation semantics, backpressure, and reconnect behavior.
- A real tool-execution boundary: discovery, authorization, confirmation, audit, timeouts, and result-size limits—not merely tool descriptors.
- Migration ownership and transaction boundaries between run, conversation, event, plugin, and provider stores.
- Plugin trust policy: signature verification, permissions, dependency isolation, network/filesystem authority, and revocation.
- Authentication versus credential storage. `CredentialStorePort` does not model principals, authorization, tenancy, or secret redaction.
- Consumer compatibility policy: semver rules, deprecation windows, API snapshots, migration tests, and a release matrix against all four repositories.
- Production Vite acceptance, including Electron asset loading, deep links, CSP, dev proxy parity, and packaged offline behavior.
- Threat models for imported workspaces, symlinks/path traversal, code execution, PTYs, malicious artifacts, and srcDoc bridges.

## 6. Revised top-level tree

```text
jini/
├── packages/
│   ├── protocol/          # versioned wire types only
│   ├── core/              # run/tool/provider services and ports
│   ├── runtime-node/      # CLI-agent adapters, parsers, process execution
│   ├── sqlite/            # optional native persistence adapter
│   ├── http/              # daemon composition + optional route packs
│   ├── cli/               # HTTP client and command registry
│   ├── platform/
│   ├── sidecar/           # runtime + neutral wire/identity descriptor
│   ├── plugin-runtime/    # includes registry schemas
│   ├── chat-core/
│   ├── react/             # chat hooks/components + small primitives
│   ├── artifacts-react/
│   └── agui/
├── apps/reference-vite/
├── fixtures/consumers/
│   ├── minimal/
│   ├── zana-shaped/
│   └── tovu-web-swap/
├── docs/
└── scripts/
```

Ordered first five extraction tasks:

1. Define versioned consumer acceptance fixtures and neutrality/API-snapshot guards; prove packed-package consumption outside the workspace.
2. Extract the minimal protocol—run events, errors, tool descriptors, replay/cancellation semantics—with mock-trace compatibility tests.
3. Extract `core`, `runtime-node`, and `sqlite` around typed services; keep OD routes and product stores outside.
4. Build HTTP and CLI adapters over the same service interfaces, then replace Tovu’s source-symlink launcher with package consumption.
5. Make the agentic web app production-Vite, then extract only `chat-core`, React run/composer state, and artifact registries validated by both Zana-shaped and Tovu-shaped fixtures.
tokens used
126,005
## 1. Verdict

This is **right-with-major-fixes**, but the current proposal is still an OD extraction program disguised as a neutral engine. The biggest concern is that neutrality is being inferred from import purity and renamed packages rather than proved through independently shaped consumers. The proposed daemon ports, “generic” routes, frontend slots, synchronization tooling, and in-repo Open Design integration all preserve OD as the architectural center of gravity. Zana is the decisive counterexample: its useful seams are capability providers and tool discovery, not design-flavored projects, artifacts, registries, renderers, or workspace UI. Jini should begin as a small, versioned runtime kernel validated by external consumers—not as 23 packages mirroring OD’s current directory taxonomy.

## 2. Strongest objections

1. **The daemon abstraction is semantically OD-shaped, and its type guarantee is nearly vacuous.**
   The proposed `DaemonPorts` includes `WorkspaceStorePort` with projects/files/conversations, `ResourceCatalogPort.listSkillLikeEntries()` and `listDesignSystems()`, marketplace publication, artifact rendering, slides, and product credentials. Those are extracted OD concepts, not a minimal daemon kernel. The supposedly generic route set—`memory`, `active-context`, `static-resource`, `terminal`, and `telemetry`—is likewise not universal. Verified: agentic’s current [`ServerContext`](/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server-context.ts:101) has roughly 40 fields, mostly `any`, including explicitly product-bound design/media/deploy/orbit concerns. Compressing those into ten mandatory ports does not neutralize them. Worse, `PortsCoverRoutes` constrains `K extends keyof DaemonPorts` and then checks that `K extends keyof DaemonPorts`; that condition is true by construction.
   **Fix:** make the kernel require only lifecycle, run store, event sink, agent executor, and tool registry. Each optional route pack supplies its own dependency interface. Use a generic composition function that infers the intersection of actual module dependencies, rather than one global port bag.

2. **The claimed “~19 packages” is actually about 23, many reflecting source folders rather than release boundaries.**
   Counting the proposed entries yields protocol, agent-runtime, daemon-core, persistence, platform, sidecar, sidecar-proto, desktop-host, chat-core, chat-react, artifacts-react, workspace-react, components, AG-UI, six utility/plugin packages, and three candidates. Existing package sizes expose the problem: agentic’s `release` is 236 lines, `metatool` 195, `registry-protocol` 199, `components` 244, and `agent-tools` 132. Publishing and versioning each separately creates compatibility matrices without independent consumers.
   **Fix:** merge `sidecar-proto` into `sidecar`; merge `registry-protocol` into `plugin-runtime`; move `release`, `metatool`, `download`, and `diagnostics` into a non-core `tooling` package or leave them parked. Put store interfaces in `core` and SQLite implementations in `sqlite`. Do not create `desktop-host` until a second host exists; put the host contract beside `sidecar`, with Electron as an adapter. Keep `platform` separate only because it already has multiple real consumers.

3. **The frontend plan mistakes slot proliferation for reusable architecture.**
   Verified: agentic’s refactored `chat-pane` and `chat-composer` slices remain heavily connected to `@open-design/contracts`, design systems, plugins, comments, sketches, OD cards, analytics, projects, and workspace context. Forty-nine files in those two slices match product/domain terms. Its Vite path is also development-only: [`vite.config.ts`](/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/vite.config.ts:1) explicitly says Next remains the build and default path. Thus “harvest the advanced Vite/refactored trunk” overstates readiness. A large `JiniChatProvider` with project, artifact, annotation, file-preview, model-picker, analytics, and i18n slots risks becoming a typed OD service locator.
   **Fix:** extract only event reduction, run state, tool timelines, composer state, and transport contracts first. Keep product composition and the workspace shell in consumer apps. Make the agentic app production-build under Vite before treating it as the extraction source. Validate the React layer with a Zana-shaped fixture that has no project-file/artifact assumptions.

4. **The protocol split confuses syntactic purity with semantic neutrality.**
   Moving files because they have zero imports does not prove that `critique`, `execution-profile`, tasks, or agent-tool shapes are general contracts. The Open-Marketing neutrality test is also much weaker than advertised: verified [`product-neutrality.test.ts`](/Users/la/Desktop/Programming/Open-Marketing/scripts/product-neutrality.test.ts:1) checks named-orchestrator copy on a few public surfaces; it does not prevent OD nouns, route semantics, path conventions, or lifecycle assumptions from entering engine APIs. The existing AG-UI adapter is similarly OD-bound: its public encoder is literally `encodeOdEventForAgui`, accepting `OdNativeEvent`.
   **Fix:** define versioned wire contracts from consumer scenarios, with compatibility fixtures for all four products. Neutrality enforcement should include forbidden dependency edges, public-API vocabulary review, API Extractor snapshots, and compiled Zana/Tovu fixtures. String scanning is supplemental.

5. **The repository strategy institutionalizes OD tilt and breaks the real Tovu consumption model.**
   Putting the full OD contracts, daemon, and web app under `foundry/integrations/open-design`, plus `sync-upstream.ts` and OD-specific source maps in every package, makes OD the privileged consumer forever. Verified: Tovu currently mutates an external engine checkout by moving `apps/web/src`, symlinking its own source into that location, and launching the engine’s built daemon via [`scripts/dev.sh`](/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:19). That is brittle, but it proves the required seam: a consumer must replace the web product without living inside the engine repository.
   **Fix:** keep OD, OM, Zana, and Tovu in their own repositories consuming published or packed `@jini/*` artifacts. Jini should contain only reference apps and contract fixtures. During extraction, test consumers against `pnpm pack` tarballs; do not embed an entire favored product.

6. **Zana is being used to justify speculative packages it does not yet validate.**
   Verified: Zana’s built slice is `core + db + ai + daemon`; its web, studio, desktop, auth, storage, payments, plugins, and CLI packages are mostly stubs. Its code-execution/live-preview vision is important, but it is not a stable implementation contract. Creating `code-exec`, `terminal`, and auth/storage/payments capability packages now would encode guessed security and lifecycle semantics.
   **Fix:** extract the capability descriptor/provider-resolution primitive because Zana and Tovu independently demonstrate it. Park terminal and code execution behind design documents until one working consumer supplies cancellation, isolation, filesystem, network, resource-limit, and audit requirements.

## 3. The open questions

**(a) Is `workspace-react` engine or per-product?** Per-product. Tovu replaces the web slice, Zana separates a Vite studio from a Next product site, and OD’s shell contains its product ontology. Jini may provide layout primitives, but not panels, navigation, settings, command palette, or shell state.

**(b) Code-exec/terminal/capability-registry in v1 or parked?** Put only a narrowly named `ProviderRegistry` and capability-negotiation types in v1. Park code execution and PTY. Also avoid the overloaded term “capability registry”: Open-Marketing already uses capabilities for AG-UI actions, while Zana uses them for infrastructure providers.

**(c) Which packages merge?** Merge `sidecar-proto → sidecar`, `registry-protocol → plugin-runtime`, and persistence interfaces into `core`; ship SQLite as `sqlite`. Merge `chat-react` with tiny React primitives unless components acquire independent consumers. Park `release`, `metatool`, `download`, and `diagnostics` as tooling. Remove `workspace-react` and defer `desktop-host`.

**(d) Does automation belong in Jini?** No. It is development control-plane software, not the product runtime. Keep it in a separate automation repository with a Jini integration profile.

**(e) Monorepo integrations or separately published consumption?** Jini should be a monorepo for its own packages, reference app, and fixtures. Every real product remains in its own repository and consumes versioned `@jini/*` releases. That is the only arrangement that genuinely tests API stability and prevents workspace-only imports.

## 4. Automation layer

Folding the existing directories under `automation/` is wrong. Verified: AI-Dev-Shop is predominantly workflow documentation, agents, skills, templates, and policy—not a durable executor. ADS-memory is project-owned state, and agentic currently contains both a top-level `ADS-memory` and a separate `AI-Dev-Shop/ADS-memory`. Its supposedly authoritative `specs_as_built/architecture.md` is a placeholder, and `dependency-graph.yaml` has empty component and dependency arrays. “Adopt as-is” would import duplication and aspirational structure.

The correct relationship is:

- **AI-Dev-Shop:** versioned declarative pipeline definitions, roles, gates, retry policies, and handoff schemas.
- **Project-runner:** authoritative execution service—queue, stage/job instances, leases, cancellation, retries, sandbox assignment, validation, and append-only run events.
- **ADS-memory:** per-project materialized knowledge and curated decisions derived from runner events and human edits; never lease or queue truth.

There must be one canonical job state machine. AI-Dev-Shop already defines `QUEUED → DISPATCHED → RUNNING → ...`; project-runner should execute that schema, not introduce a competing attempt lifecycle and then “enforce ADS policy” separately.

The proposed git-ref lease design also needs a real prototype before adoption. Arbitrary remote ref permissions/fetch behavior are unverified; a `scopeDigest` cannot detect overlapping globs without the underlying normalized scopes; and committed task-status files plus a generated committed index create merge contention. Prefer a transactional SQLite/Postgres event store for authority and export signed summaries to Git for audit. Git should hold artifacts, not serve as a distributed lock database.

## 5. What’s missing

- A first-class CLI package and command registry, despite CLI being common to all four consumers.
- A shared application-service layer used identically by HTTP and CLI; otherwise route modules become the business layer.
- Protocol versioning, event ordering, replay cursors, idempotency keys, cancellation semantics, backpressure, and reconnect behavior.
- A real tool-execution boundary: discovery, authorization, confirmation, audit, timeouts, and result-size limits—not merely tool descriptors.
- Migration ownership and transaction boundaries between run, conversation, event, plugin, and provider stores.
- Plugin trust policy: signature verification, permissions, dependency isolation, network/filesystem authority, and revocation.
- Authentication versus credential storage. `CredentialStorePort` does not model principals, authorization, tenancy, or secret redaction.
- Consumer compatibility policy: semver rules, deprecation windows, API snapshots, migration tests, and a release matrix against all four repositories.
- Production Vite acceptance, including Electron asset loading, deep links, CSP, dev proxy parity, and packaged offline behavior.
- Threat models for imported workspaces, symlinks/path traversal, code execution, PTYs, malicious artifacts, and srcDoc bridges.

## 6. Revised top-level tree

```text
jini/
├── packages/
│   ├── protocol/          # versioned wire types only
│   ├── core/              # run/tool/provider services and ports
│   ├── runtime-node/      # CLI-agent adapters, parsers, process execution
│   ├── sqlite/            # optional native persistence adapter
│   ├── http/              # daemon composition + optional route packs
│   ├── cli/               # HTTP client and command registry
│   ├── platform/
│   ├── sidecar/           # runtime + neutral wire/identity descriptor
│   ├── plugin-runtime/    # includes registry schemas
│   ├── chat-core/
│   ├── react/             # chat hooks/components + small primitives
│   ├── artifacts-react/
│   └── agui/
├── apps/reference-vite/
├── fixtures/consumers/
│   ├── minimal/
│   ├── zana-shaped/
│   └── tovu-web-swap/
├── docs/
└── scripts/
```

Ordered first five extraction tasks:

1. Define versioned consumer acceptance fixtures and neutrality/API-snapshot guards; prove packed-package consumption outside the workspace.
2. Extract the minimal protocol—run events, errors, tool descriptors, replay/cancellation semantics—with mock-trace compatibility tests.
3. Extract `core`, `runtime-node`, and `sqlite` around typed services; keep OD routes and product stores outside.
4. Build HTTP and CLI adapters over the same service interfaces, then replace Tovu’s source-symlink launcher with package consumption.
5. Make the agentic web app production-Vite, then extract only `chat-core`, React run/composer state, and artifact registries validated by both Zana-shaped and Tovu-shaped fixtures.
SD_SEAT1_DONE exit=0
