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
session id: 019f6bc0-0579-7340-80c2-5bf9f26c9317
--------
user
# Jini Architecture — Blind First-Round Packet (identical for every participant)

You are ONE independent participant in a blind, adversarial architecture debate.
You will NOT see any other participant's answer, and they will not see yours.
Do not try to guess or mimic what others might say. Give your own honest, concrete architecture.

There is no "coordinator preferred answer" in this packet. Nobody has told you the right answer. Decide for yourself.

## Your task

Read the four source documents below (all are readable from disk), inspect the two repositories read-only as much or as little as you judge useful, then produce a complete, decisive architecture recommendation for turning the reusable parts of **Open Design** into **Jini** — a generic engine that Open Design (and other products) consume through adapters. "Jini" is Swahili for "engine."

The controlling question set, stipulations, evaluation rubric, and required deliverables are in the debate brief (document 1). Answer it fully. The porting plan (document 2) is PRIOR SUGGESTIONS ONLY — not settled decisions; feel free to disagree with it explicitly.

## Source documents (read these — identical for all participants)

1. Debate brief (the controlling spec):
   `/Users/la/Desktop/Programming/Jini/docs/jini-architecture-blind-debate-brief.md`
2. Prior porting plan (SUGGESTIONS, not decisions):
   `/Users/la/Desktop/Programming/OSS-Repos/open-design/docs/jini-open-design-porting-plan.md`
3. Open Design root AGENTS.md (source repo conventions):
   `/Users/la/Desktop/Programming/OSS-Repos/open-design/AGENTS.md`
4. Jini root AGENTS.md (target repo, currently a copy of OD):
   `/Users/la/Desktop/Programming/Jini/AGENTS.md`

## Repositories (READ-ONLY inspection allowed; equal access for all participants)

- Open Design source: `/Users/la/Desktop/Programming/OSS-Repos/open-design`
- Jini target: `/Users/la/Desktop/Programming/Jini` (currently a full copy of OD with OD git remotes; apps/web/src mid-refactor)

## Required deliverables (produce ALL of these)

1. **Executive recommendation** — pick ONE repository strategy (blank-engine-with-OD-as-reference / copy-then-refactor-behind-adapters / strangler extraction / package-first / subtree / monorepo federation / other) and justify it in one tight paragraph. Be decisive; no fence-sitting.
2. **Answers to the brief's question sections** — concise, one short block each: Jini repo strategy; Daemon architecture & portability; Frontend architecture & reusable UI; Automation & cloud execution; Durable task/session ledger; Codebase-understanding reports; AI-Dev-Shop & governance; Reference-repo size & provenance; Compatibility/releases/operations; Cost & model use.
3. **Top-level Jini folder tree** — concrete.
4. **Phased Open-Design→Jini migration plan** with explicit rollback points.
5. **Frontend extraction sequence** and **Daemon extraction sequence** (ordered).
6. **project-runner + task-ledger contract** — files, schema, task states + legal transitions, locking/lease model, what is committed vs ephemeral.
7. **Cloud-context export layout** for Codebase Memory MCP / Graphify / Understand Anything (what gets committed vs kept local).
8. **Decisions requiring the user's approval** before implementation.
9. **The first 10 concrete implementation tasks**, dependency-ordered, each sized for a resumable cloud-agent session (id, scope files, goal, validation commands).
10. **Assumptions** you made and **top 5 risks** with mitigations.

## Output format

- Plain markdown, decisive prose. Lead with the executive recommendation.
- Give concise rationale, assumptions, evidence, tradeoffs, conclusions. Do NOT include private step-by-step chain-of-thought; give reasoned conclusions, not scratch work.
- Ground claims in the actual repos where you can (cite files/paths you inspected). Distinguish "verified in repo" from "assumption."
- Be specific enough that another agent could start executing task #1 tomorrow.

## Forbidden actions (strict — this is a read-only design round)

- Do NOT edit, create, move, or delete any application source file in either repo.
- Do NOT run git write operations: no commit, branch, merge, rebase, push, reset, clean, stash, or remote changes.
- Do NOT create any GitHub repository or change remotes.
- Do NOT install packages or run builds that mutate lockfiles.
- Reading files and running read-only inspection commands (git log, git status, ls, grep, cat) is fine.

Produce your full answer now as your single final message.

codex
I’m using the repository-understanding workflow because this decision depends on verified boundaries in both codebases. I’ll keep all inspection read-only and deliver the complete recommendation in one final response.
exec
/bin/bash -lc 'cat /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md' in /Users/la/Desktop/Programming/OSS-Repos/open-design
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

> Scan this project directory to discover all project files (including non-code files like configs, docs, infrastructure), detect languages and frameworks.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json`

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` to get:
- Project name, description
- Languages, frameworks
- File list with line counts and `fileCategory` per file (`code`, `config`, `docs`, `infra`, `data`, `script`, `markup`)
- Complexity estimate
- Import map (`importMap`): pre-resolved project-internal imports per file (non-code files have empty arrays)

Store `importMap` in memory as `$IMPORT_MAP` for use in Phase 2 batch construction.
Store the file list as `$FILE_LIST` with `fileCategory` metadata for use in Phase 2 batch construction.

**Gate check:** If >100 files, inform the user and suggest scoping with a subdirectory argument. Proceed only if user confirms or add guidance that this may take a while.

If the scan result includes `filteredByIgnore > 0`, report:
> Excluded {filteredByIgnore} files via `.understandignore`.

---

## Phase 1.5 — BATCH

Report: `[Phase 1.5/7] Computing semantic batches...`

Run the bundled batching script:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT
```

Reads `.understand-anything/intermediate/scan-result.json`, writes `.understand-anything/intermediate/batches.json`.

Capture stderr. Append any line starting with `Warning:` to `$PHASE_WARNINGS` for the final report.

If the script exits non-zero, the failure is hard — relay the full stderr to the user as a Phase 1.5 failure. Do not attempt to recover; the script's internal fallback (count-based) already handles recoverable issues. A non-zero exit means a fundamental problem (missing input file, malformed JSON, etc.).

---

## Phase 2 — ANALYZE

### Full analysis path

Load `.understand-anything/intermediate/batches.json` (produced by Phase 1.5). Iterate the `batches[]` array.

Report: `[Phase 2/7] Analyzing files — <totalFiles> files in <totalBatches> batches (up to 5 concurrent)...`

For each batch, dispatch a subagent using the `file-analyzer` agent definition (at `agents/file-analyzer.md`). Run up to **5 subagents concurrently**. Append the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
>
> $LANGUAGE_DIRECTIVE

Dispatch prompt template (fill in batch-specific values from `batches.json[i]`):

> Analyze these files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch: `<batchIndex>/<totalBatches>`
> Skill directory (for bundled scripts): `<SKILL_DIR>`
> Output: write to `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json` (single-file mode) OR `batch-<batchIndex>-part-<k>.json` (split mode, per Step B of your output protocol).
>
> Pre-resolved import data for this batch (use directly — do NOT re-resolve imports from source):
> ```json
> <batchImportData JSON from batches.json[i].batchImportData>
> ```
>
> Cross-batch neighbors with their exported symbols (confidence boost for cross-batch edges):
> ```json
> <neighborMap JSON from batches.json[i].neighborMap>
> ```
>
> Files to analyze in this batch (every entry MUST be passed through to `batchFiles` with all four fields — `path`, `language`, `sizeLines`, `fileCategory`):
> 1. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> 2. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> ...

**Output naming is per-batchIndex — no fusion.** If you fuse multiple small batches into a single file-analyzer dispatch for token efficiency, the dispatched agent must STILL write one output file per original `batchIndex` using `batch-<batchIndex>.json` or `batch-<batchIndex>-part-<k>.json`. The merge script's regex (`batch-(\d+)(?:-part-(\d+))?\.json`) silently drops any other naming (e.g., `batch-fused-8-13.json`, `batch-8-13.json`), losing every node and edge in that file. After each dispatch returns, verify each `batchIndex` in the dispatched input has a corresponding `batch-<batchIndex>.json` (or `batch-<batchIndex>-part-*.json`) on disk before proceeding to the next dispatch.

After ALL batches complete, report to the user: `Phase 2 complete. All <totalBatches> batches analyzed.`

Run the merge-and-normalize script bundled with this skill (located next to this SKILL.md file — use the skill directory path, not the project root):
```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
```

This script reads all `batch-*.json` files (including `batch-<i>-part-<k>.json` produced by file-analyzers that split their output) from `$PROJECT_ROOT/.understand-anything/intermediate/`, then in one pass:
- Combines all nodes and edges across batches
- Normalizes node IDs (strips double prefixes, project-name prefixes, adds missing prefixes)
- Normalizes complexity values (`low`→`simple`, `medium`→`moderate`, `high`→`complex`, etc.)
- Rewrites edge references to match corrected node IDs
- Deduplicates nodes by ID (keeps last occurrence) and edges by `(source, target, type)`
- Drops dangling edges referencing missing nodes
- Logs all corrections and dropped items to stderr

The merge script also runs a `tested_by` linker that canonicalizes test-coverage edges in two passes. **Pass 1** walks LLM-emitted `tested_by` edges and flips inverted ones in place; semantically broken edges (test↔test, prod↔prod, orphan endpoints) are dropped. **Pass 2** supplements with path-convention pairings. Production nodes that end up sourcing any `tested_by` edge get a `"tested"` tag. All resulting edges run `production → test`.

Output: `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`

Include the script's warnings in `$PHASE_WARNINGS` for the reviewer.

### Incremental update path

Write the changed-files list (one path per line) to a temp file:
```bash
git diff <lastCommitHash>..HEAD --name-only > $PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

Run compute-batches with `--changed-files`:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT \
  --changed-files=$PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

This produces a `batches.json` that contains only batches with changed files, but neighborMap entries still reference unchanged files (with their full-graph batchIndex) so cross-batch edges remain emittable.

Then dispatch file-analyzer subagents per the same template as the full path.

After batches complete:
1. Remove old nodes whose `filePath` matches any changed file from the existing graph
2. Remove old edges whose `source` or `target` references a removed node
3. Write the pruned existing nodes/edges as `batch-existing.json` in the intermediate directory
4. Run the same merge script — it will combine `batch-existing.json` with the fresh `batch-*.json` files:
   ```bash
   python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
   ```

---

## Phase 3 — ASSEMBLE REVIEW

Report to the user: `[Phase 3/7] Reviewing assembled graph...`

Dispatch a subagent using the `assemble-reviewer` agent definition (at `agents/assemble-reviewer.md`).

Pass these parameters in the dispatch prompt:

> Review the assembled graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Batch files are at: `$PROJECT_ROOT/.understand-anything/intermediate/batch-*.json`
> Write review output to: `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json`
>
> **Merge script report:**
> ```
> <paste the full stderr output from merge-batch-graphs.py>
> ```
>
> **Import map for cross-batch edge verification:**
> ```json
> $IMPORT_MAP
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json` and add any notes to `$PHASE_WARNINGS`.

---

## Phase 4 — ARCHITECTURE

Report to the user: `[Phase 4/7] Identifying architectural layers...`

**Build the combined prompt template:**
 1. Use the `architecture-analyzer` agent definition (at `agents/architecture-analyzer.md`).
 2. **Language context injection:** For each language detected in Phase 1 (e.g., `python`, `markdown`, `dockerfile`, `yaml`, `sql`, `terraform`, `graphql`, `protobuf`, `shell`, `html`, `css`), read the file at `./languages/<language-id>.md` (e.g., `./languages/python.md`, `./languages/dockerfile.md`) and append its content after the base template under a `## Language Context` header. If the file does not exist for a detected language, skip it silently and continue. These files are in the `languages/` subdirectory next to this SKILL.md file. **Include non-code language snippets** — they provide edge patterns and summary styles for non-code files.
 3. **Framework addendum injection:** For each framework detected in Phase 1 (e.g., `Django`), read the file at `./frameworks/<framework-id-lowercase>.md` (e.g., `./frameworks/django.md`) and append its full content after the language context. If the file does not exist for a detected framework, skip it silently and continue. These files are in the `frameworks/` subdirectory next to this SKILL.md file.
 4. **Output locale injection:** If `$OUTPUT_LANGUAGE` is NOT `en` (English), read the locale guidance file at `./locales/<language-code>.md` (e.g., `./locales/zh.md`, `./locales/ja.md`, `./locales/ko.md`) and append its content after the framework addendums under a `## Output Language Guidelines` header. This provides language-specific guidance for tag naming conventions, summary style, and layer name translations. If the locale file does not exist for the specified language, skip silently — the `$LANGUAGE_DIRECTIVE` still applies. These files are in the `locales/` subdirectory next to this SKILL.md file.

Append the language/framework context and the following additional context to the agent's prompt:

> **Additional context from main session:**
>
> Frameworks detected: `<frameworks from Phase 1>`
>
> Directory tree (top 2 levels):
> ```
> $DIR_TREE
> ```
>
> Use the directory tree, language context, and framework addendums (appended above) to inform layer assignments. Directory structure is strong evidence for layer boundaries. Non-code files (config, docs, infrastructure, data) should be assigned to appropriate layers — see the prompt template for guidance.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Analyze this codebase's structure to identify architectural layers.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/layers.json`
> Project: `<projectName>` — `<projectDescription>`
>
> File nodes (all node types — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, type, name, filePath, summary, tags} for ALL file-level nodes — omit complexity, languageNotes]
> ```
>
> Import edges:
> ```json
> [list of edges with type "imports"]
> ```
>
> All edges (for cross-category analysis — includes configures, documents, deploys, triggers, etc.):
> ```json
> [list of ALL edges — include all edge types]
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/layers.json` and normalize it into a final `layers` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "layers": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any layer object has a `nodes` field instead of `nodeIds`, rename `nodes` → `nodeIds`. If `nodes` entries are objects with an `id` field rather than plain strings, extract just the `id` values into `nodeIds`.
3. **Synthesize missing IDs:** If any layer is missing an `id`, generate one as `layer:<kebab-case-name>`.
4. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
5. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.

Each element of the final `layers` array MUST have this shape:

```json
[
  {
    "id": "layer:<kebab-case-name>",
    "name": "<layer name>",
    "description": "<what belongs in this layer>",
    "nodeIds": ["file:src/App.tsx", "config:tsconfig.json", "document:README.md"]
  }
]
```

All four fields (`id`, `name`, `description`, `nodeIds`) are required.

**For incremental updates:** Always re-run architecture analysis on the full merged node set, since layer assignments may shift when files change.

**Context for incremental updates:** When re-running architecture analysis, also inject the previous layer definitions:

> Previous layer definitions (for naming consistency):
> ```json
> [previous layers from existing graph]
> ```
>
> Maintain the same layer names and IDs where possible. Only add/remove layers if the file structure has materially changed.

---

## Phase 5 — TOUR

Report to the user: `[Phase 5/7] Building guided tour...`

Dispatch a subagent using the `tour-builder` agent definition (at `agents/tour-builder.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project README (first 3000 chars):
> ```
> $README_CONTENT
> ```
>
> Project entry point: `$ENTRY_POINT`
>
> Use the README to align the tour narrative with the project's own documentation. Start the tour from the entry point if one was detected. The tour should tell the same story the README tells, but through the lens of actual code structure.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Create a guided learning tour for this codebase.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/tour.json`
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages>`
>
> Nodes (all file-level nodes — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, name, filePath, summary, type} for ALL file-level nodes — do NOT include function or class nodes]
> ```
>
> Layers:
> ```json
> [list of {id, name, description} for each layer — omit nodeIds]
> ```
>
> Edges (all types — includes imports, calls, configures, documents, deploys, triggers, etc.):
> ```json
> [list of ALL edges — include all edge types for complete graph topology analysis]
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/tour.json` and normalize it into a final `tour` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "steps": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any step has `nodesToInspect` instead of `nodeIds`, rename it → `nodeIds`. If any step has `whyItMatters` instead of `description`, rename it → `description`.
3. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
4. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.
5. **Sort** by `order` before saving.

Each element of the final `tour` array MUST have this shape:

```json
[
  {
    "order": 1,
    "title": "Project Overview",
    "description": "Start with the README to understand the project's purpose and architecture.",
    "nodeIds": ["document:README.md"]
  },
  {
    "order": 2,
    "title": "Application Entry Point",
    "description": "This step explains how the frontend boots and mounts.",
    "nodeIds": ["file:src/main.tsx", "file:src/App.tsx"]
  }
]
```

Required fields: `order`, `title`, `description`, `nodeIds`. Preserve optional `languageLesson` when present.

---

## Phase 6 — REVIEW

Report to the user: `[Phase 6/7] Validating knowledge graph...`

Assemble the full KnowledgeGraph JSON object:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<projectName>",
    "languages": ["<languages>"],
    "frameworks": ["<frameworks>"],
    "description": "<projectDescription>",
    "analyzedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<commit hash from Phase 0>"
  },
  "nodes": [<all nodes from assembled-graph.json after Phase 3 review>],
  "edges": [<all edges from assembled-graph.json after Phase 3 review>],
  "layers": [<layers from Phase 4>],
  "tour": [<steps from Phase 5>]
}
```

1. Before writing the assembled graph, validate that:
   - `layers` is an array of objects with these required fields: `id`, `name`, `description`, `nodeIds`
   - `tour` is an array of objects with these required fields: `order`, `title`, `description`, `nodeIds`
   - `tour[*].languageLesson` is allowed as an optional string field
   - Every `layers[*].nodeIds` entry exists in the merged node set
   - Every `tour[*].nodeIds` entry exists in the merged node set

   If validation fails, automatically normalize and rewrite the graph into this shape before saving. If the graph still fails final validation after the normalization pass, save it with warnings but mark dashboard auto-launch as skipped.

2. Write the assembled graph to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.

3. **Check `$ARGUMENTS` for `--review` flag.** Then run the appropriate validation path:

---

#### Default path (no `--review`): inline deterministic validation

Write the following Node.js script to `$PROJECT_ROOT/.understand-anything/tmp/ua-inline-validate.cjs`:

```javascript
#!/usr/bin/env node
const fs = require('fs');
const graphPath = process.argv[2];
const outputPath = process.argv[3];
try {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];
  if (!Array.isArray(graph.nodes)) { issues.push('graph.nodes is missing or not an array'); graph.nodes = []; }
  if (!Array.isArray(graph.edges)) { issues.push('graph.edges is missing or not an array'); graph.edges = []; }
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
    if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
  });
  const fileLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
  const fileNodes = graph.nodes.filter(n => fileLevelTypes.has(n.type)).map(n => n.id);
  const assigned = new Map();
  if (!Array.isArray(graph.layers)) { if (graph.layers) warnings.push('graph.layers is not an array'); graph.layers = []; }
  if (!Array.isArray(graph.tour)) { if (graph.tour) warnings.push('graph.tour is not an array'); graph.tour = []; }
  graph.layers.forEach(layer => {
    (layer.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
      if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`);
      assigned.set(id, layer.id);
    });
  });
  fileNodes.forEach(id => {
    if (!assigned.has(id)) issues.push(`File node '${id}' not in any layer`);
  });
  graph.tour.forEach((step, i) => {
    (step.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Tour step[${i}] refs missing node '${id}'`);
    });
  });
  const withEdges = new Set([
    ...graph.edges.map(e => e.source),
    ...graph.edges.map(e => e.target)
  ]);
  graph.nodes.forEach(n => {
    if (!withEdges.has(n.id)) warnings.push(`Node '${n.id}' has no edges (orphan)`);
  });
  const stats = {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    totalLayers: graph.layers.length,
    tourSteps: graph.tour.length,
    nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type]||0)+1; return a; }, {}),
    edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type]||0)+1; return a; }, {})
  };
  fs.writeFileSync(outputPath, JSON.stringify({ issues, warnings, stats }, null, 2));
  process.exit(0);
} catch (err) { process.stderr.write(err.message + '\n'); process.exit(1); }
```

Execute it:
```bash
node $PROJECT_ROOT/.understand-anything/tmp/ua-inline-validate.cjs \
  "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json" \
  "$PROJECT_ROOT/.understand-anything/intermediate/review.json"
```

If the script exits non-zero, read stderr, fix the script, and retry once.

---

#### `--review` path: full LLM reviewer

If `--review` IS in `$ARGUMENTS`, dispatch the LLM graph-reviewer subagent as follows:

Dispatch a subagent using the `graph-reviewer` agent definition (at `agents/graph-reviewer.md`). Append the following additional context:

> **Additional context from main session:**
>
> Phase 1 scan results (file inventory):
> ```json
> [list of {path, sizeLines} from scan-result.json]
> ```
>
> Phase warnings/errors accumulated during analysis:
> - [list any batch failures, skipped files, or warnings from Phases 2-5]
>
> Cross-validate: every file in the scan inventory should have a corresponding node in the graph (node types may vary: `file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`). Flag any missing files. Also flag any graph nodes whose `filePath` doesn't appear in the scan inventory.

Pass these parameters in the dispatch prompt:

> Validate the knowledge graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Read the file and validate it for completeness and correctness.
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/review.json`

---

4. Read `$PROJECT_ROOT/.understand-anything/intermediate/review.json`.

5. **If `issues` array is non-empty:**
   - Review the `issues` list
   - Apply automated fixes where possible:
     - Remove edges with dangling references
     - Fill missing required fields with sensible defaults (e.g., empty `tags` -> `["untagged"]`, empty `summary` -> `"No summary available"`)
     - Remove nodes with invalid types
   - Re-run the final graph validation after automated fixes
   - If critical issues remain after one fix attempt, save the graph anyway but include the warnings in the final report and mark dashboard auto-launch as skipped

6. **If `issues` array is empty:** Proceed to Phase 7.

---

## Phase 7 — SAVE

Report to the user: `[Phase 7/7] Saving knowledge graph...`

1. Write the final knowledge graph to `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.

2. **Generate structural fingerprints baseline.** This creates the basis for future automatic incremental updates and **must succeed before `meta.json` is written** — otherwise auto-update sees a fresh commit hash with no fingerprints to compare against, classifies every file as STRUCTURAL, and escalates to `FULL_UPDATE` on every subsequent commit (issue #152).

   Write the input file:
   ```bash
   cat > $PROJECT_ROOT/.understand-anything/intermediate/fingerprint-input.json <<EOF
   {
     "projectRoot": "$PROJECT_ROOT",
     "sourceFilePaths": [<all source file paths from Phase 1, as JSON array>],
     "gitCommitHash": "<current commit hash>"
   }
   EOF
   ```

   Then invoke the bundled script (located next to this SKILL.md):
   ```bash
   node <SKILL_DIR>/build-fingerprints.mjs \
     $PROJECT_ROOT/.understand-anything/intermediate/fingerprint-input.json
   ```

   The script uses `TreeSitterPlugin + PluginRegistry` exactly like `extract-structure.mjs`, so the baseline matches the comparison logic used during auto-updates.

   **If the script exits non-zero or stdout does not include `Fingerprints baseline:`, abort Phase 7 and report the error. Do NOT proceed to step 3 (writing `meta.json`).**

3. Write metadata to `$PROJECT_ROOT/.understand-anything/meta.json` (only after step 2 succeeded):
   ```json
   {
     "lastAnalyzedAt": "<ISO 8601 timestamp>",
     "gitCommitHash": "<commit hash>",
     "version": "1.0.0",
     "analyzedFiles": <number of files analyzed>
   }
   ```

4. Clean up intermediate files, **preserving `scan-result.json`** so future incremental runs can skip Phase 1 SCAN (see issue #293). We `mv` scratch dirs into a timestamped `.trash-*` instead of `rm -rf`ing them directly — this avoids tripping destructive-action gates on hardened hosts (e.g. freshness-window checks) that flag deleting directories created moments earlier (see issue #301). The delayed-purge step in Phase 0 reclaims the space once the trash is older than 7 days.
   ```bash
   # Preserve scan-result.json — Phase 1's deterministic file inventory.
   # Future incremental runs (Phase 2 compute-batches.mjs --changed-files=…)
   # need this inventory; without it, Phase 1 must re-dispatch and pay ~157k
   # tokens / ~158s per incremental run.
   TRASH="$PROJECT_ROOT/.understand-anything/.trash-$(date +%s)"
   mkdir -p "$TRASH"
   INTER="$PROJECT_ROOT/.understand-anything/intermediate"
   if [ -d "$INTER" ]; then
     # Move every entry except scan-result.json into the trash dir.
     find "$INTER" -mindepth 1 -maxdepth 1 -not -name 'scan-result.json' -exec mv {} "$TRASH/" \; 2>/dev/null || true
   fi
   mv "$PROJECT_ROOT/.understand-anything/tmp" "$TRASH/" 2>/dev/null || true
   ```

5. Report a summary to the user containing:
   - Project name and description
   - Files analyzed / total files (with breakdown by fileCategory: code, config, docs, infra, data, script, markup)
   - Nodes created (broken down by type: file, function, class, config, document, service, table, endpoint, pipeline, schema, resource)
   - Edges created (broken down by type)
   - Layers identified (with names)
   - Tour steps generated (count)
   - Any warnings from the reviewer
   - Path to the output file: `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`

6. Only automatically launch the dashboard by invoking the `/understand-dashboard` skill if final graph validation passed after normalization/review fixes.
   If final validation did not pass, report that the graph was saved with warnings and dashboard launch was skipped.

---

## Error Handling

- If any subagent dispatch fails, retry **once** with the same prompt plus additional context about the failure.
- Track all warnings and errors from each phase in a `$PHASE_WARNINGS` list. When using `--review`, pass this list to the graph-reviewer in Phase 6. On the default path, include accumulated warnings in the Phase 7 final report.
- If it fails a second time, skip that phase and continue with partial results.
- ALWAYS save partial results — a partial graph is better than no graph.
- Report any skipped phases or errors in the final summary so the user knows what happened.
- NEVER silently drop errors. Every failure must be visible in the final report.

---

## Reference: KnowledgeGraph Schema

### Node Types (13 total)
| Type | Description | ID Convention |
|---|---|---|
| `file` | Source code file | `file:<relative-path>` |
| `function` | Function or method | `function:<relative-path>:<name>` |
| `class` | Class, interface, or type | `class:<relative-path>:<name>` |
| `module` | Logical module or package | `module:<name>` |
| `concept` | Abstract concept or pattern | `concept:<name>` |
| `config` | Configuration file (YAML, JSON, TOML, env) | `config:<relative-path>` |
| `document` | Documentation file (Markdown, RST, TXT) | `document:<relative-path>` |
| `service` | Deployable service definition (Dockerfile, K8s) | `service:<relative-path>` |
| `table` | Database table or migration | `table:<relative-path>:<table-name>` |
| `endpoint` | API endpoint or route definition | `endpoint:<relative-path>:<endpoint-name>` |
| `pipeline` | CI/CD pipeline configuration | `pipeline:<relative-path>` |
| `schema` | Schema definition (GraphQL, Protobuf, Prisma) | `schema:<relative-path>` |
| `resource` | Infrastructure resource (Terraform, CloudFormation) | `resource:<relative-path>` |

### Edge Types (26 total)
| Category | Types |
|---|---|
| Structural | `imports`, `exports`, `contains`, `inherits`, `implements` |
| Behavioral | `calls`, `subscribes`, `publishes`, `middleware` |
| Data flow | `reads_from`, `writes_to`, `transforms`, `validates` |
| Dependencies | `depends_on`, `tested_by`, `configures` |
| Semantic | `related`, `similar_to` |
| Infrastructure | `deploys`, `serves`, `provisions`, `triggers` |
| Schema/Data | `migrates`, `documents`, `routes`, `defines_schema` |

### Edge Weight Conventions
| Edge Type | Weight |
|---|---|
| `contains` | 1.0 |
| `inherits`, `implements` | 0.9 |
| `calls`, `exports`, `defines_schema` | 0.8 |
| `imports`, `deploys`, `migrates` | 0.7 |
| `depends_on`, `configures`, `triggers` | 0.6 |
| `tested_by`, `documents`, `provisions`, `serves`, `routes` | 0.5 |
| All others | 0.5 (default) |

exec
/bin/bash -lc "sed -n '1,220p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
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


exec
/bin/bash -lc "sed -n '221,440p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
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

> Scan this project directory to discover all project files (including non-code files like configs, docs, infrastructure), detect languages and frameworks.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json`

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` to get:
- Project name, description
- Languages, frameworks
- File list with line counts and `fileCategory` per file (`code`, `config`, `docs`, `infra`, `data`, `script`, `markup`)
- Complexity estimate
- Import map (`importMap`): pre-resolved project-internal imports per file (non-code files have empty arrays)

Store `importMap` in memory as `$IMPORT_MAP` for use in Phase 2 batch construction.
Store the file list as `$FILE_LIST` with `fileCategory` metadata for use in Phase 2 batch construction.

**Gate check:** If >100 files, inform the user and suggest scoping with a subdirectory argument. Proceed only if user confirms or add guidance that this may take a while.

If the scan result includes `filteredByIgnore > 0`, report:
> Excluded {filteredByIgnore} files via `.understandignore`.

---

## Phase 1.5 — BATCH

Report: `[Phase 1.5/7] Computing semantic batches...`

Run the bundled batching script:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT
```

Reads `.understand-anything/intermediate/scan-result.json`, writes `.understand-anything/intermediate/batches.json`.

Capture stderr. Append any line starting with `Warning:` to `$PHASE_WARNINGS` for the final report.

If the script exits non-zero, the failure is hard — relay the full stderr to the user as a Phase 1.5 failure. Do not attempt to recover; the script's internal fallback (count-based) already handles recoverable issues. A non-zero exit means a fundamental problem (missing input file, malformed JSON, etc.).

---

## Phase 2 — ANALYZE

### Full analysis path

Load `.understand-anything/intermediate/batches.json` (produced by Phase 1.5). Iterate the `batches[]` array.

Report: `[Phase 2/7] Analyzing files — <totalFiles> files in <totalBatches> batches (up to 5 concurrent)...`

For each batch, dispatch a subagent using the `file-analyzer` agent definition (at `agents/file-analyzer.md`). Run up to **5 subagents concurrently**. Append the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
>
> $LANGUAGE_DIRECTIVE

Dispatch prompt template (fill in batch-specific values from `batches.json[i]`):

> Analyze these files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch: `<batchIndex>/<totalBatches>`
> Skill directory (for bundled scripts): `<SKILL_DIR>`
> Output: write to `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json` (single-file mode) OR `batch-<batchIndex>-part-<k>.json` (split mode, per Step B of your output protocol).
>
> Pre-resolved import data for this batch (use directly — do NOT re-resolve imports from source):
> ```json
> <batchImportData JSON from batches.json[i].batchImportData>
> ```
>
> Cross-batch neighbors with their exported symbols (confidence boost for cross-batch edges):
> ```json
> <neighborMap JSON from batches.json[i].neighborMap>
> ```
>
> Files to analyze in this batch (every entry MUST be passed through to `batchFiles` with all four fields — `path`, `language`, `sizeLines`, `fileCategory`):
> 1. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> 2. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> ...

**Output naming is per-batchIndex — no fusion.** If you fuse multiple small batches into a single file-analyzer dispatch for token efficiency, the dispatched agent must STILL write one output file per original `batchIndex` using `batch-<batchIndex>.json` or `batch-<batchIndex>-part-<k>.json`. The merge script's regex (`batch-(\d+)(?:-part-(\d+))?\.json`) silently drops any other naming (e.g., `batch-fused-8-13.json`, `batch-8-13.json`), losing every node and edge in that file. After each dispatch returns, verify each `batchIndex` in the dispatched input has a corresponding `batch-<batchIndex>.json` (or `batch-<batchIndex>-part-*.json`) on disk before proceeding to the next dispatch.

After ALL batches complete, report to the user: `Phase 2 complete. All <totalBatches> batches analyzed.`

Run the merge-and-normalize script bundled with this skill (located next to this SKILL.md file — use the skill directory path, not the project root):
```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
```

This script reads all `batch-*.json` files (including `batch-<i>-part-<k>.json` produced by file-analyzers that split their output) from `$PROJECT_ROOT/.understand-anything/intermediate/`, then in one pass:
- Combines all nodes and edges across batches
- Normalizes node IDs (strips double prefixes, project-name prefixes, adds missing prefixes)
- Normalizes complexity values (`low`→`simple`, `medium`→`moderate`, `high`→`complex`, etc.)
- Rewrites edge references to match corrected node IDs
- Deduplicates nodes by ID (keeps last occurrence) and edges by `(source, target, type)`
- Drops dangling edges referencing missing nodes
- Logs all corrections and dropped items to stderr

The merge script also runs a `tested_by` linker that canonicalizes test-coverage edges in two passes. **Pass 1** walks LLM-emitted `tested_by` edges and flips inverted ones in place; semantically broken edges (test↔test, prod↔prod, orphan endpoints) are dropped. **Pass 2** supplements with path-convention pairings. Production nodes that end up sourcing any `tested_by` edge get a `"tested"` tag. All resulting edges run `production → test`.

Output: `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`

Include the script's warnings in `$PHASE_WARNINGS` for the reviewer.

### Incremental update path

Write the changed-files list (one path per line) to a temp file:
```bash
git diff <lastCommitHash>..HEAD --name-only > $PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

Run compute-batches with `--changed-files`:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT \
  --changed-files=$PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

This produces a `batches.json` that contains only batches with changed files, but neighborMap entries still reference unchanged files (with their full-graph batchIndex) so cross-batch edges remain emittable.

Then dispatch file-analyzer subagents per the same template as the full path.

After batches complete:
1. Remove old nodes whose `filePath` matches any changed file from the existing graph
2. Remove old edges whose `source` or `target` references a removed node
3. Write the pruned existing nodes/edges as `batch-existing.json` in the intermediate directory
4. Run the same merge script — it will combine `batch-existing.json` with the fresh `batch-*.json` files:
   ```bash
   python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
   ```

---

## Phase 3 — ASSEMBLE REVIEW

Report to the user: `[Phase 3/7] Reviewing assembled graph...`

Dispatch a subagent using the `assemble-reviewer` agent definition (at `agents/assemble-reviewer.md`).

Pass these parameters in the dispatch prompt:

> Review the assembled graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Batch files are at: `$PROJECT_ROOT/.understand-anything/intermediate/batch-*.json`
> Write review output to: `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json`
>
> **Merge script report:**
> ```
> <paste the full stderr output from merge-batch-graphs.py>
> ```
>
> **Import map for cross-batch edge verification:**
> ```json
> $IMPORT_MAP
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json` and add any notes to `$PHASE_WARNINGS`.

---

## Phase 4 — ARCHITECTURE

Report to the user: `[Phase 4/7] Identifying architectural layers...`

**Build the combined prompt template:**
 1. Use the `architecture-analyzer` agent definition (at `agents/architecture-analyzer.md`).
 2. **Language context injection:** For each language detected in Phase 1 (e.g., `python`, `markdown`, `dockerfile`, `yaml`, `sql`, `terraform`, `graphql`, `protobuf`, `shell`, `html`, `css`), read the file at `./languages/<language-id>.md` (e.g., `./languages/python.md`, `./languages/dockerfile.md`) and append its content after the base template under a `## Language Context` header. If the file does not exist for a detected language, skip it silently and continue. These files are in the `languages/` subdirectory next to this SKILL.md file. **Include non-code language snippets** — they provide edge patterns and summary styles for non-code files.
 3. **Framework addendum injection:** For each framework detected in Phase 1 (e.g., `Django`), read the file at `./frameworks/<framework-id-lowercase>.md` (e.g., `./frameworks/django.md`) and append its full content after the language context. If the file does not exist for a detected framework, skip it silently and continue. These files are in the `frameworks/` subdirectory next to this SKILL.md file.
 4. **Output locale injection:** If `$OUTPUT_LANGUAGE` is NOT `en` (English), read the locale guidance file at `./locales/<language-code>.md` (e.g., `./locales/zh.md`, `./locales/ja.md`, `./locales/ko.md`) and append its content after the framework addendums under a `## Output Language Guidelines` header. This provides language-specific guidance for tag naming conventions, summary style, and layer name translations. If the locale file does not exist for the specified language, skip silently — the `$LANGUAGE_DIRECTIVE` still applies. These files are in the `locales/` subdirectory next to this SKILL.md file.

Append the language/framework context and the following additional context to the agent's prompt:

> **Additional context from main session:**
>
> Frameworks detected: `<frameworks from Phase 1>`
>
> Directory tree (top 2 levels):
> ```
> $DIR_TREE
> ```
>
> Use the directory tree, language context, and framework addendums (appended above) to inform layer assignments. Directory structure is strong evidence for layer boundaries. Non-code files (config, docs, infrastructure, data) should be assigned to appropriate layers — see the prompt template for guidance.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Analyze this codebase's structure to identify architectural layers.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/layers.json`
> Project: `<projectName>` — `<projectDescription>`
>
> File nodes (all node types — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, type, name, filePath, summary, tags} for ALL file-level nodes — omit complexity, languageNotes]
> ```
>
> Import edges:
> ```json
> [list of edges with type "imports"]
> ```

exec
/bin/bash -lc "sed -n '441,660p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
>
> All edges (for cross-category analysis — includes configures, documents, deploys, triggers, etc.):
> ```json
> [list of ALL edges — include all edge types]
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/layers.json` and normalize it into a final `layers` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "layers": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any layer object has a `nodes` field instead of `nodeIds`, rename `nodes` → `nodeIds`. If `nodes` entries are objects with an `id` field rather than plain strings, extract just the `id` values into `nodeIds`.
3. **Synthesize missing IDs:** If any layer is missing an `id`, generate one as `layer:<kebab-case-name>`.
4. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
5. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.

Each element of the final `layers` array MUST have this shape:

```json
[
  {
    "id": "layer:<kebab-case-name>",
    "name": "<layer name>",
    "description": "<what belongs in this layer>",
    "nodeIds": ["file:src/App.tsx", "config:tsconfig.json", "document:README.md"]
  }
]
```

All four fields (`id`, `name`, `description`, `nodeIds`) are required.

**For incremental updates:** Always re-run architecture analysis on the full merged node set, since layer assignments may shift when files change.

**Context for incremental updates:** When re-running architecture analysis, also inject the previous layer definitions:

> Previous layer definitions (for naming consistency):
> ```json
> [previous layers from existing graph]
> ```
>
> Maintain the same layer names and IDs where possible. Only add/remove layers if the file structure has materially changed.

---

## Phase 5 — TOUR

Report to the user: `[Phase 5/7] Building guided tour...`

Dispatch a subagent using the `tour-builder` agent definition (at `agents/tour-builder.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project README (first 3000 chars):
> ```
> $README_CONTENT
> ```
>
> Project entry point: `$ENTRY_POINT`
>
> Use the README to align the tour narrative with the project's own documentation. Start the tour from the entry point if one was detected. The tour should tell the same story the README tells, but through the lens of actual code structure.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Create a guided learning tour for this codebase.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/tour.json`
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages>`
>
> Nodes (all file-level nodes — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, name, filePath, summary, type} for ALL file-level nodes — do NOT include function or class nodes]
> ```
>
> Layers:
> ```json
> [list of {id, name, description} for each layer — omit nodeIds]
> ```
>
> Edges (all types — includes imports, calls, configures, documents, deploys, triggers, etc.):
> ```json
> [list of ALL edges — include all edge types for complete graph topology analysis]
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/tour.json` and normalize it into a final `tour` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "steps": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any step has `nodesToInspect` instead of `nodeIds`, rename it → `nodeIds`. If any step has `whyItMatters` instead of `description`, rename it → `description`.
3. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
4. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.
5. **Sort** by `order` before saving.

Each element of the final `tour` array MUST have this shape:

```json
[
  {
    "order": 1,
    "title": "Project Overview",
    "description": "Start with the README to understand the project's purpose and architecture.",
    "nodeIds": ["document:README.md"]
  },
  {
    "order": 2,
    "title": "Application Entry Point",
    "description": "This step explains how the frontend boots and mounts.",
    "nodeIds": ["file:src/main.tsx", "file:src/App.tsx"]
  }
]
```

Required fields: `order`, `title`, `description`, `nodeIds`. Preserve optional `languageLesson` when present.

---

## Phase 6 — REVIEW

Report to the user: `[Phase 6/7] Validating knowledge graph...`

Assemble the full KnowledgeGraph JSON object:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<projectName>",
    "languages": ["<languages>"],
    "frameworks": ["<frameworks>"],
    "description": "<projectDescription>",
    "analyzedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<commit hash from Phase 0>"
  },
  "nodes": [<all nodes from assembled-graph.json after Phase 3 review>],
  "edges": [<all edges from assembled-graph.json after Phase 3 review>],
  "layers": [<layers from Phase 4>],
  "tour": [<steps from Phase 5>]
}
```

1. Before writing the assembled graph, validate that:
   - `layers` is an array of objects with these required fields: `id`, `name`, `description`, `nodeIds`
   - `tour` is an array of objects with these required fields: `order`, `title`, `description`, `nodeIds`
   - `tour[*].languageLesson` is allowed as an optional string field
   - Every `layers[*].nodeIds` entry exists in the merged node set
   - Every `tour[*].nodeIds` entry exists in the merged node set

   If validation fails, automatically normalize and rewrite the graph into this shape before saving. If the graph still fails final validation after the normalization pass, save it with warnings but mark dashboard auto-launch as skipped.

2. Write the assembled graph to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.

3. **Check `$ARGUMENTS` for `--review` flag.** Then run the appropriate validation path:

---

#### Default path (no `--review`): inline deterministic validation

Write the following Node.js script to `$PROJECT_ROOT/.understand-anything/tmp/ua-inline-validate.cjs`:

```javascript
#!/usr/bin/env node
const fs = require('fs');
const graphPath = process.argv[2];
const outputPath = process.argv[3];
try {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];
  if (!Array.isArray(graph.nodes)) { issues.push('graph.nodes is missing or not an array'); graph.nodes = []; }
  if (!Array.isArray(graph.edges)) { issues.push('graph.edges is missing or not an array'); graph.edges = []; }
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
    if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
  });
  const fileLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
  const fileNodes = graph.nodes.filter(n => fileLevelTypes.has(n.type)).map(n => n.id);
  const assigned = new Map();
  if (!Array.isArray(graph.layers)) { if (graph.layers) warnings.push('graph.layers is not an array'); graph.layers = []; }
  if (!Array.isArray(graph.tour)) { if (graph.tour) warnings.push('graph.tour is not an array'); graph.tour = []; }
  graph.layers.forEach(layer => {
    (layer.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
      if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`);
      assigned.set(id, layer.id);
    });
  });
  fileNodes.forEach(id => {
    if (!assigned.has(id)) issues.push(`File node '${id}' not in any layer`);
  });
  graph.tour.forEach((step, i) => {
    (step.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Tour step[${i}] refs missing node '${id}'`);
    });
  });
  const withEdges = new Set([
    ...graph.edges.map(e => e.source),
    ...graph.edges.map(e => e.target)
  ]);
  graph.nodes.forEach(n => {
    if (!withEdges.has(n.id)) warnings.push(`Node '${n.id}' has no edges (orphan)`);
  });
  const stats = {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    totalLayers: graph.layers.length,
    tourSteps: graph.tour.length,
    nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type]||0)+1; return a; }, {}),
    edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type]||0)+1; return a; }, {})
  };
  fs.writeFileSync(outputPath, JSON.stringify({ issues, warnings, stats }, null, 2));

exec
/bin/bash -lc "sed -n '661,900p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
  process.exit(0);
} catch (err) { process.stderr.write(err.message + '\n'); process.exit(1); }
```

Execute it:
```bash
node $PROJECT_ROOT/.understand-anything/tmp/ua-inline-validate.cjs \
  "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json" \
  "$PROJECT_ROOT/.understand-anything/intermediate/review.json"
```

If the script exits non-zero, read stderr, fix the script, and retry once.

---

#### `--review` path: full LLM reviewer

If `--review` IS in `$ARGUMENTS`, dispatch the LLM graph-reviewer subagent as follows:

Dispatch a subagent using the `graph-reviewer` agent definition (at `agents/graph-reviewer.md`). Append the following additional context:

> **Additional context from main session:**
>
> Phase 1 scan results (file inventory):
> ```json
> [list of {path, sizeLines} from scan-result.json]
> ```
>
> Phase warnings/errors accumulated during analysis:
> - [list any batch failures, skipped files, or warnings from Phases 2-5]
>
> Cross-validate: every file in the scan inventory should have a corresponding node in the graph (node types may vary: `file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`). Flag any missing files. Also flag any graph nodes whose `filePath` doesn't appear in the scan inventory.

Pass these parameters in the dispatch prompt:

> Validate the knowledge graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Read the file and validate it for completeness and correctness.
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/review.json`

---

4. Read `$PROJECT_ROOT/.understand-anything/intermediate/review.json`.

5. **If `issues` array is non-empty:**
   - Review the `issues` list
   - Apply automated fixes where possible:
     - Remove edges with dangling references
     - Fill missing required fields with sensible defaults (e.g., empty `tags` -> `["untagged"]`, empty `summary` -> `"No summary available"`)
     - Remove nodes with invalid types
   - Re-run the final graph validation after automated fixes
   - If critical issues remain after one fix attempt, save the graph anyway but include the warnings in the final report and mark dashboard auto-launch as skipped

6. **If `issues` array is empty:** Proceed to Phase 7.

---

## Phase 7 — SAVE

Report to the user: `[Phase 7/7] Saving knowledge graph...`

1. Write the final knowledge graph to `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.

2. **Generate structural fingerprints baseline.** This creates the basis for future automatic incremental updates and **must succeed before `meta.json` is written** — otherwise auto-update sees a fresh commit hash with no fingerprints to compare against, classifies every file as STRUCTURAL, and escalates to `FULL_UPDATE` on every subsequent commit (issue #152).

   Write the input file:
   ```bash
   cat > $PROJECT_ROOT/.understand-anything/intermediate/fingerprint-input.json <<EOF
   {
     "projectRoot": "$PROJECT_ROOT",
     "sourceFilePaths": [<all source file paths from Phase 1, as JSON array>],
     "gitCommitHash": "<current commit hash>"
   }
   EOF
   ```

   Then invoke the bundled script (located next to this SKILL.md):
   ```bash
   node <SKILL_DIR>/build-fingerprints.mjs \
     $PROJECT_ROOT/.understand-anything/intermediate/fingerprint-input.json
   ```

   The script uses `TreeSitterPlugin + PluginRegistry` exactly like `extract-structure.mjs`, so the baseline matches the comparison logic used during auto-updates.

   **If the script exits non-zero or stdout does not include `Fingerprints baseline:`, abort Phase 7 and report the error. Do NOT proceed to step 3 (writing `meta.json`).**

3. Write metadata to `$PROJECT_ROOT/.understand-anything/meta.json` (only after step 2 succeeded):
   ```json
   {
     "lastAnalyzedAt": "<ISO 8601 timestamp>",
     "gitCommitHash": "<commit hash>",
     "version": "1.0.0",
     "analyzedFiles": <number of files analyzed>
   }
   ```

4. Clean up intermediate files, **preserving `scan-result.json`** so future incremental runs can skip Phase 1 SCAN (see issue #293). We `mv` scratch dirs into a timestamped `.trash-*` instead of `rm -rf`ing them directly — this avoids tripping destructive-action gates on hardened hosts (e.g. freshness-window checks) that flag deleting directories created moments earlier (see issue #301). The delayed-purge step in Phase 0 reclaims the space once the trash is older than 7 days.
   ```bash
   # Preserve scan-result.json — Phase 1's deterministic file inventory.
   # Future incremental runs (Phase 2 compute-batches.mjs --changed-files=…)
   # need this inventory; without it, Phase 1 must re-dispatch and pay ~157k
   # tokens / ~158s per incremental run.
   TRASH="$PROJECT_ROOT/.understand-anything/.trash-$(date +%s)"
   mkdir -p "$TRASH"
   INTER="$PROJECT_ROOT/.understand-anything/intermediate"
   if [ -d "$INTER" ]; then
     # Move every entry except scan-result.json into the trash dir.
     find "$INTER" -mindepth 1 -maxdepth 1 -not -name 'scan-result.json' -exec mv {} "$TRASH/" \; 2>/dev/null || true
   fi
   mv "$PROJECT_ROOT/.understand-anything/tmp" "$TRASH/" 2>/dev/null || true
   ```

5. Report a summary to the user containing:
   - Project name and description
   - Files analyzed / total files (with breakdown by fileCategory: code, config, docs, infra, data, script, markup)
   - Nodes created (broken down by type: file, function, class, config, document, service, table, endpoint, pipeline, schema, resource)
   - Edges created (broken down by type)
   - Layers identified (with names)
   - Tour steps generated (count)
   - Any warnings from the reviewer
   - Path to the output file: `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`

6. Only automatically launch the dashboard by invoking the `/understand-dashboard` skill if final graph validation passed after normalization/review fixes.
   If final validation did not pass, report that the graph was saved with warnings and dashboard launch was skipped.

---

## Error Handling

- If any subagent dispatch fails, retry **once** with the same prompt plus additional context about the failure.
- Track all warnings and errors from each phase in a `$PHASE_WARNINGS` list. When using `--review`, pass this list to the graph-reviewer in Phase 6. On the default path, include accumulated warnings in the Phase 7 final report.
- If it fails a second time, skip that phase and continue with partial results.
- ALWAYS save partial results — a partial graph is better than no graph.
- Report any skipped phases or errors in the final summary so the user knows what happened.
- NEVER silently drop errors. Every failure must be visible in the final report.

---

## Reference: KnowledgeGraph Schema

### Node Types (13 total)
| Type | Description | ID Convention |
|---|---|---|
| `file` | Source code file | `file:<relative-path>` |
| `function` | Function or method | `function:<relative-path>:<name>` |
| `class` | Class, interface, or type | `class:<relative-path>:<name>` |
| `module` | Logical module or package | `module:<name>` |
| `concept` | Abstract concept or pattern | `concept:<name>` |
| `config` | Configuration file (YAML, JSON, TOML, env) | `config:<relative-path>` |
| `document` | Documentation file (Markdown, RST, TXT) | `document:<relative-path>` |
| `service` | Deployable service definition (Dockerfile, K8s) | `service:<relative-path>` |
| `table` | Database table or migration | `table:<relative-path>:<table-name>` |
| `endpoint` | API endpoint or route definition | `endpoint:<relative-path>:<endpoint-name>` |
| `pipeline` | CI/CD pipeline configuration | `pipeline:<relative-path>` |
| `schema` | Schema definition (GraphQL, Protobuf, Prisma) | `schema:<relative-path>` |
| `resource` | Infrastructure resource (Terraform, CloudFormation) | `resource:<relative-path>` |

### Edge Types (26 total)
| Category | Types |
|---|---|
| Structural | `imports`, `exports`, `contains`, `inherits`, `implements` |
| Behavioral | `calls`, `subscribes`, `publishes`, `middleware` |
| Data flow | `reads_from`, `writes_to`, `transforms`, `validates` |
| Dependencies | `depends_on`, `tested_by`, `configures` |
| Semantic | `related`, `similar_to` |
| Infrastructure | `deploys`, `serves`, `provisions`, `triggers` |
| Schema/Data | `migrates`, `documents`, `routes`, `defines_schema` |

### Edge Weight Conventions
| Edge Type | Weight |
|---|---|
| `contains` | 1.0 |
| `inherits`, `implements` | 0.9 |
| `calls`, `exports`, `defines_schema` | 0.8 |
| `imports`, `deploys`, `migrates` | 0.7 |
| `depends_on`, `configures`, `triggers` | 0.6 |
| `tested_by`, `documents`, `provisions`, `serves`, `routes` | 0.5 |
| All others | 0.5 (default) |

exec
/bin/bash -lc "sed -n '221,320p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
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

> Scan this project directory to discover all project files (including non-code files like configs, docs, infrastructure), detect languages and frameworks.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json`

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` to get:
- Project name, description
- Languages, frameworks
- File list with line counts and `fileCategory` per file (`code`, `config`, `docs`, `infra`, `data`, `script`, `markup`)
- Complexity estimate
- Import map (`importMap`): pre-resolved project-internal imports per file (non-code files have empty arrays)

Store `importMap` in memory as `$IMPORT_MAP` for use in Phase 2 batch construction.
Store the file list as `$FILE_LIST` with `fileCategory` metadata for use in Phase 2 batch construction.

**Gate check:** If >100 files, inform the user and suggest scoping with a subdirectory argument. Proceed only if user confirms or add guidance that this may take a while.

If the scan result includes `filteredByIgnore > 0`, report:
> Excluded {filteredByIgnore} files via `.understandignore`.

---

## Phase 1.5 — BATCH

Report: `[Phase 1.5/7] Computing semantic batches...`

Run the bundled batching script:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT
```

Reads `.understand-anything/intermediate/scan-result.json`, writes `.understand-anything/intermediate/batches.json`.

Capture stderr. Append any line starting with `Warning:` to `$PHASE_WARNINGS` for the final report.

If the script exits non-zero, the failure is hard — relay the full stderr to the user as a Phase 1.5 failure. Do not attempt to recover; the script's internal fallback (count-based) already handles recoverable issues. A non-zero exit means a fundamental problem (missing input file, malformed JSON, etc.).

---

## Phase 2 — ANALYZE

### Full analysis path

Load `.understand-anything/intermediate/batches.json` (produced by Phase 1.5). Iterate the `batches[]` array.

Report: `[Phase 2/7] Analyzing files — <totalFiles> files in <totalBatches> batches (up to 5 concurrent)...`

For each batch, dispatch a subagent using the `file-analyzer` agent definition (at `agents/file-analyzer.md`). Run up to **5 subagents concurrently**. Append the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
>
> $LANGUAGE_DIRECTIVE

Dispatch prompt template (fill in batch-specific values from `batches.json[i]`):

> Analyze these files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch: `<batchIndex>/<totalBatches>`
> Skill directory (for bundled scripts): `<SKILL_DIR>`
> Output: write to `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json` (single-file mode) OR `batch-<batchIndex>-part-<k>.json` (split mode, per Step B of your output protocol).
>
> Pre-resolved import data for this batch (use directly — do NOT re-resolve imports from source):
> ```json
> <batchImportData JSON from batches.json[i].batchImportData>
> ```
>
> Cross-batch neighbors with their exported symbols (confidence boost for cross-batch edges):
> ```json
> <neighborMap JSON from batches.json[i].neighborMap>
> ```
>
> Files to analyze in this batch (every entry MUST be passed through to `batchFiles` with all four fields — `path`, `language`, `sizeLines`, `fileCategory`):
> 1. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> 2. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> ...


exec
/bin/bash -lc "sed -n '321,420p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
**Output naming is per-batchIndex — no fusion.** If you fuse multiple small batches into a single file-analyzer dispatch for token efficiency, the dispatched agent must STILL write one output file per original `batchIndex` using `batch-<batchIndex>.json` or `batch-<batchIndex>-part-<k>.json`. The merge script's regex (`batch-(\d+)(?:-part-(\d+))?\.json`) silently drops any other naming (e.g., `batch-fused-8-13.json`, `batch-8-13.json`), losing every node and edge in that file. After each dispatch returns, verify each `batchIndex` in the dispatched input has a corresponding `batch-<batchIndex>.json` (or `batch-<batchIndex>-part-*.json`) on disk before proceeding to the next dispatch.

After ALL batches complete, report to the user: `Phase 2 complete. All <totalBatches> batches analyzed.`

Run the merge-and-normalize script bundled with this skill (located next to this SKILL.md file — use the skill directory path, not the project root):
```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
```

This script reads all `batch-*.json` files (including `batch-<i>-part-<k>.json` produced by file-analyzers that split their output) from `$PROJECT_ROOT/.understand-anything/intermediate/`, then in one pass:
- Combines all nodes and edges across batches
- Normalizes node IDs (strips double prefixes, project-name prefixes, adds missing prefixes)
- Normalizes complexity values (`low`→`simple`, `medium`→`moderate`, `high`→`complex`, etc.)
- Rewrites edge references to match corrected node IDs
- Deduplicates nodes by ID (keeps last occurrence) and edges by `(source, target, type)`
- Drops dangling edges referencing missing nodes
- Logs all corrections and dropped items to stderr

The merge script also runs a `tested_by` linker that canonicalizes test-coverage edges in two passes. **Pass 1** walks LLM-emitted `tested_by` edges and flips inverted ones in place; semantically broken edges (test↔test, prod↔prod, orphan endpoints) are dropped. **Pass 2** supplements with path-convention pairings. Production nodes that end up sourcing any `tested_by` edge get a `"tested"` tag. All resulting edges run `production → test`.

Output: `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`

Include the script's warnings in `$PHASE_WARNINGS` for the reviewer.

### Incremental update path

Write the changed-files list (one path per line) to a temp file:
```bash
git diff <lastCommitHash>..HEAD --name-only > $PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

Run compute-batches with `--changed-files`:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT \
  --changed-files=$PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

This produces a `batches.json` that contains only batches with changed files, but neighborMap entries still reference unchanged files (with their full-graph batchIndex) so cross-batch edges remain emittable.

Then dispatch file-analyzer subagents per the same template as the full path.

After batches complete:
1. Remove old nodes whose `filePath` matches any changed file from the existing graph
2. Remove old edges whose `source` or `target` references a removed node
3. Write the pruned existing nodes/edges as `batch-existing.json` in the intermediate directory
4. Run the same merge script — it will combine `batch-existing.json` with the fresh `batch-*.json` files:
   ```bash
   python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
   ```

---

## Phase 3 — ASSEMBLE REVIEW

Report to the user: `[Phase 3/7] Reviewing assembled graph...`

Dispatch a subagent using the `assemble-reviewer` agent definition (at `agents/assemble-reviewer.md`).

Pass these parameters in the dispatch prompt:

> Review the assembled graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Batch files are at: `$PROJECT_ROOT/.understand-anything/intermediate/batch-*.json`
> Write review output to: `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json`
>
> **Merge script report:**
> ```
> <paste the full stderr output from merge-batch-graphs.py>
> ```
>
> **Import map for cross-batch edge verification:**
> ```json
> $IMPORT_MAP
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json` and add any notes to `$PHASE_WARNINGS`.

---

## Phase 4 — ARCHITECTURE

Report to the user: `[Phase 4/7] Identifying architectural layers...`

**Build the combined prompt template:**
 1. Use the `architecture-analyzer` agent definition (at `agents/architecture-analyzer.md`).
 2. **Language context injection:** For each language detected in Phase 1 (e.g., `python`, `markdown`, `dockerfile`, `yaml`, `sql`, `terraform`, `graphql`, `protobuf`, `shell`, `html`, `css`), read the file at `./languages/<language-id>.md` (e.g., `./languages/python.md`, `./languages/dockerfile.md`) and append its content after the base template under a `## Language Context` header. If the file does not exist for a detected language, skip it silently and continue. These files are in the `languages/` subdirectory next to this SKILL.md file. **Include non-code language snippets** — they provide edge patterns and summary styles for non-code files.
 3. **Framework addendum injection:** For each framework detected in Phase 1 (e.g., `Django`), read the file at `./frameworks/<framework-id-lowercase>.md` (e.g., `./frameworks/django.md`) and append its full content after the language context. If the file does not exist for a detected framework, skip it silently and continue. These files are in the `frameworks/` subdirectory next to this SKILL.md file.
 4. **Output locale injection:** If `$OUTPUT_LANGUAGE` is NOT `en` (English), read the locale guidance file at `./locales/<language-code>.md` (e.g., `./locales/zh.md`, `./locales/ja.md`, `./locales/ko.md`) and append its content after the framework addendums under a `## Output Language Guidelines` header. This provides language-specific guidance for tag naming conventions, summary style, and layer name translations. If the locale file does not exist for the specified language, skip silently — the `$LANGUAGE_DIRECTIVE` still applies. These files are in the `locales/` subdirectory next to this SKILL.md file.

Append the language/framework context and the following additional context to the agent's prompt:

> **Additional context from main session:**
>
> Frameworks detected: `<frameworks from Phase 1>`
>
> Directory tree (top 2 levels):
> ```
> $DIR_TREE
> ```
>

exec
/bin/bash -lc "sed -n '421,520p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
> Use the directory tree, language context, and framework addendums (appended above) to inform layer assignments. Directory structure is strong evidence for layer boundaries. Non-code files (config, docs, infrastructure, data) should be assigned to appropriate layers — see the prompt template for guidance.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Analyze this codebase's structure to identify architectural layers.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/layers.json`
> Project: `<projectName>` — `<projectDescription>`
>
> File nodes (all node types — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, type, name, filePath, summary, tags} for ALL file-level nodes — omit complexity, languageNotes]
> ```
>
> Import edges:
> ```json
> [list of edges with type "imports"]
> ```
>
> All edges (for cross-category analysis — includes configures, documents, deploys, triggers, etc.):
> ```json
> [list of ALL edges — include all edge types]
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/layers.json` and normalize it into a final `layers` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "layers": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any layer object has a `nodes` field instead of `nodeIds`, rename `nodes` → `nodeIds`. If `nodes` entries are objects with an `id` field rather than plain strings, extract just the `id` values into `nodeIds`.
3. **Synthesize missing IDs:** If any layer is missing an `id`, generate one as `layer:<kebab-case-name>`.
4. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
5. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.

Each element of the final `layers` array MUST have this shape:

```json
[
  {
    "id": "layer:<kebab-case-name>",
    "name": "<layer name>",
    "description": "<what belongs in this layer>",
    "nodeIds": ["file:src/App.tsx", "config:tsconfig.json", "document:README.md"]
  }
]
```

All four fields (`id`, `name`, `description`, `nodeIds`) are required.

**For incremental updates:** Always re-run architecture analysis on the full merged node set, since layer assignments may shift when files change.

**Context for incremental updates:** When re-running architecture analysis, also inject the previous layer definitions:

> Previous layer definitions (for naming consistency):
> ```json
> [previous layers from existing graph]
> ```
>
> Maintain the same layer names and IDs where possible. Only add/remove layers if the file structure has materially changed.

---

## Phase 5 — TOUR

Report to the user: `[Phase 5/7] Building guided tour...`

Dispatch a subagent using the `tour-builder` agent definition (at `agents/tour-builder.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project README (first 3000 chars):
> ```
> $README_CONTENT
> ```
>
> Project entry point: `$ENTRY_POINT`
>
> Use the README to align the tour narrative with the project's own documentation. Start the tour from the entry point if one was detected. The tour should tell the same story the README tells, but through the lens of actual code structure.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Create a guided learning tour for this codebase.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/tour.json`
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages>`
>
> Nodes (all file-level nodes — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, name, filePath, summary, type} for ALL file-level nodes — do NOT include function or class nodes]
> ```
>
> Layers:
> ```json
> [list of {id, name, description} for each layer — omit nodeIds]
> ```
>
> Edges (all types — includes imports, calls, configures, documents, deploys, triggers, etc.):

exec
/bin/bash -lc "sed -n '521,620p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
> ```json
> [list of ALL edges — include all edge types for complete graph topology analysis]
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/tour.json` and normalize it into a final `tour` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "steps": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any step has `nodesToInspect` instead of `nodeIds`, rename it → `nodeIds`. If any step has `whyItMatters` instead of `description`, rename it → `description`.
3. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
4. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.
5. **Sort** by `order` before saving.

Each element of the final `tour` array MUST have this shape:

```json
[
  {
    "order": 1,
    "title": "Project Overview",
    "description": "Start with the README to understand the project's purpose and architecture.",
    "nodeIds": ["document:README.md"]
  },
  {
    "order": 2,
    "title": "Application Entry Point",
    "description": "This step explains how the frontend boots and mounts.",
    "nodeIds": ["file:src/main.tsx", "file:src/App.tsx"]
  }
]
```

Required fields: `order`, `title`, `description`, `nodeIds`. Preserve optional `languageLesson` when present.

---

## Phase 6 — REVIEW

Report to the user: `[Phase 6/7] Validating knowledge graph...`

Assemble the full KnowledgeGraph JSON object:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<projectName>",
    "languages": ["<languages>"],
    "frameworks": ["<frameworks>"],
    "description": "<projectDescription>",
    "analyzedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<commit hash from Phase 0>"
  },
  "nodes": [<all nodes from assembled-graph.json after Phase 3 review>],
  "edges": [<all edges from assembled-graph.json after Phase 3 review>],
  "layers": [<layers from Phase 4>],
  "tour": [<steps from Phase 5>]
}
```

1. Before writing the assembled graph, validate that:
   - `layers` is an array of objects with these required fields: `id`, `name`, `description`, `nodeIds`
   - `tour` is an array of objects with these required fields: `order`, `title`, `description`, `nodeIds`
   - `tour[*].languageLesson` is allowed as an optional string field
   - Every `layers[*].nodeIds` entry exists in the merged node set
   - Every `tour[*].nodeIds` entry exists in the merged node set

   If validation fails, automatically normalize and rewrite the graph into this shape before saving. If the graph still fails final validation after the normalization pass, save it with warnings but mark dashboard auto-launch as skipped.

2. Write the assembled graph to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.

3. **Check `$ARGUMENTS` for `--review` flag.** Then run the appropriate validation path:

---

#### Default path (no `--review`): inline deterministic validation

Write the following Node.js script to `$PROJECT_ROOT/.understand-anything/tmp/ua-inline-validate.cjs`:

```javascript
#!/usr/bin/env node
const fs = require('fs');
const graphPath = process.argv[2];
const outputPath = process.argv[3];
try {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];
  if (!Array.isArray(graph.nodes)) { issues.push('graph.nodes is missing or not an array'); graph.nodes = []; }
  if (!Array.isArray(graph.edges)) { issues.push('graph.edges is missing or not an array'); graph.edges = []; }
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });

exec
/bin/bash -lc "wc -l -w -c '/Users/la/Desktop/Programming/OSS-Repos/open-design/AGENTS.md'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
     364    5137   37470 /Users/la/Desktop/Programming/OSS-Repos/open-design/AGENTS.md

exec
/bin/bash -lc "wc -l -w -c '/Users/la/Desktop/Programming/OSS-Repos/open-design/docs/jini-open-design-porting-plan.md'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
     692    2280   18365 /Users/la/Desktop/Programming/OSS-Repos/open-design/docs/jini-open-design-porting-plan.md

exec
/bin/bash -lc "wc -l -w -c '/Users/la/Desktop/Programming/Jini/docs/jini-architecture-blind-debate-brief.md'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
     336    3317   22590 /Users/la/Desktop/Programming/Jini/docs/jini-architecture-blind-debate-brief.md

exec
/bin/bash -lc "wc -l -w -c '/Users/la/Desktop/Programming/Jini/AGENTS.md'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
     373    5343   39093 /Users/la/Desktop/Programming/Jini/AGENTS.md

exec
/bin/bash -lc "sed -n '1,120p' /Users/la/Desktop/Programming/Jini/docs/jini-architecture-blind-debate-brief.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# Jini Architecture Blind Debate Brief

Date prepared: 2026-07-16

Status: Ready to hand to another LLM coordinator. No debate has been run from this document.

## Coordinator mandate

Run a blind, adversarial architecture debate about how to turn the reusable parts of Open Design into Jini: an abstract engine that can support Open Design and other products through adapters.

The coordinator must not insert its own architecture proposal into the first-round packet. It may summarize and judge proposals only after every participant has frozen an independent first response.

## Requested participants

Use these three independent seats:

1. Codex using GPT-5.6 at high reasoning, or the closest exactly identified GPT-5.6 coding/reasoning model available.
2. Agy using its explicitly selected high-reasoning model. Record the exact model name shown by Agy before dispatch; do not call the CLI version the model version.
3. Claude Fable 5 using the exact model ID `claude-fable-5`.

If an exact requested model is unavailable, stop and report that fact. Do not silently substitute a different model family or version.

## Blindness and privacy rules

- Give every participant the exact same first-round brief.
- Do not show a participant another participant's answer before all first-round answers are frozen.
- Do not show the coordinator's answer or preferred architecture to any participant in round one.
- Do not request, store, or share private chain-of-thought. Ask only for concise rationale, assumptions, evidence, tradeoffs, and conclusions.
- Keep raw first-round submissions isolated until all three have finished.
- In later rounds, share only structured conclusions, disagreements, objections, and decision points. Do not share hidden reasoning or private scratch work.
- Identify every participant by exact model family, version, and reasoning level in the final report.
- Never invent a response for a failed, unavailable, or timed-out model.

## User's goal

Create a repository called Jini. “Jini” is Swahili for “engine.” It should become a generic, reusable engine extracted from Open Design, while Open Design remains a real consumer of it through product-specific adapters.

The result should make it possible to reuse daemon capabilities, agent/CLI integrations, chat UI, artifact rendering, orchestration, and selected frontend components in products that are not Open Design.

The system should also support long-running local and cloud coding work by Codex and Claude. Agents must be able to resume from a durable task ledger rather than relying on conversation history.

## Questions the debate must answer

These questions come from the user's earlier requests. Treat them as open questions; do not assume an answer from their wording.

### Jini repository strategy

- Should Jini begin as a minimal/blank engine repository with Open Design under `integrations/` or `references/`, and extract/refactor capabilities into the engine?
- Or should Jini begin as a copy of Open Design and be refactored internally until Open Design-specific behavior is behind adapters?
- Is there a better third strategy, such as a strangler extraction, package-first extraction, subtree, monorepo federation, or another arrangement?
- How should Jini reference upstream Open Design, the user's fork, stashed local changes, past commits, and the user's `server.ts` rewrites without turning Jini into an enormous or confusing repository?
- How should upstream Open Design changes continue to flow into Jini during extraction?
- How should fixes discovered during Jini extraction flow back to Open Design without creating two drifting implementations?
- What should the top-level Jini folder tree be?
- Should Jini be one repository, multiple repositories, or a monorepo with publishable packages?

### Daemon architecture and portability

- What does the Open Design daemon actually do, and which responsibilities are true reusable engine capabilities versus Open Design product behavior?
- Can the daemon currently be copied into another project and run usefully, and what hidden Open Design assumptions would travel with it?
- How hard is it to extract a reusable daemon core and separate all Open Design-specific behavior?
- Are the user's `server.ts` rewrites and route/runtime extractions good seams for speeding up that work?
- Which other daemon rewrites, branches, commits, or pull requests should be incorporated?
- What ports, contracts, dependency-injection boundaries, adapters, and composition roots should replace direct Open Design coupling?
- Should the generic engine expose an HTTP daemon, an embeddable library, a CLI, a sidecar protocol, or all four?
- Which responsibilities belong in daemon core, agent runtime, project/workspace services, artifact services, persistence, transports, and Open Design adapters?
- How should the engine discover and track installed coding CLIs such as OpenCode, Claude Code, Codex, Gemini, Cursor Agent, and future agents?
- Where should CLI discovery results live? Define the source of truth, refresh/invalidation policy, data schema, security boundary, and API used by UI and CLI consumers.
- How should per-agent differences in authentication, model discovery, prompt transport, streaming events, tool events, cancellation, resumability, and mid-turn input be normalized without reducing every runtime to a weak lowest-common-denominator interface?

### Frontend architecture and reusable UI

- What are the main Open Design frontend layers and components today?
- How should the frontend be reorganized into feature slices?
- Which parts are reusable engine/UI packages, and which parts must stay Open Design-specific?
- How should large components such as `ChatPane`, `ChatComposer`, and the top-level application shell be decomposed?
- How can ChatPane, ChatComposer, message rendering, attachments, tool cards, artifacts, question forms, conversation state, run state, and transports be reused without importing Open Design project/workspace assumptions?
- Should reusable UI be headless hooks plus components, a component library, feature packages, a reference application, web components, or another design?
- What adapter or slot interfaces are necessary for product-specific project context, plugins, models, agents, artifacts, comments, feedback, file previews, and design-system behavior?
- How should the reusable frontend remain useful outside Next.js or outside the exact Open Design daemon API?
- What is a realistic sequence and effort estimate for making the frontend Open Design-agnostic and reusable?

### Automation and cloud execution

- Can the extraction and continuing synchronization be automated outside conventional CI/CD?
- Which existing agent program should execute the work: Codex cloud, Claude Code, Agy, OpenHands, another coding-agent runner, or a combination?
- What must a repo-local `project-runner/` do beyond ordinary scripts?
- How should work be planned locally and executed in the cloud by Codex and Claude?
- How should a cloud agent claim a task, create a branch/worktree, record a session, run validation, report blockers, and safely resume after context loss?
- How should concurrent agents avoid duplicate work and conflicting writes?
- Which decisions require a human checkpoint, and which bug fixes/refactors can proceed autonomously?
- How should the workflow keep an inventory of Open Design bugs discovered during extraction and fix them autonomously in the correct repository?
- What prevents an autonomous agent from optimizing Jini while breaking Open Design compatibility?

### Durable task and session ledger

- What files and schemas should make task state durable across local sessions, Codex cloud sessions, Claude sessions, and agent failures?
- What are the task states and legal transitions?
- How are dependencies, blockers, leases, attempts, source commit, target commit, validation commands, validation results, decisions, and handoff notes recorded?
- How are concurrent updates locked or reconciled?
- What is committed to Git, and what remains local or ephemeral?
- How does a new agent deterministically find the next safe task?
- How are tasks linked back to architecture decisions and compatibility tests?

### Codebase understanding reports for cloud agents

- How should Codebase Memory MCP, Graphify, and Understand Anything be run against Open Design and Jini?
- Which reports or graph exports should be committed or uploaded so cloud agents know what to read without rebuilding expensive local indexes?
- Which heavy indexes must remain local or in object storage because of repository size?
- What small summaries, knowledge graphs, architecture maps, dependency seams, key-symbol indexes, hotspots, and source maps should be versioned in Jini?
- How should reports record the exact source repository, branch, and commit they describe?
- How are reports refreshed automatically without presenting stale graph data as current truth?
- Should cloud agents read one overview document, a folder tree of scoped reports, or both?

### AI-Dev-Shop and governance

- `AI-Dev-Shop/` must be present in Jini. Should it be vendored, a submodule, a package, or synchronized another way?
- A top-level `project-runner/` must be present.
- How should AI-Dev-Shop governance, agent roles, task ledgers, and cloud execution relate without duplicating responsibilities?
- What is the smallest useful control plane that remains understandable and maintainable?

exec
/bin/bash -lc "sed -n '121,240p' /Users/la/Desktop/Programming/Jini/docs/jini-architecture-blind-debate-brief.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:

### Reference repository size and provenance

- Would `references/open-design/` make Jini too large on GitHub?
- Compare a normal vendored copy, Git submodule, sparse/partial clone created on demand, Git subtree, generated source snapshot, and no local reference checkout.
- How should GitHub file-size limits, clone time, LFS, history size, and cloud-agent checkout costs affect the choice?
- How should code provenance, license notices, commit attribution, and upstream source mappings be preserved when code moves from Open Design into Jini?

### Compatibility, releases, and operations

- What is the public compatibility contract between Jini core and product adapters?
- How are contracts versioned, migrated, deprecated, and tested?
- How does the engine handle security boundaries around local files, subprocesses, credentials, MCP servers, plugins, and external CLIs?
- How does it fail and recover when an agent crashes, a stream is malformed, a task lease expires, an upstream API changes, or a migration only partially completes?
- What observability is required for runs, costs, retries, failures, and compatibility drift?
- How can an extraction be rolled back at each phase?
- What release strategy lets Open Design adopt Jini incrementally instead of requiring a flag-day rewrite?
- What evidence proves that Jini is genuinely reusable rather than merely Open Design with renamed symbols?

### Cost and model use

- What is the cheapest model tier that can still do a good job running Codebase Memory MCP, Graphify, Understand Anything, mapping the codebase, and explaining it to the user?
- Which tasks need a strong reasoning model, and which indexing, summarization, ledger, validation, and mechanical refactoring tasks can use cheaper models?
- How should the workflow cap cost while preserving accuracy and avoiding stale or shallow architecture reports?

## Known repository facts

These are context facts, not architectural conclusions. The coordinator should verify facts that may have changed before running the debate.

### Local repositories

- Open Design checkout: `/Users/la/Desktop/Programming/OSS-Repos/open-design`
- Jini checkout: `/Users/la/Desktop/Programming/Jini`
- Jini already contains `AI-Dev-Shop/`.
- At the time this brief was prepared, Jini was a dirty working tree with substantial frontend changes. Do not reset, clean, or overwrite it as part of the debate.
- At the time this brief was prepared, no GitHub repository named `leonaburime-ucla/Jini` had been confirmed through the GitHub CLI.
- Jini's configured Git remotes still pointed to Open Design repositories at the time of inspection. Verify before making any remote changes.

### Open Design source state at the time of inspection

- Local branch: `refactor/web-memory-slice`
- Upstream remote: `https://github.com/nexu-io/open-design.git`
- User fork remote: `https://github.com/leonaburime-ucla/open-design.git`
- The local branch was 36 commits ahead of and 52 commits behind upstream `origin/main` by symmetric commit count.
- The local branch was one commit behind its fork tracking branch.
- The branch contains a substantial frontend memory vertical-slice refactor.
- Upstream contains newer daemon, frontend, desktop, packaged-runtime, security, and tooling work not present on the local branch.
- Open Design's local working tree was approximately 5.5 GB, including an approximately 1.6 GB `.git` directory. These numbers include local state and are not the size of a clean sparse clone.

### Existing extraction work to inspect

The debate should not assume these changes are correct, but it should inspect them as evidence:

- User-authored Open Design daemon and `server.ts` rewrites on GitHub and in local branches.
- Daemon extraction pull requests previously identified around `startChatRun`, route/runtime extraction, and server decomposition.
- `apps/daemon/src/server.ts` and extracted modules under daemon runtime, routes, HTTP, events, bootstrap, marketplace, shell, telemetry, and request-composition areas.
- The frontend memory slice and its boundary checks as a possible example—not a mandated template—of feature-slice decomposition.
- Existing reusable packages such as contracts, components, platform, sidecar, and sidecar protocol.

### Open Design constraints that may matter to extraction

- `apps/daemon` is the privileged local daemon and owns HTTP APIs, agent spawning, skills, design systems, artifacts, and static serving.
- `apps/web` is the React/Next web application.
- Shared web/daemon DTOs and event contracts belong in a pure TypeScript contracts package.
- Generic OS-process primitives, generic sidecar runtime, and Open Design-specific sidecar protocol are already separated to some degree.
- Open Design expects user-facing capabilities to be available through both web UI and the `od` CLI using the same daemon HTTP API.
- Daemon-owned data is intended to derive from one resolved runtime data root, with narrow documented exceptions.
- Agent runtimes differ in input and streaming behavior; Claude currently has special stream-JSON handling for possible mid-turn input.
- The frontend has very large orchestration and chat components, including `App`, `ChatPane`, and `ChatComposer`.

## Source material every participant should receive

Provide identical snapshots or reports to all three participants. Do not give only one participant live repository access and expect the others to reason from a summary.

Minimum shared material:

- This debate brief.
- `docs/jini-open-design-porting-plan.md`, clearly labeled as prior analysis that contains suggestions, not settled decisions.
- Root `AGENTS.md` from current Open Design.
- Root `AGENTS.md` from current Jini.
- Current Git status and remote summary for both repositories.
- A commit/branch divergence summary for Open Design upstream, user fork, and relevant rewrite branches.
- A bounded file/symbol map of the daemon and frontend from Codebase Memory MCP.
- Available Graphify and Understand Anything summaries, each stamped with source commit and generation date.
- A list of the user's relevant GitHub pull requests, branches, and commits, with concise diff summaries.

If Codebase Memory MCP, Graphify, or Understand Anything output is missing, state that explicitly. Do not fabricate a report or treat an incomplete index as current.

## Candidate strategies to compare

These are options, not endorsements. Participants must be free to reject all of them.

1. Greenfield Jini core with Open Design as a reference/integration source.
2. Open Design copy that is progressively inverted into generic core plus adapters.
3. Strangler/package-first extraction: keep Open Design primary while extracting one contract-tested capability at a time into Jini.
4. A monorepo or workspace arrangement that temporarily contains both product and engine during extraction.
5. Any stronger option the participant believes the framing missed.

Every participant must explain which option it chooses, why the others fail, and what new evidence would change its recommendation.

## Required first-round output from each participant

Return a final structured proposal only. Do not return hidden chain-of-thought.

Use these sections:

1. `Executive Recommendation`
2. `Proposed Repository Topology`
3. `Package and Module Boundaries`
4. `Daemon Core and Adapter Design`
5. `Agent and CLI Discovery Design`
6. `Frontend Feature-Slice and Reusable UI Design`
7. `Open Design Integration Strategy`
8. `Project Runner and Durable Ledger`
9. `Cloud Agent Workflow`
10. `CBM, Graphify, and Understand Anything Export Strategy`
11. `Migration Phases With Exit Criteria`
12. `Testing and Compatibility Strategy`
13. `Security, Recovery, Observability, and Cost`
14. `Repository Size, Provenance, and Licensing`

exec
/bin/bash -lc "sed -n '241,380p' /Users/la/Desktop/Programming/Jini/docs/jini-architecture-blind-debate-brief.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
15. `What Not to Generalize Yet`
16. `Estimated Effort and Critical Path`
17. `Failure Modes and Reasons This Design Could Be Wrong`
18. `Blind Spots`
19. `Decision Checklist`

The `Proposed Repository Topology` section must include a concrete folder tree.

The `Package and Module Boundaries` section must include a table with responsibility, public API, dependencies allowed, dependencies forbidden, and first consumer.

The `Migration Phases` section must describe incremental phases that keep Open Design working and define a rollback point plus measurable exit criteria for every phase.

The `Estimated Effort` section must distinguish elapsed time, engineering effort, model/tool cost, and uncertainty. It must not provide false precision.

The `Blind Spots` section must name:

- A viable architecture option missing from the brief.
- A question the group should be asking but is not.
- The framing assumption most likely to be wrong.

End every complete submission with:

```txt
<<JINI_DEBATE_SUBMISSION_END>>
```

## Round-two debate procedure

After every first-round proposal is frozen:

1. The coordinator extracts a neutral decision ledger. It should contain conclusions and short rationale summaries, not chain-of-thought.
2. The coordinator identifies only material disagreements, incompatible assumptions, unaddressed requirements, and unique risks.
3. Give each participant the same ledger and disagreement packet.
4. Do not reveal model identities next to positions if anonymity can be preserved; label them Proposal A, B, and C during rebuttal.
5. Ask each participant to state:
   - Its current position on each disagreement.
   - The strongest objection to its own position.
   - The strongest objection to the leading alternative.
   - Whether it changed its conclusion and why.
   - What repo evidence or assumption change would change its mind.
6. Run no more than two rebuttal rounds unless the user explicitly asks for more.
7. A participant that fails or times out is marked withdrawn. Do not invent its rebuttal.

## Final synthesis requirements

The coordinator's final report must include:

- Exact participating models and reasoning modes.
- Transport/failure diagnostics separated from model answers.
- Each independent proposal in concise form.
- Areas of genuine agreement.
- Areas of unresolved disagreement and the assumptions causing them.
- Unique insights raised by only one participant.
- A decision ledger comparing all proposals on the same criteria.
- A recommended Jini repository tree.
- A package/interface boundary map.
- A phased Open Design-to-Jini migration plan with rollback points.
- A frontend extraction sequence.
- A daemon extraction sequence.
- A project-runner and task-ledger contract.
- A cloud-context export layout for Codebase Memory MCP, Graphify, and Understand Anything.
- A list of decisions requiring the user's approval before implementation.
- The first 10 concrete implementation tasks, ordered by dependency and sized for resumable cloud-agent sessions.

Do not claim consensus merely because two proposals use similar terminology. Agreement should mean they recommend compatible decisions under compatible assumptions.

## Evaluation rubric

Score each proposal from 1 to 5 on each dimension and explain every score briefly:

| Dimension | What a high score means |
|---|---|
| Reusability | A second non-Open-Design product can adopt the engine without importing product assumptions. |
| Incremental migration | Open Design remains usable throughout extraction, with clear rollback points. |
| Boundary clarity | Core, ports, adapters, products, UI, runtime, and orchestration have enforceable ownership. |
| Compatibility discipline | Contracts and tests detect drift between Jini and Open Design. |
| Frontend composability | Chat and artifact UI can be reused without copying giant Open Design components. |
| Runtime extensibility | New agents/CLIs can be added without editing a monolithic daemon switchboard. |
| Operational safety | Security, credentials, subprocesses, failure recovery, and observability are designed explicitly. |
| Cloud resumability | Independent cloud sessions can safely pick up durable, well-scoped tasks. |
| Maintainability | The design avoids excessive package fragmentation, indirection, and duplicated control planes. |
| Cost efficiency | Expensive models and graph generation are reserved for work that benefits from them. |
| Provenance and sync | Upstream history, licensing, source mappings, and bug flow remain understandable. |
| Time to first value | The plan delivers a reusable, tested capability early instead of waiting for a complete rewrite. |

## Actions forbidden during the debate

- Do not edit application source code.
- Do not create, delete, or change Git remotes.
- Do not create a GitHub repository.
- Do not reset, clean, stash, commit, merge, rebase, or push either working tree.
- Do not treat a local graph index as shareable cloud context unless it is explicitly exported.
- Do not assume prior proposed package names or folder trees are settled.
- Do not allow one model to see another model's private first-round draft.

The debate produces an architecture recommendation and implementation backlog only. Execution requires a separate user approval.

exec
/bin/bash -lc "sed -n '1,180p' /Users/la/Desktop/Programming/OSS-Repos/open-design/docs/jini-open-design-porting-plan.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# Jini / Open Design Porting Plan

Date: 2026-07-16

Audience: another LLM or cloud coding agent working in a separate repository or branch.

Goal: port the reusable parts of Open Design into Jini, a generic engine with reusable core packages and Open Design-specific adapters. Do not blindly copy product code. Extract stable seams, preserve behavior, and keep Open Design working as the first real consumer.

## Current source status

Source repo inspected:

```txt
/Users/la/Desktop/Programming/OSS-Repos/open-design
```

Current branch:

```txt
refactor/web-memory-slice
```

Remotes:

```txt
origin = https://github.com/nexu-io/open-design.git
fork   = https://github.com/leonaburime-ucla/open-design.git
```

This checkout is not fully up to date with upstream Open Design.

As of the last fetch on 2026-07-16:

```txt
HEAD vs origin/main: 36 commits only on this branch, 52 commits only on origin/main
HEAD vs fork/refactor/web-memory-slice: local branch is behind by 1 commit
```

Local untracked items in the Open Design checkout:

```txt
ADS-project-knowledge/
apps/web/coverage/
```

The Jini checkout found locally:

```txt
/Users/la/Desktop/Programming/Jini
```

Jini is currently dirty. It has many deleted `apps/web/src` files plus an untracked replacement `apps/web/src` tree. Treat that as active user work. Do not reset or overwrite it without explicit approval.

## Where this branch differs from upstream Open Design

The current `refactor/web-memory-slice` branch is mainly a frontend memory feature-slice refactor.

High-level diff from upstream base:

```txt
70 files changed
13,448 insertions
2,427 deletions
```

Important branch-specific changes:

- `apps/web/src/components/MemorySection.tsx` was decomposed from a large component into a vertical slice.
- New slice lives under `apps/web/src/features/memory/`.
- New provider split lives under `apps/web/src/providers/memory/`.
- Many focused memory tests were added under `apps/web/tests/features/memory/`.
- Slice-boundary guard scripts were added:
  - `scripts/check-web-slice-boundaries.ts`
  - `scripts/check-web-slice-boundaries.test.ts`
- ADR added:
  - `specs/adr/0002-frontend-vertical-slice-decomposition.md`

Upstream `origin/main` has newer work not present in this branch. Major areas changed upstream include:

- daemon security/runtime fixes
- memory cleanup behavior
- landing page release/story content
- frontend question form and assistant message changes
- file viewer and workspace fixes
- preview run status UI
- runtime link handling
- packaged/desktop/tooling updates
- dependency/version bumps

Therefore, before porting into Jini, do not assume this branch is the latest Open Design truth. Use upstream `origin/main` as the base truth, then selectively reapply or merge the memory-slice refactor if still valuable.

## Architecture map: frontend

Open Design frontend is a Next/React app under:

```txt
apps/web
```

Mental model:

```txt
Next route
  -> ClientApp
    -> App / AppInner
      -> home / project / workspace views
        -> chat, file viewer, design systems, plugins, memory, settings
          -> providers talk to daemon APIs
```

Major pressure points:

- `apps/web/src/App.tsx`
  - top-level app shell and orchestration
  - large `AppInner`
  - owns too much routing, project, modal, settings, and runtime state

- `apps/web/src/components/ChatPane.tsx`
  - very large chat rendering surface
  - owns message rows, artifacts, comments, queued sends, tool rendering, TodoWrite snapshots, virtual scrolling, and status behavior

- `apps/web/src/components/ChatComposer.tsx`
  - large composer surface
  - owns prompt input, attachments, context chips, runtime metadata, model/agent/plugin context, and submit behavior

- `apps/web/src/components/workspace/useConversationChat.ts`
  - key glue between workspace state and chat state

- `apps/web/src/providers/daemon.ts`
  - daemon API client functions

- `apps/web/src/providers/registry.ts`
  - large frontend API/provider registry

- `apps/web/src/providers/project-events.ts`
  - project/server-sent-event connection layer

- `apps/web/src/artifacts/*`
  - artifact parsing and rendering support
  - good candidate for reusable Jini extraction

- `apps/web/src/features/memory/*`
  - best current example of desired feature-slice structure

## What should become reusable Jini packages

Do not try to make the entire Open Design frontend generic. Extract the reusable engine surfaces first.

Recommended packages:

```txt
packages/jini-core/
  chat event protocol
  transport interfaces
  conversation model
  run status model

packages/jini-artifacts/
  artifact parser
  artifact types
  renderer registry
  question-form artifact
  markdown artifact helpers

packages/jini-chat-react/
  ChatPane
  ChatComposer
  MessageList
  MessageRow
  AttachmentTray
  ToolCard
  artifact slots
  composer slots

packages/jini-open-design-adapter/
  Open Design API adapter
  Open Design artifact adapter
  Open Design project/workspace adapter
```


exec
/bin/bash -lc "sed -n '181,360p' /Users/la/Desktop/Programming/OSS-Repos/open-design/docs/jini-open-design-porting-plan.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
Open Design should remain the first consumer of these packages.

## Required top-level Jini layout

Jini should be structured as a clean engine repo with explicit orchestration and integration areas.

Recommended top-level layout:

```txt
Jini/
  AI-Dev-Shop/
  project-runner/
  packages/
    jini-core/
    jini-artifacts/
    jini-chat-react/
    jini-daemon-core/
    jini-agent-runtime/
  integrations/
    open-design/
      adapter/
      compatibility-tests/
      migration-notes/
      source-map.md
  references/
    open-design/        # preferably submodule, sparse clone, or ignored local clone
  docs/
    jini-open-design-porting-plan.md
    jini-port/
      tasks.json
      sessions/
      decisions.md
      blockers.md
```

`AI-Dev-Shop` is required. The local Jini checkout already contains `AI-Dev-Shop/`, and `leonaburime-ucla/AI-Dev-Shop` exists on GitHub. As of 2026-07-16, GitHub reports that repository as public, not private.

Do not bury `AI-Dev-Shop` inside `integrations/`. It should stay top-level because it is the agent/harness/governance layer, not an Open Design adapter.

## Project runner control plane

`project-runner/` should be the local/cloud orchestration layer that lets agents resume work without relying on chat history.

It should not be a CI system. It is a small repo-local control plane for:

- reading the task ledger
- selecting the next task
- preparing source/reference checkouts
- launching Codex/Claude/OpenHands/manual runs
- recording session status
- recording validation output
- updating blockers and decisions

Recommended shape:

```txt
project-runner/
  README.md
  config.json
  bin/
    jini-next-task
    jini-start-session
    jini-finish-session
    jini-validate
    jini-sync-open-design
  src/
    ledger/
      read.ts
      write.ts
      lock.ts
      schema.ts
    runners/
      codex-cloud.ts
      claude.ts
      local-shell.ts
    git/
      source-checkout.ts
      branch.ts
      diff-summary.ts
    validation/
      commands.ts
      results.ts
  templates/
    codex-task.md
    claude-task.md
    session-handoff.md
  tests/
```

Minimum useful commands:

```txt
project-runner/bin/jini-next-task
  Prints the next unblocked task from ADS-memory/reports/jini-port/tasks.json.

project-runner/bin/jini-start-session <task-id> --agent codex|claude|local
  Creates ADS-memory/reports/jini-port/sessions/<timestamp>-<task-id>.md and marks the task in_progress.

project-runner/bin/jini-finish-session <task-id> --status done|blocked|failed
  Records validation, links the session file, and updates task status.

project-runner/bin/jini-validate <task-id>
  Runs the validation commands listed on that task.

project-runner/bin/jini-sync-open-design
  Updates references/open-design if it is present, or prints clone/fetch instructions if not.
```

This is the piece that makes cloud work resumable. Claude/Codex should not need to infer where the last run stopped from chat history.

## What should stay Open Design-specific

These should not be generalized first:

- project/workspace filesystem semantics
- design systems
- design files
- plugin marketplace specifics
- OD daemon route shapes
- OD data-root behavior
- OD packaged desktop behavior
- OD-specific analytics
- OD brand/library workflows

They can use Jini primitives, but they should not be moved into Jini core until there are at least two real consumers.

## Target frontend reorganization inside Open Design

Before package extraction, reorganize `apps/web` into feature slices:

```txt
apps/web/src/
  app-shell/
  features/
    chat/
      components/
      model/
      runtime/
      adapters/open-design/
    artifacts/
      components/
      model/
      runtime/
    workspace/
    project/
    design-systems/
    plugins/
    memory/
    settings/
    onboarding/
  providers/
    open-design/
  shared/
    components/
    hooks/
    utils/
  styles/
```

The existing `features/memory` slice should be used as the pattern, not necessarily copied exactly.

## Adapter seam

The core extraction should be adapter-first.

Example target interface:

```ts
export type ChatRuntimeAdapter = {
  send(input: ChatSendInput): AsyncIterable<ChatEvent>;
  loadConversation(id: string): Promise<ChatConversation>;
  listConversations(scope?: ChatScope): Promise<ChatConversationSummary[]>;
  resolveArtifact(ref: ArtifactRef): Promise<ResolvedArtifact>;
  stopRun?(runId: string): Promise<void>;
  reportFeedback?(input: ChatFeedbackInput): Promise<void>;
};
```

Generic Jini UI should consume `ChatRuntimeAdapter`.


exec
/bin/bash -lc "sed -n '361,540p' /Users/la/Desktop/Programming/OSS-Repos/open-design/docs/jini-open-design-porting-plan.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
Open Design should implement it using existing daemon endpoints.

## Cloud-agent workflow

Use cloud agents for bounded tasks, not a single unconstrained rewrite.

Recommended process:

```txt
1. Update source base
   - fetch upstream Open Design
   - create a fresh branch from origin/main
   - merge or cherry-pick useful local refactor commits only after reviewing conflicts

2. Generate/reuse architecture brief
   - CBM index Open Design
   - graph apps/web
   - identify dependency hotspots

3. Create task ledger
   - one task per seam
   - each task has explicit files, allowed changes, and validation commands

4. Assign cloud agent task
   - one small refactor per Codex/Claude run
   - require tests before/with behavior changes
   - require no UI redesign unless task says so

5. Validate locally or in cloud
   - typecheck
   - focused tests
   - guard
   - package build if package boundaries changed

6. Merge back
   - review diff
   - update task ledger
   - reindex graph
```

## Task ledger shape

Use a machine-readable task file in Jini, for example:

```txt
ADS-memory/reports/jini-port/tasks.json
```

Example task:

```json
{
  "id": "chat-pane-render-items-slice",
  "status": "pending",
  "source_repo": "open-design",
  "source_base": "origin/main",
  "scope": [
    "apps/web/src/components/ChatPane.tsx",
    "apps/web/src/runtime/todos.ts",
    "apps/web/src/components/AssistantMessage.tsx"
  ],
  "goal": "Move pure chat render-item construction into apps/web/src/features/chat/model without changing rendered behavior.",
  "allowed_changes": [
    "create feature files",
    "move pure helper functions",
    "add or update focused tests",
    "update imports"
  ],
  "forbidden_changes": [
    "redesign chat UI",
    "change daemon API shape",
    "remove OD-specific behavior",
    "weaken tests"
  ],
  "validation": [
    "pnpm --filter @open-design/web typecheck",
    "pnpm --filter @open-design/web vitest ChatPane AssistantMessage"
  ],
  "handoff": "Summarize moved symbols, behavior preserved, tests run, and remaining coupling."
}
```

The ledger must be treated as source of truth for cloud continuation. Every cloud session should update it or add a session handoff.

Recommended ledger files:

```txt
ADS-memory/reports/jini-port/tasks.json
ADS-memory/reports/jini-port/sessions/
ADS-memory/reports/jini-port/decisions.md
ADS-memory/reports/jini-port/blockers.md
ADS-memory/reports/jini-port/source-branches.md
```

Recommended task lifecycle:

```txt
pending -> in_progress -> done
                    \-> blocked
                    \-> failed
```

Each task should include:

- stable ID
- source repo and source ref
- target package/folder
- exact scope
- allowed changes
- forbidden changes
- validation commands
- current status
- last session path
- blocker, if any
- cloud prompt template to use

The important rule: a cloud agent should be able to open `ADS-memory/reports/jini-port/tasks.json`, pick the next `pending` or resumable `in_progress` task, read the last session handoff, and continue without this chat.

## Open Design reference strategy and repository size

Do not commit a full copy of Open Design into Jini as ordinary files under `references/open-design`.

The inspected local Open Design checkout is large:

```txt
open-design working tree: about 5.5 GB
open-design .git:        about 1.6 GB
```

That includes local install/build/runtime artifacts, but it is still a bad fit for vendoring into another Git repo.

Recommended options, in order:

1. Git submodule

   ```txt
   references/open-design -> git submodule pointing at https://github.com/nexu-io/open-design.git
   ```

   GitHub stores only a pointer in Jini, not the full repo contents. This keeps the Jini repo small.

2. Sparse/partial clone created by `project-runner`

   ```txt
   git clone --filter=blob:none --sparse https://github.com/nexu-io/open-design.git references/open-design
   git -C references/open-design sparse-checkout set apps/web apps/daemon packages/contracts docs specs
   ```

   This is good for cloud tasks because the runner can recreate the reference checkout on demand.

3. Ignored local clone

   ```txt
   references/open-design/
   ```

   Add it to `.gitignore`. This is simplest locally, but cloud agents must clone it themselves.

Avoid:

```txt
copy Open Design source into Jini and commit it
```

That will bloat Jini and make merges against upstream Open Design harder.

## Suggested task order

Start with characterization and low-risk moves.

1. `memory-slice-reconcile`
   - Decide whether the existing memory slice branch should be rebased/cherry-picked onto current upstream.
   - Do this before starting new frontend slice work.

2. `chat-characterization-tests`
   - Lock current behavior before moving chat code.
   - Cover message rendering, artifact rendering, TodoWrite rendering, run error events, attachment ordering, and composer submit payload.

3. `chat-model-pure-helpers`
   - Move pure helpers out of `ChatPane.tsx` and `ChatComposer.tsx`.

exec
/bin/bash -lc "sed -n '541,760p' /Users/la/Desktop/Programming/OSS-Repos/open-design/docs/jini-open-design-porting-plan.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
   - No visual changes.

4. `artifact-core-slice`
   - Move artifact parser/types/registry into a clean slice.
   - Define what is generic vs OD-specific.

5. `chat-runtime-adapter`
   - Introduce adapter interface while OD remains the only implementation.
   - No package extraction yet.

6. `jini-artifacts-package`
   - Extract artifact parsing/render registry into package.
   - Keep OD adapter in app.

7. `jini-chat-react-package`
   - Extract presentational chat components.
   - Use slots/adapters for OD specifics.

8. `open-design-consumes-jini`
   - Update OD frontend to consume Jini packages.
   - OD remains behaviorally unchanged.

## Prompt for Codex cloud task

Use this shape for each bounded task:

```txt
You are working on Open Design to extract reusable Jini engine surfaces.

Read docs/jini-open-design-porting-plan.md first.

Task:
<insert one task from the ledger>

Rules:
- Preserve current Open Design behavior.
- Do not redesign UI.
- Do not change daemon API contracts unless explicitly required.
- Prefer small moves with tests.
- If a product decision is ambiguous, stop and write a blocker note.
- Keep reusable code free of Open Design product names and daemon-specific assumptions.

Validation:
<insert exact commands>

Deliverable:
- code diff
- tests added/updated
- validation output
- short handoff describing moved seams and remaining coupling
```

## Prompt for Claude cloud/local task

Use this shape:

```txt
Read docs/jini-open-design-porting-plan.md.

You are doing one bounded extraction task only.

Before editing:
1. Identify the current owner file(s).
2. Identify OD-specific dependencies.
3. Identify pure/generic code that can move safely.
4. State the exact test or characterization you will rely on.

Then implement the smallest behavior-preserving refactor.

Stop if:
- you need to change API shape
- behavior is ambiguous
- tests cannot observe the behavior
- the move would become a broad rewrite
```

## Validation commands

For Open Design web work, use focused validation first:

```txt
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/web vitest <focused test pattern>
```

Before considering a larger branch ready:

```txt
pnpm guard
pnpm typecheck
```

If package/workspace boundaries change:

```txt
pnpm install
pnpm guard
pnpm typecheck
```

Do not add root `pnpm test` or root `pnpm build` aliases.

## Update strategy for Jini

Jini should not be updated by copying all of Open Design wholesale.

Recommended update flow:

```txt
1. In Open Design:
   - get current origin/main
   - preserve or rebase relevant refactor branches
   - produce clean reusable package diffs

2. In Jini:
   - create or update Jini package skeletons
   - copy only generic packages and adapters
   - keep OD adapter isolated
   - run Jini's own validation

3. Back in Open Design:
   - consume the Jini packages or mirrored package code
   - verify OD behavior stays green
```

If Jini remains a fork-like repo for now, still keep the conceptual boundary:

```txt
generic engine code != Open Design product adapter code
```

## Immediate next actions

1. Decide whether to rebase `refactor/web-memory-slice` onto `origin/main` or cherry-pick it into a fresh branch.
2. Create `ADS-memory/reports/jini-port/tasks.json`.
3. Run a scoped graph/architecture pass for `apps/web`.
4. Start with characterization tests around chat and artifacts.
5. Extract only pure helpers first.
6. Introduce adapter interfaces before moving code to packages.

## Critical caution

Do not start by moving `ChatPane.tsx` or `ChatComposer.tsx` wholesale into Jini. They currently contain too many Open Design assumptions. The correct move is:

```txt
characterize behavior
  -> split pure model/helpers
  -> introduce adapter seam
  -> extract presentational components
  -> keep OD adapter in Open Design
  -> only then package for Jini
```

exec
/bin/bash -lc "sed -n '1,190p' AGENTS.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# Directory guide

This file is the single source of truth for agents entering this repository. Read this file first; after entering `apps/`, `packages/`, `tools/`, or `e2e/`, read that layer's `AGENTS.md` for module-level details. Do not copy module details back into the root file; root stays focused on cross-repository boundaries, workflow, and commands.

## Core documentation index

- Product and onboarding: `README.md`, `docs/i18n/README.zh-CN.md`, `QUICKSTART.md`.
- Contribution and environment: `CONTRIBUTING.md`, `docs/i18n/CONTRIBUTING.zh-CN.md`.
- Architecture and protocols: `docs/spec.md`, `docs/architecture.md`, `docs/skills-protocol.md`, `docs/agent-adapters.md`, `docs/modes.md`.
- Roadmap and references: `docs/roadmap.md`, `docs/references.md`, `docs/code-review-guidelines.md`, `specs/current/maintainability-roadmap.md`.
- Directory-level agent guidance: `.github/AGENTS.md`, `apps/AGENTS.md`, `packages/AGENTS.md`, `tools/AGENTS.md`, `e2e/AGENTS.md`.
- Packaged auto-update architecture and high-confidence local harness: read `tools/pack/AGENTS.md` section "Packaged auto-update architecture and harness" before touching packaged updater code, release-channel identity, installer behavior, or updater UI.

## Workspace directories

- Workspace packages come from `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `tools/*`, and `e2e`.
- Top-level content directories: `skills/` (functional skills the agent invokes mid-task — utilities, briefs, packagers; see `skills/AGENTS.md`), `design-templates/` (rendering catalogue: decks, prototypes, image/video/audio templates; see `design-templates/AGENTS.md` and `specs/current/skills-and-design-templates.md`), `design-systems/` (brand `DESIGN.md` files), `craft/` (universal brand-agnostic craft rules a skill can opt into via `od.craft.requires`), `mocks/` (replay-based mock CLIs for `opencode`/`claude`/`codex`/`gemini`/`cursor-agent`/`deepseek`/`qwen`/`grok`, the ACP family `devin`/`hermes`/`kilo`/`kimi`/`kiro`/`vibe`, and the AMR `vela` CLI (login + models + ACP), built from anonymized Langfuse traces — PATH-overlay drop-in for tests and self-validation; see `mocks/README.md`).
- `apps/web` is the Next.js 16 App Router + React 18 web runtime; do not restore `apps/nextjs`.
- `apps/daemon` is the local privileged daemon and `od` bin. It owns `/api/*`, agent spawning, skills, design systems, artifacts, and static serving.
- `apps/desktop` is the Electron shell; it discovers the web URL through sidecar IPC.
- `apps/packaged` is the thin packaged Electron runtime entry; it starts packaged sidecars and owns the `od://` entry glue only.
- `packages/contracts` is the pure TypeScript web/daemon app contract layer.
- `packages/sidecar-proto` owns the Open Design sidecar business protocol; `packages/sidecar` owns the generic sidecar runtime; `packages/platform` owns generic OS process primitives.
- `tools/dev` is the local development lifecycle control plane.
- `tools/pack` is the local packaged build/start/stop/logs control plane, packaged updater harness, installer identity/registry validation surface, and mac beta release artifact preparation surface.
- `tools/serve` is the local fixture-service control plane; first service is `tools-serve start updater` for deterministic updater metadata and artifacts.
- `e2e` owns user-level end-to-end smoke tests and Playwright UI automation; read `e2e/AGENTS.md` before editing its tests or commands.

## Inactive or placeholder directories

- `apps/nextjs` and `packages/shared` have been removed; do not recreate or reference them.
- Local runtime data, `.tmp/`, Playwright reports, and agent scratch directories must stay out of git. For daemon-managed data paths, read and follow **Daemon data directory contract** below; do not restate or improvise path conventions elsewhere.

# Development workflow

## Environment baseline

- Runtime target is Node `~24` and `pnpm@10.33.2`; use Corepack so the pnpm version pinned in `package.json` is selected.
- New project-owned entrypoints, modules, scripts, tests, reporters, and configs should default to TypeScript.
- Residual JavaScript is limited to generated output, vendored dependencies, explicitly documented compatibility build artifacts, and the allowlist in `scripts/guard.ts`.

## Windows native

- macOS, Linux, and WSL2 are the primary supported paths. Windows native is best-effort — file an issue if it doesn't work.
- Historical Windows-specific friction is documented in closed issues #10, #96, #100, #203, and #315; check the issue tracker for the current state before filing new reports.
- Install Node 24. Either `winget install OpenJS.NodeJS.LTS` (currently Node 24.x) or download from https://nodejs.org. After install, verify with `node --version` — the WinGet LTS pointer rolls to the next major in October 2026, so re-verify if you re-run the install command later. Do not use Node 22 — see FAQ.
- `corepack enable` fails with EPERM on Windows (cannot write shims to `Program Files`). Use `npm install -g pnpm@10.33.2` instead.
- `better-sqlite3` has no prebuilt binary for win32/Node 24; `pnpm install` will compile it from source via node-gyp (~2 min). Requires Visual Studio Build Tools 2022 or newer. This is expected — not a sign of version incompatibility.
- For `tools-dev` start/stop/status usage, see "Local lifecycle" below.

## Local lifecycle

- Use `pnpm tools-dev` as the only local development lifecycle entry point.
- Do not add or restore root lifecycle aliases: `pnpm dev`, `pnpm dev:all`, `pnpm daemon`, `pnpm preview`, or `pnpm start`.
- Ports are governed by `tools-dev` flags: `--daemon-port` and `--web-port`.
- `tools-dev` exports `OD_PORT` for the web proxy target and `OD_WEB_PORT` for the web listener; do not use `NEXT_PORT`.

## Daemon data directory contract

This section is the only repository-wide source of truth for daemon-managed
data paths. Every README, guide, deployment note, and operational handoff that
mentions daemon data paths must point here instead of restating the rules.

This boundary is strict. Do not introduce concrete filesystem examples for the
daemon data directory, recommended data directory, shared data directory,
deployment mount, or example data directory. If existing code exposes a legacy
fallback, treat it as implementation detail or a known escape candidate, not as
a documentation pattern to copy. If a change needs a data-path rule that is not
covered here, request a core-maintainer decision in the PR instead of inventing
a new convention.

The daemon has one active data-root truth source:

- On daemon startup, `apps/daemon/src/server.ts` resolves `OD_DATA_DIR` into
  `RUNTIME_DATA_DIR`.
- All daemon-owned data paths must derive from `RUNTIME_DATA_DIR` or from a
  constant derived from it, such as `PROJECTS_DIR` or `ARTIFACTS_DIR`.
- `PROJECTS_DIR` is the managed-project root. Imported-folder projects are the
  explicit exception: they use `metadata.baseDir` for the user-selected
  external workspace.
- `ARTIFACTS_DIR`, SQLite, app config, memory, MCP config/tokens, automation
  state, plugin state, connector credentials, generated files, logs owned by
  sandbox mode, and agent runtime homes are daemon data and must remain under
  the resolved daemon data root unless this file names a specific exception.
- Agent subprocesses receive the resolved daemon data root as `OD_DATA_DIR`.
  They must inherit the daemon's truth source instead of guessing their own
  data path.

Development propagation:

- `tools-dev` owns sidecar runtime/log/ipc namespacing.
- `tools-dev --namespace <name>` does not, by itself, define daemon data
  isolation.
- A development run that needs an isolated daemon data root must pass
  `OD_DATA_DIR` into the daemon process environment. After that, the daemon
  resolves it once and all daemon data paths flow from `RUNTIME_DATA_DIR`.

Packaged propagation:

- `tools-pack` / `apps/packaged` own packaged channel and namespace layout.
- Packaged code resolves the final namespace-scoped daemon data root before
  spawning the daemon.
- The packaged daemon receives that final data root as `OD_DATA_DIR`; daemon
  code must not infer packaged data paths from app names, Electron `userData`,
  ports, channel names, or namespace names.

Sanctioned exceptions:

- `OD_MEDIA_CONFIG_DIR` is a narrow override for `media-config.json` only. It
  is not a second daemon data root.
- `OD_LEGACY_DATA_DIR` is a migration source for legacy data import only. It is
  not an active daemon data root.
- External tool homes such as `CODEX_HOME` are integration inputs, not daemon
  data roots. The daemon must not describe them as Open Design runtime data.
- Agent/project-cwd skill staging aliases are not daemon data roots.
- Manifest metadata keys and CSS identifiers are semantic namespaces, not
  filesystem path conventions.

Known escape candidates that must not be reused:

- Module-level defaults that point at a cwd-relative legacy data directory.
- Helper defaults such as `defaultRegistryRoots()` that recompute a data root
  from `process.env.OD_DATA_DIR` or a cwd fallback instead of receiving
  `RUNTIME_DATA_DIR`.
- `openDatabase(projectRoot)` calls that rely on its fallback instead of
  passing the resolved data root.
- Script help text or examples that suggest concrete legacy data directories.

Do not extend these escape patterns. When a fix is obvious, route the path
through `RUNTIME_DATA_DIR` or an explicit data-root argument. When it is not
obvious, block the PR and request core-maintainer guidance.

## Root command boundary

- Keep root scripts reserved for true repo-level checks and tools control-plane entrypoints: `pnpm guard`, `pnpm typecheck`, `pnpm tools-dev`, `pnpm tools-pack`, and `pnpm tools-serve`.
- Do not add root aggregate `pnpm build` or `pnpm test` aliases. Build/test commands must stay package-scoped (`pnpm --filter <package> ...`) or tool-scoped (`pnpm tools-pack ...`).
- Do not add root e2e aliases; e2e package commands and ownership rules live in `e2e/AGENTS.md`.

## GitHub automation boundary

Read `.github/AGENTS.md` before editing `.github/workflows/`, `.github/scripts/`, `.github/actions/`, PR follow-on automation, `workflow_run` trusted writes, CI handoff artifacts, or the workflow topology checks that guard those surfaces.

CI-related GitHub automation uses a two-layer architecture:

- Business layer workflows own product or validation decisions. `ci.yml` is the main low-privilege PR, merge-queue, and manual validation workflow. It detects scope, runs checks, and produces typed handoff artifacts.
- Atomic capability workflows own reusable trusted operations. `comment.atom.yml` publishes pure text PR comments, `autofix.atom.yml` applies same-repository patches, and `report.atom.yml` materializes advanced comments that need trusted dependencies, secrets, or report generation before upsert.

Do not add a new business-named follow-on workflow such as `foo.comment.atom.yml` or `bar.autofix.atom.yml` without first trying to express the flow as a `ci.yml` producer plus the existing `comment`, `autofix`, or `report` capability. Keep artifact naming, storage layout, and parser behavior centralized in `.github/scripts/handoff.py`; do not let individual workflows invent parallel handoff conventions.

## Release channel model

- `beta` is the daily R&D/development validation channel. It is optimized for fast development feedback and is not part of the stable promotion gate.
- `prerelease` is the internal validation channel for stable delivery. Stable releases remain gated by validated prerelease artifacts.
- `preview` is an independent early-access channel with stable-like release rigor. It should use preview versions such as `X.Y.Z-preview.N`, publish to the `preview` R2 channel, publish updater feeds under `preview/latest`, and follow stable's platform policy including the existing optional Linux enablement.
- `stable` is the formal delivery channel. Do not make stable promotion depend on preview; stable continues to depend on prerelease only.
- Public packaged app identity must stay channel-distinct: stable uses `Open Design`, beta uses `Open Design Beta`, prerelease uses `Open Design Prerelease`, and preview uses `Open Design Preview`. Do not ship beta, prerelease, or preview mac DMGs whose drag-install app bundle is `Open Design.app`.
- Windows beta updater validation must use the real beta namespace `release-beta-win`; otherwise a local beta-like namespace can create a separate uninstall registry key while looking like the same `Open Design Beta` app. See `tools/pack/AGENTS.md` for the architecture map and high-confidence acceptance harness.

## Boundary constraints

- Tests under `apps/`, `packages/`, and `tools/` live in a package/app/tool-level `tests/` directory sibling to `src/`; keep `src/` source-only and do not add new `*.test.ts` or `*.test.tsx` files under `src/`. Playwright UI automation belongs to `e2e/ui/`, not app packages.
- App packages must not import another app's private `src/` or `tests/` implementation as a shared helper. In particular, `apps/web/**` must not import `apps/daemon/src/**`; web/daemon integration belongs behind HTTP APIs, `packages/contracts`, and app-local provider boundaries.
- Cross-app, cross-runtime, or repository-resource consistency checks belong in `e2e/tests/` when they need to observe more than one app/package boundary; promote reusable logic to a pure package instead of borrowing another app's private source.
- Keep shared API DTOs, SSE event unions, error shapes, task shapes, and example payloads in `packages/contracts`; update contracts before wiring divergent web/daemon request or response shapes.
- Keep `packages/contracts` pure TypeScript and free of Next.js, Express, Node filesystem/process APIs, browser APIs, SQLite, daemon internals, and sidecar control-plane dependencies.
- Keep project-owned entrypoints, modules, scripts, tests, reporters, and configs TypeScript-first; generated `dist/*.js` is runtime output, and source edits belong in `.ts` files.
- New `.js`, `.mjs`, or `.cjs` files need an explicit generated/vendor/compatibility reason and must pass `pnpm guard`.
- App business logic must not know about sidecar/control-plane concepts. Keep sidecar awareness in `apps/<app>/sidecar` or the desktop sidecar entry wrapper.
- Shared web/daemon app contracts belong in `packages/contracts`; that package must not depend on Next.js, Express, Node filesystem/process APIs, browser APIs, SQLite, daemon internals, or the sidecar control-plane protocol.
- Sidecar process stamps must have exactly five fields: `app`, `mode`, `namespace`, `ipc`, and `source`.
- Orchestration layers (`tools-dev`, `tools-pack`, packaged launchers) must call package primitives; do not hand-build `--od-stamp-*` args or process-scan regexes.
- Packaged runtime paths must be namespace-scoped and independent from daemon/web ports; ports are transient transport details only.
- Default runtime files live under `<project-root>/.tmp/<source>/<namespace>/...`; POSIX IPC sockets are fixed at `/tmp/open-design/ipc/<namespace>/<app>.sock`.

## Capability exposure (UI/CLI dual-track)

Every user-facing capability must be reachable through both the web UI **and** the `od` CLI (`apps/daemon/src/cli.ts`). Shipping a feature with only one of the two surfaces is a regression.

- The CLI is the embeddability contract. External agents (hermes-agent, openclaw, custom Slack/Discord bots, packaged runtimes invoked from another shell) drive Open Design through `od` subcommands — they do not render the web UI. If a capability is UI-only, it cannot be composed into those external agents.
- Both surfaces must call the same `/api/*` endpoints; do not let the CLI talk to one shape and the UI to another. The daemon HTTP layer is the single source of truth, with `packages/contracts` carrying the shared DTOs.
- The CLI form must support `--json` for machine-readable output and accept long-form prompts via `--prompt-file <path|->`, so jobs that pipe through `xargs`, `jq`, and `<heredoc` stay clean.
- Adding a new capability is a three-step closure: HTTP endpoint in `apps/daemon/src/*-routes.ts` (with a contract type in `packages/contracts/src/api/`), UI surface in `apps/web/src/`, and `od <capability>` subcommand in `apps/daemon/src/cli.ts` registered through `SUBCOMMAND_MAP`. Land all three in the same PR; do not stage them across PRs.
- The PR template's Surface area checklist must reflect *both* surfaces. If you ticked UI, tick CLI too — and vice-versa — or explain in the PR body why the missing surface is genuinely not applicable (e.g. an internal-only daemon health probe). "I'll do the CLI later" is not a valid reason.
- Existing reference points: `od automation …` mirrors the Automations tab against `/api/routines`; `od plugin …`, `od ui …`, `od project …`, `od media …`, `od mcp …`, `od research …` follow the same shape. Copy that pattern for new capabilities.

## Git commit policy

- Git commits must not include `Co-authored-by` trailers or any other co-author metadata.

## Pull request expectations

exec
/bin/bash -lc "sed -n '191,390p' AGENTS.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:

- Opening a PR uses `.github/pull_request_template.md`; fill every section, not just the title.
- "Why" must answer both the author's use case (what made you write this PR) and the pain being addressed (user problem, technical debt, prod issue, or unblocker), not just a one-line restatement of the title.
- "What users will see" describes the change from a user's perspective — what they click, what new thing appears, what default behavior changed — not from a code perspective.
- The Surface area checklist must reflect actual surfaces touched; check every box that applies, including extension points (`skills/`, `design-systems/`, `design-templates/`, `craft/`), CLI flags, env vars, i18n keys, and new root `package.json` dependencies.
- If any UI surface is checked, attach screenshots showing the entry point — where users discover the change — not just the feature in isolation; before/after is best for behavior changes.
- For bug-fix PRs, link the red-spec test that reproduces the bug and confirm it went red on `main` and green on the branch, per the `Bug follow-up workflow` section above.
- `CONTRIBUTING.md` covers PR scope, title format, dependency policy, and the issue-first rule for non-trivial features; `docs/code-review-guidelines.md` is the reviewer-facing complement.

## Code review guide

- Use `docs/code-review-guidelines.md` as the repository-wide review standard. That document is the operational guide; this `AGENTS.md` is the source of truth when the two disagree.
- Walk reviews top-down through `docs/code-review-guidelines.md`: Product relevance test → forbidden surfaces → ownership/scope → matching lane → checklist → comments → approval bar.
- Pick the matching review lane: default code/tests, contract and protocol changes, design-system additions, skill additions, or craft additions.
- Before reviewing changes under `apps/`, `packages/`, `tools/`, or `e2e/`, read that directory's `AGENTS.md` and apply its local boundaries.
- Blocking review feedback should focus on correctness, security/secrets, data integrity, repository boundary violations, contract/migration breakage, missing required validation, or high-risk maintainability issues.
- Only maintainers may close a PR instead of requesting changes, and only when the change is not salvageable on the existing branch (wrong target product, foreign test harness, DOM/API assumptions absent from this repo, or scripts that conflict with lifecycle rules).

## PR-duty tooling

This repository no longer ships a maintainer PR-duty control plane. The former
`pnpm tools-pr` workflow has moved to the standalone `PerishCode/duty` project
so personal review-lane automation does not become product workspace
maintenance surface. Do not recreate `tools/pr`, `@open-design/tools-pr`, or a
root `pnpm tools-pr` script without a new explicit maintainer decision.

## Agent runtime conventions

- `RuntimeAgentDef.promptInputFormat` selects how the daemon writes the prompt to a child's stdin. The default `'text'` writes the composed prompt and ends stdin immediately. `'stream-json'` wraps the prompt as one JSONL `user` message and KEEPS stdin open so the daemon can stream further user messages back in mid-turn. Claude (`apps/daemon/src/runtimes/defs/claude.ts`) ships `'stream-json'` together with `--input-format stream-json` as generic mid-turn input infrastructure; the daemon closes stdin once the turn terminates cleanly. Every other agent stays on `'text'`.
- `apps/daemon/src/server.ts` tracks `run.stdinOpen` on the run object. `applyClaudeStreamJsonRunBookkeeping` closes stdin (and records `turnCompletedCleanly`) when a `turn_end` (or `usage`) event arrives with a non `tool_use` `stop_reason`. The `tool_use` stop reason means the model paused mid tool (waiting on claude-code's internal runner); closing stdin there would truncate the follow up response.
- `claude-stream.ts` emits the `turn_end` event AFTER iterating the assistant message's content blocks, not before, so the daemon sees the final `stop_reason` and every tool_use of the turn before deciding whether to close stdin.
- The host asks the user clarifying questions through the `<question-form>` artifact (see "Asking the user questions" below), NOT through a stdin-injected `tool_result`. There is no `AskUserQuestion` tool wiring, no `/api/runs/:id/tool-result` endpoint, and no host-answer return path; the stream-json input skeleton is retained only as generic infrastructure.

## Asking the user questions

- There is exactly one mechanism for clarifying user intent: the `<question-form>` markdown artifact the model emits inline. The chat renders a `QuestionsBanner` entry point (`AssistantMessage.tsx`); the form itself renders in the right-hand Questions tab (`QuestionsPanel` + `QuestionFormView`), and answers flow back as the next user message (`formatFormAnswers` in `apps/web/src/artifacts/question-form.ts` → `POST /api/chat`). There is no inline interactive tool card.
- `<question-form>` is valid on ANY turn, not just turn-1 discovery. Use it for turn-1 discovery briefs AND for mid-conversation clarification (e.g. an ambiguous annotation). The system-prompt guidance lives in `apps/daemon/src/prompts/system.ts` and `discovery.ts`; the API/BYOK-mode wording is mirrored through `packages/contracts/src/prompts/system.ts`.
- `run-artifacts.ts:runAskedUserQuestion` powers the `run_finished.asked_user_question` analytics signal by scanning the run's streamed text for a `<question-form` marker (reassembled across `text_delta` chunks), not by detecting any tool call.

## Chat UI conventions

- `apps/web/src/components/file-viewer-render-mode.ts` decides URL-load vs srcDoc for HTML previews. Bridges (deck, comment/inspect selection, palette, edit, tweaks) can ONLY inject through the srcDoc path. Add a new disqualifier to `UrlLoadDecision` whenever a feature needs a srcDoc-only bridge; pass it from `FileViewer.tsx` based on a source-content heuristic where appropriate (e.g. `hasTweaksTemplate`). The host keeps both iframes mounted simultaneously and swaps CSS visibility so toggling render mode does not cause an iframe reload flash; `iframeRef.current` stays aligned with the active iframe via `useEffect`. Receive filters use `isOurIframe(ev.source)` to accept messages from either iframe but signals that should ONLY come from the active iframe (e.g. `od:tweaks-available`) re-check `ev.source === iframeRef.current?.contentWindow`.
- TodoWrite UI pins one canonical task list above the chat composer via `PinnedTodoSlot` in `ChatPane.tsx`. The slot reads the latest TodoWrite snapshot across the conversation through `latestTodoWriteInputFromMessages` (`apps/web/src/runtime/todos.ts`). `AssistantMessage.stripTodoToolGroups` removes any TodoWrite tool groups from per message rendering so there is exactly one TodoCard on screen. The progress count includes both `completed` and `in_progress` items (1/4 reads "one underway" not "zero finished"). Dismissal via the Done button is keyed on the snapshot's JSON, so a fresh TodoWrite from the agent automatically re shows the card. `PinnedTodoSlot` sits OUTSIDE the `.chat-log` scroll container, so auto-scroll requires explicit coverage: `ChatPane`'s `ResizeObserver` accepts a `containerRef` from `PinnedTodoSlot` and observes that element directly, and a pane-level `MutationObserver` (`childList: true` on the chat pane ancestor) re-syncs that observation whenever the slot mounts or unmounts as new TodoWrite snapshots arrive.
- Clarifying questions render through the `<question-form>` artifact and the Questions tab, not an inline tool card — see "Asking the user questions" above.
- Tool group rendering uses `dedupeSnapshotToolRetries` to collapse `TodoWrite` snapshots (only the most recent call survives, since each call is a state replace). `SNAPSHOT_TOOL_NAMES` lists the snapshot-style tools; non-snapshot tools pass through untouched.

## Web CSS ownership

- `apps/web/src/index.css` is an import-only cascade entrypoint. Do not add selectors or declarations there; add imports only when a truly global stylesheet is needed, and keep import order intentional.
- Shared global styles belong in `apps/web/src/styles/`: design tokens, base/reset rules, primitives, app-shell layout, and legacy cross-component selectors that cannot safely be scoped yet. Keep domain-level global files grouped by owner (for example `styles/viewer/` and `styles/workspace/`) instead of adding more large files directly under `styles/`.
- New component-owned UI styles should default to CSS Modules next to the component (`Component.module.css`) instead of expanding global stylesheets. This is preferred for isolated components, panels, menus, drawers, toolbars, cards, and form sections.
- When touching an existing component with nearby global styles, prefer migrating that component's local selectors to a CSS Module as part of the change if it is small and testable. Do not mix a large mechanical move with behavior/styling changes in the same patch.
- Keep global class names only for deliberate shared contracts: reusable primitives, theme hooks, third-party/content styling, cross-component layout, or selectors that rely on global cascade/specificity. Document any new global selector group with its owning feature.
- CSS refactors must preserve cascade semantics. For mechanical splits, verify expanded import content/order matches the previous stylesheet; for CSS Module migrations, validate the affected UI path with `pnpm --filter @open-design/web typecheck` and a focused build/test or visual check when practical.

## Web component reuse

- New `apps/web` UI should reuse shared primitives from `@open-design/components` when one exists instead of styling plain HTML elements directly. For example, use `Button` for app buttons and `VisuallyHidden` for screen-reader-only text/status content.
- Do not add new raw primitive classes such as `primary`, `primary-ghost`, `ghost`, `subtle`, `icon-btn`, or `sr-only` for new UI. Those classes are legacy compatibility surface for existing markup until it is migrated.
- If a needed primitive is missing, prefer adding a small focused primitive to `packages/components` with colocated CSS Modules, then consume it from the app. Keep product-specific layout and workflow styling in the app, not in `packages/components`.
- Keep semantic plain HTML when it is content markup or a specialized control that the shared package does not model yet; do not force a migration that would hide native behavior or make a custom widget harder to reason about.
- `apps/web` transpiles `@open-design/components` from source during dev, so component and CSS Module edits should work through the normal web dev loop without rebuilding the package.

## i18n keys

- `apps/web/src/i18n/types.ts` is the typed `Dict`; every key must be defined in all 18 locale files under `apps/web/src/i18n/locales/*.ts` (`ar`, `de`, `en`, `es-ES`, `fa`, `fr`, `hu`, `id`, `ja`, `ko`, `pl`, `pt-BR`, `ru`, `th`, `tr`, `uk`, `zh-CN`, `zh-TW`). Add the key to `types.ts` first; missing translations produce a typecheck error.

## UI animation philosophy

- Default ease-out for UI transitions: `cubic-bezier(0.23, 1, 0.32, 1)`. Built-in `ease` is too weak; `ease-in` is forbidden for UI elements because it feels sluggish.
- Asymmetric durations: enter around 200ms, exit around 140ms. Exit reads as decisive because the user has already chosen to dismiss.
- Accordion expand and collapse uses `grid-template-rows: 0fr -> 1fr` (modern auto height pattern). Pair with opacity fade and the easing above. The shared `.accordion-collapsible` + `.accordion-collapsible-inner` class pair (defined in `apps/web/src/index.css`) is the canonical implementation; reuse it for new disclosure UI.
- Never animate from `transform: scale(0)`. Start from `scale(0.9)` or higher with `opacity: 0`.
- For elements that show conditionally, keep them mounted and toggle a CSS class (e.g. `.chat-jump-btn-active`). React unmounts skip the exit transition entirely.

## Validation strategy

- After package, workspace, or command-entry changes, run `pnpm install` so workspace links and generated dist entries stay fresh.
- For agent-stream / parser changes (`apps/daemon/src/claude-stream.ts`, `json-event-stream.ts`, `qoder-stream.ts`, etc.), replay a recorded session through the mock CLIs in `mocks/` to verify event shapes round-trip without burning provider budget. PATH-overlay activation: `export PATH="$PWD/mocks/bin:$PATH" OD_MOCKS_TRACE=<8-char-id> OD_MOCKS_NO_DELAY=1`. See `mocks/README.md` for the trace catalog and selection knobs.
- Treat every `pnpm-lock.yaml` change as requiring a Nix pnpm deps hash refresh check. `nix/pnpm-deps.nix` is a generated lock artifact; use `pnpm nix:update-hash` only when intentionally maintaining Nix packaging, then re-run `nix flake check --print-build-logs --keep-going`. Contributors without Nix can rely on the PR `Validate workspace` gate, which now uploads or auto-applies the generated hash-only fix when possible. A stale Nix hash is advisory on pull_request and never blocks the PR — the `nix_validation` job refreshes the hash via autofix while keeping the PR check green, and the hash is only enforced as a hard gate at merge time (`merge_group` and manual full runs fail closed).
- Before marking regular work ready, run at least `pnpm guard` and `pnpm typecheck`, plus the package-scoped tests/builds that match the files changed. Do not use or add root `pnpm test`/`pnpm build` aliases.
- For local web runtime loops, prefer `pnpm tools-dev run web --daemon-port <port> --web-port <port>`.
- For e2e tests that need a tools-dev daemon/web runtime, use the shared tools-dev harness under `e2e/lib/tools-dev/` and the framework suite adapters (`e2e/lib/playwright/suite.ts`, `e2e/lib/vitest/suite.ts`). Do not hand-spawn `tools-dev` from test cases or duplicate lifecycle helpers under framework-specific folders.
- Playwright UI tests must import `test`/`expect` from `@/playwright/suite`, not directly from `@playwright/test`; type-only imports from `@playwright/test` remain fine. The suite owns one isolated tools-dev daemon/web/data root per Playwright worker. Do not add a shared-runtime fallback; set Playwright workers to `1` when constrained.
- Playwright suite code must not own workspace prebuild policy. CI and callers keep the existing prebuild steps; `tools-dev` daemon freshness checks are only a fallback guard.
- On a GUI-capable machine, validate desktop by running `pnpm tools-dev`, then `pnpm tools-dev inspect desktop status`.
- Stamp/namespace changes must validate two concurrent namespaces and run desktop `inspect eval` plus `inspect screenshot` for each namespace.
- Path/log changes must run `pnpm tools-dev logs --namespace <name> --json` and confirm log paths are under `.tmp/tools-dev/<namespace>/...`.

## Bug follow-up workflow

The following is a working playbook for routine bug follow-ups, distilled from recent practice. Treat it as a default action shape, not a contract — production reality always has edges these bullets can't anticipate, so use judgment when the situation doesn't fit cleanly.

- **Lead with a red spec.** Default to encoding the bug as a falsifiable test that goes red before any source change, so the fix is anchored in observable behavior rather than source-code intuition. If a red spec can't be written cheaply, that's usually a signal to clarify scope rather than push forward on a guess.
- **Try the cheapest layer first.** Reach for the lightest test layer that can still see the symptom (e2e Vitest at the daemon HTTP boundary → app-local Vitest → Playwright UI → platform-native harnesses), and drop down only when the cheaper layer can't.
- **Hold the spec's scope.** Defects discovered outside the bug's described boundary belong in a follow-up — their own red spec, their own PR — not in this fix. List them in the PR body's "Adjacent issues" section with the rationale and move on.
- **Let the fix read as an invariant.** Prefer a named helper whose docblock describes what must hold over a bolt-on `if` guard with apologetic history-comments. The call site should read as intent.
- **Diff against the baseline.** When neighboring suites have pre-existing failures, stash or check out upstream before claiming "no new failures."
- **Link the issue from the PR body.** Use `Fixes #N` / `Closes #N` / `Resolves #N` so the issue auto-closes on merge and the release-time reverse lookup (`gh issue view N --json closedByPullRequestsReferences` → `git tag --contains <merge sha>`) actually has a chain to follow. The repo's PR template prompts for this; deleting the prompt is fine when the PR genuinely closes nothing.
- **Stage human verification for visible bugs.** When the symptom needs an eye to confirm — UI, platform-native behavior, animations, race conditions a unit test can't see — green specs alone aren't acceptance. Stand up a buggy-vs-fix comparison the reviewer can drive themselves (typical shape: two namespaced runtimes, one on `main`, one on the fix branch), and seed any required data only through production HTTP APIs; source-level test backdoors invalidate the verification because they prove a fake flow rather than the real one.

For a worked example of one full loop (red e2e spec → fix → green), see `e2e/tests/dialog/stop-reconciles-message.test.ts` (issue #135).

# Common commands

```bash
pnpm install
pnpm nix:update-hash
pnpm tools-dev
pnpm tools-serve start updater
pnpm tools-dev start web
pnpm tools-dev run web --daemon-port 17456 --web-port 17573
pnpm tools-dev status --json
pnpm tools-dev logs --json
pnpm tools-dev inspect desktop status --json
pnpm tools-dev inspect desktop screenshot --path /tmp/open-design.png
pnpm tools-dev stop
pnpm tools-dev check
```

```bash
pnpm guard
pnpm typecheck
```

```bash
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/web test
pnpm --filter @open-design/web build
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/daemon build
pnpm --filter @open-design/desktop build
pnpm --filter @open-design/tools-dev build
pnpm --filter @open-design/tools-pack build
pnpm --filter @open-design/tools-serve build
```

```bash
pnpm tools-pack mac build --to all
pnpm tools-pack mac install
pnpm tools-pack mac cleanup
pnpm tools-pack win build --to nsis
pnpm tools-pack win install
pnpm tools-pack win cleanup
pnpm tools-pack linux build --to appimage
pnpm tools-pack linux install
pnpm tools-pack linux build --containerized
```

# FAQ

## Why is there no root `pnpm dev` / `pnpm start`?

To avoid starting daemon, web, and desktop through inconsistent env, port, namespace, or log paths. All local lifecycle flows must go through `pnpm tools-dev`.

## Why should `apps/nextjs` not be restored?

The current web runtime is `apps/web`. The historical `apps/nextjs` layout has been removed from the active repo shape; restoring it would reintroduce duplicate app boundaries and stale scripts.

## How does desktop discover the web URL?

Desktop queries runtime status through sidecar IPC. The web URL comes from `tools-dev` launch status, not from desktop guessing ports or reading web internals.

## How are sidecar-proto, sidecar, and platform split?

`@open-design/sidecar-proto` owns Open Design app/mode/source constants, namespace validation, stamp fields/flags, IPC message schema, status shapes, and error semantics. `@open-design/sidecar` provides only generic bootstrap, IPC transport, path/runtime resolution, launch env, and JSON runtime files. `@open-design/platform` provides only generic OS process stamp serialization, command parsing, and process matching/search primitives, consuming the proto descriptor.

## When is `pnpm install` required?

Run `pnpm install` after changing package manifests, workspace layout, command entrypoints, bin/link-related content, or after adding/removing workspace packages.

## Can I use Node 22 instead of Node 24?

No. `package.json#engines` specifies `node: "~24"`, which is the only supported runtime. The current lockfile pins `better-sqlite3@11.10.0`; on Windows it has no prebuilt binary for Node 24 and is built from source via node-gyp (see the Windows native section). Older Node versions are not tested and may hit lockfile or dependency incompatibilities.

exec
/bin/bash -lc 'diff -u /Users/la/Desktop/Programming/OSS-Repos/open-design/AGENTS.md /Users/la/Desktop/Programming/Jini/AGENTS.md || true' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
--- /Users/la/Desktop/Programming/OSS-Repos/open-design/AGENTS.md	2026-07-06 07:28:14
+++ /Users/la/Desktop/Programming/Jini/AGENTS.md	2026-07-05 09:43:14
@@ -15,6 +15,7 @@
 
 - Workspace packages come from `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `tools/*`, and `e2e`.
 - Top-level content directories: `skills/` (functional skills the agent invokes mid-task — utilities, briefs, packagers; see `skills/AGENTS.md`), `design-templates/` (rendering catalogue: decks, prototypes, image/video/audio templates; see `design-templates/AGENTS.md` and `specs/current/skills-and-design-templates.md`), `design-systems/` (brand `DESIGN.md` files), `craft/` (universal brand-agnostic craft rules a skill can opt into via `od.craft.requires`), `mocks/` (replay-based mock CLIs for `opencode`/`claude`/`codex`/`gemini`/`cursor-agent`/`deepseek`/`qwen`/`grok`, the ACP family `devin`/`hermes`/`kilo`/`kimi`/`kiro`/`vibe`, and the AMR `vela` CLI (login + models + ACP), built from anonymized Langfuse traces — PATH-overlay drop-in for tests and self-validation; see `mocks/README.md`).
+- Contributor/dev skills: `dev-skills/` (agent-agnostic `SKILL.md` refactoring/maintenance workflows any code agent — Claude Code, Codex, Gemini, Cursor — can load; e.g. `fixing-open-design`; see `dev-skills/AGENTS.md`). These are **not** product skills: they are not surfaced in the OD UI or `/api/skills`, unlike `skills/`.
 - `apps/web` is the Next.js 16 App Router + React 18 web runtime; do not restore `apps/nextjs`.
 - `apps/daemon` is the local privileged daemon and `od` bin. It owns `/api/*`, agent spawning, skills, design systems, artifacts, and static serving.
 - `apps/desktop` is the Electron shell; it discovers the web URL through sidecar IPC.
@@ -290,7 +291,15 @@
 - **Stage human verification for visible bugs.** When the symptom needs an eye to confirm — UI, platform-native behavior, animations, race conditions a unit test can't see — green specs alone aren't acceptance. Stand up a buggy-vs-fix comparison the reviewer can drive themselves (typical shape: two namespaced runtimes, one on `main`, one on the fix branch), and seed any required data only through production HTTP APIs; source-level test backdoors invalidate the verification because they prove a fake flow rather than the real one.
 
 For a worked example of one full loop (red e2e spec → fix → green), see `e2e/tests/dialog/stop-reconciles-message.test.ts` (issue #135).
+
+## Refactoring workflow
 
+When the work is a **structural refactor of a backend/daemon module** — splitting a god-file or a flat directory of many files into modules, applying the capability-barrel pattern, breaking dependency cycles, or reorganizing `apps/daemon/src/**` into `core/` + concern subdirectories — **load `dev-skills/fixing-open-design/SKILL.md` before touching code and follow its phases.** It is the repository's canonical, machine-enforced refactor template (reference implementation: `apps/daemon/src/design-systems/`; guard: `scripts/check-barrel-imports.ts`).
+
+- Triggers: "refactor this subsystem", "split this god-file", "capability-barrel this module", "apply the design-systems pattern", "organize these files into a subfolder", or any task that moves/regroups daemon modules for maintainability.
+- The skill is agent-agnostic (Claude Code, Codex, Gemini, Cursor). Do not hand-roll a barrel split or invent a variant layout — the guard enforces the exact shape, and an unregistered split rots immediately.
+- One subsystem per PR; public export surface stays identical; every file gets a `@module` docblock and every export JSDoc; register the domain in `CAPABILITY_BARREL_DOMAINS` and keep `pnpm guard` green. See `dev-skills/AGENTS.md` for the dev-skill roster.
+
 # Common commands
 
 ```bash

mcp: codebase-memory-mcp/list_projects started
mcp: codebase-memory-mcp/list_projects (completed)
exec
/bin/bash -lc 'git status --short --branch' in /Users/la/Desktop/Programming/OSS-Repos/open-design
exec
/bin/bash -lc 'git remote -v' in /Users/la/Desktop/Programming/OSS-Repos/open-design
exec
/bin/bash -lc 'git branch -vv && git branch -r' in /Users/la/Desktop/Programming/OSS-Repos/open-design
exec
/bin/bash -lc "git branch --show-current && git rev-parse HEAD && git log -1 --format='%ad%n%s' --date=iso-strict" in /Users/la/Desktop/Programming/OSS-Repos/open-design
exec
/bin/bash -lc "git branch --show-current && git rev-parse HEAD && git log -1 --format='%ad%n%s' --date=iso-strict" in /Users/la/Desktop/Programming/Jini
exec
/bin/bash -lc 'git remote -v' in /Users/la/Desktop/Programming/Jini
exec
/bin/bash -lc 'git status --short --branch' in /Users/la/Desktop/Programming/Jini
exec
/bin/bash -lc 'git branch -vv && git branch -r' in /Users/la/Desktop/Programming/Jini
 succeeded in 10325ms:
2026-07-16 09:27:36.917 xcodebuild[32478:1021846]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:37.523 xcodebuild[32515:1021906]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:38.509 xcodebuild[32515:1021884] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-CbYfsL6F' (errno=Operation not permitted)
2026-07-16 09:27:40.572 xcodebuild[32537:1022031]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.162 xcodebuild[32549:1022079]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.902 xcodebuild[32549:1022048] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
fork	https://github.com/leonaburime-ucla/open-design.git (fetch)
fork	https://github.com/leonaburime-ucla/open-design.git (push)
origin	https://github.com/nexu-io/open-design.git (fetch)
origin	https://github.com/nexu-io/open-design.git (push)

 succeeded in 10971ms:
2026-07-16 09:27:36.928 xcodebuild[32502:1021849]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:37.570 xcodebuild[32514:1021913]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:38.511 xcodebuild[32514:1021879] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-wJIFLeoA' (errno=Operation not permitted)
2026-07-16 09:27:40.713 xcodebuild[32545:1022062]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.303 xcodebuild[32555:1022093]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:42.053 xcodebuild[32555:1022069] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
fork	https://github.com/leonaburime-ucla/open-design.git (fetch)
fork	https://github.com/leonaburime-ucla/open-design.git (push)
origin	https://github.com/nexu-io/open-design.git (fetch)
origin	https://github.com/nexu-io/open-design.git (push)

 succeeded in 11092ms:
2026-07-16 09:27:36.948 xcodebuild[32477:1021870]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:37.593 xcodebuild[32518:1021921]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:38.523 xcodebuild[32518:1021899] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-0YHbOGEP' (errno=Operation not permitted)
2026-07-16 09:27:40.683 xcodebuild[32544:1022060]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.283 xcodebuild[32554:1022091]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:42.089 xcodebuild[32554:1022066] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
## refactor/web-memory-slice...fork/refactor/web-memory-slice [behind 1]
?? ADS-project-knowledge/
?? apps/web/coverage/
?? docs/jini-open-design-porting-plan.md

 succeeded in 11115ms:
2026-07-16 09:27:36.877 xcodebuild[32503:1021842]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:37.563 xcodebuild[32509:1021914]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:38.514 xcodebuild[32509:1021858] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-yn6UvcyX' (errno=Operation not permitted)
2026-07-16 09:27:40.606 xcodebuild[32541:1022041]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.197 xcodebuild[32553:1022089]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.935 xcodebuild[32553:1022059] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
## integrated
 D apps/web/src/App.tsx
 D apps/web/src/analytics/amr-attribution.ts
 D apps/web/src/analytics/amr-auth.ts
 D apps/web/src/analytics/byok-run.ts
 D apps/web/src/analytics/client.ts
 D apps/web/src/analytics/ds-create-entry.ts
 D apps/web/src/analytics/error-tracking.ts
 D apps/web/src/analytics/events.ts
 D apps/web/src/analytics/identity.ts
 D apps/web/src/analytics/onboarding-session.ts
 D apps/web/src/analytics/provider.tsx
 D apps/web/src/analytics/scrub.ts
 D apps/web/src/analytics/upload-tracking.ts
 D apps/web/src/api-attachment-context.ts
 D apps/web/src/artifacts/manifest.ts
 D apps/web/src/artifacts/markdown-context.ts
 D apps/web/src/artifacts/markdown.ts
 D apps/web/src/artifacts/parser.ts
 D apps/web/src/artifacts/pointer.ts
 D apps/web/src/artifacts/question-form.ts
 D apps/web/src/artifacts/recover.ts
 D apps/web/src/artifacts/renderer-registry.ts
 D apps/web/src/artifacts/strip.ts
 D apps/web/src/artifacts/types.ts
 D apps/web/src/artifacts/validate.ts
 D apps/web/src/comments.ts
 D apps/web/src/components/AgentDiagnosticRow.module.css
 D apps/web/src/components/AgentDiagnosticRow.tsx
 D apps/web/src/components/AgentIcon.tsx
 D apps/web/src/components/AgentPicker.tsx
 D apps/web/src/components/AmrGuidance.tsx
 D apps/web/src/components/AmrLoginPill.tsx
 D apps/web/src/components/AppChromeHeader.tsx
 D apps/web/src/components/AssistantMessage.tsx
 D apps/web/src/components/AvatarMenu.tsx
 D apps/web/src/components/BoardComposerPopover.tsx
 D apps/web/src/components/BrandEnrichmentBanner.module.css
 D apps/web/src/components/BrandEnrichmentBanner.tsx
 D apps/web/src/components/BrandPickerModal.module.css
 D apps/web/src/components/BrandPickerModal.tsx
 D apps/web/src/components/BrandPreviewCard.module.css
 D apps/web/src/components/BrandPreviewCard.tsx
 D apps/web/src/components/BrandReadyPrompt.module.css
 D apps/web/src/components/BrandReadyPrompt.tsx
 D apps/web/src/components/BrandReferencePicker.module.css
 D apps/web/src/components/BrandReferencePicker.tsx
 D apps/web/src/components/BrandsTab.module.css
 D apps/web/src/components/BrandsTab.tsx
 D apps/web/src/components/ChatComposer.tsx
 D apps/web/src/components/ChatPane.tsx
 D apps/web/src/components/ComposerPluginPreview.tsx
 D apps/web/src/components/ComposerPlusMenu.tsx
 D apps/web/src/components/ConnectorLogo.tsx
 D apps/web/src/components/ConnectorsBrowser.tsx
 D apps/web/src/components/ContextChipHoverCard.module.css
 D apps/web/src/components/ContextChipHoverCard.tsx
 D apps/web/src/components/ContextChipStrip.tsx
 D apps/web/src/components/ContinueInCliButton.tsx
 D apps/web/src/components/ConversationsMenu.tsx
 D apps/web/src/components/CustomSelect.tsx
 D apps/web/src/components/DesignBrowserPanel.tsx
 D apps/web/src/components/DesignFilesPanel.tsx
 D apps/web/src/components/DesignKitView.tsx
 D apps/web/src/components/DesignSpecView.tsx
 D apps/web/src/components/DesignSystemAssetDropzone.module.css
 D apps/web/src/components/DesignSystemAssetDropzone.tsx
 D apps/web/src/components/DesignSystemCreateHero.module.css
 D apps/web/src/components/DesignSystemCreateHero.tsx
 D apps/web/src/components/DesignSystemFlow.tsx
 D apps/web/src/components/DesignSystemKitPreview.tsx
 D apps/web/src/components/DesignSystemPicker.tsx
 D apps/web/src/components/DesignSystemPreviewModal.tsx
 D apps/web/src/components/DesignSystemSwitchPicker.tsx
 D apps/web/src/components/DesignSystemsSection.tsx
 D apps/web/src/components/DesignSystemsTab.module.css
 D apps/web/src/components/DesignSystemsTab.tsx
 D apps/web/src/components/DesignsTab.tsx
 D apps/web/src/components/EditorIcon.tsx
 D apps/web/src/components/EntryHelpMenu.tsx
 D apps/web/src/components/EntryNavRail.tsx
 D apps/web/src/components/EntrySettingsMenu.tsx
 D apps/web/src/components/EntryShell.tsx
 D apps/web/src/components/EntryView.tsx
 D apps/web/src/components/ExamplesTab.tsx
 D apps/web/src/components/ExportDiagnosticsButton.tsx
 D apps/web/src/components/FigmaHelpModal.module.css
 D apps/web/src/components/FigmaHelpModal.tsx
 D apps/web/src/components/FigmaImportModal.module.css
 D apps/web/src/components/FigmaImportModal.tsx
 D apps/web/src/components/FileOpsSummary.tsx
 D apps/web/src/components/FileViewer.tsx
 D apps/web/src/components/FileWorkspace.tsx
 D apps/web/src/components/FinalizeDesignButton.tsx
 D apps/web/src/components/GenUIInbox.tsx
 D apps/web/src/components/GenUISurfaceRenderer.tsx
 D apps/web/src/components/GithubStarBadge.tsx
 D apps/web/src/components/HandoffButton.tsx
 D apps/web/src/components/HomeHero.tsx
 D apps/web/src/components/HomeTemplatesReveal.tsx
 D apps/web/src/components/HomeView.tsx
 D apps/web/src/components/Icon.tsx
 D apps/web/src/components/IframeKeepAlivePool.tsx
 D apps/web/src/components/InlineModelSwitcher.tsx
 D apps/web/src/components/InlinePluginsRail.tsx
 D apps/web/src/components/IntegrationsView.tsx
 D apps/web/src/components/KitErrorBoundary.module.css
 D apps/web/src/components/KitErrorBoundary.tsx
 D apps/web/src/components/LanguageMenu.tsx
 D apps/web/src/components/LibraryAssetMeta.tsx
 D apps/web/src/components/LibraryPicker.module.css
 D apps/web/src/components/LibraryPicker.tsx
 D apps/web/src/components/LibraryPreviewModal.module.css
 D apps/web/src/components/LibraryPreviewModal.tsx
 D apps/web/src/components/LibrarySection.module.css
 D apps/web/src/components/LibrarySection.tsx
 D apps/web/src/components/LibraryUploadModal.module.css
 D apps/web/src/components/LibraryUploadModal.tsx
 D apps/web/src/components/LiveArtifactBadges.tsx
 D apps/web/src/components/Loading.tsx
 D apps/web/src/components/ManualEditPanel.tsx
 D apps/web/src/components/MarketplaceView.tsx
 D apps/web/src/components/McpClientSection.tsx
 D apps/web/src/components/MemoryHooksPanel.module.css
 D apps/web/src/components/MemoryHooksPanel.tsx
 D apps/web/src/components/MemoryModelInline.tsx
 D apps/web/src/components/MemoryProfilePanel.module.css
 D apps/web/src/components/MemoryProfilePanel.tsx
 D apps/web/src/components/MemorySection.tsx
 D apps/web/src/components/MemoryToast.tsx
 D apps/web/src/components/MissingBrandFontsBanner.tsx
 D apps/web/src/components/NewAutomationModal.tsx
 D apps/web/src/components/NewBrandModal.module.css
 D apps/web/src/components/NewBrandModal.tsx
 D apps/web/src/components/NewProjectModal.tsx
 D apps/web/src/components/NewProjectPanel.tsx
 D apps/web/src/components/NextStepActions.module.css
 D apps/web/src/components/NextStepActions.tsx
 D apps/web/src/components/OdCard.module.css
 D apps/web/src/components/OdCard.tsx
 D apps/web/src/components/PaletteTweaks.tsx
 D apps/web/src/components/PasteTextDialog.tsx
 D apps/web/src/components/PlanBadge.tsx
 D apps/web/src/components/PluginDetailView.tsx
 D apps/web/src/components/PluginDetailsModal.tsx
 D apps/web/src/components/PluginInputsForm.tsx
 D apps/web/src/components/PluginLoopHome.tsx
 D apps/web/src/components/PluginsHomeSection.tsx
 D apps/web/src/components/PluginsSection.tsx
 D apps/web/src/components/PluginsView.tsx
 D apps/web/src/components/PreviewDrawOverlay.tsx
 D apps/web/src/components/PreviewModal.tsx
 D apps/web/src/components/PrivacyConsentModal.tsx
 D apps/web/src/components/PrivacySection.tsx
 D apps/web/src/components/ProjectActionsToolbar.tsx
 D apps/web/src/components/ProjectLocationsSection.tsx
 D apps/web/src/components/ProjectReferenceModal.module.css
 D apps/web/src/components/ProjectReferenceModal.tsx
 D apps/web/src/components/ProjectView.tsx
 D apps/web/src/components/PromptTemplatePreviewModal.tsx
 D apps/web/src/components/PromptTemplatesTab.tsx
 D apps/web/src/components/QuestionForm.tsx
 D apps/web/src/components/QuestionsPanel.tsx
 D apps/web/src/components/QuickSwitcher.tsx
 D apps/web/src/components/RecentProjectsStrip.tsx
 D apps/web/src/components/RemixIcon.tsx
 D apps/web/src/components/RoutinesSection.tsx
 D apps/web/src/components/SessionModeToggle.tsx
 D apps/web/src/components/SettingsDialog.tsx
 D apps/web/src/components/SketchEditor.tsx
 D apps/web/src/components/SketchEnginePrewarm.module.css
 D apps/web/src/components/SketchEnginePrewarm.tsx
 D apps/web/src/components/SketchPreview.tsx
 D apps/web/src/components/SkillDetailsModal.tsx
 D apps/web/src/components/SkillsSection.tsx
 D apps/web/src/components/SocialShareGrid.tsx
 D apps/web/src/components/TasksView.tsx
 D apps/web/src/components/Theater/AGENTS.md
 D apps/web/src/components/Theater/CritiqueTheaterMount.tsx
 D apps/web/src/components/Theater/InterruptButton.tsx
 D apps/web/src/components/Theater/PanelistLane.tsx
 D apps/web/src/components/Theater/RoundDivider.tsx
 D apps/web/src/components/Theater/ScoreTicker.tsx
 D apps/web/src/components/Theater/TheaterCollapsed.tsx
 D apps/web/src/components/Theater/TheaterDegraded.tsx
 D apps/web/src/components/Theater/TheaterStage.tsx
 D apps/web/src/components/Theater/TheaterTranscript.tsx
 D apps/web/src/components/Theater/hooks/useCritiqueReplay.ts
 D apps/web/src/components/Theater/hooks/useCritiqueStream.ts
 D apps/web/src/components/Theater/hooks/useCritiqueTheaterEnabled.ts
 D apps/web/src/components/Theater/index.ts
 D apps/web/src/components/Theater/state/reducer.ts
 D apps/web/src/components/Theater/state/sse.ts
 D apps/web/src/components/Toast.tsx
 D apps/web/src/components/ToolCard.tsx
 D apps/web/src/components/TooltipLayer.tsx
 D apps/web/src/components/TrustBadge.tsx
 D apps/web/src/components/UpdaterPopup.tsx
 D apps/web/src/components/UseEverywhereModal.tsx
 D apps/web/src/components/WorkingDirPicker.module.css
 D apps/web/src/components/WorkingDirPicker.tsx
 D apps/web/src/components/WorkspaceTabsBar.tsx
 D apps/web/src/components/XaiOAuthControl.tsx
 D apps/web/src/components/agentModelSelection.ts
 D apps/web/src/components/agentOrdering.ts
 D apps/web/src/components/amrLoginPolling.ts
 D apps/web/src/components/auto-open-file.ts
 D apps/web/src/components/byok/ByokConnectionTestControl.tsx
 D apps/web/src/components/byok/ByokKeyField.tsx
 D apps/web/src/components/byok/ByokModelField.tsx
 D apps/web/src/components/byok/ByokProviderBaseUrl.tsx
 D apps/web/src/components/byok/ByokProviderPicker.tsx
 D apps/web/src/components/byok/validation.ts
 D apps/web/src/components/composer-detail-position.ts
 D apps/web/src/components/composer-flyout-placement.ts
 D apps/web/src/components/composer/CaretFloatingLayer.tsx
 D apps/web/src/components/composer/LexicalComposerInput.tsx
 D apps/web/src/components/composer/MentionNode.ts
 D apps/web/src/components/composer/deserialize.ts
 D apps/web/src/components/composer/serialize.ts
 D apps/web/src/components/connectors-events.ts
 D apps/web/src/components/connectors-state.ts
 D apps/web/src/components/design-browser-tools.ts
 D apps/web/src/components/design-files/designArtifacts.ts
 D apps/web/src/components/design-files/pluginFolderActions.ts
 D apps/web/src/components/design-files/pluginFolders.ts
 D apps/web/src/components/design-system-github-evidence.ts
 D apps/web/src/components/design-system-group-order.ts
 D apps/web/src/components/design-system-metadata.ts
 D apps/web/src/components/design-system-project.ts
 D apps/web/src/components/enterpriseUrl.ts
 D apps/web/src/components/file-viewer-render-mode.ts
 D apps/web/src/components/home-hero/EdgeAutoScroll.tsx
 D apps/web/src/components/home-hero/PlaceholderCarousel.tsx
 D apps/web/src/components/home-hero/ScenarioArt.tsx
 D apps/web/src/components/home-hero/TemplatePicker.tsx
 D apps/web/src/components/home-hero/chip-labels.ts
 D apps/web/src/components/home-hero/chips.ts
 D apps/web/src/components/home-hero/firstRunGuide.ts
 D apps/web/src/components/home-hero/media-surfaces.ts
 D apps/web/src/components/home-hero/placeholderScenarios.ts
 D apps/web/src/components/home-hero/plugin-authoring.ts
 D apps/web/src/components/home-hero/sub-chips.ts
 D apps/web/src/components/markdown-scroll-sync.ts
 D apps/web/src/components/modelOptions.tsx
 D apps/web/src/components/pet/DesktopPetSurface.tsx
 D apps/web/src/components/pet/PetOverlay.tsx
 D apps/web/src/components/pet/PetSettings.tsx
 D apps/web/src/components/pet/PetSpriteFace.tsx
 D apps/web/src/components/pet/codexAtlas.ts
 D apps/web/src/components/pet/image.ts
 D apps/web/src/components/pet/pets.ts
 D apps/web/src/components/pet/taskCenter.ts
 D apps/web/src/components/plugin-details/PluginByline.tsx
 D apps/web/src/components/plugin-details/PluginDesignSystemDetail.tsx
 D apps/web/src/components/plugin-details/PluginExampleDetail.tsx
 D apps/web/src/components/plugin-details/PluginMediaDetail.tsx
 D apps/web/src/components/plugin-details/PluginMetaSections.tsx
 D apps/web/src/components/plugin-details/PluginPreviewHero.tsx
 D apps/web/src/components/plugin-details/PluginScenarioDetail.tsx
 D apps/web/src/components/plugin-details/PluginShareMenu.tsx
 D apps/web/src/components/plugin-details/pluginUseMenu.ts
 D apps/web/src/components/plugins-home/PluginCard.tsx
 D apps/web/src/components/plugins-home/cards/DesignSystemSurface.tsx
 D apps/web/src/components/plugins-home/cards/HtmlSurface.tsx
 D apps/web/src/components/plugins-home/cards/MediaSurface.tsx
 D apps/web/src/components/plugins-home/cards/PreviewSurface.tsx
 D apps/web/src/components/plugins-home/cards/TextSurface.tsx
 D apps/web/src/components/plugins-home/curatedPriority.ts
 D apps/web/src/components/plugins-home/duplicate.ts
 D apps/web/src/components/plugins-home/facets.ts
 D apps/web/src/components/plugins-home/localization.ts
 D apps/web/src/components/plugins-home/presetSeedPrompt.ts
 D apps/web/src/components/plugins-home/preview.ts
 D apps/web/src/components/plugins-home/savedPlugins.ts
 D apps/web/src/components/plugins-home/subfacetLabel.ts
 D apps/web/src/components/plugins-home/useActions.ts
 D apps/web/src/components/plugins-home/useInView.ts
 D apps/web/src/components/plugins-home/usePluginFacets.ts
 D apps/web/src/components/plugins-home/visualScore.ts
 D apps/web/src/components/providerModelsCache.ts
 D apps/web/src/components/share-to-community/shareToCommunityPrompt.ts
 D apps/web/src/components/sketch-colors.ts
 D apps/web/src/components/sketch-model.ts
 D apps/web/src/components/use-everywhere/agent-guide.ts
 D apps/web/src/components/use-everywhere/sections.ts
 D apps/web/src/components/useDiscordPresence.ts
 D apps/web/src/components/useGithubStars.ts
 D apps/web/src/components/useOpenFolderImport.ts
 D apps/web/src/components/workspace-context.ts
 D apps/web/src/components/workspace/SideChatTab.module.css
 D apps/web/src/components/workspace/SideChatTab.tsx
 D apps/web/src/components/workspace/TabLauncherMenu.module.css
 D apps/web/src/components/workspace/TabLauncherMenu.tsx
 D apps/web/src/components/workspace/TerminalViewer.module.css
 D apps/web/src/components/workspace/TerminalViewer.tsx
 D apps/web/src/components/workspace/tab-launcher.ts
 D apps/web/src/components/workspace/useConversationChat.ts
 D apps/web/src/design-system-auto-prompt.ts
 D apps/web/src/edit-mode/bridge.ts
 D apps/web/src/edit-mode/source-patches.ts
 D apps/web/src/edit-mode/types.ts
 D apps/web/src/features/libraryUi.ts
 D apps/web/src/hooks/useCoalescedCallback.ts
 D apps/web/src/hooks/useDesignMdState.ts
 D apps/web/src/hooks/useFinalizeProject.ts
 D apps/web/src/hooks/useModalWindowDragGuard.ts
 D apps/web/src/hooks/useProjectDetail.ts
 D apps/web/src/hooks/useTerminalLaunch.ts
 D apps/web/src/i18n/content.ar.ts
 D apps/web/src/i18n/content.es-ES.ts
 D apps/web/src/i18n/content.fa.ts
 D apps/web/src/i18n/content.fr.ts
 D apps/web/src/i18n/content.hu.ts
 D apps/web/src/i18n/content.id.ts
 D apps/web/src/i18n/content.it.ts
 D apps/web/src/i18n/content.ja.ts
 D apps/web/src/i18n/content.ko.ts
 D apps/web/src/i18n/content.pl.ts
 D apps/web/src/i18n/content.pt-BR.ts
 D apps/web/src/i18n/content.ru.ts
 D apps/web/src/i18n/content.th.ts
 D apps/web/src/i18n/content.tr.ts
 D apps/web/src/i18n/content.ts
 D apps/web/src/i18n/content.uk.ts
 D apps/web/src/i18n/content.zh-CN.ts
 D apps/web/src/i18n/index.tsx
 D apps/web/src/i18n/locales/ar.ts
 D apps/web/src/i18n/locales/de.ts
 D apps/web/src/i18n/locales/en.ts
 D apps/web/src/i18n/locales/es-ES.ts
 D apps/web/src/i18n/locales/fa.ts
 D apps/web/src/i18n/locales/fr.ts
 D apps/web/src/i18n/locales/hu.ts
 D apps/web/src/i18n/locales/id.ts
 D apps/web/src/i18n/locales/it.ts
 D apps/web/src/i18n/locales/ja.ts
 D apps/web/src/i18n/locales/ko.ts
 D apps/web/src/i18n/locales/pl.ts
 D apps/web/src/i18n/locales/pt-BR.ts
 D apps/web/src/i18n/locales/ru.ts
 D apps/web/src/i18n/locales/th.ts
 D apps/web/src/i18n/locales/tr.ts
 D apps/web/src/i18n/locales/uk.ts
 D apps/web/src/i18n/locales/zh-CN.ts
 D apps/web/src/i18n/locales/zh-TW.ts
 D apps/web/src/i18n/plugin-content.ts
 D apps/web/src/i18n/runErrors.ts
 D apps/web/src/i18n/types.ts
 D apps/web/src/index.css
 D apps/web/src/lib/build-clipboard-prompt.ts
 D apps/web/src/lib/build-continue-in-cli-toast.ts
 D apps/web/src/lib/copy-to-clipboard.ts
 D apps/web/src/lib/parse-provenance.ts
 D apps/web/src/lib/pod-members.ts
 D apps/web/src/lib/resolve-finalize-request.ts
 D apps/web/src/lib/updater.ts
 D apps/web/src/media/aihubmix-image-models.ts
 D apps/web/src/media/execution-policy.ts
 D apps/web/src/media/models.ts
 D apps/web/src/media/provider-readiness.ts
 D apps/web/src/motion.ts
 D apps/web/src/observability/boot-timing.ts
 D apps/web/src/observability/iframe-error.ts
 D apps/web/src/observability/install.ts
 D apps/web/src/observability/long-task.ts
 D apps/web/src/observability/resource-error.ts
 D apps/web/src/observability/stuck-run.ts
 D apps/web/src/observability/visibility.ts
 D apps/web/src/observability/white-screen.ts
 D apps/web/src/produced-files.ts
 D apps/web/src/providers/aihubmix-compatible.ts
 D apps/web/src/providers/anthropic-compatible.ts
 D apps/web/src/providers/anthropic.ts
 D apps/web/src/providers/api-proxy.ts
 D apps/web/src/providers/azure-compatible.ts
 D apps/web/src/providers/connection-test.ts
 D apps/web/src/providers/daemon.ts
 D apps/web/src/providers/elevenlabs-voices.ts
 D apps/web/src/providers/google-compatible.ts
 D apps/web/src/providers/ollama-compatible.ts
 D apps/web/src/providers/openai-compatible.ts
 D apps/web/src/providers/project-events.ts
 D apps/web/src/providers/provider-models.ts
 D apps/web/src/providers/registry.ts
 D apps/web/src/providers/senseaudio-compatible.ts
 D apps/web/src/providers/sse.ts
 D apps/web/src/quickSwitcherRecents.ts
 D apps/web/src/router.ts
 D apps/web/src/runtime/amr-guidance.ts
 D apps/web/src/runtime/brand-browser-bridge.ts
 D apps/web/src/runtime/brand-enrichment.ts
 D apps/web/src/runtime/brand-intent.ts
 D apps/web/src/runtime/brand-references.json
 D apps/web/src/runtime/brand-references.ts
 D apps/web/src/runtime/brands.ts
 D apps/web/src/runtime/chat-events.ts
 D apps/web/src/runtime/design-kit.ts
 D apps/web/src/runtime/design-md-parse.ts
 D apps/web/src/runtime/design-system-package-audit.ts
 D apps/web/src/runtime/design-toolbox.ts
 D apps/web/src/runtime/exports.ts
 D apps/web/src/runtime/file-ops.ts
 D apps/web/src/runtime/home-intent.ts
 D apps/web/src/runtime/in-project-link.ts
 D apps/web/src/runtime/jsx-module-refs.ts
 D apps/web/src/runtime/kit-edit.ts
 D apps/web/src/runtime/kit-upload.ts
 D apps/web/src/runtime/markdown.tsx
 D apps/web/src/runtime/partial-json.ts
 D apps/web/src/runtime/plugin-source.ts
 D apps/web/src/runtime/react-component.ts
 D apps/web/src/runtime/resume.ts
 D apps/web/src/runtime/shiki.ts
 D apps/web/src/runtime/slide-nav.ts
 D apps/web/src/runtime/srcdoc.ts
 D apps/web/src/runtime/todos.ts
 D apps/web/src/runtime/tool-events.ts
 D apps/web/src/runtime/tool-renderers.ts
 D apps/web/src/runtime/useBrandExtract.ts
 D apps/web/src/runtime/useBrandReadyPrompt.ts
 D apps/web/src/runtime/zip.ts
 D apps/web/src/state/apiProtocols.ts
 D apps/web/src/state/appearance.ts
 D apps/web/src/state/config.ts
 D apps/web/src/state/libraryHandoff.ts
 D apps/web/src/state/litellm-models.json
 D apps/web/src/state/maxTokens.ts
 D apps/web/src/state/mcp.ts
 D apps/web/src/state/onboarding-profile.ts
 D apps/web/src/state/project-locations.ts
 D apps/web/src/state/projects.ts
 D apps/web/src/styles/base.css
 D apps/web/src/styles/chat.css
 D apps/web/src/styles/design-system-flow.css
 D apps/web/src/styles/entrance.css
 D apps/web/src/styles/home/entry-layout.css
 D apps/web/src/styles/home/home-hero.css
 D apps/web/src/styles/home/index.css
 D apps/web/src/styles/home/integrations.css
 D apps/web/src/styles/home/marketplace.css
 D apps/web/src/styles/home/new-project-modal.css
 D apps/web/src/styles/home/plugins-home.css
 D apps/web/src/styles/home/plugins-view.css
 D apps/web/src/styles/home/plus-menu.css
 D apps/web/src/styles/home/recent-projects.css
 D apps/web/src/styles/home/tasks.css
 D apps/web/src/styles/home/use-everywhere.css
 D apps/web/src/styles/modal-window-drag.css
 D apps/web/src/styles/plan-badge.css
 D apps/web/src/styles/primitives.css
 D apps/web/src/styles/remixicon/remixicon.css
 D apps/web/src/styles/shell.css
 D apps/web/src/styles/social-share.css
 D apps/web/src/styles/tokens.css
 D apps/web/src/styles/viewer/code.css
 D apps/web/src/styles/viewer/composio.css
 D apps/web/src/styles/viewer/core.css
 D apps/web/src/styles/viewer/library.css
 D apps/web/src/styles/viewer/memory.css
 D apps/web/src/styles/viewer/pets.css
 D apps/web/src/styles/viewer/plugin-inputs.css
 D apps/web/src/styles/viewer/plugin-rail.css
 D apps/web/src/styles/viewer/routines.css
 D apps/web/src/styles/viewer/templates-plugins.css
 D apps/web/src/styles/viewer/theater.css
 D apps/web/src/styles/viewer/tools.css
 D apps/web/src/styles/workspace/artifacts.css
 D apps/web/src/styles/workspace/connectors.css
 D apps/web/src/styles/workspace/design-browser.css
 D apps/web/src/styles/workspace/design-files.css
 D apps/web/src/styles/workspace/drawer.css
 D apps/web/src/styles/workspace/mention-home.css
 D apps/web/src/styles/workspace/terminal.css
 D apps/web/src/types.ts
 D apps/web/src/utils/agentLabels.ts
 D apps/web/src/utils/apiProtocol.ts
 D apps/web/src/utils/byokProvider.ts
 D apps/web/src/utils/chatTime.ts
 D apps/web/src/utils/connectorBrandColor.ts
 D apps/web/src/utils/fileSystemErrors.ts
 D apps/web/src/utils/imeComposing.ts
 D apps/web/src/utils/inlineMentions.ts
 D apps/web/src/utils/notifications.ts
 D apps/web/src/utils/pickAndImportError.ts
 D apps/web/src/utils/platform.ts
 D apps/web/src/utils/pluginInsertionTracking.ts
 D apps/web/src/utils/pluginRequiredInputs.ts
 D apps/web/src/utils/projectName.ts
 D apps/web/src/utils/promptTemplateDsCategories.ts
 D apps/web/src/utils/smoothScrollToTop.ts
 D apps/web/src/utils/uuid.ts
 D apps/web/src/utils/visibleAgents.ts
 D apps/web/src/utils/visualStability.ts
?? ADS-project-knowledge/reports/swarm-consensus/smoke-tests/2026-07-16T160738Z-claude-discovery.md
?? ADS-project-knowledge/reports/swarm-consensus/smoke-tests/history/
?? ADS-project-knowledge/reports/swarm-consensus/smoke-tests/last-known-good.json
?? apps/web/src
?? apps/web/src.orig/
?? docs/jini-architecture-blind-debate-brief.md
?? docs/jini-open-design-porting-plan.md

 succeeded in 16824ms:
2026-07-16 09:27:36.915 xcodebuild[32506:1021848]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:37.586 xcodebuild[32513:1021918]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:38.507 xcodebuild[32513:1021877] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-7SHLfyA3' (errno=Operation not permitted)
2026-07-16 09:27:40.466 xcodebuild[32536:1022023]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.023 xcodebuild[32546:1022072]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.866 xcodebuild[32546:1022027] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
* integrated 478a8557 refactor(daemon): extract server/bootstrap/start-listener from server.ts
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-D1J9M16Z' (errno=Operation not permitted)
2026-07-16 09:27:47.378 xcodebuild[32641:1022508]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:47.948 xcodebuild[32651:1022566]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:48.446 xcodebuild[32651:1022521] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-awXLXEtZ' (errno=Operation not permitted)
2026-07-16 09:27:49.446 xcodebuild[32668:1022629]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:49.833 xcodebuild[32672:1022681]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:50.332 xcodebuild[32672:1022644] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.

 succeeded in 16871ms:
2026-07-16 09:27:36.885 xcodebuild[32486:1021844]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:37.550 xcodebuild[32511:1021908]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:38.504 xcodebuild[32511:1021867] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-1xj9UGFs' (errno=Operation not permitted)
2026-07-16 09:27:40.552 xcodebuild[32538:1022032]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.110 xcodebuild[32548:1022075]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.873 xcodebuild[32548:1022043] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
  agent/file-viewer-clean                 d907dcefd refactor(web): extract FileViewer's version-history, export-toast, and deck-slide-nav clusters into the file-viewer slice
  agent/file-viewer-continue-ghf          8606c1917 refactor(web): extract FileViewer's version-history, export-toast, and deck-slide-nav clusters into the file-viewer slice
  agent/file-workspace-clean              8ebe9c9ba [origin/main: ahead 24, behind 183] refactor(web): finish FileWorkspace vertical-slice decomposition
  agent/file-workspace-finish             a01ec5ae9 refactor(web): finish FileWorkspace vertical-slice decomposition
  agent/project-view-clusters-15-18       4bd4f0c51 refactor(web): extract ProjectView's design-system workspace audit and picker cluster (15) into the file-viewer slice
  agent/project-view-continue             0d7abe10a docs(web): mark ProjectView brand-browser-assist cluster (13) done in the extraction plan
  agent/project-view-merge-continue       eaee3b110 refactor(web): extract ProjectView's AMR balance-gate dialog state into the project-view slice
  agents-capability-barrel                7e92958b3 [fork/agents-capability-barrel] refactor(daemon): capability-barrel the agents domain
  arch/auth-flat-grouping                 95a8136bb [fork/arch/auth-flat-grouping: ahead 1, behind 165] refactor(daemon): group auth modules into auth/
  arch/brands-capability-barrel           e5c3c1100 refactor(daemon): promote brands capability barrel
  arch/browser-flat-grouping              9d81b71da [fork/arch/browser-flat-grouping] refactor(daemon): group browser bridges into browser/
  arch/chat-run-extraction                780917104 [fork/arch/chat-run-extraction] test(daemon): harden sse-shapes characterization suite per review
  arch/cli-help-flat-grouping             24e949de3 [fork/arch/cli-help-flat-grouping] refactor(daemon): group CLI help-text modules into cli-help/
  arch/config-flat-grouping               d91a08dea [fork/arch/config-flat-grouping: ahead 1, behind 179] refactor(daemon): group app-config.ts + installation.ts into config/
  arch/design-flat-grouping               f51ccb325 [fork/arch/design-flat-grouping] refactor(daemon): group design lifecycle modules into design/
  arch/finalize-capability-barrel         d6d2ee5d6 refactor(daemon): capability-barrel the finalize domain
  arch/migration-flat-grouping            f9668e5ea [fork/arch/migration-flat-grouping] refactor(daemon): group data-migration modules into migration/
  arch/observability-capability-barrel    993a2f38d refactor(daemon): capability-barrel the observability (Langfuse) domain
  arch/plugins-capability-barrel          3c4c71a45 refactor daemon plugins into capability barrel
  arch/plugins-fold-decouple              c1ee35881 [fork/arch/plugins-fold-decouple] refactor(daemon): fold plugin-asset-cache/plugin-preview-bakes into plugins/
  arch/prompt-templates-media-decouple    da7a1c836 [fork/arch/prompt-templates-media-decouple] refactor(daemon): fold prompt-templates into media/
  arch/server-preamble-1                  cc8c26db5 [fork/arch/server-preamble-1] test(daemon): restore OD_DATA_DIR/OD_AGENT_HOME after the SSE-shapes suite
  arch/server-preamble-2                  e38e2b593 [fork/arch/server-preamble-2] refactor(daemon): extract assistant-message persistence from server.ts
  arch/server-slice-5                     f1aabe9e5 refactor(daemon): dissolve the startServer god-function into feature modules
  arch/server-startserver-endgame         f1aabe9e5 [fork/arch/server-startserver-endgame] refactor(daemon): dissolve the startServer god-function into feature modules
  arch/skills-capability-barrel           878029056 refactor(daemon): capability-barrel the skills domain
  arch/split-tools-connectors-cli         b5c051088 [fork/arch/split-tools-connectors-cli] refactor(daemon): split tools-connectors-cli god-file into a capability-barrel module
  automation-capability-barrel            174fdf7bc fix(daemon): repoint plugin subcommand dynamic imports after cli split
  cli-capability-barrels                  94832936c fix(daemon): repoint plugin subcommand dynamic imports after cli split
  codex-capability-barrel                 9eaf81b8a refactor(daemon): capability-barrel the codex domain
+ codex/fix-pr-5088                       5bf0cd99c (/private/tmp/open-design-pr-5088) refactor(daemon): route public-surface design-system tests through the barrel
+ codex/fix-pr-5128                       390e9e648 (/private/tmp/open-design-pr-5128) [fork/arch/chat-run-extraction: ahead 86, behind 4] test(daemon): harden sse-shapes characterization suite per review
+ codex/fix-pr-5132                       cc8c26db5 (/private/tmp/open-design-pr-5132) test(daemon): restore OD_DATA_DIR/OD_AGENT_HOME after the SSE-shapes suite
+ codex/fix-pr-5139                       e0bc76d1b (/private/tmp/open-design-pr-5139) fix(daemon): update pipeline test run import
+ codex/fix-pr-5149                       64eeac241 (/private/tmp/open-design-pr-5149) refactor(daemon): capability-barrel the telemetry domain
+ codex/fix-pr-5151                       ff9988df5 (/private/tmp/open-design-pr-5151) refactor(daemon): capability-barrel the export domain
+ codex/fix-pr-5164                       ebdb38188 (/private/tmp/open-design-pr-5164) fix(guard): resolve .mjs/.cjs imports extension-specifically
+ codex/fix-pr-5189                       2988f8deb (/private/tmp/open-design-pr-5189) fix(daemon): correct config migration import
+ codex/fix-pr-5190                       6d6f36440 (/private/tmp/open-design-pr-5190) test(daemon): update tool token startup import
+ codex/fix-pr-5228                       e05c1cda3 (/private/tmp/open-design-pr-5228) fix(web): fix the general invariant behind the last four review findings
  design-systems-capability-barrels       aee695013 [fork/design-systems-capability-barrels: ahead 2, behind 208] refactor(daemon): route public-surface design-system tests through the barrel
  export-capability-barrel                bd102811d Merge remote-tracking branch 'origin/main' into export-capability-barrel
  feat/agent-ready-contracts              008ce33f8 [fork/feat/agent-ready-contracts] fix(contracts): address review — narrow search result to api-only; distinct browser vs api call paths
  feat/agent-tools-slice-2                7fb1698e0 [origin/main: ahead 1, behind 115] feat(daemon,web): add browser-actions capability with a new agent-tools package
  fws-reconcile-tmp                       a01ec5ae9 refactor(web): finish FileWorkspace vertical-slice decomposition
  guard/ts-nocheck-unresolved-imports     e9141181a [fork/guard/ts-nocheck-unresolved-imports: ahead 2, behind 152] fix(guard): resolve .mjs/.cjs imports extension-specifically
  integrated                              478a85577 [fork/integrated: ahead 11] refactor(daemon): extract server/bootstrap/start-listener from server.ts
  integrated-trunk                        ab81a954a [fork/integrated-trunk: ahead 1] docs(agents): require full island shape + Sonnet-4.6 doc delegation in refactor workflow
  integration/barrels-preview             216cc01cf Merge branch 'agents-capability-barrel' into integration/barrels-preview
  library-capability-barrel               8c75dbfba [fork/library-capability-barrel] fix(daemon): repoint plugin subcommand dynamic imports after cli split
  local-web-automations-slice             0332d220a [fork/refactor/web-automations-slice] refactor(web): close two Phase 8.5 leaks, reach true 100% branch coverage
  local-web-file-viewer-slice             78abff31a [fork/refactor/web-file-viewer-slice: behind 3] refactor(web): extract the deploy modal's per-link copy feedback into the file-viewer slice
  local-web-file-workspace-slice          a7f7dadb8 [fork/refactor/web-file-workspace-slice: behind 18] refactor(web): move sketch/tab-bar pure helpers into the file-workspace slice
  local-web-handoff-slice                 7615f1ea9 [fork/refactor/web-handoff-slice] refactor(web): close the coverage/audit loop and complete the handoff slice
  local-web-project-view-slice            a190b21cc [fork/refactor/web-project-view-slice] refactor(web): fold ProjectView's project-rename handler into useProjectActions
  local-web-settingsdialog-slice          3e9783fc1 [fork/refactor/web-settingsdialog-slice: behind 13] refactor(web): extract the AMR-card highlight nudge into the features/settings vertical slice
  main                                    4567a0d57 [origin/main: behind 115] fix(daemon): import scanRunEventsForUsageAnalytics for devloop token reconciliation (#5434)
  mcp-capability-barrel                   9bbf0b7ec [fork/mcp-capability-barrel] refactor(daemon): capability-barrel the mcp domain
  memory-capability-barrel                5d9cf7267 fix(daemon): repoint plugin subcommand dynamic imports after cli split
  project-capability-barrel               6068b335e refactor(daemon): capability-barrel the project domain
  refactor/agent-protocol-barrel          e26a7764c [fork/refactor/agent-protocol-barrel] fix(daemon): repoint verify-amr-real-vela script to the agent-protocol barrel
  refactor/contracts-metadata-block       5a14f6592 [origin/main: ahead 1, behind 257] refactor(contracts): decompose renderMetadataBlock into per-concern helpers
  refactor/db-barrel                      be33bd4f9 [fork/refactor/db-barrel] refactor(daemon): split db.ts god-file into capability-barrel db/ module
  refactor/download-barrel-split          ed3feb5f7 refactor(download): split index.ts into cohesive sibling modules (part of #5165)
  refactor/events-barrel-split            06c30c484 refactor(contracts): split analytics events.ts into per-concern barrel
  refactor/host-barrel-split              567b667ac refactor(host): split index.ts into cohesive sibling modules (part of #5165)
  refactor/langfuse-trace-barrel          948d21645 [fork/refactor/langfuse-trace-barrel] refactor(daemon): split langfuse-trace.ts god-file into a capability-barrel module
  refactor/platform-barrel-split          41158545b refactor(platform): split index.ts god-file into cohesive sibling modules
  refactor/plugin-runtime-helpers         a4cef0b4d [origin/main: ahead 3, behind 257] refactor(plugin-runtime): extract block-scalar and inline-array helpers from parseYamlSubset
  refactor/sidecar-barrel-split           5588e80aa refactor(sidecar): split index.ts into cohesive sibling modules (part of #5165)
  refactor/sidecar-proto-barrel-split     c2c218240 refactor(sidecar-proto): split index.ts into cohesive sibling modules (part of #5165)
  refactor/web-chat-composer-slice        dd5c32b9b refactor(web): chat-pane slice - extract nextUserContentByAssistantId derivation
  refactor/web-chat-composer-slice-pr     99c9134ea [origin/main: ahead 1, behind 125] refactor(web): decompose ChatComposer.tsx into a features/chat-composer vertical slice
  refactor/web-chat-pane-slice            58fe43587 [origin/main: ahead 1, behind 125] refactor(web): decompose ChatPane.tsx into a features/chat-pane vertical slice
  refactor/web-file-viewer-slice          72f1ec007 [fork/refactor/web-file-viewer-slice: ahead 6] refactor(web): extract the share-menu popover into a dumb ShareMenu component
  refactor/web-file-viewer-slice-clusterb bea1d3cd7 refactor(web): extract HtmlViewer's analytics fire-helpers into the file-viewer slice
  refactor/web-mcp-client-slice           e290acc20 refactor(web): decompose McpClientSection into a features/mcp-client vertical slice
  refactor/web-memmodel-transport         290340291 refactor(web): route MemoryModelInline through the providers/memory transport home
* refactor/web-memory-slice               f65eea034 [fork/refactor/web-memory-slice: behind 1] fix(web): fix 3 nettee bugs, 2 self-found races, push memory-slice coverage to ~97%
  run-capability-barrel                   6355d495a [fork/run-capability-barrel: ahead 6, behind 107] Merge origin/main into run-capability-barrel
  settings-finish                         69c1e0775 [fork/refactor/web-settingsdialog-slice: behind 26] refactor(web): start a features/settings vertical slice (leaked helpers + ConnectorSection)
  telemetry-capability-barrel             f6c81f781 refactor(daemon): capability-barrel the telemetry domain
  worktree-agent-a177e38285954d513        4567a0d57 fix(daemon): import scanRunEventsForUsageAnalytics for devloop token reconciliation (#5434)
  worktree-agent-a177e99dbbd88eb4f        af5ce8745 fix(integrated): repair @ts-nocheck-masked broken imports + extract server/events (slice-5a)
  worktree-agent-a1c238efb77b6afe4        f24bda9c9 fix(home): drop letterbox band on deck example-prompt previews (#5105)
  worktree-agent-a3813d509b49e2d63        f24bda9c9 fix(home): drop letterbox band on deck example-prompt previews (#5105)
  worktree-agent-a40f6d5580d23dcaf        af5ce8745 fix(integrated): repair @ts-nocheck-masked broken imports + extract server/events (slice-5a)
  worktree-agent-a45529b2428b8cd81        4567a0d57 fix(daemon): import scanRunEventsForUsageAnalytics for devloop token reconciliation (#5434)
  worktree-agent-a4ee478df8fcf44ac        4567a0d57 fix(daemon): import scanRunEventsForUsageAnalytics for devloop token reconciliation (#5434)
  worktree-agent-a57935d6b94817286        409c123bb fix(daemon): stop local CLI auth probes misclassifying valid auth (#4632)
  worktree-agent-a7141b8b017c5e589        4567a0d57 fix(daemon): import scanRunEventsForUsageAnalytics for devloop token reconciliation (#5434)
  worktree-agent-a97a2537a5339f2f1        409c123bb fix(daemon): stop local CLI auth probes misclassifying valid auth (#4632)
  worktree-agent-a9b2f487efd9ea515        f24bda9c9 fix(home): drop letterbox band on deck example-prompt previews (#5105)
  worktree-agent-aa4ecef2dc59709c4        4567a0d57 fix(daemon): import scanRunEventsForUsageAnalytics for devloop token reconciliation (#5434)
  worktree-agent-ab8693b02ac43d625        f24bda9c9 fix(home): drop letterbox band on deck example-prompt previews (#5105)
  worktree-agent-ac6dd1a1be97d8abc        4567a0d57 fix(daemon): import scanRunEventsForUsageAnalytics for devloop token reconciliation (#5434)
  worktree-agent-ad0da37da73cea360        4567a0d57 fix(daemon): import scanRunEventsForUsageAnalytics for devloop token reconciliation (#5434)
  worktree-agent-af4d628a9dff58f76        4567a0d57 fix(daemon): import scanRunEventsForUsageAnalytics for devloop token reconciliation (#5434)
  worktree-agent-af6b2a161e1dd2ab9        af5ce8745 fix(integrated): repair @ts-nocheck-masked broken imports + extract server/events (slice-5a)
  worktree-agent-afd82f51a0ef08123        af5ce8745 fix(integrated): repair @ts-nocheck-masked broken imports + extract server/events (slice-5a)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-4H16FTPg' (errno=Operation not permitted)
2026-07-16 09:27:47.413 xcodebuild[32646:1022514]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:47.941 xcodebuild[32653:1022564]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:48.445 xcodebuild[32653:1022527] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-l79G46IL' (errno=Operation not permitted)
2026-07-16 09:27:49.446 xcodebuild[32667:1022631]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:49.833 xcodebuild[32671:1022680]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:50.332 xcodebuild[32671:1022645] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
  fork/accidental-bolt
  fork/add-codex-interactive-capability-map
  fork/add-twitter-badge
  fork/adventurous-sleep
  fork/afk/afk-b377f4be-buana9
  fork/agent-pr-explore-artifacts-pr-2946-c46ca2b0
  fork/agent-runtime
  fork/agent/file-viewer-clean
  fork/agent/file-workspace-clean
  fork/agent/file-workspace-finish
  fork/agent/project-view-clusters-15-18
  fork/agent/project-view-continue
  fork/agent/project-view-merge-continue
  fork/agents-capability-barrel
  fork/agents-ts
  fork/amr-model-preset
  fork/amr-model-preset-v0.9.0
  fork/amr-open-design-trace-env
  fork/amr-profile
  fork/arch/auth-flat-grouping
  fork/arch/brands-capability-barrel
  fork/arch/browser-flat-grouping
  fork/arch/chat-run-extraction
  fork/arch/cli-help-flat-grouping
  fork/arch/config-flat-grouping
  fork/arch/design-flat-grouping
  fork/arch/migration-flat-grouping
  fork/arch/observability-capability-barrel
  fork/arch/plugins-capability-barrel
  fork/arch/plugins-fold-decouple
  fork/arch/prompt-templates-media-decouple
  fork/arch/server-preamble-1
  fork/arch/server-preamble-2
  fork/arch/server-startserver-endgame
  fork/arch/split-tools-connectors-cli
  fork/artifacts/pr-4737-review-screenshots-e22a1ca
  fork/assets/maintainer-posters
  fork/astonishing-reindeer
  fork/automation-capability-barrel
  fork/automation/blog-indexing-status
  fork/automation/refresh-contributors-wall
  fork/backport-4656-to-release/v0.12.0
  fork/backport-4665-to-release/v0.12.0
  fork/backport-4668-to-release/v0.12.0
  fork/backport-4670-to-release/v0.12.0
  fork/backport-4691-to-release/v0.12.0
  fork/backport-4771-to-release/v0.13.0
  fork/backport-4928-to-release/v0.13.0
  fork/backport-4946-to-release/v0.13.0
  fork/backport-4984-to-release/v0.13.0
  fork/backport-4993-to-release/v0.13.0
  fork/backport-5037-to-release/v0.13.0
  fork/backport/splash-video-rel
  fork/backup/release-v0.10.0-20260610-prerecut
  fork/beta/langfuse-report-hook-smoke
  fork/blacksmith-migration-1867a9f
  fork/bot-author
  fork/bot-cards
  fork/bot/fix-issue-646-acp-timeout
  fork/brassy-hip
  fork/cherry-pick/desktop-os-locale-detect-v0.8.0
  fork/cherry-pick/feedback-show-on-all-completed-turns-v0.8.0
  fork/cherry/deck-queue-autopage-v0.10.0
  fork/cherry/generation-preview-design-files-tab-v0.10.0
  fork/childlike-war
  fork/chore/add-flowai-live-dashboard-template
  fork/chore/agent-mocks-from-langfuse
  fork/chore/agent-pr-explore-placeholder
  fork/chore/agent-pr-explore-r2-env
  fork/chore/back-merge-v0.9.0
  fork/chore/backmerge-release-qa-0.10.0
  fork/chore/build-optimizations-followup
  fork/chore/bump-0.10.2
  fork/chore/bump-main-0.10.2
  fork/chore/bump-main-0.12.1-ahead-of-stable
  fork/chore/bump-v0.10.0
  fork/chore/bump-vela-cli-0.0.16
  fork/chore/bump-vela-cli-0.0.2
  fork/chore/bump-vela-cli-0.0.6
  fork/chore/codex-exec-path-fix
  fork/chore/curate-featured-top-10
  fork/chore/discord-issue-forum-webhook
  fork/chore/docs-environment-refresh
  fork/chore/docs-structure-cleanup
  fork/chore/e2e-entry-ci-alignment
  fork/chore/e2e-entry-redesign-alignment
  fork/chore/e2e-extended-hardening
  fork/chore/e2e-smoke-hardening
  fork/chore/e2e-test-gating
  fork/chore/entry-test-coverage
  fork/chore/extended-playwright-stabilization
  fork/chore/feishu-nightly-on-release-0.9.0
  fork/chore/feishu-notify-on-release-0.9.0
  fork/chore/fork-pr-workflow-approval
  fork/chore/garnet-namespace-alignment
  fork/chore/gha-runtime-optimization
  fork/chore/mac-signing-perf-audit
  fork/chore/main-directory-align-refresh
  fork/chore/manual-agent-pr-explore
  fork/chore/nightly-ui-e2e-2026-05-10
  fork/chore/nightly-ui-e2e-2026-05-10-pr
  fork/chore/official-content-i18n
  fork/chore/plugin-previews
  fork/chore/plugin-previews-27213195032
  fork/chore/plugin-previews-27229730437
  fork/chore/plugin-previews-27248137135
  fork/chore/plugin-previews-27256294412
  fork/chore/plugin-previews-27468987030
  fork/chore/plugin-previews-27607068861
  fork/chore/plugin-previews-27612329182
  fork/chore/plugin-previews-27625621044
  fork/chore/plugin-previews-27641528949
  fork/chore/plugin-previews-27662803525
  fork/chore/plugin-previews-27676233040
  fork/chore/plugin-previews-27781691191
  fork/chore/plugin-previews-27842444445
  fork/chore/plugin-previews-27879979493
  fork/chore/plugin-previews-28006448653
  fork/chore/plugin-previews-automerge
  fork/chore/pr-fixes-link-discipline
  fork/chore/prebundle-artifact-size-research
  fork/chore/readme-0.8.0-preview-banner
  fork/chore/release-beta-isomorphism
  fork/chore/release-beta-report-mac-signing
  fork/chore/release-beta-spec-reports
  fork/chore/release-beta-windows-signing
  fork/chore/release-stable-nightly-gate
  fork/chore/remove-automations-ingest-source-v0.8.0
  fork/chore/remove-html-ppt-studio-family
  fork/chore/remove-shamoni-example
  fork/chore/split-large-source-files
  fork/chore/tools-dev-usability-temp
  fork/chore/tools-pr-retirement
  fork/chore/ui-e2e-automation-suite
  fork/chore/v0.8.0-now-in-main-doc-update
  fork/chore/vela-cli-0.0.8
  fork/chore/vela-cli-0.0.9-v0.9.0
  fork/chore/windows-package-optimization
  fork/chore/zh-cn-readme-trim-byok-fallback
  fork/ci/agent-pr-explore-case-status-emoji
  fork/ci/agent-pr-explore-codex-agent
  fork/ci/agent-pr-explore-comment-trigger
  fork/ci/agent-pr-explore-docker-pull-fallback
  fork/ci/agent-pr-explore-gh-retry
  fork/ci/agent-pr-explore-lightweight-checkout
  fork/ci/agent-pr-explore-npm-mirror
  fork/ci/agent-pr-explore-prompt-finalize
  fork/ci/agent-pr-explore-provision-runner
  fork/ci/agent-pr-explore-skip-comment
  fork/ci/agent-pr-explore-slim-and-report
  fork/ci/agent-pr-explore-ssh-host-fetch
  fork/ci/agent-prompt-non-lazy
  fork/ci/feishu-unify-daily-into-release
  fork/ci/finalize-release-bump-main
  fork/ci/landing-staging-gate
  fork/ci/nix-validation-non-blocking-on-pr
  fork/ci/release-branch-direct-pr-guard
  fork/claude/blissful-feistel-a59585
  fork/claude/blissful-feistel-a59585-pr2
  fork/claude/exciting-elgamal-a4beec
  fork/claude/pedantic-tu-1fb3da
  fork/cli-capability-barrels
  fork/codex-capability-barrel
  fork/codex-wrapper
  fork/codex/20260601-launch-contract
  fork/codex/acp-upstream-error-events
  fork/codex/active-design-system-prompt-test-fix
  fork/codex/active-design-system-visual-direction
  fork/codex/add-codebuddy-pet
  fork/codex/agent-browser-cdp-startup
  fork/codex/agent-cli-contract-registry
  fork/codex/ai-native-observability-loop-spec
  fork/codex/amr-acp-error-propagation
  fork/codex/amr-acp-progress-status
  fork/codex/amr-artifact-suppression
  fork/codex/amr-attachment-staging
  fork/codex/amr-cancel-main
  fork/codex/amr-client-structured-errors
  fork/codex/amr-cloud-recovery
  fork/codex/amr-cloud-recovery-fresh
  fork/codex/amr-cloud-recovery-main-20260623
  fork/codex/amr-config-path-dot-amr
  fork/codex/amr-frontend-optimizations
  fork/codex/amr-frontend-pr-2355
  fork/codex/amr-hide-opencode-bootstrap-logs
  fork/codex/amr-image-attachments-acp-forwarding
  fork/codex/amr-insufficient-balance-recharge
  fork/codex/amr-insufficient-balance-recharge-main
  fork/codex/amr-jump-optimization
  fork/codex/amr-link-catalog-models
  fork/codex/amr-link-startup-resilience
  fork/codex/amr-link-startup-resilience-main
  fork/codex/amr-live-models-dot-amr
  fork/codex/amr-onboarding-card-polish
  fork/codex/amr-opencode-error-presentation
  fork/codex/amr-packaged-env-forwarding
  fork/codex/amr-runtime-acp-main-pr
  fork/codex/amr-runtime-acp-p0-issues-2-3-4
  fork/codex/amr-runtime-acp-zoom-out
  fork/codex/amr-send-preflight-intercept
  fork/codex/amr-startup-defaults
  fork/codex/amr-stderr-balance-main
  fork/codex/amr-traffic-conversion-attribution
  fork/codex/amr-vela-cli-0.0.2
  fork/codex/amr-vela-cli-0.0.3-test.1
  fork/codex/amr-wallet-auth-redirect
  fork/codex/amr-wallet-balance
  fork/codex/amr-wallet-balance-v2
  fork/codex/amr-wallet-link-dedup
  fork/codex/attribution-phase1
  fork/codex/auto-open-produced-html
  fork/codex/auto-update-task-init
  fork/codex/backport-3439-release-v0.10.0
  fork/codex/backport-4691-release-v0.12.0
  fork/codex/backport-onboarding-lang-menu-release-v0.12.0
  fork/codex/backport-same-run-retry-runtime-0.10.0
  fork/codex/blacksmith-4vcpu-job-probe
  fork/codex/brand-extraction-terminal-status
  fork/codex/brand-kit-preview-lifecycle
  fork/codex/browser-comment-live-position
  fork/codex/bump-0.8.1-beta-base
  fork/codex/bump-vela-cli-0.0.10
  fork/codex/bump-vela-cli-0.0.13
  fork/codex/bump-vela-cli-0.0.14
  fork/codex/bump-vela-cli-0.0.19
  fork/codex/bump-vela-cli-0.0.4-test.0
  fork/codex/byok-opencode-agent
  fork/codex/byok-pr-a-validation
  fork/codex/byok-pr-b-key-field
  fork/codex/byok-pr-c-model-fetch-clean
  fork/codex/byok-pr-d-byok-ia
  fork/codex/byok-pr-metrics
  fork/codex/byok-pr0-structure-extract
  fork/codex/byok-provider-presets
  fork/codex/chat-comments-main
  fork/codex/chat-queue-code-comments
  fork/codex/chat-queue-send
  fork/codex/ci-alert-triage
  fork/codex/ci-efficiency-optimization
  fork/codex/ci-hot-full-mode
  fork/codex/ci-nix-lane
  fork/codex/ci-test-optimization
  fork/codex/ci-wall-time-under-10
  fork/codex/claude-artifact-echo-fix
  fork/codex/claude-design-system-workflow
  fork/codex/claude-resume-missing-retry
  fork/codex/clean-e2e-risk-coverage
  fork/codex/clean-object-manifest-reasons
  fork/codex/clear-applied-updater-state
  fork/codex/cli-first-artifact-handoff
  fork/codex/close-home-mention-details
  fork/codex/codex-stream-newline-boundary
  fork/codex/codex-thinking-status
  fork/codex/comment-data-api
  fork/codex/connector-memory-settings
  fork/codex/contabo-runner-01-poc
  fork/codex/critical-gate-rebalance
  fork/codex/cursor-agent-auth-diagnostics
  fork/codex/daemon-diagnostics-coverage
  fork/codex/dark-mode-card-tokens
  fork/codex/dedupe-tool-use-events
  fork/codex/defer-skill-plugin-cta
  fork/codex/delivery-completion-check
  fork/codex/delivery-contract-guard
  fork/codex/delivery-progress-tracking
  fork/codex/derive-object-relay-url
  fork/codex/design-system-2-backfill-batch-01
  fork/codex/design-system-2-backfill-batch-02
  fork/codex/design-system-2-backfill-batch-03
  fork/codex/design-system-2-backfill-batch-04
  fork/codex/design-system-2-backfill-batch-05
  fork/codex/design-system-2-backfill-batch-06
  fork/codex/design-system-2-backfill-batch-07
  fork/codex/design-system-2-backfill-batch-08
  fork/codex/design-system-2-backfill-batch-09
  fork/codex/design-system-2-backfill-batch-10
  fork/codex/design-system-2-backfill-plan
  fork/codex/design-system-2-undeclared-token-cleanup
  fork/codex/design-system-default-manifest
  fork/codex/design-system-github-handoff
  fork/codex/design-system-home-polish
  fork/codex/design-system-import-combined
  fork/codex/design-system-import-pr0
  fork/codex/design-system-import-pr1
  fork/codex/design-system-import-pr2
  fork/codex/design-system-import-pr4
  fork/codex/design-system-import-pr5
  fork/codex/design-system-import-pr6
  fork/codex/design-system-local-importer
  fork/codex/design-system-manifest-runtime
  fork/codex/design-system-project-contract
  fork/codex/design-system-source-flow-polish
  fork/codex/design-system-source-flow-polish-pr
  fork/codex/design-systems-gallery-settings
  fork/codex/desktop-auto-update
  fork/codex/diagram-plugin-v1
  fork/codex/disable-codex-plugins-env
  fork/codex/discord-feedback-cta
  fork/codex/download-pid-reuse-lock
  fork/codex/draw
  fork/codex/draw-worktree
  fork/codex/ds-derived-outputs-pr3
  fork/codex/ds-token-contract-importer-pr1
  fork/codex/ds-token-contract-rebuild-pr2
  fork/codex/ds-token-extraction-fix
  fork/codex/e2e-agents-fixture-cleanup
  fork/codex/e2e-entry-modal-followup
  fork/codex/e2e-priority-main-ci-alerts
  fork/codex/edit-individual-group-elements
  fork/codex/expand-project-onboarding-coverage
  fork/codex/failure-classification-drilldown
  fork/codex/fanzhen-0.13-ui
  fork/codex/fanzhen-share-to-od-next-step
  fork/codex/feishu-alert-smoke-test
  fork/codex/fix-amr-cli-card-labels
  fork/codex/fix-artifact-blank-screens
  fork/codex/fix-assistant-agent-label
  fork/codex/fix-attachment-delete-rerun-blank
  fork/codex/fix-brand-kit-modal-intent
  fork/codex/fix-browser-use-search-focus
  fork/codex/fix-claude-tool-use-usage-terminal
  fork/codex/fix-composer-byok-model-switch
  fork/codex/fix-composio-oauth-launch-cancel
  fork/codex/fix-connector-refresh
  fork/codex/fix-daemon-run-reload-recovery
  fork/codex/fix-deck-keyboard-double-step
  fork/codex/fix-ds-modal-layer
  fork/codex/fix-ds-review-toc-overlay
  fork/codex/fix-file-preview-panel-layout
  fork/codex/fix-home-example-prompts
  fork/codex/fix-home-layout-file-list
  fork/codex/fix-home-mention-catalog-search
  fork/codex/fix-home-style-picker-duplicate-key
  fork/codex/fix-image-export-capture
  fork/codex/fix-image-export-menu-capture
  fork/codex/fix-image-export-tab-save-flicker
  fork/codex/fix-langfuse-posthog-closure
  fork/codex/fix-langfuse-report-context
  fork/codex/fix-main-amr-onboarding-ci
  fork/codex/fix-main-p0-alert-followup
  fork/codex/fix-main-p0-e2e
  fork/codex/fix-newsletter-od-cors
  fork/codex/fix-newsletter-ui
  fork/codex/fix-official-plugin-skill-catalog
  fork/codex/fix-onboarding-dropdown-style
  fork/codex/fix-onboarding-home-flash
  fork/codex/fix-onboarding-language-menu
  fork/codex/fix-opencode-todowrite-footer
  fork/codex/fix-packaged-mac-dock-sidecar
  fork/codex/fix-plugin-preview-new-tab-assets
  fork/codex/fix-plugin-reference-after-send
  fork/codex/fix-preview-modal-image-export
  fork/codex/fix-preview-share-explicit-url
  fork/codex/fix-preview-ui-panels
  fork/codex/fix-project-file-link-routing
  fork/codex/fix-project-instructions-modal-layer
  fork/codex/fix-prompt-title-summary
  fork/codex/fix-reference-search-focus
  fork/codex/fix-resume-test-cleanup
  fork/codex/fix-run-finished-project-kind
  fork/codex/fix-social-template-en-description
  fork/codex/fix-staged-attachment-e2e
  fork/codex/fix-tab-state-resets
  fork/codex/fix-uk-duplicate-prompt-template-keys
  fork/codex/fix-uk-prompt-template-keys
  fork/codex/fix-use-with-query-scroll
  fork/codex/fix-viewer-modal-layering
  fork/codex/fix-viewer-share-menu-z
  fork/codex/fix-vite-html-export
  fork/codex/fix-windows-release-smoke-pnpm
  fork/codex/fix-windows-release-smoke-portable-update-root
  fork/codex/from-0.8-preview-c835
  fork/codex/from-0.8.0-preview-local
  fork/codex/harden-backport-automerge
  fork/codex/hide-chat-plugin-use-action
  fork/codex/hide-external-browser-annotation-tools
  fork/codex/hide-terminal-browser-entrypoints
  fork/codex/home-audio-essential-workflow
  fork/codex/home-handoff-share-polish
  fork/codex/home-manus-prompt-presets
  fork/codex/home-mention-popover-dismiss
  fork/codex/home-mention-validation-assets-20260609
  fork/codex/home-mode-popover-left
  fork/codex/home-prototype-highlight
  fork/codex/home-settings-regression-hardening
  fork/codex/home-starter-artifact-categories
  fork/codex/home-use-scroll-top
  fork/codex/issue-1288-chat-pane-feedback
  fork/codex/issue-2219-updater-ui
  fork/codex/issue-3578-langfuse-phase2
  fork/codex/issue-564-claude-diagnostics
  fork/codex/kimi-gemini-runtime-triage
  fork/codex/landing-amr-signin
  fork/codex/landing-download-live-version
  fork/codex/landing-page-google-analytics
  fork/codex/landing-page-optimization
  fork/codex/landing-page-optimization-20260702
  fork/codex/landing-qa-feishu-summary
  fork/codex/landing-release-metadata-downloads
  fork/codex/langfuse-failure-classification
  fork/codex/langfuse-observability-attribution
  fork/codex/langfuse-prompt-blame
  fork/codex/langfuse-prompt-stack-spec
  fork/codex/launcher-integration
  fork/codex/launcher-system-reimplementation
  fork/codex/local-cli-explicit-api-keys
  fork/codex/local-cli-explicit-api-keys-main
  fork/codex/local-env-telemetry
  fork/codex/local-preview-annotation-main
  fork/codex/main-amr-action-row-guard
  fork/codex/main-amr-card-polish
  fork/codex/main-design-system-ui-polish
  fork/codex/main-onboarding-brand-cleanup
  fork/codex/main-p0-ci-feishu-dedupe
  fork/codex/main-p0-ci-feishu-dedupe-gh
  fork/codex/main-risk-test-coverage
  fork/codex/make-same-copy
  fork/codex/manual-edit-mode
  fork/codex/mention-popover-stable-height
  fork/codex/merge-artifact-telemetry-into-content
  fork/codex/message-rendering-runtime
  fork/codex/newsletter-welcome-email
  fork/codex/normal-artifact-create
  fork/codex/od-data-dir-docs
  fork/codex/onboarding-amr-login-cancel
  fork/codex/onboarding-brand-actions-tab-width
  fork/codex/onboarding-brand-extraction-main
  fork/codex/onboarding-byok-auto-checks
  fork/codex/onboarding-cli-scan-cache
  fork/codex/onboarding-full-latest
  fork/codex/onboarding-no-amr
  fork/codex/onboarding-page-optimization
  fork/codex/onboarding-starter-flow
  fork/codex/open-design-runs-on-json-contract
  fork/codex/open-design-visual-refresh
  fork/codex/open-design-website-optimization
  fork/codex/optimization-20260630
  fork/codex/optimize-error-card-source-info
  fork/codex/package-amr-wallet-main
  fork/codex/packaged-runtime-deps
  fork/codex/pet-rail-style-preview-v0.8.0
  fork/codex/pick-pr-4952-to-main
  fork/codex/plugin-context-clear-e2e-assets
  fork/codex/plugin-form-clears-on-mention-removal
  fork/codex/ppt-keyboard-pagination-p1
  fork/codex/pr-2355-cli-scan-loading
  fork/codex/pr-2355-onboarding
  fork/codex/pr-2400-without-folder-pickers
  fork/codex/pr-3509-structure-prototype
  fork/codex/pr-3685-assets
  fork/codex/pr-4260-extraction-state-fixes
  fork/codex/pr-4423-settings-update
  fork/codex/pr1350-manual-edit-fixes
  fork/codex/pr4740-release-ds-tracking
  fork/codex/pr4768-main-ds-tracking
  fork/codex/prefetch-page-preview
  fork/codex/preserve-structured-daemon-errors
  fork/codex/preview-comment-ui
  fork/codex/pricing-page
  fork/codex/primary-artifact-preview-drawer
  fork/codex/primary-artifact-preview-drawer-pr
  fork/codex/production-trace-object-authority
  fork/codex/project-back-home
  fork/codex/project-ui-refresh-polish
  fork/codex/promote-opencode-role-marker-errors
  fork/codex/question-form-banner-editable
  fork/codex/readme-comment-partial
  fork/codex/recover-critique-theater-stack
  fork/codex/refine-cli-picker-controls-main
  fork/codex/register-release-prerelease-workflow
  fork/codex/release-amr-card-action-row
  fork/codex/release-beta-s-install-guard
  fork/codex/release-beta-s-mac-arm64
  fork/codex/release-beta-s-placeholder
  fork/codex/release-beta-s-windows-error
  fork/codex/release-design-system-ui-polish
  fork/codex/release-download-image-toast-offset
  fork/codex/release-error-diagnostics-copy
  fork/codex/release-present-tab-offset
  fork/codex/release-preview-comment-queue
  fork/codex/release-preview-placeholder
  fork/codex/release-question-form-live-code
  fork/codex/release-smoke-seed-onboarding
  fork/codex/release-stable-launcher
  fork/codex/release-stable-manual-version
  fork/codex/release-stable-notes-public-origin
  fork/codex/release-stable-publish-mode
  fork/codex/release-theme-color-bug
  fork/codex/release-v0.8.0-auto-update-fixes
  fork/codex/release-v080-mac-ready-updater
  fork/codex/release-v080-mac-updater-rail-ready
  fork/codex/release-v080-update-observability
  fork/codex/release-v080-win-smoke-update-root
  fork/codex/remove-main-push-ci
  fork/codex/remove-project-instructions-and-stream-error-fix
  fork/codex/remove-studio-action-icons
  fork/codex/remove-unsure-budget-option
  fork/codex/rename-ci-workflows
  fork/codex/rename-share-to-export
  fork/codex/restore-chat-message-roles
  fork/codex/restore-preview-edit-module
  fork/codex/retry-policy-transient-suppression
  fork/codex/retry-preserve-run-state
  fork/codex/revert-amr-wallet-balance
  fork/codex/rich-design-system-chip-preview
  fork/codex/run-failure-classification
  fork/codex/run-lifecycle-tracing
  fork/codex/run-reliability-optimization-spec
  fork/codex/runner-tier-default
  fork/codex/runtime-recovery-installer-sidecar-uninstall
  fork/codex/runtime-todo-artifact-ui
  fork/codex/safe-retry-policy-contracts
  fork/codex/same-run-retry-runtime
  fork/codex/select-user-design-systems-on-home
  fork/codex/semantic-token-inference
  fork/codex/serveroptima-runner-poc
  fork/codex/settings-amr-cli-card-polish
  fork/codex/share-to-od-next-step
  fork/codex/shared-ui-polish
  fork/codex/social-card-entry
  fork/codex/social-share-publish-page-copy
  fork/codex/social-share-templates-artifacts
  fork/codex/soft-empty-api-response
  fork/codex/split-daemon-run-helpers
  fork/codex/sse-keepalive-nginx-docs
  fork/codex/stabilize-settings-dialog-entry
  fork/codex/studio-interaction-polish
  fork/codex/studio-interaction-updates
  fork/codex/studio-tool-edge-cases
  fork/codex/tools-dev-env-files
  fork/codex/trace-safe-object-manifests
  fork/codex/trace-touched-files-r2
  fork/codex/trace-touched-files-r2-reopen
  fork/codex/tune-main-ui-ci-alerts
  fork/codex/ui-optimizations-pr2355
  fork/codex/unified-daemon-startup
  fork/codex/update-open-design-x-link
  fork/codex/update-vela-cli-0.0.7
  fork/codex/validation-assets-official-catalog
  fork/codex/vela-companion-packaging
  fork/codex/visual-draw-annotation-context
  fork/codex/visual-report-threshold
  fork/codex/visual-target-baselines
  fork/codex/win-smoke-launcher-layout
  fork/codex/windows-desktop-auto-update-main
  fork/codex/windows-launcher-acceptance
  fork/codex/windows-packaged-updater-hardening
  fork/codex/workflow-atom-names
  fork/codex/workflow-followup
  fork/codex/workflow-governance
  fork/codex/workflow-optimization
  fork/codex/workflow-optimization-next
  fork/codex/workspace-capability-v0.8.0
  fork/common-sphere
  fork/cursor/289994c1
  fork/cursor/376f147b
  fork/cursor/47ca13ab
  fork/cursor/e740089e
  fork/deeply-confidence
  fork/demo/launchpad-ia
  fork/demo/plugin-share-feedback
  fork/demo/workspace-team-features
  fork/demo/workspace-team-polish
  fork/design-systems-capability-barrels
  fork/dev-0508
  fork/disable-svg-daily
  fork/docs/arabic-readme
  fork/docs/desktop-shipped
  fork/docs/packaged-crash-governance-spec
  fork/docs/preview-v0.8.0-branch-guidance
  fork/docs/readme-0-10-0-banner
  fork/docs/readme-0.9.0-to-main
  fork/docs/social-preview-assets
  fork/docs/sync-all-langs
  fork/docs/zh-cn-0.9.0-amr
  fork/docs/zh-cn-agents-logo-grid
  fork/docs/zh-cn-fix-counts
  fork/docs/zh-cn-followup-tweaks
  fork/docs/zh-cn-plugin-usage
  fork/docs/zh-cn-readme-title
  fork/eli/fix/remove-pet-composer-button
  fork/even-ferry
  fork/examples/motionsites-3d-portfolio-velar
  fork/exp/all-opts
  fork/explore/daemon-token-channel-injection
  fork/export-capability-barrel
  fork/feat/add-animations
  fork/feat/agent-ready-contracts
  fork/feat/amr-auth-tracking
  fork/feat/amr-error-guidance
  fork/feat/amr-runtime-acp
  fork/feat/amr-wallet-ui-polish
  fork/feat/analytics-instrumentation
  fork/feat/analytics-onboarding-ds-events
  fork/feat/anime-fighting-game-screenshot
  fork/feat/antigravity-runtime
  fork/feat/artifact-next-step-actions
  fork/feat/assistant-feedback-analytics
  fork/feat/auto-qa-artifact-check-registry
  fork/feat/backport-auto-approve
  fork/feat/backport-automerge
  fork/feat/backport-on-label-after-merge
  fork/feat/bake-pipeline
  fork/feat/batch-design-system-testing
  fork/feat/block-unvalidated-merge
  fork/feat/chat-style-revamp
  fork/feat/cli-config-healthcheck
  fork/feat/cli-detection-self-rescue
  fork/feat/cloud-subscription-copy
  fork/feat/codex-session-resume
  fork/feat/comment-panel-tracking
  fork/feat/community-iframe-gallery
  fork/feat/community-slides-plugins
  fork/feat/composer-context-branding
  fork/feat/configure-runnable-globals
  fork/feat/contributors-page
  fork/feat/deployment-watermark
  fork/feat/design-files-panel-redesign
  fork/feat/design-system-ai-brands
  fork/feat/design-system-batch-reporter
  fork/feat/design-system-batch-tokens
  fork/feat/design-system-batch2-tokens
  fork/feat/design-system-cursor-tokens
  fork/feat/design-toolbox-into-nextstep
  fork/feat/designs-tab-cards
  fork/feat/desktop-help-menu-links
  fork/feat/desktop-integration-refresh
  fork/feat/desktop-integraton
  fork/feat/desktop-splash-video
  fork/feat/diagnostics-export
  fork/feat/discord-community-link
  fork/feat/discovery-single-shot
  fork/feat/document-upload
  fork/feat/ds-analytics-run-regenerate-fields
  fork/feat/ds-gallery-template-wiring
  fork/feat/editable-pptx-export
  fork/feat/enterprise-lead-form-rework
  fork/feat/example-query-react-to-html
  fork/feat/exception-tracking-always-on
  fork/feat/feishu-daily-pr-links
  fork/feat/feishu-nightly-manual-dispatch
  fork/feat/feishu-nightly-notify
  fork/feat/gallery-video-prefetch
  fork/feat/generation-preview-failure-reason
  fork/feat/generation-preview-stage
  fork/feat/github-dashboard-skill
  fork/feat/grok-build-runtime
  fork/feat/grok-imagine
  fork/feat/hermes
  fork/feat/home-composer-input
  fork/feat/home-second-level-categories
  fork/feat/home-subchip-i18n
  fork/feat/html-video-seo-keywords
  fork/feat/import-claude-design-zip
  fork/feat/in-context-comments
  fork/feat/landing-agents-detail-pages
  fork/feat/landing-alternatives-stitch
  fork/feat/landing-blog-0-11-0-12
  fork/feat/landing-blog-agents-prototyping-listicles
  fork/feat/landing-blog-best-ai-design-tools
  fork/feat/landing-blog-claude-code-frontend-design
  fork/feat/landing-blog-claude-figma-090
  fork/feat/landing-blog-figma-v0-listicles
  fork/feat/landing-blog-vibe-design-cluster
  fork/feat/landing-claude-design-capture
  fork/feat/landing-community-i18n
  fork/feat/landing-detail-preview-share-cta
  fork/feat/landing-download-page
  fork/feat/landing-fallback-skill-preview-cards
  fork/feat/landing-favicon-refresh
  fork/feat/landing-ha-seo-discoverability
  fork/feat/landing-ha-seo-title
  fork/feat/landing-header-amr-row
  fork/feat/landing-header-grouped-nav
  fork/feat/landing-header-social-footer-sister
  fork/feat/landing-header-three-zone
  fork/feat/landing-hero-restyle
  fork/feat/landing-home-footer-library-align
  fork/feat/landing-html-video
  fork/feat/landing-i18n-prune
  fork/feat/landing-ikigai-backlink
  fork/feat/landing-ikigai-one-story
  fork/feat/landing-ikigai-teams-cta
  fork/feat/landing-nav-compare-group
  fork/feat/landing-nav-restructure
  fork/feat/landing-page-logo-png
  fork/feat/landing-page-preview-fallback
  fork/feat/landing-plugin-detail-remove-homepage
  fork/feat/landing-plugins-card-links-to-new-detail
  fork/feat/landing-plugins-i18n
  fork/feat/landing-plugins-preview-share
  fork/feat/landing-plugins-redirects-i18n
  fork/feat/landing-plugins-trim
  fork/feat/landing-pr2469-cherry-pick
  fork/feat/landing-pr2469-replicate
  fork/feat/landing-roles-path-rename
  fork/feat/landing-solution-roles
  fork/feat/landing-solutions-use-cases
  fork/feat/landing-templates-data-fix
  fork/feat/landing-templates-grid
  fork/feat/landing-templates-i18n-completeness
  fork/feat/landing-templates-subcategory-i18n
  fork/feat/landing-trust-infra
  fork/feat/landing-tutorials-batch1
  fork/feat/landing-tutorials-batch2
  fork/feat/landing-tutorials-batch3
  fork/feat/landing-tutorials-batch4
  fork/feat/landing-tutorials-batch5
  fork/feat/landing-tutorials-batch6
  fork/feat/landing-tutorials-channel
  fork/feat/landing-tutorials-channel-v2
  fork/feat/landing-tutorials-longform
  fork/feat/landing-vibe-cluster-seo
  fork/feat/langfuse-telemetry
  fork/feat/langfuse-telemetry-relay
  fork/feat/main-chain-validation-suite
  fork/feat/mcp-codex-generation
  fork/feat/mcp-install-plugin-marketplace
  fork/feat/multi-model-endpoints
  fork/feat/new-project-media-redesign
  fork/feat/new-work-0608-10
  fork/feat/new-work-0608-12
  fork/feat/new-work-0608-2
  fork/feat/new-work-0608-9
  fork/feat/new-work-0610
  fork/feat/new-work-0610-4
  fork/feat/new-work-0615
  fork/feat/nextstep-toolbox-actions
  fork/feat/observability-full
  fork/feat/od-contribute-plugin-branch
  fork/feat/od-share-to-community-skill
  fork/feat/official-decks-od-narrative
  fork/feat/onboarding-amr-detecting-skeleton
  fork/feat/onboarding-cloud-signin
  fork/feat/onboarding-newsletter-step
  fork/feat/onboarding-personalized-start
  fork/feat/optimize-naming
  fork/feat/optimize-style
  fork/feat/otaku-dance-choreography-breakdown
  fork/feat/packaged-startup-telemetry
  fork/feat/plugin-preview-video
  fork/feat/plugin-settings-automation-tracking
  fork/feat/plugin-template-remix
  fork/feat/posthog-project-fields
  fork/feat/pr-impact-analysis-tooling
  fork/feat/preview-default-r2-base
  fork/feat/preview-filename-hash
  fork/feat/preview-presets-framing
  fork/feat/pricing-ui-update
  fork/feat/privacy-consent-single-button
  fork/feat/programmatic-pptx-export
  fork/feat/questions-right-panel
  fork/feat/quick-brief-honor-plugin-inputs
  fork/feat/readme-mcp-install-uniform
  fork/feat/release-automation-workflows
  fork/feat/remove-artifact-settings
  fork/feat/remove-home-open-existing-card
  fork/feat/remove-side-chat-entry
  fork/feat/replace-startup-splash-video
  fork/feat/resume-cache-first-call-telemetry
  fork/feat/run-resume-on-failure
  fork/feat/settings-dialog-redesign
  fork/feat/share-out-button-tracking
  fork/feat/skip-discovery-for-example-prompts
  fork/feat/social-media-dashboard-skill
  fork/feat/startup-animation-open-design-wordmark
  fork/feat/startup-splash-video
  fork/feat/stream-auq-card
  fork/feat/studio-toolbar-merge-3081
  fork/feat/support-star-us
  fork/feat/three-kingdoms-screenshots
  fork/feat/three-kingdoms-seedance-videos
  fork/feat/tools-pr
  fork/feat/topbar-redesign
  fork/feat/tracking-html-file-versions
  fork/feat/tweaks-palette-popover
  fork/feat/ui-chore
  fork/feat/upload-tracking-cover-all-entries
  fork/feat/url-clone-plugin
  fork/feat/vaunt-contributor-recognition
  fork/feat/vercel-multifile-deploy
  fork/feat/web-manual-edit-pin-inspector
  fork/feat/web-session-replay
  fork/feat/web-sourcemap-upload
  fork/feat/website-optimization
  fork/feat/website-optimization-v2
  fork/feat/whats-new-popup
  fork/feat/windows-beta-packaging
  fork/feat/workspace-header-redesign
  fork/feat/workspace-tabs-auto-shrink
  fork/feat/x-grok-integration
  fork/feature/integrations-skills-tab
  fork/feature/live-artifacts-spec
  fork/feature/skill-plugin-candidates
  fork/fix-138
  fork/fix-145
  fork/fix-coauthor
  fork/fix-contributor-wall
  fork/fix-home-entry-actions
  fork/fix-image-timeout
  fork/fix-main-new-project-panel-default
  fork/fix-translations-drift
  fork/fix/52-claude-stdin-windows-enametoolong
  fork/fix/allowed-dev-origins
  fork/fix/amr-acp-stage-timeout
  fork/fix/amr-acp-tool-only-no-output
  fork/fix/amr-acp-tool-only-no-output-v090
  fork/fix/amr-agent-refresh-after-auth
  fork/fix/amr-card-signout-flicker-and-login-refresh
  fork/fix/amr-login-direct-first-proxy-fallback
  fork/fix/amr-login-surface-url
  fork/fix/amr-model-list-refresh-after-login
  fork/fix/amr-preflight-cache-and-diagnostics
  fork/fix/amr-settings-card-flash
  fork/fix/amr-windows-vela-refresh
  fork/fix/analytics-amr-provider-id
  fork/fix/analytics-app-version-zero
  fork/fix/analytics-ds-field-gaps
  fork/fix/analytics-telemetry-default-on
  fork/fix/artifact-manifest-test-mtime-flake
  fork/fix/assistant-chat-link-handling
  fork/fix/automation-ingest-select-chevron-v0.8.0
  fork/fix/backport-automerge-bot-author
  fork/fix/backport-automerge-pristine-only
  fork/fix/beta-reader-schema-compat
  fork/fix/body-hydration-warning
  fork/fix/brand-dark-native-default
  fork/fix/brandkit-status-and-fastpath
  fork/fix/browser-snapshot-internal-open
  fork/fix/ci-merge-queue-gate-skip-non-pr-refs
  fork/fix/classify-execution-failed-subtypes
  fork/fix/claude-design-import-wheel-followups
  fork/fix/claude-socket-drop-diagnostic
  fork/fix/codex-app-bundle-detection
  fork/fix/codex-cli-path-fallback-ux
  fork/fix/codex-service-tier-wildcard
  fork/fix/comment-queue-on-busy
  fork/fix/composer-flatten-input
  fork/fix/conversation-msg-count
  fork/fix/conversation-msg-count-v0.10.0
  fork/fix/conversation-run-duration
  fork/fix/daemon-typecheck-core
  fork/fix/daemon-typecheck-leaf
  fork/fix/daily-beta-track-main
  fork/fix/deck-comment-slide-scope-v0.9.0
  fork/fix/deck-detect-vertical-pages
  fork/fix/deck-queue-autopage
  fork/fix/decouple-privacy-banner-lifecycle
  fork/fix/default-router-craft
  fork/fix/demo-credits-media-polish
  fork/fix/demo-onboarding-polish
  fork/fix/demo-onboarding-polish-v2
  fork/fix/design-browser-css-3358-regression
  fork/fix/design-files-current-dir-sync
  fork/fix/design-files-empty-folders
  fork/fix/desktop-entry-chrome-consistency
  fork/fix/desktop-splash-white-bg
  fork/fix/desktop-stable-web-origin-511
  fork/fix/diagnostics-capture-daemon-logs
  fork/fix/document-chip-send-blocked-v0.13.0
  fork/fix/draw-disable-send-during-run
  fork/fix/draw-snapshot-no-reload
  fork/fix/ds-token-legacy-backfill
  fork/fix/ds-token-unification
  fork/fix/edit-mode-text-leaf-kind
  fork/fix/entry-tab-layout-and-ds-showcase
  fork/fix/exception-tracking-platform-and-fetch-noise
  fork/fix/execution-failed-reclassify
  fork/fix/extended-connectors-auth-cancel
  fork/fix/feedback-event-agent-model
  fork/fix/feedback-show-on-all-completed-turns
  fork/fix/feishu-nightly-channel
  fork/fix/fileviewer-preview-blank
  fork/fix/first-call-cache-ratio-additive-usage
  fork/fix/flaky-manual-edit-bridge-click
  fork/fix/flaky-projects-empty-state
  fork/fix/folder-reset-render-phase-v0.10.0
  fork/fix/footer-wordmark-mobile-clip
  fork/fix/fork-pr-auto-approve-linkage
  fork/fix/github-metadata-daemon-proxy
  fork/fix/grok-build-slim-prompt
  fork/fix/header-buttons-always-right
  fork/fix/home-community-card-use-and-filter-link
  fork/fix/home-mention-files-cap
  fork/fix/home-scroll-back-smooth
  fork/fix/i18n-content-dup-keys
  fork/fix/i18n-designfiles-showmore-coverage
  fork/fix/inspect-hover-card-flicker
  fork/fix/isolate-agent-probe-cwd
  fork/fix/issue-1118-windows-installer-process-close
  fork/fix/issue-1215
  fork/fix/issue-164-media-output-validation
  fork/fix/issue-37-unfinished-todos
  fork/fix/issue-891-run-shutdown-cleanup
  fork/fix/landing-about-img-aspect
  fork/fix/landing-amr-wallet-redirect-main
  fork/fix/landing-baked-previews
  fork/fix/landing-card-padding-unification
  fork/fix/landing-community-nav-trim
  fork/fix/landing-copy-example-sibling-assets
  fork/fix/landing-ha-canonical-url
  fork/fix/landing-home-mobile-nav-toggle
  fork/fix/landing-i18n-nav-tweaks
  fork/fix/landing-nav-download-tracking
  fork/fix/landing-nav-mobile-dropdowns
  fork/fix/landing-official-x-handle
  fork/fix/landing-plugins-redirect-loc-collision
  fork/fix/landing-restore-posthog
  fork/fix/landing-seo-onpage-meta
  fork/fix/landing-share-origin
  fork/fix/landing-sitemap-drop-redirects
  fork/fix/langfuse-report-hook
  fork/fix/launch-review-regressions
  fork/fix/live-artifact-read-json-input-validation
  fork/fix/live-artifact-tab-overflow
  fork/fix/mac-dock-icon
  fork/fix/main-ci-agent-stream-mocks
  fork/fix/mark-capture-srcdoc-iframe
  fork/fix/media-provider-key-visibility
  fork/fix/model-picker-search-3262
  fork/fix/motion-loader-in-plugins
  fork/fix/nav-rail-demote-plugins-integrations
  fork/fix/needs-validation-gate-merge-group-only
  fork/fix/needs-validation-gate-resolve-pr-from-ref
  fork/fix/next-step-requires-artifact
  fork/fix/onboarding-amr-selection
  fork/fix/onboarding-amr-visible
  fork/fix/onboarding-cloud-login-error
  fork/fix/onboarding-survey-tracking
  fork/fix/orbit-template-migration
  fork/fix/orbit-template-migration-v0.7.0
  fork/fix/package-plugin-preview-manifest
  fork/fix/packaged-electron-dist-resilience
  fork/fix/plugin-authoring-prompt
  fork/fix/plugin-folder-contribute-flow
  fork/fix/plugin-pipeline-core-quality-stages
  fork/fix/plugin-publish-pr-workflow
  fork/fix/plugin-use-menu-order
  fork/fix/pnpm-install-toolchain
  fork/fix/post-backmerge-ci
  fork/fix/posthog-domexception-trace
  fork/fix/pr-author-inactivity-activity-window
  fork/fix/prerelease-changelog-release-commit
  fork/fix/preset-seed-reflow-hardwraps
  fork/fix/preview-iframe-trailing-slash
  fork/fix/prompt-template-desktop-close-hitbox
  fork/fix/publish-repo-flow
  fork/fix/question-form-id-churn
  fork/fix/question-form-max-selections
  fork/fix/queue-send-flush
  fork/fix/recvlF9KkVssQj-tools-popover
  fork/fix/recvlVk3NdCtho-onboarding-style
  fork/fix/release-beta-mac-sign-mode
  fork/fix/release-header-layout-clean
  fork/fix/release-stable-build-desktop-too
  fork/fix/release-stable-defer-linux
  fork/fix/release-stable-linux-no-corepack
  fork/fix/release-stable-linux-pnpm-standalone
  fork/fix/release-stable-manifest-attribution
  fork/fix/release-stable-metadata-fields
  fork/fix/release-stable-skip-nightly-gate
  fork/fix/release-stable-verify-typecheck-order
  fork/fix/remove-generation-preview-stage
  fork/fix/restore-composer-toolbox-entry
  fork/fix/restore-pr2461-evil-merge-losses
  fork/fix/retry-stopped-task-accumulation
  fork/fix/run-failure-signal-classification
  fork/fix/smallfix-bugs-batch
  fork/fix/spawn-ebadf-fd-leak
  fork/fix/system-proxy-agent-runtimes
  fork/fix/task-error-ui
  fork/fix/telemetry-default-on-install-id
  fork/fix/template-project-create-flow
  fork/fix/todo-dark-mode
  fork/fix/tools-pr-stats-chunk
  fork/fix/tools-pr-unresolved-cr-fallback
  fork/fix/web-exception-appversion-stale
  fork/fix/web-generation-preview-design-files-tab
  fork/fix/web-generation-preview-scope-empty-design-files
  fork/fix/web-header-layout
  fork/fix/web-i18n-entry-gaps
  fork/fix/win-onboarding-href-prefix
  fork/fix/win-onboarding-smoke-href-race
  fork/fix/win-onboarding-smoke-reset-user-data
  fork/fix/win-reset-readdir-enoent-only
  fork/fix/win-smoke-onboarding-shell
  fork/fix/win-smoke-running-instances-assertion
  fork/fix/workspace-model-pickers
  fork/fix/zh-cn-readme-links-banner
  fork/fixed-record
  fork/funny-friend
  fork/garnet-hemisphere
  fork/gh-readonly-queue/main/pr-3557-1197f43bc4289d8f9c5e00ef4443b2acef566da8
  fork/gh-readonly-queue/main/pr-3909-e89832257cff9b241ae75acb337761e6f01b4428
  fork/gh-readonly-queue/main/pr-3983-e89832257cff9b241ae75acb337761e6f01b4428
  fork/gh-readonly-queue/main/pr-4406-a4abae380408f20602533c4c1573dbfaa25237b9
  fork/glow-seashore
  fork/gossamer-enquiry
  fork/grove-wander
  fork/growth/readme-utm-attribution
  fork/growth/utm-attribution-cookie
  fork/guard/ts-nocheck-unresolved-imports
  fork/heather-snowstorm
  fork/holistic-pipe
  fork/hyperframes-html-in-canvas
  fork/i18n-content
  fork/incongruous-megaraptor
  fork/incredible-vessel
  fork/init-agents-md
  fork/integrated
  fork/integrated-trunk
  fork/invited-barometer
  fork/iodized-nephew
  fork/issue-38-document-preview
  fork/joey/add-maintainer-rules
  fork/jumpy-centipede
  fork/landing-page-home-refresh
  fork/landing-page-home-refresh-2
  fork/landing-page/auto-deploy-and-facets
  fork/landing-refresh-merge-to-main
  fork/landing/footer-wordmark
  fork/library-capability-barrel
  fork/looper/1106-byok-connect-but-no-tool-fc3b8d4cd2f678e1
  fork/looper/1121-windows-64-zip-260882204e8aea55
  fork/looper/1251-orbit-output-template-stays-in-65afec9caf3f68c0
  fork/looper/1251-orbit-output-template-stays-in-e6d8b68e6627623f
  fork/looper/1409-creating-a-template-stops-work-f6af2a4abb9380ca
  fork/looper/1416-quick-brief-form-is-not-1084e7dc43443d54
  fork/looper/1416-quick-brief-form-is-not-41d5a36cef33364f
  fork/looper/1416-quick-brief-form-is-not-8738af0de7b54a2a
  fork/looper/1416-quick-brief-form-is-not-c6ddfecb3f2c4f5a
  fork/looper/149-improve-tools-dev-diagnostics-c60e851c2e396383
  fork/looper/1504-enhancement-visual-validation-8fb45079c70332e8
  fork/looper/1531-open-design-landing-deck-can-80f4c406c19d1f3b
  fork/looper/1628-failed-to-deploy-on-vercel-c5a53739fb76b93c
  fork/looper/1635-mention-skills-not-injected-in-eff76dc315a98813
  fork/looper/1701-tofu-language-06ef0a63094ac0bf
  fork/looper/1856-folder-selection-not-working-da3cf031173e6758
  fork/looper/1892-dependency-security-audit-4-hi-3fcd4dc565b1291a
  fork/looper/1892-dependency-security-audit-4-hi-4150974c87a90c60
  fork/looper/1892-dependency-security-audit-4-hi-4ace3bf0d887e122
  fork/looper/1892-dependency-security-audit-4-hi-b8f15647d6963cf9
  fork/looper/1892-dependency-security-audit-4-hi-d2754d5182587040
  fork/looper/1892-dependency-security-audit-4-hi-ef8e196a8770dda4
  fork/looper/1893-changelog-md-unreleased-sectio-9ebe829ddea49130
  fork/looper/1912-macos-codex-connection-test-fa-9b0d603219db8f20
  fork/looper/1914-bulk-edit-operations-fail-with-4545f36842f8bd1e
  fork/looper/1914-bulk-edit-operations-fail-with-4b403dd732de86cc
  fork/looper/2078-automation-tab-and-page-are-9ab315e92fbaf44c
  fork/looper/2081-integrations-tab-and-page-are-a5abf8ad84a1da43
  fork/looper/2146-proposal-bundle-plugin-layout-54653c8dc0b86771
  fork/looper/2197-windows-packaged-app-codex-cli-3739c5f4d4cfa6a8
  fork/looper/2197-windows-packaged-app-codex-cli-a607e3ea82271565
  fork/looper/2405-design-files-tab-can-get-73e9a03332ad2180
  fork/looper/2464-0-7-0-early-completed-02d3f0359f7ed414
  fork/looper/2803-directly-accessing-the-previou-bfaaad7f11054f8b
  fork/looper/2884-manual-editor-01127717676d9a55
  fork/looper/2886-optimize-nix-maintenance-and-c-ef6e1d6fadb8c3f4
  fork/looper/2909-detect-and-persist-skill-plugi-e5dc30532035d241
  fork/looper/2953-image-1d17cc59abf65fa3
  fork/looper/3007-testing-a1d46514c4159a62
  fork/looper/3184-0-8-0-agent-won-be2cf10570aa5878
  fork/looper/3490-cannot-change-pages-while-in-b983c3a200c1b3d1
  fork/looper/3533-high-cpu-usage-on-macos-32ae33a423d6ee60
  fork/looper/3556-implement-langfuse-prompt-stac-d491c25e1cc2bd87
  fork/looper/3654-antigravity-cli-not-working-281187c2eacee18c
  fork/looper/3854-automations-beta-crystallize-c-7b0c2f2f07db6690
  fork/looper/3859-amr-onboarding-can-fail-with-5acd7e4cb094cc4f
  fork/looper/3860-settings-test-fails-against-ne-b558d1dbfca9f5ee
  fork/looper/3866-keep-the-official-docker-image-bc67a74b9a823371
  fork/looper/3872-pdf-export-can-produce-blank-c25e6e85c4ac326b
  fork/looper/3886-fork-from-here-conversations-c-ba20a4d77c1ca555
  fork/looper/4091-bug-claude-token-94768fba117fd4ef
  fork/looper/4125-bug-claude-code-startup-report-f2e4fdd03e96632c
  fork/looper/4126-bug-output-commenting-may-be-6a17a3e736982d5a
  fork/looper/4137-bug-the-generated-content-is-2789dee3c99ccd9a
  fork/looper/4165-refactor-web-standardize-simpl-331c624489260a89
  fork/looper/4166-refactor-web-migrate-settings-ee964dec7537d1ff
  fork/looper/4186-docker-opencode-not-detected-d-6dde02af74dba8d9
  fork/looper/4187-docker-api-token-required-when-58b7d80075f02dd1
  fork/looper/4208-image-generation-produces-two-5c90ab46a9fb1420
  fork/looper/4228-macos-screenshot-export-spawns-fa040dea77bb694d
  fork/looper/4281-bug-i-m-getting-a-a59698e5bf419688
  fork/looper/47-add-visible-conversation-times-108bcb81859dd5ff
  fork/looper/479-question-can-we-hook-this-b0b900403645fd1d
  fork/looper/53-preview-pagination-state-leaks-9709166f7bac9a55
  fork/looper/569-wix-ja-slide-google-slides-f7bdbdb0f5bc7d0d
  fork/looper/57-deck-preview-pagination-contro-d9ce790cc18e1f35
  fork/looper/69-react-9193ae20697560a7
  fork/looper/715-error-exporting-apresentations-f1db7b9a10e512af
  fork/looper/715-error-exporting-apresentations-f1db7b9a10e512af-clean
  fork/looper/planner/360-home
  fork/main
  fork/main-pr4862-e2e
  fork/mcp-capability-barrel
  fork/memory-capability-barrel
  fork/merge-conflict
  fork/metrics-run-25239911967
  fork/metrics-run-25266427929
  fork/metrics-run-25410988456
  fork/metrics-run-25706979263
  fork/metrics-run-25772023800
  fork/metrics-run-25835844101
  fork/metrics-run-25845526685
  fork/metrics-run-25894802921
  fork/metrics-run-25909494432
  fork/metrics-run-25948810963
  fork/metrics-run-25956879979
  fork/metrics-run-25957086610
  fork/metrics-run-26135368764
  fork/metrics-run-26352090593
  fork/metrics-run-26383906145
  fork/metrics-run-26432496803
  fork/metrics-run-26491478678
  fork/metrics-run-26555123481
  fork/metrics-run-26618479827
  fork/metrics-run-26674286548
  fork/metrics-run-26703646361
  fork/metrics-run-26736612369
  fork/metrics-run-26799497704
  fork/midnight-lemur
  fork/mountain-darkness
  fork/mountainous-turtle
  fork/new-agent-runtime-expactation
  fork/nutritious-dracopelta
  fork/od-contrib/plugin/munch-tv-prototype-20260602-205417
  fork/optimize-electron-dist-bundle-size
  fork/perf/deck-walk-speed
  fork/perf/landing-defer-enhancers
  fork/perf/landing-hero-image-resizing
  fork/pftom-patch-1
  fork/pick/3358-design-files-v0.10.0
  fork/pick/3582-stream-auq-v0.10.0
  fork/pick/3617-entry-rail-v0.10.0
  fork/pick/3625-composer-context-v0.10.0
  fork/pick/3645-simplify-composer-v0.10.0
  fork/popular-mercury
  fork/pr-4174
  fork/pr-770
  fork/pr-d/design-token-channel-default-on
  fork/pr/prompt-behavior
  fork/pr/transcript-artifact-summary
  fork/pr17-modernized
  fork/preview/enterprise-lead-4625
  fork/preview/zh-cn-readme-0.8.0
  fork/prickle-kite
  fork/probable-fold
  fork/project-capability-barrel
  fork/quark-armchair
  fork/quiver-saw
  fork/ray/ui-dropdown-controls
  fork/rebel-nexu-zero-bot-push-demo
  fork/reconcile/garnet-main-product-review
  fork/refactor/agent-protocol-barrel
  fork/refactor/contracts-metadata-block
  fork/refactor/daemon-server-phase-0-2
  fork/refactor/daemon-server-phase-3-route-dedupe
  fork/refactor/daemon-server-phase-4-plugin-split
  fork/refactor/db-barrel
  fork/refactor/download-barrel-split
  fork/refactor/events-barrel-split
  fork/refactor/extract-ui-primitives
  fork/refactor/host-barrel-split
  fork/refactor/langfuse-trace-barrel
  fork/refactor/platform-barrel-split
  fork/refactor/plugin-runtime-helpers
  fork/refactor/sidecar-barrel-split
  fork/refactor/sidecar-proto-barrel-split
  fork/refactor/web-automations-slice
  fork/refactor/web-chat-composer-slice-pr
  fork/refactor/web-chat-pane-slice
  fork/refactor/web-chatcomposer-slice
  fork/refactor/web-file-viewer-slice
  fork/refactor/web-file-workspace-slice
  fork/refactor/web-handoff-slice
  fork/refactor/web-mcp-client-slice
  fork/refactor/web-memory-slice
  fork/refactor/web-project-view-slice
  fork/refactor/web-settingsdialog-slice
  fork/release-bot/bump-main-v0.13.1
  fork/release/v0.1.0
  fork/release/v0.10.0
  fork/release/v0.10.1
  fork/release/v0.11.0
  fork/release/v0.12.0
  fork/release/v0.13.0
  fork/release/v0.2.0
  fork/release/v0.3.0
  fork/release/v0.4.0
  fork/release/v0.4.1
  fork/release/v0.5.0
  fork/release/v0.5.1
  fork/release/v0.6.1
  fork/release/v0.7.0
  fork/release/v0.8.0
  fork/release/v0.9.0
  fork/remove-live-artifact-home-chip
  fork/remove-resume-conversation-button
  fork/revert-1622-agent-runtime
  fork/revert-4952-codex/fanzhen-0.13-ui
  fork/revert/deck-comment-slide-scope-v0.9.0
  fork/revert/pr-1806-nav-rail-demote
  fork/revert/pr-2360-restore-nav-rail-demote
  fork/revert/pr-2469-broken-deploy
  fork/run-capability-barrel
  fork/server-ts
  fork/simplify-plugin-candidate-cta
  fork/skill-i18n
  fork/skills/enhance-frontend-design
  fork/smoke/agent-pr-explore-approval
  fork/social-links-ig-li-rednote
  fork/sour-spleen
  fork/spec/agent-cli-session-resume
  fork/spec/agent-pr-explore
  fork/spec/agent-startup-latency
  fork/spec/claude-session-resume
  fork/spec/plugin-preview-bake-pipeline
  fork/spike/electron-independent-resource-updates
  fork/spike/release-beta-windows-signer-hello
  fork/split-daemon-project-routes
  fork/stellar-owl
  fork/sync/main-into-preview-v0.8.0
  fork/tailwind-phase-1
  fork/tar-mandible
  fork/telemetry-capability-barrel
  fork/template/digits-fintech-swiss-template
  fork/template/fable-5-liquid-landing
  fork/template/field-notes-editorial-template
  fork/template/html-ppt-retro-quarterly-review
  fork/template/hyperframes-video-template
  fork/template/social-media-matrix-live-artifact
  fork/template/video-seedance-desk-hologram-ar-realdesk
  fork/template/weread-year-in-review-video-template
  fork/test-visual-regression-triptych
  fork/test/e2e-project-and-home-coverage
  fork/test/home-entry-coverage
  fork/test/home-entry-coverage-gh
  fork/test/memory-routines-coverage-followups
  fork/thrilling-oval
  fork/token-first-tailwind
  fork/track-run-entry-from
  fork/traveling-leek
  fork/ts-doc
  fork/ui/design-systems-library-cleanup
  fork/update-contributors-wall
  fork/worktree-feat-posthog-analytics
  fork/worktree-fix-issue-10-windows-spawn
  fork/worktree-fix-issue-6-skills-permission
  fork/worktree-fix-issue-8-model-picker
  fork/worktree-i18n-localization-fix
  fork/worktree-new-work
  fork/worktree-nextjs-16-refactor
  fork/worktree-noodle-plugin
  fork/worktree-plugin-deploy-share
  fork/worktree-warm-kindling-cascade
  fork/yjl-acceptance-pending-20260608
  fork/zealous-candytuft
  origin/HEAD -> origin/main
  origin/main
  origin/pr-5088
  origin/pr-5128
  origin/pr-5132
  origin/pr-5139
  origin/pr-5149
  origin/pr-5151
  origin/pr-5159
  origin/pr-5164
  origin/pr-5189
  origin/pr-5190
  origin/pr-5228

 succeeded in 21180ms:
2026-07-16 09:27:36.944 xcodebuild[32505:1021865]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:37.583 xcodebuild[32517:1021920]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:38.509 xcodebuild[32517:1021893] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-UC6F3sHJ' (errno=Operation not permitted)
2026-07-16 09:27:40.590 xcodebuild[32540:1022035]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.155 xcodebuild[32552:1022081]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.903 xcodebuild[32552:1022058] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
integrated
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-jhqPSLsa' (errno=Operation not permitted)
2026-07-16 09:27:47.405 xcodebuild[32647:1022511]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:47.930 xcodebuild[32652:1022561]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:48.443 xcodebuild[32652:1022526] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-J2hmCjB2' (errno=Operation not permitted)
2026-07-16 09:27:49.446 xcodebuild[32669:1022630]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:49.834 xcodebuild[32673:1022679]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:50.355 xcodebuild[32673:1022643] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
478a85577aff5aff6d98e3aed8214fafc5003af5
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-tjXKwkq2' (errno=Operation not permitted)
2026-07-16 09:27:53.448 xcodebuild[32713:1022806]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:53.860 xcodebuild[32719:1022827]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:54.202 xcodebuild[32719:1022813] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-4uOv6HWc' (errno=Operation not permitted)
2026-07-16 09:27:55.017 xcodebuild[32725:1022845]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:55.322 xcodebuild[32727:1022857]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:55.657 xcodebuild[32727:1022849] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
2026-07-04T14:35:49-07:00
refactor(daemon): extract server/bootstrap/start-listener from server.ts

 succeeded in 21236ms:
2026-07-16 09:27:36.941 xcodebuild[32479:1021860]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:37.562 xcodebuild[32516:1021910]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:38.508 xcodebuild[32516:1021887] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-o0CYCkJU' (errno=Operation not permitted)
2026-07-16 09:27:40.550 xcodebuild[32539:1022029]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.130 xcodebuild[32547:1022077]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:41.884 xcodebuild[32547:1022044] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
refactor/web-memory-slice
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-CYrYnkIq' (errno=Operation not permitted)
2026-07-16 09:27:47.374 xcodebuild[32643:1022506]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:47.955 xcodebuild[32650:1022568]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:48.458 xcodebuild[32650:1022520] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-COY1d0BY' (errno=Operation not permitted)
2026-07-16 09:27:49.477 xcodebuild[32670:1022638]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:49.907 xcodebuild[32675:1022686]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:50.407 xcodebuild[32675:1022652] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
f65eea0343014bd8dad179dd4701c5eb02e18df4
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-bNgVeDJW' (errno=Operation not permitted)
2026-07-16 09:27:53.570 xcodebuild[32715:1022819]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:53.949 xcodebuild[32724:1022831]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:54.273 xcodebuild[32724:1022826] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-ovcTx9pu' (errno=Operation not permitted)
2026-07-16 09:27:55.089 xcodebuild[32726:1022850]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:55.387 xcodebuild[32728:1022859]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:27:55.720 xcodebuild[32728:1022855] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
2026-07-14T21:45:01-07:00
fix(web): fix 3 nettee bugs, 2 self-found races, push memory-slice coverage to ~97%

exec
/bin/bash -lc 'type -a git
/usr/bin/git --version
/usr/local/bin/git --version 2>/dev/null || true' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 4378ms:
2026-07-16 09:28:01.283 xcodebuild[32751:1022976]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:01.649 xcodebuild[32752:1022982]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:02.008 xcodebuild[32752:1022980] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-HtjgdW2V' (errno=Operation not permitted)
2026-07-16 09:28:02.959 xcodebuild[32764:1023031]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:03.301 xcodebuild[32765:1023037]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:03.638 xcodebuild[32765:1023035] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git version 2.39.3 (Apple Git-145)

exec
/bin/bash -lc 'ls -l /usr/local/bin/git /opt/homebrew/bin/git 2>/dev/null || true
file /usr/local/bin/git 2>/dev/null || true' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
/usr/local/bin/git: cannot open `/usr/local/bin/git' (No such file or directory)

exec
/bin/bash -lc 'git rev-parse HEAD && git branch --show-current && git remote -v' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 12839ms:
2026-07-16 09:28:14.546 xcodebuild[32830:1023282]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:14.879 xcodebuild[32831:1023295]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:15.218 xcodebuild[32831:1023286] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-IqlwEj4O' (errno=Operation not permitted)
2026-07-16 09:28:16.061 xcodebuild[32832:1023310]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:16.407 xcodebuild[32833:1023315]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:16.734 xcodebuild[32833:1023314] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
f65eea0343014bd8dad179dd4701c5eb02e18df4
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-rUjyquKI' (errno=Operation not permitted)
2026-07-16 09:28:18.786 xcodebuild[32837:1023353]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:19.125 xcodebuild[32838:1023358]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:19.444 xcodebuild[32838:1023357] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-R6kHFw7L' (errno=Operation not permitted)
2026-07-16 09:28:20.273 xcodebuild[32839:1023364]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:20.584 xcodebuild[32840:1023369]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:20.952 xcodebuild[32840:1023368] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
refactor/web-memory-slice
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-1U65c2OK' (errno=Operation not permitted)
2026-07-16 09:28:23.230 xcodebuild[32849:1023430]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:23.576 xcodebuild[32860:1023437]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:23.937 xcodebuild[32860:1023435] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-ljH51bV9' (errno=Operation not permitted)
2026-07-16 09:28:24.772 xcodebuild[32861:1023453]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:25.085 xcodebuild[32862:1023458]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:25.411 xcodebuild[32862:1023457] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
fork	https://github.com/leonaburime-ucla/open-design.git (fetch)
fork	https://github.com/leonaburime-ucla/open-design.git (push)
origin	https://github.com/nexu-io/open-design.git (fetch)
origin	https://github.com/nexu-io/open-design.git (push)

exec
/bin/bash -lc 'git rev-parse HEAD && git branch --show-current && git remote -v && git status --short --branch' in /Users/la/Desktop/Programming/Jini
 succeeded in 18196ms:
2026-07-16 09:28:31.759 xcodebuild[32882:1023570]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:32.171 xcodebuild[32885:1023575]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:32.594 xcodebuild[32885:1023574] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-BXHBNP43' (errno=Operation not permitted)
2026-07-16 09:28:33.533 xcodebuild[32889:1023608]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:33.884 xcodebuild[32890:1023626]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:34.289 xcodebuild[32890:1023612] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
478a85577aff5aff6d98e3aed8214fafc5003af5
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-VTwkmxXV' (errno=Operation not permitted)
2026-07-16 09:28:36.360 xcodebuild[32904:1023649]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:36.676 xcodebuild[32905:1023655]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:37.007 xcodebuild[32905:1023653] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-WQ8SKuFC' (errno=Operation not permitted)
2026-07-16 09:28:37.827 xcodebuild[32906:1023663]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:38.163 xcodebuild[32907:1023678]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:38.498 xcodebuild[32907:1023667] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
integrated
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-jxyPHjyx' (errno=Operation not permitted)
2026-07-16 09:28:40.538 xcodebuild[32920:1023703]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:40.891 xcodebuild[32921:1023708]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:41.224 xcodebuild[32921:1023707] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Ayfkwsrn' (errno=Operation not permitted)
2026-07-16 09:28:42.080 xcodebuild[32922:1023741]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:42.437 xcodebuild[32926:1023754]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:42.852 xcodebuild[32926:1023749] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
fork	https://github.com/leonaburime-ucla/open-design.git (fetch)
fork	https://github.com/leonaburime-ucla/open-design.git (push)
origin	https://github.com/nexu-io/open-design.git (fetch)
origin	https://github.com/nexu-io/open-design.git (push)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Xhw3tg2f' (errno=Operation not permitted)
2026-07-16 09:28:45.088 xcodebuild[32950:1023835]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:45.443 xcodebuild[32951:1023842]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:45.783 xcodebuild[32951:1023840] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-hYncMQL6' (errno=Operation not permitted)
2026-07-16 09:28:46.592 xcodebuild[32952:1023848]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:46.902 xcodebuild[32953:1023853]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:47.227 xcodebuild[32953:1023852] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
## integrated
 D apps/web/src/App.tsx
 D apps/web/src/analytics/amr-attribution.ts
 D apps/web/src/analytics/amr-auth.ts
 D apps/web/src/analytics/byok-run.ts
 D apps/web/src/analytics/client.ts
 D apps/web/src/analytics/ds-create-entry.ts
 D apps/web/src/analytics/error-tracking.ts
 D apps/web/src/analytics/events.ts
 D apps/web/src/analytics/identity.ts
 D apps/web/src/analytics/onboarding-session.ts
 D apps/web/src/analytics/provider.tsx
 D apps/web/src/analytics/scrub.ts
 D apps/web/src/analytics/upload-tracking.ts
 D apps/web/src/api-attachment-context.ts
 D apps/web/src/artifacts/manifest.ts
 D apps/web/src/artifacts/markdown-context.ts
 D apps/web/src/artifacts/markdown.ts
 D apps/web/src/artifacts/parser.ts
 D apps/web/src/artifacts/pointer.ts
 D apps/web/src/artifacts/question-form.ts
 D apps/web/src/artifacts/recover.ts
 D apps/web/src/artifacts/renderer-registry.ts
 D apps/web/src/artifacts/strip.ts
 D apps/web/src/artifacts/types.ts
 D apps/web/src/artifacts/validate.ts
 D apps/web/src/comments.ts
 D apps/web/src/components/AgentDiagnosticRow.module.css
 D apps/web/src/components/AgentDiagnosticRow.tsx
 D apps/web/src/components/AgentIcon.tsx
 D apps/web/src/components/AgentPicker.tsx
 D apps/web/src/components/AmrGuidance.tsx
 D apps/web/src/components/AmrLoginPill.tsx
 D apps/web/src/components/AppChromeHeader.tsx
 D apps/web/src/components/AssistantMessage.tsx
 D apps/web/src/components/AvatarMenu.tsx
 D apps/web/src/components/BoardComposerPopover.tsx
 D apps/web/src/components/BrandEnrichmentBanner.module.css
 D apps/web/src/components/BrandEnrichmentBanner.tsx
 D apps/web/src/components/BrandPickerModal.module.css
 D apps/web/src/components/BrandPickerModal.tsx
 D apps/web/src/components/BrandPreviewCard.module.css
 D apps/web/src/components/BrandPreviewCard.tsx
 D apps/web/src/components/BrandReadyPrompt.module.css
 D apps/web/src/components/BrandReadyPrompt.tsx
 D apps/web/src/components/BrandReferencePicker.module.css
 D apps/web/src/components/BrandReferencePicker.tsx
 D apps/web/src/components/BrandsTab.module.css
 D apps/web/src/components/BrandsTab.tsx
 D apps/web/src/components/ChatComposer.tsx
 D apps/web/src/components/ChatPane.tsx
 D apps/web/src/components/ComposerPluginPreview.tsx
 D apps/web/src/components/ComposerPlusMenu.tsx
 D apps/web/src/components/ConnectorLogo.tsx
 D apps/web/src/components/ConnectorsBrowser.tsx
 D apps/web/src/components/ContextChipHoverCard.module.css
 D apps/web/src/components/ContextChipHoverCard.tsx
 D apps/web/src/components/ContextChipStrip.tsx
 D apps/web/src/components/ContinueInCliButton.tsx
 D apps/web/src/components/ConversationsMenu.tsx
 D apps/web/src/components/CustomSelect.tsx
 D apps/web/src/components/DesignBrowserPanel.tsx
 D apps/web/src/components/DesignFilesPanel.tsx
 D apps/web/src/components/DesignKitView.tsx
 D apps/web/src/components/DesignSpecView.tsx
 D apps/web/src/components/DesignSystemAssetDropzone.module.css
 D apps/web/src/components/DesignSystemAssetDropzone.tsx
 D apps/web/src/components/DesignSystemCreateHero.module.css
 D apps/web/src/components/DesignSystemCreateHero.tsx
 D apps/web/src/components/DesignSystemFlow.tsx
 D apps/web/src/components/DesignSystemKitPreview.tsx
 D apps/web/src/components/DesignSystemPicker.tsx
 D apps/web/src/components/DesignSystemPreviewModal.tsx
 D apps/web/src/components/DesignSystemSwitchPicker.tsx
 D apps/web/src/components/DesignSystemsSection.tsx
 D apps/web/src/components/DesignSystemsTab.module.css
 D apps/web/src/components/DesignSystemsTab.tsx
 D apps/web/src/components/DesignsTab.tsx
 D apps/web/src/components/EditorIcon.tsx
 D apps/web/src/components/EntryHelpMenu.tsx
 D apps/web/src/components/EntryNavRail.tsx
 D apps/web/src/components/EntrySettingsMenu.tsx
 D apps/web/src/components/EntryShell.tsx
 D apps/web/src/components/EntryView.tsx
 D apps/web/src/components/ExamplesTab.tsx
 D apps/web/src/components/ExportDiagnosticsButton.tsx
 D apps/web/src/components/FigmaHelpModal.module.css
 D apps/web/src/components/FigmaHelpModal.tsx
 D apps/web/src/components/FigmaImportModal.module.css
 D apps/web/src/components/FigmaImportModal.tsx
 D apps/web/src/components/FileOpsSummary.tsx
 D apps/web/src/components/FileViewer.tsx
 D apps/web/src/components/FileWorkspace.tsx
 D apps/web/src/components/FinalizeDesignButton.tsx
 D apps/web/src/components/GenUIInbox.tsx
 D apps/web/src/components/GenUISurfaceRenderer.tsx
 D apps/web/src/components/GithubStarBadge.tsx
 D apps/web/src/components/HandoffButton.tsx
 D apps/web/src/components/HomeHero.tsx
 D apps/web/src/components/HomeTemplatesReveal.tsx
 D apps/web/src/components/HomeView.tsx
 D apps/web/src/components/Icon.tsx
 D apps/web/src/components/IframeKeepAlivePool.tsx
 D apps/web/src/components/InlineModelSwitcher.tsx
 D apps/web/src/components/InlinePluginsRail.tsx
 D apps/web/src/components/IntegrationsView.tsx
 D apps/web/src/components/KitErrorBoundary.module.css
 D apps/web/src/components/KitErrorBoundary.tsx
 D apps/web/src/components/LanguageMenu.tsx
 D apps/web/src/components/LibraryAssetMeta.tsx
 D apps/web/src/components/LibraryPicker.module.css
 D apps/web/src/components/LibraryPicker.tsx
 D apps/web/src/components/LibraryPreviewModal.module.css
 D apps/web/src/components/LibraryPreviewModal.tsx
 D apps/web/src/components/LibrarySection.module.css
 D apps/web/src/components/LibrarySection.tsx
 D apps/web/src/components/LibraryUploadModal.module.css
 D apps/web/src/components/LibraryUploadModal.tsx
 D apps/web/src/components/LiveArtifactBadges.tsx
 D apps/web/src/components/Loading.tsx
 D apps/web/src/components/ManualEditPanel.tsx
 D apps/web/src/components/MarketplaceView.tsx
 D apps/web/src/components/McpClientSection.tsx
 D apps/web/src/components/MemoryHooksPanel.module.css
 D apps/web/src/components/MemoryHooksPanel.tsx
 D apps/web/src/components/MemoryModelInline.tsx
 D apps/web/src/components/MemoryProfilePanel.module.css
 D apps/web/src/components/MemoryProfilePanel.tsx
 D apps/web/src/components/MemorySection.tsx
 D apps/web/src/components/MemoryToast.tsx
 D apps/web/src/components/MissingBrandFontsBanner.tsx
 D apps/web/src/components/NewAutomationModal.tsx
 D apps/web/src/components/NewBrandModal.module.css
 D apps/web/src/components/NewBrandModal.tsx
 D apps/web/src/components/NewProjectModal.tsx
 D apps/web/src/components/NewProjectPanel.tsx
 D apps/web/src/components/NextStepActions.module.css
 D apps/web/src/components/NextStepActions.tsx
 D apps/web/src/components/OdCard.module.css
 D apps/web/src/components/OdCard.tsx
 D apps/web/src/components/PaletteTweaks.tsx
 D apps/web/src/components/PasteTextDialog.tsx
 D apps/web/src/components/PlanBadge.tsx
 D apps/web/src/components/PluginDetailView.tsx
 D apps/web/src/components/PluginDetailsModal.tsx
 D apps/web/src/components/PluginInputsForm.tsx
 D apps/web/src/components/PluginLoopHome.tsx
 D apps/web/src/components/PluginsHomeSection.tsx
 D apps/web/src/components/PluginsSection.tsx
 D apps/web/src/components/PluginsView.tsx
 D apps/web/src/components/PreviewDrawOverlay.tsx
 D apps/web/src/components/PreviewModal.tsx
 D apps/web/src/components/PrivacyConsentModal.tsx
 D apps/web/src/components/PrivacySection.tsx
 D apps/web/src/components/ProjectActionsToolbar.tsx
 D apps/web/src/components/ProjectLocationsSection.tsx
 D apps/web/src/components/ProjectReferenceModal.module.css
 D apps/web/src/components/ProjectReferenceModal.tsx
 D apps/web/src/components/ProjectView.tsx
 D apps/web/src/components/PromptTemplatePreviewModal.tsx
 D apps/web/src/components/PromptTemplatesTab.tsx
 D apps/web/src/components/QuestionForm.tsx
 D apps/web/src/components/QuestionsPanel.tsx
 D apps/web/src/components/QuickSwitcher.tsx
 D apps/web/src/components/RecentProjectsStrip.tsx
 D apps/web/src/components/RemixIcon.tsx
 D apps/web/src/components/RoutinesSection.tsx
 D apps/web/src/components/SessionModeToggle.tsx
 D apps/web/src/components/SettingsDialog.tsx
 D apps/web/src/components/SketchEditor.tsx
 D apps/web/src/components/SketchEnginePrewarm.module.css
 D apps/web/src/components/SketchEnginePrewarm.tsx
 D apps/web/src/components/SketchPreview.tsx
 D apps/web/src/components/SkillDetailsModal.tsx
 D apps/web/src/components/SkillsSection.tsx
 D apps/web/src/components/SocialShareGrid.tsx
 D apps/web/src/components/TasksView.tsx
 D apps/web/src/components/Theater/AGENTS.md
 D apps/web/src/components/Theater/CritiqueTheaterMount.tsx
 D apps/web/src/components/Theater/InterruptButton.tsx
 D apps/web/src/components/Theater/PanelistLane.tsx
 D apps/web/src/components/Theater/RoundDivider.tsx
 D apps/web/src/components/Theater/ScoreTicker.tsx
 D apps/web/src/components/Theater/TheaterCollapsed.tsx
 D apps/web/src/components/Theater/TheaterDegraded.tsx
 D apps/web/src/components/Theater/TheaterStage.tsx
 D apps/web/src/components/Theater/TheaterTranscript.tsx
 D apps/web/src/components/Theater/hooks/useCritiqueReplay.ts
 D apps/web/src/components/Theater/hooks/useCritiqueStream.ts
 D apps/web/src/components/Theater/hooks/useCritiqueTheaterEnabled.ts
 D apps/web/src/components/Theater/index.ts
 D apps/web/src/components/Theater/state/reducer.ts
 D apps/web/src/components/Theater/state/sse.ts
 D apps/web/src/components/Toast.tsx
 D apps/web/src/components/ToolCard.tsx
 D apps/web/src/components/TooltipLayer.tsx
 D apps/web/src/components/TrustBadge.tsx
 D apps/web/src/components/UpdaterPopup.tsx
 D apps/web/src/components/UseEverywhereModal.tsx
 D apps/web/src/components/WorkingDirPicker.module.css
 D apps/web/src/components/WorkingDirPicker.tsx
 D apps/web/src/components/WorkspaceTabsBar.tsx
 D apps/web/src/components/XaiOAuthControl.tsx
 D apps/web/src/components/agentModelSelection.ts
 D apps/web/src/components/agentOrdering.ts
 D apps/web/src/components/amrLoginPolling.ts
 D apps/web/src/components/auto-open-file.ts
 D apps/web/src/components/byok/ByokConnectionTestControl.tsx
 D apps/web/src/components/byok/ByokKeyField.tsx
 D apps/web/src/components/byok/ByokModelField.tsx
 D apps/web/src/components/byok/ByokProviderBaseUrl.tsx
 D apps/web/src/components/byok/ByokProviderPicker.tsx
 D apps/web/src/components/byok/validation.ts
 D apps/web/src/components/composer-detail-position.ts
 D apps/web/src/components/composer-flyout-placement.ts
 D apps/web/src/components/composer/CaretFloatingLayer.tsx
 D apps/web/src/components/composer/LexicalComposerInput.tsx
 D apps/web/src/components/composer/MentionNode.ts
 D apps/web/src/components/composer/deserialize.ts
 D apps/web/src/components/composer/serialize.ts
 D apps/web/src/components/connectors-events.ts
 D apps/web/src/components/connectors-state.ts
 D apps/web/src/components/design-browser-tools.ts
 D apps/web/src/components/design-files/designArtifacts.ts
 D apps/web/src/components/design-files/pluginFolderActions.ts
 D apps/web/src/components/design-files/pluginFolders.ts
 D apps/web/src/components/design-system-github-evidence.ts
 D apps/web/src/components/design-system-group-order.ts
 D apps/web/src/components/design-system-metadata.ts
 D apps/web/src/components/design-system-project.ts
 D apps/web/src/components/enterpriseUrl.ts
 D apps/web/src/components/file-viewer-render-mode.ts
 D apps/web/src/components/home-hero/EdgeAutoScroll.tsx
 D apps/web/src/components/home-hero/PlaceholderCarousel.tsx
 D apps/web/src/components/home-hero/ScenarioArt.tsx
 D apps/web/src/components/home-hero/TemplatePicker.tsx
 D apps/web/src/components/home-hero/chip-labels.ts
 D apps/web/src/components/home-hero/chips.ts
 D apps/web/src/components/home-hero/firstRunGuide.ts
 D apps/web/src/components/home-hero/media-surfaces.ts
 D apps/web/src/components/home-hero/placeholderScenarios.ts
 D apps/web/src/components/home-hero/plugin-authoring.ts
 D apps/web/src/components/home-hero/sub-chips.ts
 D apps/web/src/components/markdown-scroll-sync.ts
 D apps/web/src/components/modelOptions.tsx
 D apps/web/src/components/pet/DesktopPetSurface.tsx
 D apps/web/src/components/pet/PetOverlay.tsx
 D apps/web/src/components/pet/PetSettings.tsx
 D apps/web/src/components/pet/PetSpriteFace.tsx
 D apps/web/src/components/pet/codexAtlas.ts
 D apps/web/src/components/pet/image.ts
 D apps/web/src/components/pet/pets.ts
 D apps/web/src/components/pet/taskCenter.ts
 D apps/web/src/components/plugin-details/PluginByline.tsx
 D apps/web/src/components/plugin-details/PluginDesignSystemDetail.tsx
 D apps/web/src/components/plugin-details/PluginExampleDetail.tsx
 D apps/web/src/components/plugin-details/PluginMediaDetail.tsx
 D apps/web/src/components/plugin-details/PluginMetaSections.tsx
 D apps/web/src/components/plugin-details/PluginPreviewHero.tsx
 D apps/web/src/components/plugin-details/PluginScenarioDetail.tsx
 D apps/web/src/components/plugin-details/PluginShareMenu.tsx
 D apps/web/src/components/plugin-details/pluginUseMenu.ts
 D apps/web/src/components/plugins-home/PluginCard.tsx
 D apps/web/src/components/plugins-home/cards/DesignSystemSurface.tsx
 D apps/web/src/components/plugins-home/cards/HtmlSurface.tsx
 D apps/web/src/components/plugins-home/cards/MediaSurface.tsx
 D apps/web/src/components/plugins-home/cards/PreviewSurface.tsx
 D apps/web/src/components/plugins-home/cards/TextSurface.tsx
 D apps/web/src/components/plugins-home/curatedPriority.ts
 D apps/web/src/components/plugins-home/duplicate.ts
 D apps/web/src/components/plugins-home/facets.ts
 D apps/web/src/components/plugins-home/localization.ts
 D apps/web/src/components/plugins-home/presetSeedPrompt.ts
 D apps/web/src/components/plugins-home/preview.ts
 D apps/web/src/components/plugins-home/savedPlugins.ts
 D apps/web/src/components/plugins-home/subfacetLabel.ts
 D apps/web/src/components/plugins-home/useActions.ts
 D apps/web/src/components/plugins-home/useInView.ts
 D apps/web/src/components/plugins-home/usePluginFacets.ts
 D apps/web/src/components/plugins-home/visualScore.ts
 D apps/web/src/components/providerModelsCache.ts
 D apps/web/src/components/share-to-community/shareToCommunityPrompt.ts
 D apps/web/src/components/sketch-colors.ts
 D apps/web/src/components/sketch-model.ts
 D apps/web/src/components/use-everywhere/agent-guide.ts
 D apps/web/src/components/use-everywhere/sections.ts
 D apps/web/src/components/useDiscordPresence.ts
 D apps/web/src/components/useGithubStars.ts
 D apps/web/src/components/useOpenFolderImport.ts
 D apps/web/src/components/workspace-context.ts
 D apps/web/src/components/workspace/SideChatTab.module.css
 D apps/web/src/components/workspace/SideChatTab.tsx
 D apps/web/src/components/workspace/TabLauncherMenu.module.css
 D apps/web/src/components/workspace/TabLauncherMenu.tsx
 D apps/web/src/components/workspace/TerminalViewer.module.css
 D apps/web/src/components/workspace/TerminalViewer.tsx
 D apps/web/src/components/workspace/tab-launcher.ts
 D apps/web/src/components/workspace/useConversationChat.ts
 D apps/web/src/design-system-auto-prompt.ts
 D apps/web/src/edit-mode/bridge.ts
 D apps/web/src/edit-mode/source-patches.ts
 D apps/web/src/edit-mode/types.ts
 D apps/web/src/features/libraryUi.ts
 D apps/web/src/hooks/useCoalescedCallback.ts
 D apps/web/src/hooks/useDesignMdState.ts
 D apps/web/src/hooks/useFinalizeProject.ts
 D apps/web/src/hooks/useModalWindowDragGuard.ts
 D apps/web/src/hooks/useProjectDetail.ts
 D apps/web/src/hooks/useTerminalLaunch.ts
 D apps/web/src/i18n/content.ar.ts
 D apps/web/src/i18n/content.es-ES.ts
 D apps/web/src/i18n/content.fa.ts
 D apps/web/src/i18n/content.fr.ts
 D apps/web/src/i18n/content.hu.ts
 D apps/web/src/i18n/content.id.ts
 D apps/web/src/i18n/content.it.ts
 D apps/web/src/i18n/content.ja.ts
 D apps/web/src/i18n/content.ko.ts
 D apps/web/src/i18n/content.pl.ts
 D apps/web/src/i18n/content.pt-BR.ts
 D apps/web/src/i18n/content.ru.ts
 D apps/web/src/i18n/content.th.ts
 D apps/web/src/i18n/content.tr.ts
 D apps/web/src/i18n/content.ts
 D apps/web/src/i18n/content.uk.ts
 D apps/web/src/i18n/content.zh-CN.ts
 D apps/web/src/i18n/index.tsx
 D apps/web/src/i18n/locales/ar.ts
 D apps/web/src/i18n/locales/de.ts
 D apps/web/src/i18n/locales/en.ts
 D apps/web/src/i18n/locales/es-ES.ts
 D apps/web/src/i18n/locales/fa.ts
 D apps/web/src/i18n/locales/fr.ts
 D apps/web/src/i18n/locales/hu.ts
 D apps/web/src/i18n/locales/id.ts
 D apps/web/src/i18n/locales/it.ts
 D apps/web/src/i18n/locales/ja.ts
 D apps/web/src/i18n/locales/ko.ts
 D apps/web/src/i18n/locales/pl.ts
 D apps/web/src/i18n/locales/pt-BR.ts
 D apps/web/src/i18n/locales/ru.ts
 D apps/web/src/i18n/locales/th.ts
 D apps/web/src/i18n/locales/tr.ts
 D apps/web/src/i18n/locales/uk.ts
 D apps/web/src/i18n/locales/zh-CN.ts
 D apps/web/src/i18n/locales/zh-TW.ts
 D apps/web/src/i18n/plugin-content.ts
 D apps/web/src/i18n/runErrors.ts
 D apps/web/src/i18n/types.ts
 D apps/web/src/index.css
 D apps/web/src/lib/build-clipboard-prompt.ts
 D apps/web/src/lib/build-continue-in-cli-toast.ts
 D apps/web/src/lib/copy-to-clipboard.ts
 D apps/web/src/lib/parse-provenance.ts
 D apps/web/src/lib/pod-members.ts
 D apps/web/src/lib/resolve-finalize-request.ts
 D apps/web/src/lib/updater.ts
 D apps/web/src/media/aihubmix-image-models.ts
 D apps/web/src/media/execution-policy.ts
 D apps/web/src/media/models.ts
 D apps/web/src/media/provider-readiness.ts
 D apps/web/src/motion.ts
 D apps/web/src/observability/boot-timing.ts
 D apps/web/src/observability/iframe-error.ts
 D apps/web/src/observability/install.ts
 D apps/web/src/observability/long-task.ts
 D apps/web/src/observability/resource-error.ts
 D apps/web/src/observability/stuck-run.ts
 D apps/web/src/observability/visibility.ts
 D apps/web/src/observability/white-screen.ts
 D apps/web/src/produced-files.ts
 D apps/web/src/providers/aihubmix-compatible.ts
 D apps/web/src/providers/anthropic-compatible.ts
 D apps/web/src/providers/anthropic.ts
 D apps/web/src/providers/api-proxy.ts
 D apps/web/src/providers/azure-compatible.ts
 D apps/web/src/providers/connection-test.ts
 D apps/web/src/providers/daemon.ts
 D apps/web/src/providers/elevenlabs-voices.ts
 D apps/web/src/providers/google-compatible.ts
 D apps/web/src/providers/ollama-compatible.ts
 D apps/web/src/providers/openai-compatible.ts
 D apps/web/src/providers/project-events.ts
 D apps/web/src/providers/provider-models.ts
 D apps/web/src/providers/registry.ts
 D apps/web/src/providers/senseaudio-compatible.ts
 D apps/web/src/providers/sse.ts
 D apps/web/src/quickSwitcherRecents.ts
 D apps/web/src/router.ts
 D apps/web/src/runtime/amr-guidance.ts
 D apps/web/src/runtime/brand-browser-bridge.ts
 D apps/web/src/runtime/brand-enrichment.ts
 D apps/web/src/runtime/brand-intent.ts
 D apps/web/src/runtime/brand-references.json
 D apps/web/src/runtime/brand-references.ts
 D apps/web/src/runtime/brands.ts
 D apps/web/src/runtime/chat-events.ts
 D apps/web/src/runtime/design-kit.ts
 D apps/web/src/runtime/design-md-parse.ts
 D apps/web/src/runtime/design-system-package-audit.ts
 D apps/web/src/runtime/design-toolbox.ts
 D apps/web/src/runtime/exports.ts
 D apps/web/src/runtime/file-ops.ts
 D apps/web/src/runtime/home-intent.ts
 D apps/web/src/runtime/in-project-link.ts
 D apps/web/src/runtime/jsx-module-refs.ts
 D apps/web/src/runtime/kit-edit.ts
 D apps/web/src/runtime/kit-upload.ts
 D apps/web/src/runtime/markdown.tsx
 D apps/web/src/runtime/partial-json.ts
 D apps/web/src/runtime/plugin-source.ts
 D apps/web/src/runtime/react-component.ts
 D apps/web/src/runtime/resume.ts
 D apps/web/src/runtime/shiki.ts
 D apps/web/src/runtime/slide-nav.ts
 D apps/web/src/runtime/srcdoc.ts
 D apps/web/src/runtime/todos.ts
 D apps/web/src/runtime/tool-events.ts
 D apps/web/src/runtime/tool-renderers.ts
 D apps/web/src/runtime/useBrandExtract.ts
 D apps/web/src/runtime/useBrandReadyPrompt.ts
 D apps/web/src/runtime/zip.ts
 D apps/web/src/state/apiProtocols.ts
 D apps/web/src/state/appearance.ts
 D apps/web/src/state/config.ts
 D apps/web/src/state/libraryHandoff.ts
 D apps/web/src/state/litellm-models.json
 D apps/web/src/state/maxTokens.ts
 D apps/web/src/state/mcp.ts
 D apps/web/src/state/onboarding-profile.ts
 D apps/web/src/state/project-locations.ts
 D apps/web/src/state/projects.ts
 D apps/web/src/styles/base.css
 D apps/web/src/styles/chat.css
 D apps/web/src/styles/design-system-flow.css
 D apps/web/src/styles/entrance.css
 D apps/web/src/styles/home/entry-layout.css
 D apps/web/src/styles/home/home-hero.css
 D apps/web/src/styles/home/index.css
 D apps/web/src/styles/home/integrations.css
 D apps/web/src/styles/home/marketplace.css
 D apps/web/src/styles/home/new-project-modal.css
 D apps/web/src/styles/home/plugins-home.css
 D apps/web/src/styles/home/plugins-view.css
 D apps/web/src/styles/home/plus-menu.css
 D apps/web/src/styles/home/recent-projects.css
 D apps/web/src/styles/home/tasks.css
 D apps/web/src/styles/home/use-everywhere.css
 D apps/web/src/styles/modal-window-drag.css
 D apps/web/src/styles/plan-badge.css
 D apps/web/src/styles/primitives.css
 D apps/web/src/styles/remixicon/remixicon.css
 D apps/web/src/styles/shell.css
 D apps/web/src/styles/social-share.css
 D apps/web/src/styles/tokens.css
 D apps/web/src/styles/viewer/code.css
 D apps/web/src/styles/viewer/composio.css
 D apps/web/src/styles/viewer/core.css
 D apps/web/src/styles/viewer/library.css
 D apps/web/src/styles/viewer/memory.css
 D apps/web/src/styles/viewer/pets.css
 D apps/web/src/styles/viewer/plugin-inputs.css
 D apps/web/src/styles/viewer/plugin-rail.css
 D apps/web/src/styles/viewer/routines.css
 D apps/web/src/styles/viewer/templates-plugins.css
 D apps/web/src/styles/viewer/theater.css
 D apps/web/src/styles/viewer/tools.css
 D apps/web/src/styles/workspace/artifacts.css
 D apps/web/src/styles/workspace/connectors.css
 D apps/web/src/styles/workspace/design-browser.css
 D apps/web/src/styles/workspace/design-files.css
 D apps/web/src/styles/workspace/drawer.css
 D apps/web/src/styles/workspace/mention-home.css
 D apps/web/src/styles/workspace/terminal.css
 D apps/web/src/types.ts
 D apps/web/src/utils/agentLabels.ts
 D apps/web/src/utils/apiProtocol.ts
 D apps/web/src/utils/byokProvider.ts
 D apps/web/src/utils/chatTime.ts
 D apps/web/src/utils/connectorBrandColor.ts
 D apps/web/src/utils/fileSystemErrors.ts
 D apps/web/src/utils/imeComposing.ts
 D apps/web/src/utils/inlineMentions.ts
 D apps/web/src/utils/notifications.ts
 D apps/web/src/utils/pickAndImportError.ts
 D apps/web/src/utils/platform.ts
 D apps/web/src/utils/pluginInsertionTracking.ts
 D apps/web/src/utils/pluginRequiredInputs.ts
 D apps/web/src/utils/projectName.ts
 D apps/web/src/utils/promptTemplateDsCategories.ts
 D apps/web/src/utils/smoothScrollToTop.ts
 D apps/web/src/utils/uuid.ts
 D apps/web/src/utils/visibleAgents.ts
 D apps/web/src/utils/visualStability.ts
?? ADS-project-knowledge/reports/swarm-consensus/smoke-tests/2026-07-16T160738Z-claude-discovery.md
?? ADS-project-knowledge/reports/swarm-consensus/smoke-tests/history/
?? ADS-project-knowledge/reports/swarm-consensus/smoke-tests/last-known-good.json
?? apps/web/src
?? apps/web/src.orig/
?? docs/jini-architecture-blind-debate-brief.md
?? docs/jini-open-design-porting-plan.md

exec
/bin/bash -lc 'git status --short --branch && git rev-list --left-right --count HEAD...origin/main && git rev-list --left-right --count HEAD...fork/refactor/web-memory-slice 2>/dev/null || true' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 13068ms:
2026-07-16 09:28:53.981 xcodebuild[32968:1024073]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:54.342 xcodebuild[32979:1024079]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:54.709 xcodebuild[32979:1024077] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Hrav1B0K' (errno=Operation not permitted)
2026-07-16 09:28:55.600 xcodebuild[32990:1024106]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:55.906 xcodebuild[32991:1024111]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:56.234 xcodebuild[32991:1024110] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
## refactor/web-memory-slice...fork/refactor/web-memory-slice [behind 1]
?? ADS-project-knowledge/
?? apps/web/coverage/
?? docs/jini-open-design-porting-plan.md
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-wVqUAGWk' (errno=Operation not permitted)
2026-07-16 09:28:58.394 xcodebuild[32995:1024162]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:58.703 xcodebuild[32996:1024167]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:28:59.031 xcodebuild[32996:1024166] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-VvR0He2O' (errno=Operation not permitted)
2026-07-16 09:28:59.849 xcodebuild[32997:1024183]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:29:00.201 xcodebuild[32998:1024204]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:29:00.521 xcodebuild[32998:1024187] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
36	52
0	1

exec
/bin/bash -lc "find . -maxdepth 2 -mindepth 1 -type d -not -path './.git*' -not -path './node_modules*' -not -path './.tmp*' | sort | sed -n '1,280p'" in /Users/la/Desktop/Programming/Jini
exec
/bin/bash -lc "find . -maxdepth 2 -mindepth 1 -type d -not -path './.git*' -not -path './node_modules*' -not -path './.tmp*' | sort | sed -n '1,240p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
./.claude
./.claude-plugin
./.claude/commands
./.claude/skills
./.claude/worktrees
./.code-review-graph
./.codegraph
./.looper-attachments
./.od
./.od/artifacts
./.od/brands
./.od/connectors
./.od/critique-artifacts
./.od/design-systems
./.od/design-templates
./.od/library
./.od/memory
./.od/plugins
./.od/projects
./.od/runs
./.od/skills
./.playwright-mcp
./.serena
./.serena/cache
./.serena/memories
./.understand-anything
./.understand-anything/intermediate
./.understand-anything/tmp
./.vaunt
./.vaunt/icons
./ADS-project-knowledge
./ADS-project-knowledge/.local-artifacts
./AI-Dev-Shop
./AI-Dev-Shop/.claude
./AI-Dev-Shop/.gemini
./AI-Dev-Shop/.git
./AI-Dev-Shop/ADS-memory
./AI-Dev-Shop/agents
./AI-Dev-Shop/framework
./AI-Dev-Shop/harness-engineering
./AI-Dev-Shop/integrations
./AI-Dev-Shop/project-knowledge-template
./AI-Dev-Shop/skills
./apps
./apps/daemon
./apps/desktop
./apps/landing-page
./apps/packaged
./apps/web
./assets
./assets/community-pets
./assets/frames
./assets/prompt-templates
./charts
./charts/open-design
./clipper
./clipper/_locales
./clipper/assets
./clipper/icons
./clipper/store
./craft
./data
./data/cards
./data/plugin-previews
./deploy
./deploy/aws
./deploy/azure
./deploy/scripts
./deploy/tests
./design-systems
./design-systems/_schema
./design-systems/agentic
./design-systems/airbnb
./design-systems/airtable
./design-systems/ant
./design-systems/apple
./design-systems/application
./design-systems/arc
./design-systems/artistic
./design-systems/atelier-zero
./design-systems/bento
./design-systems/binance
./design-systems/bmw
./design-systems/bmw-m
./design-systems/bold
./design-systems/brutalism
./design-systems/bugatti
./design-systems/cafe
./design-systems/cal
./design-systems/canva
./design-systems/cisco
./design-systems/claude
./design-systems/clay
./design-systems/claymorphism
./design-systems/clean
./design-systems/clickhouse
./design-systems/cohere
./design-systems/coinbase
./design-systems/colorful
./design-systems/composio
./design-systems/contemporary
./design-systems/corporate
./design-systems/cosmic
./design-systems/creative
./design-systems/cursor
./design-systems/dashboard
./design-systems/default
./design-systems/discord
./design-systems/dithered
./design-systems/doodle
./design-systems/dramatic
./design-systems/duolingo
./design-systems/editorial
./design-systems/elegant
./design-systems/elevenlabs
./design-systems/energetic
./design-systems/enterprise
./design-systems/expo
./design-systems/expressive
./design-systems/fantasy
./design-systems/ferrari
./design-systems/figma
./design-systems/flat
./design-systems/framer
./design-systems/friendly
./design-systems/futuristic
./design-systems/github
./design-systems/glassmorphism
./design-systems/gradient
./design-systems/hashicorp
./design-systems/hud
./design-systems/huggingface
./design-systems/ibm
./design-systems/intercom
./design-systems/kami
./design-systems/kraken
./design-systems/lamborghini
./design-systems/levels
./design-systems/linear-app
./design-systems/lingo
./design-systems/loom
./design-systems/lovable
./design-systems/luxury
./design-systems/mastercard
./design-systems/material
./design-systems/meta
./design-systems/minimal
./design-systems/minimax
./design-systems/mintlify
./design-systems/miro
./design-systems/mission-control
./design-systems/mistral-ai
./design-systems/modern
./design-systems/mongodb
./design-systems/mono
./design-systems/neobrutalism
./design-systems/neon
./design-systems/neumorphism
./design-systems/nike
./design-systems/notion
./design-systems/nvidia
./design-systems/ollama
./design-systems/openai
./design-systems/opencode-ai
./design-systems/pacman
./design-systems/paper
./design-systems/perplexity
./design-systems/perspective
./design-systems/pinterest
./design-systems/playstation
./design-systems/posthog
./design-systems/premium
./design-systems/professional
./design-systems/publication
./design-systems/raycast
./design-systems/refined
./design-systems/renault
./design-systems/replicate
./design-systems/resend
./design-systems/retro
./design-systems/revolut
./design-systems/runwayml
./design-systems/sanity
./design-systems/sentry
./design-systems/shadcn
./design-systems/shopify
./design-systems/simple
./design-systems/skeumorphism
./design-systems/slack
./design-systems/sleek
./design-systems/spacex
./design-systems/spacious
./design-systems/spotify
./design-systems/starbucks
./design-systems/storytelling
./design-systems/stripe
./design-systems/supabase
./design-systems/superhuman
./design-systems/tesla
./design-systems/tetris
./design-systems/theverge
./design-systems/together-ai
./design-systems/tom-modern
./design-systems/totality-festival
./design-systems/trading-terminal
./design-systems/uber
./design-systems/urdu
./design-systems/vercel
./design-systems/vibrant
./design-systems/vintage
./design-systems/vodafone
./design-systems/voltagent
./design-systems/warm-editorial
./design-systems/warp
./design-systems/webex
./design-systems/webflow
./design-systems/wechat
./design-systems/wired
./design-systems/wise
./design-systems/x-ai
./design-systems/xiaohongshu
./design-systems/zapier
./design-templates
./design-templates/audio-jingle
./design-templates/blog-post
./design-templates/clinical-case-report
./design-templates/contact-widget
./design-templates/critique
./design-templates/dashboard
./design-templates/dating-web
./design-templates/dcf-valuation
./design-templates/digital-eguide
./design-templates/docs-page
./design-templates/email-marketing
./design-templates/eng-runbook
./design-templates/finance-report
./design-templates/flowai-live-dashboard-template
./design-templates/gamified-app
./design-templates/github-dashboard
./design-templates/guizang-ppt

 succeeded in 0ms:
./.claude
./.claude-plugin
./.claude/commands
./.claude/skills
./.od
./.od/artifacts
./.od/brands
./.od/critique-artifacts
./.od/design-systems
./.od/design-templates
./.od/library
./.od/plugins
./.od/projects
./.od/skills
./.vaunt
./.vaunt/icons
./ADS-project-knowledge
./ADS-project-knowledge/governance
./ADS-project-knowledge/memory
./ADS-project-knowledge/meta
./ADS-project-knowledge/reports
./ADS-project-knowledge/specs
./ADS-project-knowledge/specs_as_built
./AI-Dev-Shop
./AI-Dev-Shop/.claude
./AI-Dev-Shop/.gemini
./AI-Dev-Shop/ADS-project-knowledge
./AI-Dev-Shop/agents
./AI-Dev-Shop/framework
./AI-Dev-Shop/harness-engineering
./AI-Dev-Shop/integrations
./AI-Dev-Shop/project-knowledge-template
./AI-Dev-Shop/skills
./apps
./apps/daemon
./apps/desktop
./apps/landing-page
./apps/packaged
./apps/telemetry-worker
./apps/web
./assets
./assets/community-pets
./assets/frames
./assets/prompt-templates
./charts
./charts/open-design
./clipper
./clipper/_locales
./clipper/assets
./clipper/icons
./clipper/store
./craft
./data
./data/cards
./data/plugin-previews
./deploy
./deploy/aws
./deploy/azure
./deploy/scripts
./deploy/tests
./design-systems
./design-systems/_schema
./design-systems/agentic
./design-systems/airbnb
./design-systems/airtable
./design-systems/ant
./design-systems/apple
./design-systems/application
./design-systems/arc
./design-systems/artistic
./design-systems/atelier-zero
./design-systems/bento
./design-systems/binance
./design-systems/bmw
./design-systems/bmw-m
./design-systems/bold
./design-systems/brutalism
./design-systems/bugatti
./design-systems/cafe
./design-systems/cal
./design-systems/canva
./design-systems/cisco
./design-systems/claude
./design-systems/clay
./design-systems/claymorphism
./design-systems/clean
./design-systems/clickhouse
./design-systems/cohere
./design-systems/coinbase
./design-systems/colorful
./design-systems/composio
./design-systems/contemporary
./design-systems/corporate
./design-systems/cosmic
./design-systems/creative
./design-systems/cursor
./design-systems/dashboard
./design-systems/default
./design-systems/discord
./design-systems/dithered
./design-systems/doodle
./design-systems/dramatic
./design-systems/duolingo
./design-systems/editorial
./design-systems/elegant
./design-systems/elevenlabs
./design-systems/energetic
./design-systems/enterprise
./design-systems/expo
./design-systems/expressive
./design-systems/fantasy
./design-systems/ferrari
./design-systems/figma
./design-systems/flat
./design-systems/framer
./design-systems/friendly
./design-systems/futuristic
./design-systems/github
./design-systems/glassmorphism
./design-systems/gradient
./design-systems/hashicorp
./design-systems/hud
./design-systems/huggingface
./design-systems/ibm
./design-systems/intercom
./design-systems/kami
./design-systems/kraken
./design-systems/lamborghini
./design-systems/levels
./design-systems/linear-app
./design-systems/lingo
./design-systems/loom
./design-systems/lovable
./design-systems/luxury
./design-systems/mastercard
./design-systems/material
./design-systems/meta
./design-systems/minimal
./design-systems/minimax
./design-systems/mintlify
./design-systems/miro
./design-systems/mission-control
./design-systems/mistral-ai
./design-systems/modern
./design-systems/mongodb
./design-systems/mono
./design-systems/neobrutalism
./design-systems/neon
./design-systems/neumorphism
./design-systems/nike
./design-systems/notion
./design-systems/nvidia
./design-systems/ollama
./design-systems/openai
./design-systems/opencode-ai
./design-systems/pacman
./design-systems/paper
./design-systems/perplexity
./design-systems/perspective
./design-systems/pinterest
./design-systems/playstation
./design-systems/posthog
./design-systems/premium
./design-systems/professional
./design-systems/publication
./design-systems/raycast
./design-systems/refined
./design-systems/renault
./design-systems/replicate
./design-systems/resend
./design-systems/retro
./design-systems/revolut
./design-systems/runwayml
./design-systems/sanity
./design-systems/sentry
./design-systems/shadcn
./design-systems/shopify
./design-systems/simple
./design-systems/skeumorphism
./design-systems/slack
./design-systems/sleek
./design-systems/spacex
./design-systems/spacious
./design-systems/spotify
./design-systems/starbucks
./design-systems/storytelling
./design-systems/stripe
./design-systems/supabase
./design-systems/superhuman
./design-systems/tesla
./design-systems/tetris
./design-systems/theverge
./design-systems/together-ai
./design-systems/totality-festival
./design-systems/trading-terminal
./design-systems/uber
./design-systems/urdu
./design-systems/vercel
./design-systems/vibrant
./design-systems/vintage
./design-systems/vodafone
./design-systems/voltagent
./design-systems/warm-editorial
./design-systems/warp
./design-systems/webex
./design-systems/webflow
./design-systems/wechat
./design-systems/wired
./design-systems/wise
./design-systems/x-ai
./design-systems/xiaohongshu
./design-systems/zapier
./design-templates
./design-templates/audio-jingle
./design-templates/blog-post
./design-templates/clinical-case-report
./design-templates/contact-widget
./design-templates/critique
./design-templates/dashboard
./design-templates/dating-web
./design-templates/dcf-valuation
./design-templates/digital-eguide
./design-templates/docs-page
./design-templates/email-marketing
./design-templates/eng-runbook
./design-templates/finance-report
./design-templates/flowai-live-dashboard-template
./design-templates/gamified-app
./design-templates/github-dashboard
./design-templates/guizang-ppt
./design-templates/hr-onboarding
./design-templates/html-ppt
./design-templates/html-ppt-course-module
./design-templates/html-ppt-graphify-dark-graph
./design-templates/html-ppt-hermes-cyber-terminal
./design-templates/html-ppt-knowledge-arch-blueprint
./design-templates/html-ppt-obsidian-claude-gradient
./design-templates/html-ppt-pitch-deck
./design-templates/html-ppt-presenter-mode-reveal
./design-templates/html-ppt-product-launch
./design-templates/html-ppt-taste-brutalist
./design-templates/html-ppt-taste-editorial
./design-templates/html-ppt-tech-sharing
./design-templates/html-ppt-testing-safety-alert
./design-templates/html-ppt-weekly-report
./design-templates/html-ppt-xhs-pastel-card
./design-templates/html-ppt-xhs-white-editorial
./design-templates/html-ppt-zhangzara-8-bit-orbit
./design-templates/html-ppt-zhangzara-biennale-yellow
./design-templates/html-ppt-zhangzara-block-frame
./design-templates/html-ppt-zhangzara-blue-professional
./design-templates/html-ppt-zhangzara-bold-poster
./design-templates/html-ppt-zhangzara-broadside
./design-templates/html-ppt-zhangzara-capsule
./design-templates/html-ppt-zhangzara-cartesian
./design-templates/html-ppt-zhangzara-cobalt-grid
./design-templates/html-ppt-zhangzara-coral
./design-templates/html-ppt-zhangzara-creative-mode
./design-templates/html-ppt-zhangzara-daisy-days
./design-templates/html-ppt-zhangzara-editorial-tri-tone
./design-templates/html-ppt-zhangzara-grove
./design-templates/html-ppt-zhangzara-long-table
./design-templates/html-ppt-zhangzara-mat
./design-templates/html-ppt-zhangzara-monochrome
./design-templates/html-ppt-zhangzara-neo-grid-bold
./design-templates/html-ppt-zhangzara-peoples-platform
./design-templates/html-ppt-zhangzara-pin-and-paper
./design-templates/html-ppt-zhangzara-pink-script
./design-templates/html-ppt-zhangzara-playful
./design-templates/html-ppt-zhangzara-raw-grid
./design-templates/html-ppt-zhangzara-retro-windows
./design-templates/html-ppt-zhangzara-retro-zine
./design-templates/html-ppt-zhangzara-sakura-chroma
./design-templates/html-ppt-zhangzara-scatterbrain
./design-templates/html-ppt-zhangzara-signal
./design-templates/html-ppt-zhangzara-soft-editorial
./design-templates/html-ppt-zhangzara-stencil-tablet
./design-templates/html-ppt-zhangzara-studio
./design-templates/html-ppt-zhangzara-vellum
./design-templates/hyperframes

exec
/bin/bash -lc 'du -sh . .git apps packages tools 2>/dev/null' in /Users/la/Desktop/Programming/OSS-Repos/open-design
exec
/bin/bash -lc 'for f in apps/*/package.json packages/*/package.json tools/*/package.json; do test -f "$f" && printf '"'%s ' \""'$f" && sed -n '"'s/.*\"name\": \"\\(["'^"]*'"\\)\".*/\\1/p' \""'$f" | head -1; done' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/daemon/package.json @open-design/daemon
apps/desktop/package.json @open-design/desktop
apps/landing-page/package.json @open-design/landing-page
apps/packaged/package.json @open-design/packaged
apps/web/package.json @open-design/web
packages/agui-adapter/package.json @open-design/agui-adapter
packages/components/package.json @open-design/components
packages/contracts/package.json @open-design/contracts
packages/diagnostics/package.json @open-design/diagnostics
packages/download/package.json @open-design/download
packages/host/package.json @open-design/host
packages/launcher-proto/package.json @open-design/launcher-proto
packages/metatool/package.json @open-design/metatool
packages/platform/package.json @open-design/platform
packages/plugin-runtime/package.json @open-design/plugin-runtime
packages/registry-protocol/package.json @open-design/registry-protocol
packages/release/package.json @open-design/release
packages/sidecar-proto/package.json @open-design/sidecar-proto
packages/sidecar/package.json @open-design/sidecar
tools/dev/package.json @open-design/tools-dev
tools/pack/package.json @open-design/tools-pack
tools/release/package.json @open-design/tools-release
tools/serve/package.json @open-design/tools-serve

exec
/bin/bash -lc 'for f in apps/*/package.json packages/*/package.json tools/*/package.json; do test -f "$f" && printf '"'%s ' \""'$f" && sed -n '"'s/.*\"name\": \"\\(["'^"]*'"\\)\".*/\\1/p' \""'$f" | head -1; done' in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
apps/daemon/package.json @open-design/daemon
apps/desktop/package.json @open-design/desktop
apps/landing-page/package.json @open-design/landing-page
apps/packaged/package.json @open-design/packaged
apps/telemetry-worker/package.json @open-design/telemetry-worker
apps/web/package.json @open-design/web
packages/agui-adapter/package.json @open-design/agui-adapter
packages/components/package.json @open-design/components
packages/contracts/package.json @open-design/contracts
packages/diagnostics/package.json @open-design/diagnostics
packages/download/package.json @open-design/download
packages/host/package.json @open-design/host
packages/launcher-proto/package.json @open-design/launcher-proto
packages/metatool/package.json @open-design/metatool
packages/platform/package.json @open-design/platform
packages/plugin-runtime/package.json @open-design/plugin-runtime
packages/registry-protocol/package.json @open-design/registry-protocol
packages/release/package.json @open-design/release
packages/sidecar-proto/package.json @open-design/sidecar-proto
packages/sidecar/package.json @open-design/sidecar
tools/dev/package.json @open-design/tools-dev
tools/pack/package.json @open-design/tools-pack
tools/release/package.json @open-design/tools-release
tools/serve/package.json @open-design/tools-serve

 succeeded in 3965ms:
5.5G	.
1.6G	.git
200M	apps
7.3M	packages
7.4M	tools

exec
/bin/bash -lc "rg --files apps packages | rg '("'^|/)AGENTS'"\\.md"'$'"'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/AGENTS.md
apps/landing-page/AGENTS.md
packages/AGENTS.md
apps/packaged/AGENTS.md
apps/daemon/AGENTS.md
apps/daemon/src/critique/AGENTS.md
apps/web/src/components/Theater/AGENTS.md

exec
/bin/bash -lc "cat 'apps/AGENTS.md'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# apps/AGENTS.md

Follow the root `AGENTS.md` first. This file only records module-level boundaries for `apps/`.

## Active apps

- `apps/web`: Next.js 16 App Router + React 18 web runtime. Entrypoints live in `apps/web/app/`; the main client shell is `apps/web/src/App.tsx`. During local `tools-dev` web runs, `apps/web/next.config.ts` rewrites `/api/*`, `/artifacts/*`, and `/frames/*` to `OD_PORT`.
- `apps/daemon`: Express + SQLite local daemon and `od` bin. It owns REST/SSE APIs, agent CLI spawning, skills, design systems, artifact persistence, static serving, and daemon-managed data. Before describing or changing daemon data paths, read the root `AGENTS.md` section **Daemon data directory contract**; it is mandatory and must not be restated here.
- `apps/desktop`: Electron shell. Desktop does not guess the web port; it reads runtime status through sidecar IPC and opens the reported web URL.
- `apps/packaged`: Thin packaged Electron runtime entry. It starts packaged daemon/web sidecars, registers the `od://` entry protocol, and delegates desktop host behavior to `apps/desktop`.

## apps/web frontend refactors (vertical slices)

Before decomposing a large `apps/web` component (a "god-component" like `SettingsDialog`, `MemorySection`, or `ChatComposer`), read `docs/adr/0002-frontend-vertical-slice-decomposition.md` first. It is the canonical design for this work and covers: the layer split (wire DTOs → `packages/contracts`, transport adapters → `apps/web/src/providers/`, in-slice `features/<slice>/` owning ports + rules + hooks + dumb components + barrel), the injected-port hook paradigm, and the **Testing & coverage strategy for a slice** subsection (how to reach ≥95% honestly — classify each "unreachable" branch and apply the matching fix instead of `/* v8 ignore */`).

The `MemorySection` slice (`apps/web/src/features/memory/`) is the worked canary; mirror its structure. A detailed session working-log for that canary lives in the branch's `ADS-project-knowledge/reports/*-memory-slice-*handoff.md` when present.

## Daemon layout

- `apps/daemon/src/` contains only daemon app source.
- `apps/daemon/tests/` contains daemon tests.
- `apps/daemon/sidecar/` contains the daemon sidecar entry.
- CLI/agent argument definition changes belong in `apps/daemon/src/runtimes/defs/`; stdout parser changes belong with the matching runtime helpers and parser tests.

### Router layout

- Existing daemon domain endpoints belong in the matching daemon route file; avoid adding route handlers directly to `apps/daemon/src/server.ts` unless the route is bootstrap-wide or has no clear domain owner.
- New route registrars should be wired into the matching semantic section in `server.ts`; keep sections broad and reuse existing sections before adding a new one.
- Bootstrap-wide routes describe daemon availability or startup metadata shared by every domain. `/api/health` and `/api/version` stay in `server.ts` because they only report process-level status.
- Domain routes describe a product capability or data model. `/api/active` belongs in `apps/daemon/src/routes/active-context.ts` because transient UI focus is its own domain, while chat routes own persistent conversation and run state.
- Add endpoints to an existing route file when they share the same domain language and dependency set. Split a new module under `apps/daemon/src/routes/` when the endpoint introduces a distinct domain or has little dependency overlap with existing route modules.

## Test layout

- App tests live in each app's `tests/` directory, sibling to `src/`; preserve source-relative subpaths inside `tests/` when useful.
- Keep app `src/` directories source-only; do not add new `*.test.ts` or `*.test.tsx` files under `src/`.
- `apps/web/tests/` contains web-owned Vitest tests and uses `*.test.ts` / `*.test.tsx`.
- Playwright UI automation belongs in `e2e/ui/`; do not add Playwright suites or UI automation helper scripts under `apps/web`.

## Sidecar awareness

- App business layers must not import sidecar packages or branch on `runtime.mode`, `namespace`, `ipc`, or `source`.
- Keep sidecar awareness in `apps/<app>/sidecar` or the desktop sidecar entry wrapper.

## Packaged runtime

- `apps/nextjs` has been removed; do not restore it.
- Packaged web uses Next.js SSR through the web sidecar; do not put Next output under daemon `OD_RESOURCE_ROOT`.
- Packaged `OD_RESOURCE_ROOT` is only for daemon non-Next read-only resources: `skills/`, `design-systems/`, and `frames/`.
- Packaged data/log/runtime/cache paths must be namespace-scoped and must not depend on daemon or web ports.
- Daemon↔web packaged traffic still uses an HTTP origin/port because Next.js dev server and SSR proxy paths assume HTTP origins; switching to Unix sockets would require patching Next internals. The invariant is that data/log/runtime/cache paths never embed ports.

## Common app commands

```bash
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/web test
pnpm --filter @open-design/daemon typecheck
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/daemon build
pnpm --filter @open-design/desktop typecheck
pnpm --filter @open-design/desktop build
pnpm --filter @open-design/packaged typecheck
pnpm --filter @open-design/packaged build
```

exec
/bin/bash -lc "cat 'apps/daemon/AGENTS.md'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# apps/daemon/AGENTS.md

Follow the root `AGENTS.md` and `apps/AGENTS.md` first. This file records daemon-specific code organization and editing rules.

## Role

`apps/daemon` is the local Express + SQLite daemon and owns:

- `/api/*` HTTP routes and SSE streams.
- The `od` CLI entrypoint in `src/cli.ts`.
- Project persistence, generated files, artifacts, media, skills, design systems, plugins, MCP, connector credentials, automation state, agent spawning, and static serving.
- The daemon sidecar entry under `sidecar/`.

The daemon is not a shared library for the web app. Do not import daemon private `src/` modules from `apps/web`; shared web/daemon contracts belong in `packages/contracts`.

## Source Layout

- `src/server.ts` is the composition root: create process-wide services, build dependency objects, install middleware, and register route modules. Keep request/domain logic out of `server.ts` unless the route is genuinely bootstrap-wide.
- `src/cli.ts` is the CLI composition root: parse top-level commands, dispatch subcommands, and format process output. Keep substantial command implementation in domain modules or focused `*-cli.ts` helpers.
- `src/server-context.ts`, `src/route-context-contract.ts`, `src/route-registration-guard.ts`, and small root constants/startup helpers may stay at the top level because they describe daemon-wide wiring.
- `src/routes/` contains domain route registrars that were split out of `server.ts`. New daemon domain endpoints should normally land here.
- Legacy route files still at `src/*-routes.ts` may remain until touched. When making meaningful changes in one, prefer moving it to `src/routes/<domain>.ts` if the move is small and mechanically safe.
- `src/http/` owns shared HTTP helpers, error/result adapters, origin checks, and route mounting utilities.
- `src/services/` owns reusable daemon services that are not tied to Express request/response objects.
- `src/runtimes/` owns agent runtime definitions, spawning, parser integration, executable discovery, and runtime environment shaping. Agent argument definitions belong in `src/runtimes/defs/`.
- `src/prompts/` owns daemon-side prompt construction. Keep mirrored BYOK/API wording in `packages/contracts/src/prompts/` when the same text is exposed outside the daemon.
- `src/plugins/`, `src/connectors/`, `src/registry/`, `src/research/`, `src/media-adapters/`, `src/live-artifacts/`, `src/storage/`, and `src/critique/` own their named domains. Prefer adding code inside the existing domain folder before creating a new top-level folder.
- `tests/` contains daemon tests. Keep test paths roughly parallel to `src/` when useful.

Do not edit generated `dist/` output.

## Top-Level `src/` Hygiene

Do not keep adding unrelated files directly under `src/`. The top level is currently crowded, so use these rules for new code and for touched legacy files:

- New domain code belongs in a domain folder, not in `src/<feature>.ts`, unless it is a daemon-wide primitive.
- New route code belongs in `src/routes/` or an existing route subfolder such as `src/routes/plugins/`.
- New runtime or stream-parser code belongs in `src/runtimes/`, with runtime definitions in `src/runtimes/defs/`.
- New provider/integration client code belongs in the existing domain folder when one exists, or under `src/integrations/<provider>.ts` for provider-specific glue.
- New persistence/storage abstractions belong in `src/storage/` unless they are tightly coupled to the legacy SQLite facade in `src/db.ts`.
- New prompt construction belongs in `src/prompts/`.
- New plugin, connector, registry, research, media adapter, live-artifact, critique, metrics, logging, QA, or GenUI code belongs in the matching existing folder.
- New general-purpose helpers should be avoided. If a helper has a real owner, put it with that owner. If it is daemon-wide infrastructure, use a focused folder such as `src/http/`, `src/services/`, `src/storage/`, or `src/runtimes/` instead of creating another top-level utility file.

When touching a legacy top-level file:

- Prefer a small, safe move into an existing domain folder when imports are straightforward and the change is already about that domain.
- Do not mix a broad mechanical move with behavior changes unless the move is required to make the behavior change understandable.
- If a file is split, keep the public function names stable at call sites where possible and move tests with the behavior they cover.
- Use temporary root-level compatibility exports only when they materially reduce churn; remove them in the same PR if the diff stays small.

Suggested ownership for common legacy top-level families:

- `project-routes.ts`, `import-export-routes.ts`, `mcp-routes.ts` -> `src/routes/`. (Route modules already split out, such as `routes/chat.ts`, `routes/terminal.ts`, and `routes/social-share.ts`, are done; do not list them here.)
- `copilot-stream.ts`, `acp.ts`, `agents.ts`, `run-*`, `agent-*`, `*-diagnostics.ts` -> usually `src/runtimes/` or a future `src/runs/` folder, depending on ownership. (`claude-stream.ts`, `qoder-stream.ts`, `json-event-stream.ts`, and `runs.ts` already live under `src/runtimes/`.)
- `design-systems-cli-help.ts`, `tools-design-systems-cli.ts`, `claude-design-import.ts` when used only there -> `src/design-systems/`. (Core design-system modules, design tokens, `swift-colors.ts`, and `frontmatter.ts` are already under `src/design-systems/`.)
- `inline-assets.ts`, `lint-artifact.ts`, `pdf-export.ts`, `document-preview.ts`, `static-spa.ts` -> `src/artifacts/` or the existing artifact owner. (The `artifact-*` family already moved under `src/artifacts/`.)
- `memory*.ts`, `orbit*.ts`, `automation-*.ts`, `routines.ts`, `prompt-*`, `handoff-*`, `finalize-design.ts` -> keep with their domain; introduce folders when touching multiple related files.

The `media-*` family has already moved into `src/media/`; no media modules remain at the top level.

These are migration targets, not permission to do a large cleanup PR. Move only what helps the current change or removes active ambiguity.

## Route Structure

Route modules should follow this shape:

```ts
import type { Express } from 'express';
import type { RouteDeps } from '../server-context.js';

export interface RegisterExampleRoutesDeps extends RouteDeps<'http' | 'paths'> {
  example: ExampleService;
}

export function registerExampleRoutes(app: Express, ctx: RegisterExampleRoutesDeps): void {
  // app.get/post/patch/delete(...)
}
```

Guidelines:

- Keep one exported registrar per domain, except where the existing file already has a small family of closely related registrars.
- Declare a narrow `Register*RoutesDeps` type. Pick only the `ServerContext` keys the route uses, and add explicit service interfaces for domain-specific dependencies.
- Add the registrar dependency type to `src/route-context-contract.ts` when it should be covered by the server context assertion.
- Register the route from the matching semantic section in `src/server.ts`.
- Use existing route helpers from `src/http/` when they fit. Do not invent another error envelope if a contract already exists.
- Keep parsing/validation near the route boundary and push reusable behavior into named helpers or services.
- Do not add new route handlers directly to `server.ts` unless they are bootstrap-wide process metadata such as health/version.

## Dependency Boundaries

- `src/server-context.ts` is the route dependency map. If a route needs a new cross-route dependency, add it there deliberately and keep its type narrow.
- Prefer explicit domain service interfaces in route files over `any` or `unknown`.
- Use types from the implementation module or `packages/contracts` instead of restating response shapes by hand.
- Keep `packages/contracts` pure. Do not move daemon-only Node, SQLite, Express, filesystem, or process types into contracts.
- Daemon data paths must follow the root **Daemon data directory contract**. Route all daemon-owned data through `RUNTIME_DATA_DIR` or constants derived from it.

## CLI and Surface Parity

User-facing capabilities must be reachable through both:

- Web/API routes in the daemon.
- `od` CLI subcommands in `src/cli.ts`.

When adding a user-facing capability, close the loop in one change: contract type, daemon route, web surface if applicable, and CLI command with `--json` plus `--prompt-file <path|->` for long prompts where relevant.

## Runtime and Agent Changes

- Parser changes belong beside the matching runtime stream helper and should include focused parser tests.
- Runtime definition changes belong in `src/runtimes/defs/`.
- For agent-stream/parser changes, replay a mock CLI trace from `mocks/` when practical instead of burning provider budget.
- Preserve Claude stream-json bookkeeping in `src/runtimes/claude-stream.ts` and `src/server.ts`; do not close stdin on `tool_use` stop reasons.

## Tests

- Tests belong under `apps/daemon/tests/`, not under `src/`.
- Use the cheapest layer that can observe the behavior: pure helper test, route-level Vitest with `startServer`, then broader integration only when necessary.
- For bug fixes, prefer a red spec that fails before the fix.
- If a test depends on native modules such as `better-sqlite3`, make sure local dependencies were built for the active Node version before blaming the code.

## Commands

Common daemon checks:

```bash
pnpm --filter @open-design/daemon typecheck
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/daemon build
```

Focused tests from `apps/daemon`:

```bash
pnpm exec vitest run -c vitest.config.ts tests/<file>.test.ts
```

For local runtime validation, start through the repo control plane, not daemon package lifecycle aliases:

```bash
pnpm tools-dev run web --daemon-port <port> --web-port <port>
```

## Review Checklist

Before handing off daemon changes, check:

- Route logic is in a route module, not newly embedded in `server.ts`.
- New route deps are explicit and covered by `route-context-contract.ts` where appropriate.
- Shared DTOs or error shapes live in `packages/contracts` when the web or CLI consumes them.
- CLI parity is handled or explicitly not applicable.
- Daemon data paths derive from the resolved daemon data root.
- Tests are under `tests/` and relevant checks were run.

exec
/bin/bash -lc "cat 'packages/AGENTS.md'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# packages/AGENTS.md

Follow the root `AGENTS.md` first. This file only records module-level boundaries for `packages/`.

## Package responsibilities

- `packages/contracts`: web/daemon app contract layer. Keep it pure TypeScript; it must not depend on Next.js, Express, Node filesystem/process APIs, browser APIs, SQLite, daemon internals, or the sidecar control-plane protocol.
- `packages/components`: shared React UI primitives and primitive CSS. It may depend on React types/runtime only; keep product workflows and app-specific layout/styling in the apps.
- `packages/host`: web/desktop host bridge contract. It models renderer-facing host capabilities and helpers while keeping `window.__od__` access out of app UI code.
- `packages/metatool`: internal metadata helpers for repo-local tool build outputs. Keep reusable hash/check/write mechanics here; each concrete tool owns its own `meta.json`.
- `packages/release`: pure release-domain primitives. Owns release channel names, version parsing/formatting, metadata field derivation, storage prefixes, release namespaces, and app identity data. It must not read/write files, call GitHub/R2, spawn build tools, or own workflow execution.
- `packages/sidecar-proto`: Open Design sidecar business protocol. Owns app/mode/source constants, namespace validation, stamp descriptor/fields/flags, IPC message schema, status shapes, error semantics, and default product path constants.
- `packages/sidecar`: generic sidecar runtime primitives. Includes bootstrap, IPC transport, path/runtime resolution, launch env, and JSON runtime file helpers; it must not hard-code Open Design app keys or IPC business messages.
- `packages/platform`: generic OS process primitives. Includes stamp serialization, command parsing, process matching/search, and well-known user-toolchain bin discovery; it must consume the `sidecar-proto` descriptor and must not hard-code `--od-stamp-*` details. The toolchain helper is the single source of truth shared by the daemon agent resolver (`apps/daemon/src/agents.ts`) and the packaged sidecar PATH builder (`apps/packaged/src/sidecars.ts`) so neither layer can drift the search list.

## Removed directories

- `packages/shared` has been removed; do not restore it.
- For new shared types, choose the boundary first: web/daemon app DTOs go in `contracts`; sidecar control-plane protocol goes in `sidecar-proto`; generic runtime code goes in `sidecar`; generic OS/process code goes in `platform`.

## Boundary checklist

- Package tests live in each package's `tests/` directory, sibling to `src/`; keep `src/` source-only and do not add new `*.test.ts` or `*.test.tsx` files under `src/`.
- Do not move runtime validation/schema enforcement into `contracts` prematurely; current contracts define the typed target shape only.
- Do not let app packages depend directly on sidecar control-plane details.
- Do not hard-code Open Design app/source/mode constants in `sidecar` or `platform`.
- Keep stamp fields limited to five: `app`, `mode`, `namespace`, `ipc`, and `source`.

## Common package commands

```bash
pnpm --filter @open-design/contracts typecheck
pnpm --filter @open-design/host typecheck
pnpm --filter @open-design/host test
pnpm --filter @open-design/metatool typecheck
pnpm --filter @open-design/metatool test
pnpm --filter @open-design/release typecheck
pnpm --filter @open-design/release test
pnpm --filter @open-design/sidecar-proto typecheck
pnpm --filter @open-design/sidecar-proto test
pnpm --filter @open-design/sidecar typecheck
pnpm --filter @open-design/sidecar test
pnpm --filter @open-design/platform typecheck
pnpm --filter @open-design/platform test
```

exec
/bin/bash -lc 'find apps/daemon/src -maxdepth 2 -type d | sort' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/daemon/src
apps/daemon/src/agent-protocol
apps/daemon/src/agent-protocol/acp
apps/daemon/src/agent-protocol/core
apps/daemon/src/agent-protocol/pi-rpc
apps/daemon/src/artifacts
apps/daemon/src/brands
apps/daemon/src/brands/engine
apps/daemon/src/browser
apps/daemon/src/cli-help
apps/daemon/src/connectors
apps/daemon/src/critique
apps/daemon/src/critique/__fixtures__
apps/daemon/src/critique/parsers
apps/daemon/src/deploy
apps/daemon/src/design
apps/daemon/src/design-systems
apps/daemon/src/figma
apps/daemon/src/genui
apps/daemon/src/http
apps/daemon/src/integrations
apps/daemon/src/live-artifacts
apps/daemon/src/logging
apps/daemon/src/media
apps/daemon/src/media-adapters
apps/daemon/src/metrics
apps/daemon/src/migration
apps/daemon/src/plugins
apps/daemon/src/plugins/atoms
apps/daemon/src/projects
apps/daemon/src/prompts
apps/daemon/src/qa
apps/daemon/src/registry
apps/daemon/src/research
apps/daemon/src/routes
apps/daemon/src/routes/plugins
apps/daemon/src/routes/project
apps/daemon/src/runtimes
apps/daemon/src/runtimes/defs
apps/daemon/src/services
apps/daemon/src/sidecar
apps/daemon/src/storage
apps/daemon/src/tools

exec
/bin/bash -lc "find apps/daemon/src -maxdepth 2 -type f -name '*.ts' | sort | sed -n '1,260p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/daemon/src/agent-protocol/index.ts
apps/daemon/src/agent-session-resume.ts
apps/daemon/src/agents.ts
apps/daemon/src/amr-stderr-filter.ts
apps/daemon/src/analytics.ts
apps/daemon/src/api-token-auth.ts
apps/daemon/src/app-config.ts
apps/daemon/src/app-version.ts
apps/daemon/src/artifacts-cli.ts
apps/daemon/src/artifacts/create.ts
apps/daemon/src/artifacts/manifest.ts
apps/daemon/src/artifacts/publication-guard.ts
apps/daemon/src/artifacts/runtime-compat.ts
apps/daemon/src/artifacts/stub-guard.ts
apps/daemon/src/artifacts/text-suppression.ts
apps/daemon/src/automation-ingestions.ts
apps/daemon/src/automation-proposals.ts
apps/daemon/src/automation-routine-evolution.ts
apps/daemon/src/automation-templates.ts
apps/daemon/src/brand-routes.ts
apps/daemon/src/brands/design-md-input.ts
apps/daemon/src/brands/design-md.ts
apps/daemon/src/brands/fonts.ts
apps/daemon/src/brands/imagery-fallback.ts
apps/daemon/src/brands/index.ts
apps/daemon/src/brands/kit-i18n.ts
apps/daemon/src/brands/kit-render.ts
apps/daemon/src/brands/logo-fallback.ts
apps/daemon/src/brands/memory.ts
apps/daemon/src/brands/prefetch.ts
apps/daemon/src/brands/provisional.ts
apps/daemon/src/brands/safe-fetch.ts
apps/daemon/src/brands/schema.ts
apps/daemon/src/brands/seed-fallback.ts
apps/daemon/src/brands/seed.ts
apps/daemon/src/brands/store.ts
apps/daemon/src/brands/system.ts
apps/daemon/src/brands/validate.ts
apps/daemon/src/browser/browser-open.ts
apps/daemon/src/browser/browser-use-diagnostics.ts
apps/daemon/src/browser/index.ts
apps/daemon/src/byok-tools.ts
apps/daemon/src/claude-diagnostics.ts
apps/daemon/src/cli-help/brands-cli-help.ts
apps/daemon/src/cli-help/design-systems-cli-help.ts
apps/daemon/src/cli-help/index.ts
apps/daemon/src/cli.ts
apps/daemon/src/codex-cli.ts
apps/daemon/src/codex-config-normalize.ts
apps/daemon/src/codex-pets.ts
apps/daemon/src/codex-rollout-usage.ts
apps/daemon/src/community-pets-sync.ts
apps/daemon/src/connectionTest.ts
apps/daemon/src/connectors/catalog.ts
apps/daemon/src/connectors/composio-config.ts
apps/daemon/src/connectors/composio-curation.ts
apps/daemon/src/connectors/composio-descriptions.ts
apps/daemon/src/connectors/composio.ts
apps/daemon/src/connectors/routes.ts
apps/daemon/src/connectors/service.ts
apps/daemon/src/constants.ts
apps/daemon/src/copilot-stream.ts
apps/daemon/src/craft.ts
apps/daemon/src/critique/adapter-degraded.ts
apps/daemon/src/critique/artifact-handler.ts
apps/daemon/src/critique/artifact-writer.ts
apps/daemon/src/critique/config.ts
apps/daemon/src/critique/conformance-history.ts
apps/daemon/src/critique/conformance.ts
apps/daemon/src/critique/errors.ts
apps/daemon/src/critique/interrupt-handler.ts
apps/daemon/src/critique/orchestrator.ts
apps/daemon/src/critique/parser.ts
apps/daemon/src/critique/persistence.ts
apps/daemon/src/critique/ratchet.ts
apps/daemon/src/critique/rollout.ts
apps/daemon/src/critique/run-registry.ts
apps/daemon/src/critique/scoreboard.ts
apps/daemon/src/critique/spawn-inputs.ts
apps/daemon/src/critique/transcript.ts
apps/daemon/src/cwd-aliases.ts
apps/daemon/src/daemon-paths.ts
apps/daemon/src/daemon-startup.ts
apps/daemon/src/daemon-url.ts
apps/daemon/src/db.ts
apps/daemon/src/deck-export.ts
apps/daemon/src/deploy.ts
apps/daemon/src/deploy/cloudflare-pages-helpers.ts
apps/daemon/src/design-systems/frontmatter.ts
apps/daemon/src/design-systems/generation-jobs.ts
apps/daemon/src/design-systems/github-import.ts
apps/daemon/src/design-systems/import.ts
apps/daemon/src/design-systems/index.ts
apps/daemon/src/design-systems/preview.ts
apps/daemon/src/design-systems/rename-args.ts
apps/daemon/src/design-systems/server-services.ts
apps/daemon/src/design-systems/shadcn-import.ts
apps/daemon/src/design-systems/showcase.ts
apps/daemon/src/design-systems/source-context.ts
apps/daemon/src/design-systems/swift-colors.ts
apps/daemon/src/design-systems/token-contract-rebuild.ts
apps/daemon/src/design-systems/token-contract.ts
apps/daemon/src/design-systems/token-evidence.ts
apps/daemon/src/design/claude-design-import.ts
apps/daemon/src/design/finalize-design.ts
apps/daemon/src/design/handoff-design.ts
apps/daemon/src/design/index.ts
apps/daemon/src/desktop-auth.ts
apps/daemon/src/diagnostics-export.ts
apps/daemon/src/document-preview.ts
apps/daemon/src/export-cli-request.ts
apps/daemon/src/export-cli-routing.ts
apps/daemon/src/figma/fig-decode.ts
apps/daemon/src/figma/figma-import.ts
apps/daemon/src/genui/events.ts
apps/daemon/src/genui/index.ts
apps/daemon/src/genui/registry.ts
apps/daemon/src/genui/store.ts
apps/daemon/src/handoff-cli.ts
apps/daemon/src/home-expansion.ts
apps/daemon/src/http/adapter.ts
apps/daemon/src/http/api-errors.ts
apps/daemon/src/http/index.ts
apps/daemon/src/http/local-daemon-request.ts
apps/daemon/src/http/oauth-result-page.ts
apps/daemon/src/http/origin-guard.ts
apps/daemon/src/http/parse.ts
apps/daemon/src/http/response.ts
apps/daemon/src/http/tool-request-auth.ts
apps/daemon/src/http/types.ts
apps/daemon/src/import-export-routes.ts
apps/daemon/src/inline-assets.ts
apps/daemon/src/installation.ts
apps/daemon/src/integrations/aihubmix.ts
apps/daemon/src/integrations/elevenlabs-voices.ts
apps/daemon/src/integrations/google-models.ts
apps/daemon/src/integrations/openai-chat-token-params.ts
apps/daemon/src/integrations/provider-models.ts
apps/daemon/src/integrations/vela-errors.ts
apps/daemon/src/integrations/vela-profile.ts
apps/daemon/src/integrations/vela-wallet.ts
apps/daemon/src/integrations/vela.ts
apps/daemon/src/integrations/xai-credentials.ts
apps/daemon/src/integrations/xai-oauth-server.ts
apps/daemon/src/integrations/xai-oauth.ts
apps/daemon/src/integrations/xai-tokens.ts
apps/daemon/src/langfuse-bridge.ts
apps/daemon/src/langfuse-trace.ts
apps/daemon/src/library-install.ts
apps/daemon/src/library-store.ts
apps/daemon/src/library-sync.ts
apps/daemon/src/library-tokens.ts
apps/daemon/src/library.ts
apps/daemon/src/linked-dirs.ts
apps/daemon/src/lint-artifact.ts
apps/daemon/src/live-artifacts/http-helpers.ts
apps/daemon/src/live-artifacts/refresh-service.ts
apps/daemon/src/live-artifacts/refresh.ts
apps/daemon/src/live-artifacts/render.ts
apps/daemon/src/live-artifacts/schema.ts
apps/daemon/src/live-artifacts/store.ts
apps/daemon/src/logging/critique.ts
apps/daemon/src/mcp-agent-install.ts
apps/daemon/src/mcp-config.ts
apps/daemon/src/mcp-install-info.ts
apps/daemon/src/mcp-live-artifacts-server.ts
apps/daemon/src/mcp-oauth.ts
apps/daemon/src/mcp-routes.ts
apps/daemon/src/mcp-tokens.ts
apps/daemon/src/mcp.ts
apps/daemon/src/media-adapters/capabilities.ts
apps/daemon/src/media-adapters/index.ts
apps/daemon/src/media-adapters/seed.ts
apps/daemon/src/media-adapters/types.ts
apps/daemon/src/media-adapters/video.ts
apps/daemon/src/media/amr-image-staging.ts
apps/daemon/src/media/config.ts
apps/daemon/src/media/index.ts
apps/daemon/src/media/models.ts
apps/daemon/src/media/policy.ts
apps/daemon/src/media/prompt-templates.ts
apps/daemon/src/media/task-store.ts
apps/daemon/src/media/tasks.ts
apps/daemon/src/memory-connectors.ts
apps/daemon/src/memory-extractions.ts
apps/daemon/src/memory-llm.ts
apps/daemon/src/memory-rules.ts
apps/daemon/src/memory-verify.ts
apps/daemon/src/memory.ts
apps/daemon/src/metrics/index.ts
apps/daemon/src/migration/index.ts
apps/daemon/src/migration/legacy-data-migrator.ts
apps/daemon/src/migration/update-apply-observations.ts
apps/daemon/src/native-folder-dialog.ts
apps/daemon/src/native-session-recovery.ts
apps/daemon/src/orbit-agent-summary.ts
apps/daemon/src/orbit.ts
apps/daemon/src/origin-validation.ts
apps/daemon/src/pdf-export.ts
apps/daemon/src/plugins/apply.ts
apps/daemon/src/plugins/atom-bodies.ts
apps/daemon/src/plugins/atoms.ts
apps/daemon/src/plugins/bundled.ts
apps/daemon/src/plugins/connector-gate.ts
apps/daemon/src/plugins/connector-probe.ts
apps/daemon/src/plugins/context-craft.ts
apps/daemon/src/plugins/diff.ts
apps/daemon/src/plugins/doctor.ts
apps/daemon/src/plugins/duplicate-project.ts
apps/daemon/src/plugins/ensure-core-stages.ts
apps/daemon/src/plugins/events.ts
apps/daemon/src/plugins/export.ts
apps/daemon/src/plugins/gc.ts
apps/daemon/src/plugins/index.ts
apps/daemon/src/plugins/installer.ts
apps/daemon/src/plugins/local-skill.ts
apps/daemon/src/plugins/lockfile.ts
apps/daemon/src/plugins/marketplace-doctor.ts
apps/daemon/src/plugins/marketplace-seed.ts
apps/daemon/src/plugins/marketplaces.ts
apps/daemon/src/plugins/pack.ts
apps/daemon/src/plugins/persistence.ts
apps/daemon/src/plugins/pipeline-runner.ts
apps/daemon/src/plugins/pipeline.ts
apps/daemon/src/plugins/plugin-asset-cache.ts
apps/daemon/src/plugins/plugin-preview-bakes.ts
apps/daemon/src/plugins/publish.ts
apps/daemon/src/plugins/registry.ts
apps/daemon/src/plugins/resolve-snapshot.ts
apps/daemon/src/plugins/scaffold.ts
apps/daemon/src/plugins/search.ts
apps/daemon/src/plugins/share-helpers.ts
apps/daemon/src/plugins/simulate.ts
apps/daemon/src/plugins/skill-candidates.ts
apps/daemon/src/plugins/snapshot-diff.ts
apps/daemon/src/plugins/snapshots.ts
apps/daemon/src/plugins/stats.ts
apps/daemon/src/plugins/trust.ts
apps/daemon/src/plugins/until.ts
apps/daemon/src/plugins/validate.ts
apps/daemon/src/plugins/verify.ts
apps/daemon/src/project-file-versions.ts
apps/daemon/src/project-ignored-dirs.ts
apps/daemon/src/project-locations.ts
apps/daemon/src/project-root.ts
apps/daemon/src/project-watchers.ts
apps/daemon/src/projects.ts
apps/daemon/src/projects/archive-filename.ts
apps/daemon/src/prompt-telemetry.ts
apps/daemon/src/prompts/core-slim.ts
apps/daemon/src/prompts/deck-framework.ts
apps/daemon/src/prompts/directions.ts
apps/daemon/src/prompts/discovery.ts
apps/daemon/src/prompts/media-contract.ts
apps/daemon/src/prompts/official-system.ts
apps/daemon/src/prompts/panel.ts
apps/daemon/src/prompts/research-contract.ts
apps/daemon/src/prompts/system.ts
apps/daemon/src/qa/cta-hierarchy.ts
apps/daemon/src/qa/deck-layout.ts

exec
/bin/bash -lc 'wc -l apps/daemon/src/server.ts apps/daemon/src/cli.ts apps/web/src/App.tsx apps/web/src/components/ChatPane.tsx apps/web/src/components/ChatComposer.tsx apps/web/src/components/workspace/useConversationChat.ts apps/web/src/providers/daemon.ts apps/web/src/providers/registry.ts apps/web/src/providers/project-events.ts' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
    8635 apps/daemon/src/server.ts
   10071 apps/daemon/src/cli.ts
    2677 apps/web/src/App.tsx
    4342 apps/web/src/components/ChatPane.tsx
    5608 apps/web/src/components/ChatComposer.tsx
     363 apps/web/src/components/workspace/useConversationChat.ts
    1521 apps/web/src/providers/daemon.ts
    2856 apps/web/src/providers/registry.ts
     187 apps/web/src/providers/project-events.ts
   36260 total

exec
/bin/bash -lc "find packages/contracts/src -maxdepth 2 -type f | sort | sed -n '1,220p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
packages/contracts/src/agent-tools/actions.ts
packages/contracts/src/agent-tools/descriptor.ts
packages/contracts/src/agent-tools/index.ts
packages/contracts/src/agent-tools/manifest.ts
packages/contracts/src/agent-tools/registry.ts
packages/contracts/src/agent-tools/task.ts
packages/contracts/src/analytics/artifact-id.ts
packages/contracts/src/analytics/events.ts
packages/contracts/src/analytics/index.ts
packages/contracts/src/analytics/observability.ts
packages/contracts/src/analytics/public-params.ts
packages/contracts/src/api/agent-sessions.ts
packages/contracts/src/api/amrWallet.ts
packages/contracts/src/api/app-config.ts
packages/contracts/src/api/artifacts.ts
packages/contracts/src/api/attribution.ts
packages/contracts/src/api/automations.ts
packages/contracts/src/api/brands.ts
packages/contracts/src/api/chat.ts
packages/contracts/src/api/comments.ts
packages/contracts/src/api/community.ts
packages/contracts/src/api/connectionTest.ts
packages/contracts/src/api/connectors.ts
packages/contracts/src/api/context.ts
packages/contracts/src/api/export.ts
packages/contracts/src/api/figma.ts
packages/contracts/src/api/files.ts
packages/contracts/src/api/finalize.ts
packages/contracts/src/api/github.ts
packages/contracts/src/api/handoff.ts
packages/contracts/src/api/host-tools.ts
packages/contracts/src/api/library.ts
packages/contracts/src/api/live-artifacts.ts
packages/contracts/src/api/mcp.ts
packages/contracts/src/api/media.ts
packages/contracts/src/api/memory.ts
packages/contracts/src/api/orbit.ts
packages/contracts/src/api/plugin-candidates.ts
packages/contracts/src/api/projects.ts
packages/contracts/src/api/providerModels.ts
packages/contracts/src/api/proxy.ts
packages/contracts/src/api/reasoningExecution.ts
packages/contracts/src/api/registry.ts
packages/contracts/src/api/research.ts
packages/contracts/src/api/routines.ts
packages/contracts/src/api/run-completeness.ts
packages/contracts/src/api/social-share.ts
packages/contracts/src/api/terminals.ts
packages/contracts/src/api/version.ts
packages/contracts/src/api/whats-new.ts
packages/contracts/src/api/workspaces.ts
packages/contracts/src/artifacts/od-card.ts
packages/contracts/src/common.ts
packages/contracts/src/critique.ts
packages/contracts/src/design-systems/components-manifest.ts
packages/contracts/src/design-systems/derived-token-outputs.ts
packages/contracts/src/design-systems/token-schema.ts
packages/contracts/src/errors.ts
packages/contracts/src/examples.ts
packages/contracts/src/execution-profile.ts
packages/contracts/src/index.ts
packages/contracts/src/plugins/apply.ts
packages/contracts/src/plugins/context.ts
packages/contracts/src/plugins/events.ts
packages/contracts/src/plugins/index.ts
packages/contracts/src/plugins/installed.ts
packages/contracts/src/plugins/manifest.ts
packages/contracts/src/plugins/marketplace.ts
packages/contracts/src/plugins/plugin-url.ts
packages/contracts/src/plugins/scenario-defaults.ts
packages/contracts/src/plugins/share-actions.ts
packages/contracts/src/prompts/atom-block.ts
packages/contracts/src/prompts/deck-framework.ts
packages/contracts/src/prompts/directions.ts
packages/contracts/src/prompts/discovery.ts
packages/contracts/src/prompts/media-contract.ts
packages/contracts/src/prompts/official-system.ts
packages/contracts/src/prompts/plugin-block.ts
packages/contracts/src/prompts/system.ts
packages/contracts/src/runtime/deck-stage-fallback.ts
packages/contracts/src/sse/chat.ts
packages/contracts/src/sse/common.ts
packages/contracts/src/sse/proxy.ts
packages/contracts/src/tasks.ts

exec
/bin/bash -lc "find packages/components/src packages/platform/src packages/sidecar/src packages/sidecar-proto/src -maxdepth 2 -type f | sort | sed -n '1,240p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
packages/components/src/button.module.css
packages/components/src/button.tsx
packages/components/src/class-names.ts
packages/components/src/css-modules.d.ts
packages/components/src/dialog.module.css
packages/components/src/dialog.tsx
packages/components/src/form-controls.module.css
packages/components/src/form-controls.tsx
packages/components/src/index.ts
packages/components/src/primitives.tsx
packages/components/src/styles.css
packages/components/src/visually-hidden.tsx
packages/platform/src/command.ts
packages/platform/src/fs.ts
packages/platform/src/http.ts
packages/platform/src/index.ts
packages/platform/src/process.ts
packages/platform/src/proxy-env.ts
packages/platform/src/toolchain.ts
packages/sidecar-proto/src/index.ts
packages/sidecar/src/bootstrap.ts
packages/sidecar/src/index.ts
packages/sidecar/src/ipc-path.ts
packages/sidecar/src/json-file.ts
packages/sidecar/src/json-ipc.ts
packages/sidecar/src/net.ts
packages/sidecar/src/paths.ts
packages/sidecar/src/port.ts
packages/sidecar/src/types.ts

exec
/bin/bash -lc "rg -n '"'^import .*|''^const RUNTIME_DATA_DIR|''^export async function|''^async function start|register[A-Z].*Routes|startChatRun|stdinOpen|applyClaudeStreamJsonRunBookkeeping'"' apps/daemon/src/server.ts | sed -n '1,320p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
2:import type {
10:import express from 'express';
11:import multer from 'multer';
12:import JSZip from 'jszip';
13:import { execFile, spawn } from 'node:child_process';
14:import { randomUUID } from 'node:crypto';
15:import { fileURLToPath } from 'node:url';
16:import path from 'node:path';
17:import fs from 'node:fs';
18:import os from 'node:os';
19:import net from 'node:net';
20:import { executionProfileFromStreamFormat, PLUGIN_SHARE_ACTION_PLUGIN_IDS } from '@open-design/contracts';
21:import { isTodoWriteToolName, stopReasonIsTruncation, todoItemsFromTodoWriteInput } from '@open-design/contracts';
22:import {
30:import { emittedRenderableQuestionForm } from './question-form-detect.js';
31:import { resolveProjectRoot } from './project-root.js';
32:import {
46:import {
55:import {
64:import {
69:import { userFacingAgentLabel } from './user-facing-agent-label.js';
70:import {
76:import {
95:import {
96:  applyClaudeStreamJsonRunBookkeeping,
107:import {
111:import {
117:import {
149:  applyClaudeStreamJsonRunBookkeeping,
176:import { createCommandInvocation } from '@open-design/platform';
177:import { SIDECAR_ENV } from '@open-design/sidecar-proto';
178:import {
192:import {
199:import { loadMmdRouteLaunchEnv } from './runtimes/mmd-routes.js';
200:import { preparePromptFileForAgent } from './runtimes/prompt-file.js';
201:import { TerminalControlSequenceStripper } from './runtimes/terminal-control.js';
202:import { buildOpenCodeByokProviderConfig } from './runtimes/byok-opencode.js';
203:import {
207:import {
211:import {
215:import { amrModelLoadingCache } from './runtimes/amr-model-cache.js';
216:import {
220:import { migrateLegacyDataDirSync } from './migration/index.js';
221:import {
232:import { normalizeDaemonBindHost } from './daemon-startup.js';
241:import { readCurrentAppVersionInfo } from './app-version.js';
242:import {
248:import { validateLinkedDirs } from './linked-dirs.js';
249:import { installFromTarget, uninstallById, sanitizeRepoName } from './library-install.js';
250:import {
255:import {
261:import { defaultMediaExecutionPolicy, parseMediaExecutionPolicyInput } from './media/policy.js';
262:import {
268:import {
286:import { createDesignSystemGenerationJobStore } from './design-systems/generation-jobs.js';
287:import { createDesignSystemServerServices } from './design-systems/server-services.js';
288:import { prepareDesignTokenContractRebuild } from './design-systems/token-contract-rebuild.js';
289:import { registerBrandRoutes } from './brand-routes.js';
290:import {
321:import {
325:import {
331:import { attachAcpSession } from './agent-protocol/index.js';
332:import { attachPiRpcSession } from './agent-protocol/index.js';
333:import { stageAmrImagePaths } from './media/amr-image-staging.js';
334:import { ingestRoutineConnectorEvolution } from './automation-routine-evolution.js';
335:import { createClaudeStreamHandler } from './runtimes/claude-stream.js';
336:import { createAgentTitleMarkerStripper } from './title-marker.js';
337:import { createRoleMarkerGuard } from './role-marker-guard.js';
338:import { createToolLoopGuard, resolveToolLoopMode, type ToolLoopVerdict } from './tool-loop-guard.js';
339:import { diagnoseClaudeCliFailure } from './claude-diagnostics.js';
340:import { loadCritiqueConfigFromEnv } from './critique/config.js';
341:import { reconcileStaleRuns } from './critique/persistence.js';
342:import { runOrchestrator } from './critique/orchestrator.js';
343:import { createRunRegistry } from './critique/run-registry.js';
344:import { handleCritiqueInterrupt } from './critique/interrupt-handler.js';
345:import { handleCritiqueArtifact } from './critique/artifact-handler.js';
346:import {
352:import { narrowProjectCritiqueOverride } from './critique/spawn-inputs.js';
353:import { createCopilotStreamHandler } from './copilot-stream.js';
354:import { createJsonEventStreamHandler } from './runtimes/json-event-stream.js';
355:import {
362:import { readOpenCodeServiceFailure } from './runtimes/opencode-log.js';
363:import { createAgentStderrVisibilityFilter } from './amr-stderr-filter.js';
364:import { createQoderStreamHandler } from './runtimes/qoder-stream.js';
365:import { subscribe as subscribeFileEvents } from './project-watchers.js';
366:import { importFigmaFromBytes } from './figma/figma-import.js';
367:import { renderDesignSystemPreview } from './design-systems/preview.js';
368:import { renderDesignSystemShowcase } from './design-systems/showcase.js';
369:import { createChatRunService } from './runtimes/runs.js';
370:import {
374:import { deriveRunErrorCode, runResultFromStatus } from './run-result.js';
375:import { classifyRunFailure, isResumableFailure } from './run-failure-classification.js';
376:import { decideSafeRunRetry } from './run-retry-policy.js';
377:import {
381:import {
386:import {
390:import { reportRunCompletedFromDaemon } from './langfuse-bridge.js';
391:import { buildPromptStackTelemetry } from './prompt-telemetry.js';
392:import { readAnalyticsContext } from './analytics.js';
393:import {
397:import {
405:import { listProviderModels } from './integrations/provider-models.js';
406:import { importClaudeDesignZip } from './design/index.js';
407:import {
414:import { buildDocumentPreview } from './document-preview.js';
415:import { lintArtifact, renderFindingsForAgent } from './lint-artifact.js';
416:import { loadCraftSections } from './craft.js';
417:import { skillCwdAliasSegment, stageActiveSkill } from './cwd-aliases.js';
418:import { buildDesktopArtifactExportInput, buildDesktopPdfExportInput } from './pdf-export.js';
419:import { generateMedia } from './media/index.js';
420:import { listElevenLabsVoiceOptions } from './integrations/elevenlabs-voices.js';
421:import { searchResearch, ResearchError } from './research/index.js';
422:import { openBrowser } from './browser/index.js';
423:import {
432:import { readMaskedConfig, writeConfig } from './media/config.js';
433:import {
438:import { TASK_TTL_AFTER_DONE_MS, createMediaTaskStore } from './media/task-store.js';
439:import {
448:import {
451:import {
457:import {
464:import { agentCliEnvForAgent, readAppConfig, readPluginEnvKnobs, writeAppConfig } from './app-config.js';
465:import { OrbitService, formatLocalProjectTimestamp, renderOrbitTemplateSystemPrompt } from './orbit.js';
466:import { buildOrbitNoLiveArtifactSummary } from './orbit-agent-summary.js';
467:import {
472:import { buildMcpInstallPayload } from './mcp-install-info.js';
473:import { createDiagnosticsExportHandler } from './diagnostics-export.js';
474:import { DIAGNOSTICS_EXPORT_PATH } from '@open-design/diagnostics';
475:import {
506:import { validateArtifactManifestInput } from './artifacts/manifest.js';
507:import { ArtifactPublicationBlockedError } from './artifacts/publication-guard.js';
508:import {
556:import {
563:import {
568:import {
579:import { refreshLiveArtifact } from './live-artifacts/refresh-service.js';
580:import {
585:import { registerConnectorRoutes } from './connectors/routes.js';
586:import { registerActiveContextRoutes } from './routes/active-context.js';
587:import { registerAutomationRoutes } from './routes/automation.js';
588:import { registerAttributionRoutes } from './routes/attribution.js';
589:import { registerDaemonRoutes } from './routes/daemon.js';
590:import { registerGenuiRoutes } from './routes/genui.js';
591:import { registerDesignSystemRoutes } from './routes/design-systems.js';
592:import { registerHostToolsRoutes } from './routes/host-tools.js';
593:import { registerPluginAssetRoutes } from './routes/plugins/assets.js';
594:import { registerPluginMarketplaceRoutes } from './routes/plugins/marketplaces.js';
595:import { registerPluginEventRoutes, registerPluginRoutes, registerProjectPluginRoutes } from './routes/plugins/index.js';
596:import { registerMcpRoutes } from './mcp-routes.js';
597:import { registerXaiRoutes } from './routes/xai.js';
598:import { registerLiveArtifactRoutes } from './routes/live-artifact.js';
599:import { registerDesignSystemToolRoutes } from './routes/design-system-tool.js';
600:import { registerDeployRoutes, registerDeploymentCheckRoutes } from './routes/deploy.js';
601:import { registerMediaRoutes } from './routes/media.js';
602:import { registerProjectRoutes, registerProjectArtifactRoutes, registerProjectFileRoutes, registerProjectUploadRoutes } from './routes/project/index.js';
603:import { registerVelaRoutes } from './routes/vela.js';
604:import { registerFinalizeRoutes, registerImportRoutes, registerProjectExportRoutes } from './import-export-routes.js';
605:import { registerHandoffRoutes } from './routes/handoff.js';
606:import { EmptyTranscriptError, synthesizeHandoffPrompt } from './design/index.js';
607:import { TranscriptExportLockedError } from './transcript-export.js';
608:import { registerChatRoutes } from './routes/chat.js';
609:import { registerRunRoutes } from './routes/runs.js';
610:import { registerTerminalRoutes } from './routes/terminal.js';
611:import { createTerminalService } from './terminals.js';
612:import { registerSocialShareRoutes } from './routes/social-share.js';
613:import { registerOpenDesignPublicMetadataRoutes } from './routes/open-design-public-metadata.js';
614:import { registerWhatsNewRoutes } from './routes/whats-new.js';
615:import { registerMemoryRoutes } from './routes/memory.js';
616:import { registerTelemetryRoutes } from './routes/telemetry.js';
617:import {
619:  registerAtomRoutes,
620:  registerStaticResourceRoutes,
624:import { registerRoutineRoutes, routineDbRowToContract } from './routes/routine.js';
625:import { resolveAmrModelProbe } from './runtimes/amr-model-probe.js';
626:import { createPluginInstallationHelpers, normalizeProjectPluginFolderPath, resolveProjectChildDirectory } from './services/plugin-installation.js';
627:import { createPluginShareTaskStore } from './services/plugin-share-tasks.js';
628:import { getRouteRegistrationInventory, installRouteRegistrationGuard } from './route-registration-guard.js';
629:import { assertServerContextSatisfiesRoutes } from './route-context-contract.js';
630:import { configureConnectorCredentialStore, connectorService, FileConnectorCredentialStore } from './connectors/service.js';
631:import { composioConnectorProvider } from './connectors/composio.js';
632:import { configureComposioConfigStore } from './connectors/composio-config.js';
633:import { CHAT_TOOL_ENDPOINTS, CHAT_TOOL_OPERATIONS, toolTokenRegistry } from './tool-tokens.js';
634:import {
649:import {
657:import {
665:import { registerLibraryRoutes } from './routes/library.js';
666:import {
670:import { listLibraryTokenOrigins } from './library-store.js';
671:import { apiTokenFromEnv, isApiAuthDisabled, isApiTokenMiddlewareEnabled } from './api-token-auth.js';
672:import { createOpenDesignPublicMetadataService } from './services/open-design-public-metadata.js';
673:import { createWhatsNewService } from './services/whats-new.js';
674:import { execCommandViaLoginShell } from './services/login-shell.js';
675:import {
679:import {
693:import { sanitizeArchiveFilename } from './projects/archive-filename.js';
694:import {
699:import { renderOAuthResultPage } from './http/oauth-result-page.js';
700:import { createToolRequestAuth } from './http/tool-request-auth.js';
807:const RUNTIME_DATA_DIR = resolveDataDir(process.env.OD_DATA_DIR, PROJECT_ROOT, {
819:const RUNTIME_DATA_DIR_CANONICAL = (() => {
1995:export async function startServer({
2448:  registerMemoryRoutes(app, {
2454:  registerAutomationRoutes(app, {
2463:  // simple project-create surface is wired through `registerProjectRoutes`
2467:  // (legacy POST /api/projects body deleted — see registerProjectRoutes below.)
2469:  const telemetry = registerTelemetryRoutes(app, {
2576:  const attributionService = registerAttributionRoutes(app, {
2642:  registerDaemonRoutes(app, {
2654:  registerOpenDesignPublicMetadataRoutes(app, {
2659:  registerWhatsNewRoutes(app, {
2663:  registerPluginEventRoutes(app, {
2667:  registerConnectorRoutes(app, {
2878:  registerMcpRoutes(app, {
2883:  registerXaiRoutes(app, {
2888:  registerActiveContextRoutes(app, {
2893:  registerHostToolsRoutes(app, {
2901:  registerLibraryRoutes(app, {
2950:  registerSocialShareRoutes(app, { http: httpDeps });
2951:  registerProjectRoutes(app, {
2968:  registerTerminalRoutes(app, {
2976:  registerImportRoutes(app, {
2992:  registerStaticResourceRoutes(app, {
3018:  registerDesignSystemRoutes(app, {
3044:  registerBrandRoutes(app, {
3072:  registerProjectArtifactRoutes(app, {
3079:  registerLiveArtifactRoutes(app, {
3087:  registerDesignSystemToolRoutes(app, {
3098:  registerDeployRoutes(app, {
3106:  registerFinalizeRoutes(app, {
3114:  registerHandoffRoutes(app, {
3123:  registerDeploymentCheckRoutes(app, { db, http: httpDeps, deploy: deployDeps });
3125:  registerProjectExportRoutes(app, {
3136:  registerProjectFileRoutes(app, {
3149:  registerMediaRoutes(app, {
3166:  registerVelaRoutes(app, {
3387:  registerPluginRoutes(app, {
3414:  registerAtomRoutes(app, {
3418:  registerPluginMarketplaceRoutes(app, {
3424:  registerPluginAssetRoutes(app, {
3433:  registerGenuiRoutes(app, {
3439:  registerProjectPluginRoutes(app, {
3466:  registerProjectUploadRoutes(app, {
4066:    // `listSkills()` scan in `startChatRun`. critiqueShouldRun threads
4176:  const startChatRun = async (chatBody, run) => {
5202:      run.stdinOpen = false;
5206:      // set by a clean `turn_end` (applyClaudeStreamJsonRunBookkeeping); without
5216:      void startChatRun(chatBody, run).catch((err) => {
7108:          applyClaudeStreamJsonRunBookkeeping(run, ev);
7880:        // turn (see applyClaudeStreamJsonRunBookkeeping) or when the child
7897:        run.stdinOpen = true;
7997:    design.runs.start(run, () => startChatRun({
8060:  registerRunRoutes(app, {
8066:    chat: { startChatRun },
8312:      design.runs.start(run, () => startChatRun({
8483:    chat: { startChatRun },
8494:  registerRoutineRoutes(app, {
8508:  registerChatRoutes(app, {
8513:    chat: { startChatRun },

exec
/bin/bash -lc "sed -n '1,260p' apps/daemon/src/server-context.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
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
/bin/bash -lc "sed -n '1,260p' apps/daemon/src/route-context-contract.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import type { ServerContext } from './server-context.js';
import type { RegisterActiveContextRoutesDeps } from './routes/active-context.js';
import type { RegisterAutomationRoutesDeps } from './routes/automation.js';
import type { RegisterChatRoutesDeps } from './routes/chat.js';
import type { RegisterDeployRoutesDeps, RegisterDeploymentCheckRoutesDeps } from './routes/deploy.js';
import type { RegisterFinalizeRoutesDeps, RegisterImportRoutesDeps, RegisterProjectExportRoutesDeps } from './import-export-routes.js';
import type { RegisterGenuiRoutesDeps } from './routes/genui.js';
import type { RegisterHandoffRoutesDeps } from './routes/handoff.js';
import type { RegisterHostToolsRoutesDeps } from './routes/host-tools.js';
import type { RegisterLiveArtifactRoutesDeps } from './routes/live-artifact.js';
import type { RegisterMcpRoutesDeps } from './mcp-routes.js';
import type { RegisterMediaRoutesDeps } from './routes/media.js';
import type { RegisterMemoryRoutesDeps } from './routes/memory.js';
import type { RegisterOpenDesignPublicMetadataRoutesDeps } from './routes/open-design-public-metadata.js';
import type { RegisterProjectArtifactRoutesDeps, RegisterProjectFileRoutesDeps, RegisterProjectRoutesDeps, RegisterProjectUploadRoutesDeps } from './routes/project/index.js';
import type { RegisterRoutineRoutesDeps } from './routes/routine.js';
import type { RegisterRunRoutesDeps } from './routes/runs.js';
import type { RegisterSocialShareRoutesDeps } from './routes/social-share.js';
import type { RegisterStaticResourceRoutesDeps } from './routes/static-resource.js';
import type { RegisterVelaRoutesDeps } from './routes/vela.js';
import type { RegisterXaiRoutesDeps } from './routes/xai.js';

type AllRegisteredRouteDeps =
  & RegisterActiveContextRoutesDeps
  & RegisterAutomationRoutesDeps
  & RegisterChatRoutesDeps
  & RegisterDeployRoutesDeps
  & RegisterDeploymentCheckRoutesDeps
  & RegisterFinalizeRoutesDeps
  & RegisterGenuiRoutesDeps
  & RegisterHandoffRoutesDeps
  & RegisterHostToolsRoutesDeps
  & RegisterImportRoutesDeps
  & RegisterLiveArtifactRoutesDeps
  & RegisterMcpRoutesDeps
  & RegisterMediaRoutesDeps
  & RegisterMemoryRoutesDeps
  & RegisterOpenDesignPublicMetadataRoutesDeps
  & RegisterProjectArtifactRoutesDeps
  & RegisterProjectExportRoutesDeps
  & RegisterProjectFileRoutesDeps
  & RegisterProjectRoutesDeps
  & RegisterProjectUploadRoutesDeps
  & RegisterRoutineRoutesDeps
  & RegisterRunRoutesDeps
  & RegisterSocialShareRoutesDeps
  & RegisterStaticResourceRoutesDeps
  & RegisterVelaRoutesDeps
  & RegisterXaiRoutesDeps;

type Assert<T extends true> = T;
type ServerContextCoversRouteDeps = Assert<ServerContext extends AllRegisteredRouteDeps ? true : false>;

export function assertServerContextSatisfiesRoutes(ctx: ServerContextCoversRouteDeps extends true ? ServerContext : never): void {
  void ctx;
}

exec
/bin/bash -lc "find apps/daemon/src/routes apps/daemon/src/runtimes apps/daemon/src/services apps/daemon/src/storage -type f -name '*.ts' | sort" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/daemon/src/routes/active-context.ts
apps/daemon/src/routes/attribution.ts
apps/daemon/src/routes/automation.ts
apps/daemon/src/routes/chat.ts
apps/daemon/src/routes/daemon.ts
apps/daemon/src/routes/deploy.ts
apps/daemon/src/routes/design-system-tool.ts
apps/daemon/src/routes/design-systems.ts
apps/daemon/src/routes/genui.ts
apps/daemon/src/routes/handoff.ts
apps/daemon/src/routes/host-tools.ts
apps/daemon/src/routes/library.ts
apps/daemon/src/routes/live-artifact.ts
apps/daemon/src/routes/media.ts
apps/daemon/src/routes/memory.ts
apps/daemon/src/routes/open-design-public-metadata.ts
apps/daemon/src/routes/plugins/assets.ts
apps/daemon/src/routes/plugins/index.ts
apps/daemon/src/routes/plugins/marketplaces.ts
apps/daemon/src/routes/project/cancel-owned-runs.ts
apps/daemon/src/routes/project/comments.ts
apps/daemon/src/routes/project/conversations.ts
apps/daemon/src/routes/project/index.ts
apps/daemon/src/routes/routine.ts
apps/daemon/src/routes/runs.ts
apps/daemon/src/routes/social-share.ts
apps/daemon/src/routes/static-resource.ts
apps/daemon/src/routes/telemetry.ts
apps/daemon/src/routes/terminal.ts
apps/daemon/src/routes/vela.ts
apps/daemon/src/routes/whats-new.ts
apps/daemon/src/routes/xai.ts
apps/daemon/src/runtimes/amr-model-cache.ts
apps/daemon/src/runtimes/amr-model-probe.ts
apps/daemon/src/runtimes/auth.ts
apps/daemon/src/runtimes/byok-opencode.ts
apps/daemon/src/runtimes/capabilities.ts
apps/daemon/src/runtimes/chat-prompt-inputs.ts
apps/daemon/src/runtimes/chat-run-context.ts
apps/daemon/src/runtimes/chat-run-lifecycle.ts
apps/daemon/src/runtimes/chat-run-messages.ts
apps/daemon/src/runtimes/claude-stream.ts
apps/daemon/src/runtimes/defs/aider.ts
apps/daemon/src/runtimes/defs/amp.ts
apps/daemon/src/runtimes/defs/amr.ts
apps/daemon/src/runtimes/defs/antigravity.ts
apps/daemon/src/runtimes/defs/byok-opencode.ts
apps/daemon/src/runtimes/defs/claude.ts
apps/daemon/src/runtimes/defs/codebuddy.ts
apps/daemon/src/runtimes/defs/codex.ts
apps/daemon/src/runtimes/defs/copilot.ts
apps/daemon/src/runtimes/defs/cursor-agent.ts
apps/daemon/src/runtimes/defs/deepseek.ts
apps/daemon/src/runtimes/defs/devin.ts
apps/daemon/src/runtimes/defs/grok-build.ts
apps/daemon/src/runtimes/defs/hermes.ts
apps/daemon/src/runtimes/defs/kilo.ts
apps/daemon/src/runtimes/defs/kimi.ts
apps/daemon/src/runtimes/defs/kiro.ts
apps/daemon/src/runtimes/defs/mimo.ts
apps/daemon/src/runtimes/defs/opencode.ts
apps/daemon/src/runtimes/defs/pi.ts
apps/daemon/src/runtimes/defs/qoder.ts
apps/daemon/src/runtimes/defs/qwen.ts
apps/daemon/src/runtimes/defs/reasonix.ts
apps/daemon/src/runtimes/defs/shared.ts
apps/daemon/src/runtimes/defs/trae-cli.ts
apps/daemon/src/runtimes/defs/vibe.ts
apps/daemon/src/runtimes/detection.ts
apps/daemon/src/runtimes/diagnostics.ts
apps/daemon/src/runtimes/env.ts
apps/daemon/src/runtimes/executables.ts
apps/daemon/src/runtimes/invocation.ts
apps/daemon/src/runtimes/json-event-stream.ts
apps/daemon/src/runtimes/launch.ts
apps/daemon/src/runtimes/local-profiles.ts
apps/daemon/src/runtimes/mcp.ts
apps/daemon/src/runtimes/metadata.ts
apps/daemon/src/runtimes/mmd-routes.ts
apps/daemon/src/runtimes/models.ts
apps/daemon/src/runtimes/opencode-log.ts
apps/daemon/src/runtimes/paths.ts
apps/daemon/src/runtimes/plain-stream.ts
apps/daemon/src/runtimes/prompt-budget.ts
apps/daemon/src/runtimes/prompt-file.ts
apps/daemon/src/runtimes/qoder-stream.ts
apps/daemon/src/runtimes/registry.ts
apps/daemon/src/runtimes/resolution.ts
apps/daemon/src/runtimes/run-artifacts.ts
apps/daemon/src/runtimes/run-lifecycle-analytics.ts
apps/daemon/src/runtimes/runs.ts
apps/daemon/src/runtimes/terminal-control.ts
apps/daemon/src/runtimes/terminal-launch.ts
apps/daemon/src/runtimes/types.ts
apps/daemon/src/services/login-shell.ts
apps/daemon/src/services/open-design-public-metadata.ts
apps/daemon/src/services/plugin-installation.ts
apps/daemon/src/services/plugin-share-tasks.ts
apps/daemon/src/services/whats-new.ts
apps/daemon/src/storage/aws-sigv4.ts
apps/daemon/src/storage/daemon-db.ts
apps/daemon/src/storage/db-inspect.ts
apps/daemon/src/storage/project-storage.ts

exec
/bin/bash -lc "find apps/daemon/src/runtimes/defs -type f -maxdepth 1 -name '*.ts' -print -exec wc -l {} \\;" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 102ms:
     106 apps/daemon/src/runtimes/defs/cursor-agent.ts

exec
/bin/bash -lc "sed -n '1,320p' 'apps/daemon/src/runtimes/types.ts'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import type { ExecFileOptions } from 'node:child_process';
import type { AgentDiagnostic, ModelMetadata } from '@open-design/contracts';

export type { AgentDiagnostic } from '@open-design/contracts';

export type RuntimeEnv = NodeJS.ProcessEnv | Record<string, string>;

export type RuntimeModelOption = {
  id: string;
  label: string;
  enabled?: boolean;
  default?: boolean;
  inputPriceUsdPerMillion?: number;
  outputPriceUsdPerMillion?: number;
  metadata?: ModelMetadata;
};

export type RuntimeModelSource = 'live' | 'fallback';

export type RuntimeReasoningOption = RuntimeModelOption;

export type RuntimeBuildOptions = {
  model?: string | null;
  reasoning?: string | null;
};

export type RuntimeContext = {
  cwd?: string;
  // True when the current chat run has at least one prior persisted
  // assistant message in the same conversation — i.e. this isn't the
  // first user turn. Plain-streaming adapters that support a "continue
  // the most recent conversation" CLI flag (e.g. `agy -c`) read this to
  // decide whether to resume the upstream agent's own session state
  // instead of spawning a fresh, context-free turn. Adapters that
  // either have no resume flag or recompose history into the prompt
  // themselves ignore this field.
  hasPriorAssistantTurn?: boolean;
  // Daemon-owned path to a temp file where the adapter should write
  // its diagnostic log. Today only antigravity consumes this: agy in
  // print mode is silent on stdout/stderr for both missing-auth AND
  // quota-exhausted failures (verified via `agy --log-file` capture
  // during PR #3157), so post-exit log inspection is the only way to
  // tell them apart. Adapters that don't have a `--log-file` flag
  // ignore this field; the daemon cleans the file up after reading.
  agentLogFilePath?: string;
  // Override for the antigravity model-selection settings file path.
  // Production code leaves this undefined (falls back to the default
  // ~/.gemini/antigravity-cli/settings.json). Tests pass a temp path
  // so unit assertions against buildArgs do not touch the real home dir.
  antigravitySettingsPath?: string;
  // Daemon-owned path to a temp file containing the composed prompt.
  // Adapters with `promptViaFile: true` read this instead of receiving
  // the prompt via argv or stdin. The daemon creates the file before
  // buildArgs and removes it after the child exits.
  promptFilePath?: string;
  // Resume-capable adapters (resumesSessionViaCli) read these to decide
  // whether to continue the CLI's own session. `resumeSessionId` is the
  // stored id for this (conversation, agent) when a prior session exists;
  // the adapter passes it to the CLI's resume flag and the daemon sends
  // only the latest user turn. When it is null/absent the adapter starts
  // a new session using `newSessionId` (a freshly minted UUID the daemon
  // also persists) and the daemon seeds it with the full transcript.
  resumeSessionId?: string | null;
  newSessionId?: string;
};

// Marker on a RuntimeAgentDef declaring that the adapter's CLI maintains
// its own multi-turn conversation memory and the daemon should NOT also
// pack the rendered web transcript (the `## user` / `## assistant` blocks
// `buildDaemonTranscript` produces) into the user request. Today only
// `agy -c` qualifies; other plain-stream adapters have no upstream
// session storage and still rely on the daemon-side transcript injection
// for multi-turn coherence.
//
// Without this opt-out, agy with `-c` receives the same prior turn
// twice — once from its own conversation memory, once embedded in the
// composed user request — and the embedded copy includes the literal
// `<question-form>` markup it emitted on turn 1. The model then
// pattern-matches that and re-emits the form on turn 2, looking like
// the discovery loop never breaks.

export type RuntimeCapabilityMap = Record<string, boolean>;

export type RuntimeListModels = {
  args: string[];
  timeoutMs?: number;
  parse: (stdout: string) => RuntimeModelOption[] | null;
};

export type RuntimePromptBudgetError = {
  code: 'AGENT_PROMPT_TOO_LARGE';
  message: string;
  bytes?: number;
  commandLineLength?: number;
  limit: number;
};

export type RuntimeAgentDef = {
  id: string;
  name: string;
  bin: string;
  versionArgs: string[];
  fallbackModels: RuntimeModelOption[];
  buildArgs: (
    prompt: string,
    imagePaths: string[],
    extraAllowedDirs?: string[],
    options?: RuntimeBuildOptions,
    runtimeContext?: RuntimeContext,
  ) => string[];
  streamFormat: string;
  fallbackBins?: string[];
  versionProbeTimeoutMs?: number;
  helpArgs?: string[];
  capabilityFlags?: Record<string, string>;
  // Adapter reads the composed prompt from a daemon-created temp file.
  // This is intentionally opt-in: stdin-capable adapters keep using
  // `promptViaStdin`, and argv-only adapters keep their argv budget guard
  // unless their CLI exposes an explicit prompt-file flag.
  promptViaFile?: boolean;
  promptViaStdin?: boolean;
  // Format for the user prompt fed via stdin. Default is plain text (the
  // entire prompt buffer goes in raw, then stdin is closed). When set to
  // 'stream-json' the daemon writes a single JSONL line wrapping the prompt
  // as an Anthropic user message (so tool_result blocks can later be
  // injected into the same stdin without re-spawning the child). Only
  // honored for adapters that also set `promptViaStdin: true`.
  promptInputFormat?: 'text' | 'stream-json';
  eventParser?: string;
  env?: Record<string, string>;
  listModels?: RuntimeListModels;
  fetchModels?: (
    resolvedBin: string,
    env: RuntimeEnv,
  ) => Promise<RuntimeModelOption[] | null>;
  reasoningOptions?: RuntimeReasoningOption[];
  supportsImagePaths?: boolean;
  maxPromptArgBytes?: number;
  mcpDiscovery?: string;
  // How the daemon forwards the user's `.od/mcp-config.json` external MCP
  // servers to this runtime at spawn time. The shape of the injection
  // is one of three strategies, each of which the server.ts spawn
  // pipeline knows how to apply:
  //
  //   'claude-mcp-json'      — write `.mcp.json` into the managed
  //                            project cwd (Claude Code auto-loads it).
  //   'acp-merge'            — merge stdio entries into the existing
  //                            `mcpServers` array of an ACP launch
  //                            descriptor (Hermes / Kimi / Kilo / Kiro
  //                            / Vibe / Devin).
  //   'opencode-env-content' — serialise to OpenCode's `mcp` config
  //                            schema and hand it through
  //                            `OPENCODE_CONFIG_CONTENT` in the spawn
  //                            env.
  //   'mimo-env-content'      — same schema as opencode-env-content
  //                            but emitted as `MIMOCODE_CONFIG_CONTENT`
  //                            under MiMo's env namespace.
  //
  // Leave undefined for adapters that have no native MCP transport
  // wired yet (codex, cursor-agent, copilot, qoder, pi). The
  // settings UI reads this field to surface an explicit "external MCP
  // is not forwarded to <agent>; configure servers in <agent>'s own
  // config file instead" hint, replacing the previous silent-failure
  // UX from issue #2142.
  externalMcpInjection?:
    | 'claude-mcp-json'
    | 'acp-merge'
    | 'opencode-env-content'
    | 'mimo-env-content';
  installUrl?: string;
  docsUrl?: string;
  // When `false`, the Settings model picker hides the "Custom (fill below)"
  // option and the associated free-text input. Use this for agents whose
  // CLI does not actually accept a model id (e.g. `agy` v1.0.3 has no
  // `--model` flag yet — upstream issue #35 — and the model is chosen
  // server-side; AMR routes model selection through ACP's
  // `session/set_model` and rejects free-form ids). Defaults to allowing
  // custom input (undefined === true) so most adapters keep today's UX.
  supportsCustomModel?: boolean;
  // When `true`, the daemon trusts this adapter's CLI to carry its own
  // multi-turn conversation memory across spawn invocations (today only
  // `agy -c`). The chat composer skips the rendered web transcript on
  // follow-up turns and sends just the latest user message — see the
  // RuntimeContext.hasPriorAssistantTurn comment for why double-context
  // is the discovery-form loop's root cause.
  resumesSessionViaCli?: boolean;
  // How the resumable session id is obtained, for `resumesSessionViaCli`
  // adapters. The default (undefined/false) is "specify-style": the daemon
  // mints `RuntimeContext.newSessionId` and the CLI is told to use it (claude
  // `--session-id`), so the id the daemon stores is the id it generated. When
  // `true` the adapter is "capture-style": the CLI generates its OWN session
  // id and reports it on the stream (codex `thread.started.thread_id`), so the
  // daemon must capture that id from the parsed stream (surfaced as a
  // `status` event's `sessionId`) and persist THAT as the resume handle —
  // `newSessionId` is not passed to the CLI. See server.ts capture-and-store
  // path and `agent-cli-session-resume.md`.
  capturesSessionIdFromStream?: boolean;
  // ACP-runtime analogue of capture-style resume: the agent talks `acp-json-rpc`
  // (today only AMR/vela) and supports resuming via `session/load`. The daemon
  // captures the durable upstream session handle from the ACP session
  // (`getDurableSessionId()`) and persists THAT, drives `session/load` on a
  // resume turn, and maps the agent's structured `resume_failed` error onto the
  // reseed path. Kept distinct from `resumesSessionViaCli` /
  // `capturesSessionIdFromStream` because the capture + resume transport is the
  // ACP result, not a `--session-id` flag or a stream `status` event.
  resumesSessionViaAcpLoad?: boolean;
  // Optional name of a daemon-process environment variable that overrides
  // the default model id when the chat run reaches the spawn layer with
  // null or the synthetic 'default'. Used by adapters whose CLI rejects
  // 'default' (e.g. AMR / vela) so an operator can swap the hardcoded
  // fallback without a code change — set the env var on the daemon
  // process when launching `tools-dev` / `od` daemon. The value must be
  // present in the daemon's `process.env`; Settings-UI per-agent env
  // values only reach the spawned child and are NOT consulted here.
  defaultModelEnvVar?: string;
  // Agent-recommended override for the chat-run inactivity watchdog.
  // The watchdog observes child stdout/stderr/SSE activity, not real
  // CPU progress, so agents whose CLIs go silent for long stretches
  // during legitimate work (e.g. Copilot's deck-generation thinking
  // phase from #2467) need a longer ceiling than the 10-minute global
  // default. Operators can still override per-process via
  // `OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS` — that env wins.
  inactivityTimeoutMs?: number;
  // Declarative authentication probe. When set, detection spawns
  // `<bin> <args>` after the version check and classifies the combined
  // stdout/stderr to derive `authStatus`. This replaces the previous
  // hardcoded "only cursor-agent gets an auth probe" gate: an adapter
  // opts in by declaring a cheap, side-effect-free status/whoami command
  // (e.g. cursor-agent `status`). Adapters WITHOUT this field are never
  // actively probed for auth — their auth status is only inferred later
  // from a real chat failure's error text (see classifyAgentServiceFailure).
  authProbe?: {
    args: string[];
    timeoutMs?: number;
    // Agent id whose tailored auth classifier + API-key short-circuit should
    // be used for this probe when it differs from the runtime agent id. Local
    // profiles (local-profiles.ts) inherit a base adapter's `authProbe` but run
    // under the profile id; carrying the base id here keeps the base adapter's
    // auth semantics (e.g. Claude's JSON-aware parser) instead of falling
    // through to the generic classifier. Defaults to the def id when unset.
    classifierAgentId?: string;
  };
  // Format for the `env` field in ACP `session/new` → `mcpServers[].env`.
  // `'array'` (default) emits `[{name, value}]` — used by Hermes, Kimi,
  // Kilo, Kiro, Vibe, and Devin.  `'map'` emits `{"KEY": "val"}` — used
  // by reasonix ≥ 1.0 (Go) whose ACP implementation expects the standard
  // MCP `map[string]string` shape. Leave `undefined` (defaults to 'array')
  // for all other agents — the existing behavior is unchanged.
  acpMcpEnvFormat?: 'array' | 'map';
};

export type DetectedAgent = Omit<
  RuntimeAgentDef,
  | 'buildArgs'
  | 'listModels'
  | 'fetchModels'
  | 'fallbackModels'
  | 'helpArgs'
  | 'capabilityFlags'
  | 'fallbackBins'
  | 'versionProbeTimeoutMs'
  | 'maxPromptArgBytes'
  | 'env'
  // `inactivityTimeoutMs` is a spawn-time-only hint consumed by the
  // chat-run watchdog. It is not part of the public `/api/agents`
  // contract (`packages/contracts/src/api/registry.ts#AgentInfo`), so
  // omitting it here keeps the daemon response aligned with that
  // shared web/CLI shape — agents pick it up by reading the runtime
  // def directly, the registry payload stays unchanged.
  | 'inactivityTimeoutMs'
  | 'authProbe'
> & {
  models: RuntimeModelOption[];
  modelsSource: RuntimeModelSource;
  available: boolean;
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
  path?: string;
  version?: string | null;
  diagnostics?: AgentDiagnostic[];
};

export type RuntimeExecOptions = ExecFileOptions & {
  env?: NodeJS.ProcessEnv;
};

exec
/bin/bash -lc "sed -n '1,320p' 'apps/daemon/src/runtimes/registry.ts'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import { amrAgentDef } from './defs/amr.js';
import { claudeAgentDef } from './defs/claude.js';
import { codexAgentDef } from './defs/codex.js';
import { devinAgentDef } from './defs/devin.js';
import { opencodeAgentDef } from './defs/opencode.js';
import { byokOpenCodeAgentDef } from './defs/byok-opencode.js';
import { hermesAgentDef } from './defs/hermes.js';
import { traeCliAgentDef } from './defs/trae-cli.js';
import { grokBuildAgentDef } from './defs/grok-build.js';
import { kimiAgentDef } from './defs/kimi.js';
import { cursorAgentDef } from './defs/cursor-agent.js';
import { qwenAgentDef } from './defs/qwen.js';
import { qoderAgentDef } from './defs/qoder.js';
import { copilotAgentDef } from './defs/copilot.js';
import { ampAgentDef } from './defs/amp.js';
import { piAgentDef } from './defs/pi.js';
import { kiroAgentDef } from './defs/kiro.js';
import { kiloAgentDef } from './defs/kilo.js';
import { vibeAgentDef } from './defs/vibe.js';
import { deepseekAgentDef } from './defs/deepseek.js';
import { aiderAgentDef } from './defs/aider.js';
import { antigravityAgentDef } from './defs/antigravity.js';
import { codebuddyAgentDef } from './defs/codebuddy.js';
import { reasonixAgentDef } from './defs/reasonix.js';
import { mimoAgentDef } from './defs/mimo.js';
import { readLocalAgentProfileDefs as readLocalAgentProfileDefsFromFile } from './local-profiles.js';
import type { RuntimeAgentDef } from './types.js';

const BASE_AGENT_DEFS: RuntimeAgentDef[] = [
  amrAgentDef,
  claudeAgentDef,
  codexAgentDef,
  devinAgentDef,
  opencodeAgentDef,
  byokOpenCodeAgentDef,
  hermesAgentDef,
  traeCliAgentDef,
  grokBuildAgentDef,
  kimiAgentDef,
  cursorAgentDef,
  qwenAgentDef,
  qoderAgentDef,
  copilotAgentDef,
  ampAgentDef,
  piAgentDef,
  kiroAgentDef,
  kiloAgentDef,
  vibeAgentDef,
  deepseekAgentDef,
  aiderAgentDef,
  antigravityAgentDef,
  reasonixAgentDef,
  codebuddyAgentDef,
  mimoAgentDef,
];

export function readLocalAgentProfileDefs(
  baseDefs: RuntimeAgentDef[] = BASE_AGENT_DEFS,
): RuntimeAgentDef[] {
  return readLocalAgentProfileDefsFromFile(baseDefs);
}

export const AGENT_DEFS: RuntimeAgentDef[] = [
  ...BASE_AGENT_DEFS,
  ...readLocalAgentProfileDefs(BASE_AGENT_DEFS),
];

const ids = new Set();
for (const def of AGENT_DEFS) {
  if (ids.has(def.id)) {
    throw new Error(`Duplicate agent definition id: ${def.id}`);
  }
  ids.add(def.id);
}

export function getAgentDef(id: string): RuntimeAgentDef | null {
  return AGENT_DEFS.find((a) => a.id === id) || null;
}

exec
/bin/bash -lc "sed -n '1,320p' 'apps/daemon/src/runtimes/detection.ts'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import { execAgentFile } from './invocation.js';
import { AGENT_DEFS } from './registry.js';
import {
  DEFAULT_MODEL_OPTION,
  getRememberedLiveModels,
  rememberLiveModels,
} from './models.js';
import { applyAgentLaunchEnv, resolveAgentLaunch } from './launch.js';
import { spawnEnvForAgent } from './env.js';
import { probeAgentAuthStatus } from './auth.js';
import { agentCapabilities } from './capabilities.js';
import { installMetaForAgent } from './metadata.js';
import { resolveAmrProfile } from '../integrations/vela.js';
import {
  buildAuthDiagnostic,
  buildExecutableDiagnostic,
  buildNotInvocableDiagnostic,
  type NotInvocableCause,
} from './diagnostics.js';
import type {
  AgentDiagnostic,
  DetectedAgent,
  RuntimeAgentDef,
  RuntimeCapabilityMap,
  RuntimeModelSource,
  RuntimeModelOption,
} from './types.js';

type FetchedRuntimeModels = {
  models: RuntimeModelOption[];
  source: RuntimeModelSource;
};

function configuredEnvForAgent(
  configuredEnvByAgent: Record<string, Record<string, string>>,
  agentId: string,
): Record<string, string> {
  const configAgentId = agentId === 'byok-opencode' ? 'opencode' : agentId;
  return configuredEnvByAgent?.[configAgentId] ?? {};
}

function amrModelScopeFromEnv(env: NodeJS.ProcessEnv): string {
  return resolveAmrProfile(env);
}

function withRememberedAmrModels(
  def: RuntimeAgentDef,
  env: NodeJS.ProcessEnv,
  modelResult: FetchedRuntimeModels,
): FetchedRuntimeModels {
  if (def.id !== 'amr' || modelResult.models.length > 0) return modelResult;
  const rememberedModels = getRememberedLiveModels(def.id, amrModelScopeFromEnv(env));
  if (rememberedModels.length === 0) return modelResult;
  return { models: rememberedModels, source: 'live' };
}

async function fetchModels(
  def: RuntimeAgentDef,
  resolvedBin: string,
  env: NodeJS.ProcessEnv,
): Promise<FetchedRuntimeModels> {
  if (typeof def.fetchModels === 'function') {
    try {
      const parsed = await def.fetchModels(resolvedBin, env);
      if (!parsed || parsed.length === 0) {
        return { models: def.fallbackModels, source: 'fallback' };
      }
      return { models: parsed, source: 'live' };
    } catch {
      return { models: def.fallbackModels, source: 'fallback' };
    }
  }
  if (!def.listModels) {
    return { models: def.fallbackModels, source: 'fallback' };
  }
  try {
    const { stdout } = await execAgentFile(resolvedBin, def.listModels.args, {
      env,
      timeout: def.listModels.timeoutMs ?? 5000,
      // Models lists from popular CLIs (e.g. opencode) easily exceed the
      // default 1MB buffer once you include every openrouter model. Bump
      // it so we don't truncate the listing.
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = def.listModels.parse(String(stdout));
    // Empty / null parse result means the CLI didn't actually return a
    // usable list (e.g. cursor-agent's "No models available"); fall back
    // to the static hint so the picker isn't stuck on Default-only.
    if (!parsed || parsed.length === 0) {
      return { models: def.fallbackModels, source: 'fallback' };
    }
    return { models: parsed, source: 'live' };
  } catch {
    return { models: def.fallbackModels, source: 'fallback' };
  }
}

type VersionProbeOutcome =
  | { kind: 'not-invocable'; cause: NotInvocableCause }
  | { kind: 'spawned'; version: string | null };

/**
 * Run the agent's `--version` probe and classify the result. The probe
 * has two distinct failure modes the catch arm has to discriminate:
 *
 *   - **Not invocable.** The OS rejected the spawn outright, OR the
 *     wrapper script spawned but its underlying interpreter / target
 *     failed. We split permission failures (EACCES / exit 126) from
 *     missing-target failures (ENOENT / ENOTDIR / exit 127) so Settings can
 *     offer permission-specific copy instead of treating every failure as a
 *     broken shim. We still mark the agent unavailable so Settings does not
 *     advertise a ghost entry (issue #658, lefarcen review P2 on PR #1301).
 *
 *   - **Spawned but `--version` was unhappy.** The binary itself ran
 *     (any other rejection: timeout, generic non-zero exit, stderr
 *     noise) so the CLI is invocable; we just can't read a version
 *     string. Adapters whose `--version` flag is unsupported land
 *     here and must keep working with `version: null`.
 *
 * `child_process.execFile` reports OS-level rejections with a string
 * `err.code` (`'ENOENT'`, `'EACCES'`, `'ENOTDIR'`) and non-zero exit
 * codes with a *numeric* `err.code` equal to the exit status, so the
 * two arms below are unambiguous.
 */
async function probeVersionAtPath(
  def: RuntimeAgentDef,
  resolved: string,
  env: NodeJS.ProcessEnv,
): Promise<VersionProbeOutcome> {
  try {
    const { stdout } = await execAgentFile(resolved, def.versionArgs, {
      env,
      timeout: def.versionProbeTimeoutMs ?? 3000,
    });
    const version = String(stdout).trim().split('\n')[0] ?? null;
    return { kind: 'spawned', version };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (typeof code === 'string') {
      if (code === 'EACCES') {
        return { kind: 'not-invocable', cause: 'not-executable' };
      }
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return { kind: 'not-invocable', cause: 'missing-target' };
      }
    } else if (typeof code === 'number' && (code === 126 || code === 127)) {
      return {
        kind: 'not-invocable',
        cause: code === 126 ? 'not-executable' : 'missing-target',
      };
    }
    return { kind: 'spawned', version: null };
  }
}

function unavailableAgent(
  def: RuntimeAgentDef,
  diagnostics: AgentDiagnostic[] = [],
): DetectedAgent {
  return {
    ...stripFns(def),
    models: def.fallbackModels ?? [DEFAULT_MODEL_OPTION],
    modelsSource: 'fallback',
    available: false,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...installMetaForAgent(def.id),
  };
}

// Probe the agent's `--help` once and record which advertised flags the
// installed CLI supports, so buildArgs can consult the cache. Extracted from
// the main probe so it can run concurrently with model + auth probing instead
// of blocking them. Returns the capability map (or null when the agent
// declares no help/capability metadata or the probe failed).
async function probeCapabilities(
  def: RuntimeAgentDef,
  launchPath: string,
  env: NodeJS.ProcessEnv,
): Promise<RuntimeCapabilityMap | null> {
  if (!def.helpArgs || !def.capabilityFlags) return null;
  try {
    const { stdout } = await execAgentFile(launchPath, def.helpArgs, {
      env,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const caps: RuntimeCapabilityMap = {};
    for (const [flag, key] of Object.entries(def.capabilityFlags)) {
      caps[key] = String(stdout).includes(flag);
    }
    return caps;
  } catch {
    // If --help fails, leave caps empty so buildArgs falls back to the safe
    // baseline (no optional flags).
    return {};
  }
}

async function probe(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): Promise<DetectedAgent> {
  // Detection must probe the exact path the runtime will spawn, not just the
  // PATH-visible shim. This is load-bearing for Codex under nvm/fnm/mise:
  // the discovered `codex` entry is often a `#!/usr/bin/env node` wrapper
  // that is not invocable from a GUI-launched app's stripped PATH, while the
  // launch resolver can still upgrade it to the packaged native Codex binary.
  // If detection probes the shim but chat/run spawns the native binary, the
  // UI incorrectly reports "not installed" until the user pins CODEX_BIN by
  // hand even though the real launch path is healthy.
  const launch = resolveAgentLaunch(def, configuredEnv);
  if (!launch.selectedPath || !launch.launchPath) {
    return unavailableAgent(def, [buildExecutableDiagnostic(def, configuredEnv)]);
  }
  const probeEnv = applyAgentLaunchEnv(
    spawnEnvForAgent(
      def.id,
      {
        ...process.env,
        ...(def.env || {}),
      },
      configuredEnv,
      undefined,
      { resolvedBin: launch.selectedPath },
    ),
    launch,
  );
  const outcome = await probeVersionAtPath(def, launch.launchPath, probeEnv);
  if (outcome.kind === 'not-invocable') {
    return unavailableAgent(def, [
      buildNotInvocableDiagnostic(def, launch, outcome.cause),
    ]);
  }
  // The version probe must finish first (it gates availability), but the
  // three post-version probes are independent reads — run them concurrently
  // so a single agent's detection wall is max(help, models, auth) ≈ 5s rather
  // than the sum ≈ 15s. `--help` capabilities are cached on `agentCapabilities`
  // for buildArgs to consult.
  const [caps, modelResult, auth] = await Promise.all([
    probeCapabilities(def, launch.launchPath, probeEnv),
    fetchModels(def, launch.launchPath, probeEnv),
    probeAgentAuthStatus(def, launch.launchPath, probeEnv),
  ]);
  const surfacedModelResult = withRememberedAmrModels(def, probeEnv, modelResult);
  if (caps) {
    agentCapabilities.set(def.id, caps);
  }
  const authDiagnostic = auth ? buildAuthDiagnostic(def, auth) : null;
  return {
    ...stripFns(def),
    models: surfacedModelResult.models,
    modelsSource: surfacedModelResult.source,
    available: true,
    path: launch.selectedPath,
    version: outcome.version,
    ...(auth
      ? {
          authStatus: auth.status,
          ...(auth.message ? { authMessage: auth.message } : {}),
        }
      : {}),
    ...(authDiagnostic ? { diagnostics: [authDiagnostic] } : {}),
    ...installMetaForAgent(def.id),
  };
}

function stripFns(
  def: RuntimeAgentDef,
): Omit<DetectedAgent, 'models' | 'modelsSource' | 'available' | 'path' | 'version'> {
  // Drop the buildArgs / listModels closures but keep declarative metadata
  // (reasoningOptions, streamFormat, name, bin, etc.). `models` is
  // populated separately by `fetchModels`, so we strip the static
  // `fallbackModels` slot here too. `helpArgs` / `capabilityFlags` /
  // `fallbackBins` / `maxPromptArgBytes` / `env` are probe-or-spawn-only
  // metadata and shouldn't bleed into the API response either.
  // `inactivityTimeoutMs` is a spawn-time hint for the chat-run watchdog
  // and is not part of the public AgentInfo contract — strip it here so
  // the runtime registry stays the only consumer.
  const {
    buildArgs,
    listModels,
    fetchModels,
    fallbackModels,
    helpArgs,
    capabilityFlags,
    fallbackBins,
    versionProbeTimeoutMs,
    maxPromptArgBytes,
    env,
    inactivityTimeoutMs,
    authProbe,
    ...rest
  } = def;
  return rest;
}

async function safeProbe(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): Promise<DetectedAgent> {
  try {
    return await probe(def, configuredEnv);
  } catch {
    // Fault isolation (issue #2297): one adapter's probe blowing up
    // — e.g. a synchronous filesystem throw during PATH walking on a
    // packaged Windows daemon, or an async rejection from one of the
    // post-launch probes — must not collapse the whole agent picker.
    // Without this guard the bare `Promise.all` rejected and the
    // `/api/agents` catch arm returned `[]`, so the UI silently lost
    // every CLI option and fell back to BYOK / Cloud only.
    return unavailableAgent(def);
  }
}

function rememberDetectedLiveModels(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string>,
  agent: DetectedAgent,
): void {
  if (def.id === 'amr' && agent.models.length === 0) return;

exec
/bin/bash -lc "sed -n '1,320p' 'apps/daemon/src/runtimes/executables.ts'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter } from 'node:path';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { wellKnownUserToolchainBins } from '@open-design/platform';
import { resolveSandboxRuntimeConfigFromEnv } from '../sandbox-mode.js';
import { expandHomePath } from './paths.js';
import type { RuntimeAgentDef } from './types.js';

const RUNTIME_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const AGENT_BIN_ENV_KEYS = new Map<string, string>([
  ['amr', 'VELA_BIN'],
  ['aider', 'AIDER_BIN'],
  ['claude', 'CLAUDE_BIN'],
  ['codebuddy', 'CODEBUDDY_BIN'],
  ['codex', 'CODEX_BIN'],
  ['copilot', 'COPILOT_BIN'],
  ['cursor-agent', 'CURSOR_AGENT_BIN'],
  ['deepseek', 'DEEPSEEK_BIN'],
  ['devin', 'DEVIN_BIN'],
  ['hermes', 'HERMES_BIN'],
  ['kimi', 'KIMI_BIN'],
  ['kiro', 'KIRO_BIN'],
  ['kilo', 'KILO_BIN'],
  ['mimo', 'MIMO_BIN'],
  ['opencode', 'OPENCODE_BIN'],
  ['byok-opencode', 'OPENCODE_BIN'],
  ['pi', 'PI_BIN'],
  ['qoder', 'QODER_BIN'],
  ['qwen', 'QWEN_BIN'],
  ['reasonix', 'REASONIX_BIN'],
  ['trae-cli', 'TRAE_CLI_BIN'],
  ['vibe', 'VIBE_BIN'],
]);

const TOOLCHAIN_DIR_CACHE_TTL_MS = 5000;
let cachedToolchainHome: string | null = null;
let cachedToolchainDirs: string[] | null = null;
let cachedToolchainDirsAt = 0;

// Resolve the home directory detection should search, honoring the sandbox /
// `OD_AGENT_HOME` override. `hasOverride` lets callers scope strictly to the
// override home (skipping real-machine system locations) so sandboxed
// detection runs and tests stay deterministic instead of reaching the host.
function resolveDetectionHome(): { home: string; hasOverride: boolean } {
  const sandboxRuntime = resolveSandboxRuntimeConfigFromEnv(
    process.env,
    RUNTIME_PROJECT_ROOT,
  );
  const homeOverride =
    sandboxRuntime?.roots.agentHomeDir ?? process.env.OD_AGENT_HOME;
  return { home: homeOverride || homedir(), hasOverride: Boolean(homeOverride) };
}

function userToolchainDirs() {
  const { home, hasOverride } = resolveDetectionHome();
  const homeOverride = hasOverride ? home : undefined;
  const now = Date.now();
  if (
    cachedToolchainHome === home &&
    cachedToolchainDirs &&
    now - cachedToolchainDirsAt < TOOLCHAIN_DIR_CACHE_TTL_MS
  ) {
    return cachedToolchainDirs;
  }
  cachedToolchainHome = home;
  cachedToolchainDirsAt = now;
  // When OD_AGENT_HOME is set, scope the search strictly to the override
  // home: skip Homebrew / /usr/local *and* pass an empty env so that a
  // developer or CI runner with NPM_CONFIG_PREFIX / npm_config_prefix
  // exported can't leak the real machine's <prefix>/bin into a sandboxed
  // detection run. Without this the agents.test.ts cases that build a
  // tmp home would be machine-environment-dependent.
  cachedToolchainDirs = wellKnownUserToolchainBins({
    home,
    includeSystemBins: process.platform !== 'win32' && !homeOverride,
    env: homeOverride ? {} : process.env,
  });
  return cachedToolchainDirs;
}

// The user-level toolchain bin directories (Homebrew, ~/.local/bin, ~/.bun/bin,
// version-manager node dirs, npm prefixes, …) that binary *resolution* searches
// beyond process.env.PATH. Exposed so the spawn env can append the same dirs:
// a binary can resolve here yet fail to *execute* if its shebang interpreter
// (e.g. `#!/usr/bin/env bun`) lives in one of these dirs and the spawn PATH
// doesn't include it. Keeping resolution and spawn PATH symmetric fixes that.
export function userToolchainBinDirs(): string[] {
  return userToolchainDirs();
}

function resolvePathDirs() {
  const seen = new Set();
  const dirs = [
    ...(process.env.PATH || '').split(delimiter),
    // GUI launchers (macOS .app bundles, Linux .desktop files) often start
    // with a minimal PATH. Include common user-level CLI install locations
    // so agent detection matches the user's shell-installed tools,
    // especially Node version managers.
    ...userToolchainDirs(),
  ];
  return dirs.filter((dir) => {
    if (!dir || seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

// The exact, de-duplicated directory list `resolveOnPath` walks. Surfaced so
// detection can attach it to a `not-on-path` diagnostic verbatim — the UI
// shows the user where we actually looked before asking them to set an
// explicit binary path, instead of recomputing PATH client-side.
export function agentSearchDirs(): string[] {
  return resolvePathDirs();
}

// The `*_BIN` environment variable that overrides PATH detection for a given
// agent id (e.g. `cursor-agent` → `CURSOR_AGENT_BIN`), or null when the agent
// has no override key. Drives the `setEnv` / `clearEnv` fix intents.
export function agentBinEnvKey(agentId: string | undefined): string | null {
  if (!agentId) return null;
  return AGENT_BIN_ENV_KEYS.get(agentId) ?? null;
}

export function resolveOnPath(bin: string): string | null {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];
  const dirs = resolvePathDirs();
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (full && existsSync(full)) return full;
    }
  }
  return null;
}

function looksExecutableOnWindows(filePath: string): boolean {
  const ext = path.extname(filePath).trim().toUpperCase();
  if (!ext) return false;
  const executableExts = (process.env.PATHEXT || '.EXE;.CMD;.BAT')
    .split(';')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return executableExts.includes(ext);
}

function executableFilePath(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const expanded = expandHomePath(raw.trim());
  if (!path.isAbsolute(expanded)) return null;
  try {
    if (!statSync(expanded).isFile()) return null;
    if (process.platform === 'win32') {
      if (!looksExecutableOnWindows(expanded)) return null;
    } else {
      accessSync(expanded, constants.X_OK);
    }
    return expanded;
  } catch {
    return null;
  }
}

// Resolve the first available binary for an agent definition. Tries
// `def.bin` first, then walks `def.fallbackBins` in order. Used for
// agents whose forks ship under a different binary name but speak the
// exact same CLI (Claude Code → OpenClaude, issue #235). Returns null
// when no candidate is on PATH.
function configuredExecutableOverride(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): string | null {
  const envKey = AGENT_BIN_ENV_KEYS.get(def?.id);
  if (!envKey) return null;
  return executableFilePath(configuredEnv?.[envKey]);
}

export function resolveAmrOpenCodeExecutable(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = executableFilePath(env.VELA_OPENCODE_BIN);
  if (configured) return configured;
  // In packaged builds prefer the bundled companion under
  // `OD_RESOURCE_ROOT/bin/libexec/opencode/opencode` so a stale global
  // `opencode` on the user's PATH can't override the known-good build that
  // shipped with this app. PATH is only consulted as a last resort.
  const resourceRoot = (
    env.OD_RESOURCE_ROOT ?? process.env.OD_RESOURCE_ROOT
  )?.trim();
  if (resourceRoot) {
    const bundledDir = packagedVelaOpenCodeCompanionTree(resourceRoot);
    if (bundledDir) {
      const bundled = executableFilePath(
        path.join(
          bundledDir,
          process.platform === 'win32' ? 'opencode.exe' : 'opencode',
        ),
      );
      if (bundled) return bundled;
    }
  }
  return resolveOnPath('opencode-cli') ?? resolveOnPath('opencode');
}

// `tools/pack/tests/resources.test.ts` ships the AMR OpenCode companion as a
// `<resourceRoot>/bin/libexec/opencode/opencode` *executable file*, not just
// the directory. Treating any directory there as a valid companion produces a
// false-positive availability path: `detectAgents()` would surface AMR as
// available even though the first real run can't launch (`vela` would spawn
// a missing/non-executable inner binary). Verify the inner executable too.
function packagedVelaOpenCodeCompanionTree(resourceRoot: string): string | null {
  const candidate = path.join(resourceRoot, 'bin', 'libexec', 'opencode');
  const exe = path.join(
    candidate,
    process.platform === 'win32' ? 'opencode.exe' : 'opencode',
  );
  try {
    if (!statSync(candidate).isDirectory()) return null;
    if (!statSync(exe).isFile()) return null;
    if (process.platform === 'win32') {
      if (!looksExecutableOnWindows(exe)) return null;
    } else {
      accessSync(exe, constants.X_OK);
    }
    return candidate;
  } catch {
    return null;
  }
}

function packagedBuiltInExecutable(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): string | null {
  if (def.id === 'byok-opencode') {
    return resolveAmrOpenCodeExecutable({ ...process.env, ...configuredEnv });
  }
  if (def.id !== 'amr') return null;
  const resourceRoot = process.env.OD_RESOURCE_ROOT?.trim();
  if (!resourceRoot) return null;
  if (
    !resolveAmrOpenCodeExecutable({ ...process.env, ...configuredEnv }) &&
    !packagedVelaOpenCodeCompanionTree(resourceRoot)
  ) {
    return null;
  }
  const candidate = path.join(
    resourceRoot,
    'bin',
    process.platform === 'win32' ? 'vela.exe' : 'vela',
  );
  try {
    if (!statSync(candidate).isFile()) return null;
    if (process.platform === 'win32') {
      if (!looksExecutableOnWindows(candidate)) return null;
    } else {
      accessSync(candidate, constants.X_OK);
    }
    return candidate;
  } catch {
    return null;
  }
}

// The official OpenAI Codex desktop app (bundle id `com.openai.codex`) ships
// the `codex` CLI *inside* its macOS application bundle at
// `Codex.app/Contents/Resources/codex` and does NOT add it to PATH unless the
// user explicitly runs the app's "Install command line tool" action. Users who
// installed Codex only through the app therefore see a "not installed" agent
// card even though a healthy native `codex` binary exists on disk, because
// neither PATH nor the user-toolchain search dirs cover the app bundle. Probe
// the well-known bundle locations so app-only installs are detected. This is a
// last-resort fallback that ranks below PATH, so an explicit `npm i -g` /
// Homebrew / version-manager install always wins.
function codexAppBundleExecutable(def: RuntimeAgentDef): string | null {
  if (def?.id !== 'codex') return null;
  for (const candidate of codexAppBundleCandidates()) {
    const resolved = executableFilePath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

// Exported for tests: the no-override `/Applications` branch can't be exercised
// through `resolveAgentExecutable` deterministically (it would depend on the
// host actually having `/Applications/Codex.app`), so tests assert the built
// candidate list directly to catch a path typo or ordering regression in the
// common real-world install case.
export function codexAppBundleCandidates(): string[] {
  // The Codex app bundle is a macOS-only concept; other platforms have no
  // analogous standalone install of the `codex` CLI to probe for here.
  if (process.platform !== 'darwin') return [];
  const { home, hasOverride } = resolveDetectionHome();
  const bundleSuffix = ['Codex.app', 'Contents', 'Resources', 'codex'];
  // User-scoped install (~/Applications). Honors the override home so
  // sandboxed detection runs and tests stay deterministic.
  const candidates = [path.join(home, 'Applications', ...bundleSuffix)];
  // System-wide /Applications install. Skip it under an override home for the
  // same isolation reason `userToolchainDirs` skips Homebrew/system bins.
  if (!hasOverride) {
    candidates.unshift(path.join('/Applications', ...bundleSuffix));
  }
  return candidates;
}

export function resolveAgentExecutable(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): string | null {
  return inspectAgentExecutableResolution(def, configuredEnv).selectedPath;
}


exec
/bin/bash -lc "sed -n '1,320p' 'apps/daemon/src/runtimes/resolution.ts'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import { getAgentDef } from './registry.js';
import { resolveAgentExecutable } from './executables.js';

// Resolve the absolute path of an agent's binary on the current PATH.
// Used by the chat handler so spawn() gets the same executable that
// detection reported as available — fixes Windows ENOENT when the bare
// bin name isn't on the child process's PATH (issue #10).
export function resolveAgentBin(id: string, configuredEnv: Record<string, string> = {}) {
  const def = getAgentDef(id);
  if (!def?.bin) return null;
  return resolveAgentExecutable(def, configuredEnv);
}

exec
/bin/bash -lc "sed -n '1,320p' 'apps/daemon/src/runtimes/capabilities.ts'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import type { RuntimeCapabilityMap } from './types.js';

export const agentCapabilities = new Map<string, RuntimeCapabilityMap>();

exec
/bin/bash -lc "sed -n '1,320p' 'apps/daemon/src/runtimes/metadata.ts'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
/** HTTPS links for the web UI when an agent is unavailable. Keys match `AGENT_DEFS[].id`. */
const AGENT_INSTALL_LINKS: Record<
  string,
  { installUrl?: string; docsUrl?: string }
> = {
  amp: {
    installUrl: 'https://ampcode.com/manual#install',
    docsUrl: 'https://ampcode.com/manual',
  },
  amr: {
    installUrl: 'https://open-design.ai/amr',
    docsUrl: 'https://github.com/nexu-io/open-design/blob/main/docs/new-agent-runtime-acp.md',
  },
  claude: {
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  codex: {
    installUrl: 'https://github.com/openai/codex',
    docsUrl: 'https://developers.openai.com/codex',
  },
  devin: {
    installUrl: 'https://cli.devin.ai/docs',
    docsUrl: 'https://docs.devin.ai',
  },
  opencode: {
    installUrl: 'https://opencode.ai/docs',
    docsUrl: 'https://github.com/sst/opencode',
  },
  hermes: {
    installUrl: 'https://github.com/nexu-io/open-design/blob/main/docs/agent-adapters.md',
    docsUrl: 'https://hermes-agent.nousresearch.com/docs/',
  },
  'trae-cli': {
    installUrl: 'https://www.volcengine.com/docs/86677/2227861?lang=zh',
    docsUrl: 'https://www.volcengine.com/docs/86677/2227861?lang=zh',
  },
  kimi: {
    installUrl: 'https://github.com/MoonshotAI/kimi-cli',
    docsUrl: 'https://www.kimi.com/code/docs/en/kimi-cli/guides/getting-started.html?aff=open-design',
  },
  'cursor-agent': {
    installUrl: 'https://cursor.com/docs/cli/overview',
    docsUrl: 'https://docs.cursor.com/en/cli/overview',
  },
  qwen: {
    installUrl: 'https://github.com/QwenLM/qwen-code',
    docsUrl: 'https://qwenlm.github.io/qwen-code-docs/en/index',
  },
  qoder: {
    installUrl: 'https://qoder.com/download',
    docsUrl: 'https://docs.qoder.com',
  },
  copilot: {
    installUrl: 'https://github.com/github/copilot-cli',
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/use-copilot-extensions/use-in-cli',
  },
  pi: {
    installUrl: 'https://github.com/nexu-io/open-design/blob/main/docs/agent-adapters.md',
    docsUrl: 'https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md',
  },
  kiro: {
    installUrl: 'https://kiro.dev',
    docsUrl: 'https://kiro.dev/docs/cli/',
  },
  kilo: {
    installUrl: 'https://kilo.ai',
    docsUrl: 'https://kilo.ai/docs/cli',
  },
  mimo: {
    installUrl: 'https://mimo.ai',
    docsUrl: 'https://mimo.ai/docs',
  },
  vibe: {
    installUrl: 'https://docs.mistral.ai',
    docsUrl: 'https://github.com/mistralai/vibe-acp',
  },
  deepseek: {
    installUrl: 'https://github.com/Hmbown/CodeWhale',
    docsUrl: 'https://github.com/Hmbown/CodeWhale/blob/main/README.md',
  },
  codebuddy: {
    installUrl: 'https://www.codebuddy.cn',
    docsUrl: 'https://www.codebuddy.cn/docs/workbuddy/Overview',
  },
};

function sanitizeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function installMetaForAgent(
  agentId: string,
): { installUrl?: string; docsUrl?: string } {
  const meta = AGENT_INSTALL_LINKS[agentId];
  if (!meta) return {};
  const installUrl = sanitizeHttpsUrl(meta.installUrl);
  const docsUrl = sanitizeHttpsUrl(meta.docsUrl);
  return {
    ...(installUrl ? { installUrl } : {}),
    ...(docsUrl ? { docsUrl } : {}),
  };
}

exec
/bin/bash -lc "sed -n '1,320p' 'apps/daemon/src/runtimes/runs.ts'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
// @ts-nocheck
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { todoSnapshotHasUnfinishedWork } from '@open-design/contracts';
import { normalizeMediaExecutionPolicyForRun } from '../media/policy.js';
import {
  normalizeRunToolBundleForRun,
  summarizeRunToolBundle,
} from '../run-tool-bundle.js';
import { createRunLifecycleTracer } from '../run-lifecycle-tracer.js';
import { projectWorkspaceProvenance } from '../workspace-contract.js';

export const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

function readString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractErrorDetails(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const nested = payload.error && typeof payload.error === 'object' ? payload.error : {};
  return {
    error: readString(nested.message) ?? readString(payload.message),
    errorCode: readString(nested.code) ?? readString(payload.code),
  };
}

export function createChatRunService({
  createSseResponse,
  createSseErrorPayload,
  maxEvents = 2_000,
  ttlMs = 30 * 60 * 1000,
  shutdownGraceMs = 3_000,
  // Absolute directory under which per-run event JSONL logs are written
  // (one file per run at <runsLogDir>/<runId>/events.jsonl). When null,
  // event persistence is disabled and statusBody.eventsLogPath = null —
  // legacy behavior. The path is surfaced through MCP get_run so an
  // external coding agent can `tail` the file in its own shell during
  // a long OD generation, instead of polling blindly and giving up.
  runsLogDir = null,
  // Optional observer invoked for every emitted event BEFORE the in-memory
  // ring buffer is truncated. The daemon uses it to fold committed side
  // effects (tool calls, artifact writes) into a per-run accumulator that
  // outlives buffer truncation. Kept generic here: this service does not
  // interpret event semantics, it just hands each record to the observer.
  onEventEmitted = null,
}) {
  const runs = new Map();

  const create = (meta = {}) => {
    const now = Date.now();
    const id = randomUUID();
    const run = {
      id,
      projectId: typeof meta.projectId === 'string' && meta.projectId ? meta.projectId : null,
      conversationId: typeof meta.conversationId === 'string' && meta.conversationId ? meta.conversationId : null,
      assistantMessageId: typeof meta.assistantMessageId === 'string' && meta.assistantMessageId ? meta.assistantMessageId : null,
      clientRequestId: typeof meta.clientRequestId === 'string' && meta.clientRequestId ? meta.clientRequestId : null,
      agentId: typeof meta.agentId === 'string' && meta.agentId ? meta.agentId : null,
      projectMetadata:
        meta.projectMetadata && typeof meta.projectMetadata === 'object' && !Array.isArray(meta.projectMetadata)
          ? meta.projectMetadata
          : null,
      workspace: projectWorkspaceProvenance(meta.projectMetadata),
      // Plan §3.A1 / spec §11.5. The applied plugin snapshot id pins
      // every prompt fragment and tool gate to a frozen view so replay
      // is byte-equal across plugin upgrades. Runs are in-memory in
      // v1 — the id lives on the run object plus on the
      // `applied_plugin_snapshots` row (FK back via run_id).
      appliedPluginSnapshotId:
        typeof meta.appliedPluginSnapshotId === 'string' && meta.appliedPluginSnapshotId
          ? meta.appliedPluginSnapshotId
          : null,
      pluginId:
        typeof meta.pluginId === 'string' && meta.pluginId ? meta.pluginId : null,
      mediaExecution: normalizeMediaExecutionPolicyForRun(meta.mediaExecution),
      toolBundle: normalizeRunToolBundleForRun(meta.toolBundle),
      browserUse: meta.browserUse && typeof meta.browserUse === 'object' ? meta.browserUse : null,
      sessionMode:
        meta.sessionMode === 'chat' || meta.sessionMode === 'design' || meta.sessionMode === 'plan'
          ? meta.sessionMode
          : null,
      context:
        meta.context && typeof meta.context === 'object' && !Array.isArray(meta.context)
          ? meta.context
          : null,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      events: [],
      nextEventId: 1,
      clients: new Set(),
      waiters: new Set(),
      child: null,
      acpSession: null,
      childPid: null,
      processGroupId: null,
      childExitObservedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      cancelRequested: false,
      retryRestartTimer: null,
      stdinOpen: false,
      // Work-completeness signals (#1247 / #1060), folded from agent events by
      // captureRunWorkCompletenessSignals (server.ts). `lastTodoSnapshot` is the
      // most recent TodoWrite `todos` array; `truncatedMidTurn` records a
      // max_tokens cut-off. At terminal time finish() derives
      // `endedWithUnfinishedWork` from them via the canonical predicate.
      lastTodoSnapshot: null,
      truncatedMidTurn: false,
      endedWithUnfinishedWork: false,
      artifactCount: undefined as number | undefined,
      artifactOutcome: undefined,
      eventsLogPath: runsLogDir ? path.join(runsLogDir, id, 'events.jsonl') : null,
      eventsLogStream: null,
      // Set once finish() has closed the log stream, so a late post-finish emit
      // can't lazily re-open a stream nothing will ever close (FD leak).
      eventsLogClosed: false,
    };
    runs.set(run.id, run);
    return run;
  };

  const get = (id) => runs.get(id) ?? null;

  const scheduleCleanup = (run) => {
    setTimeout(() => {
      if (TERMINAL_RUN_STATUSES.has(run.status)) runs.delete(run.id);
    }, ttlMs).unref?.();
  };

  // Lazily open the per-run event log on first emit. The directory may
  // not exist yet; mkdir is recursive so it's safe to call repeatedly.
  // Disk failures are best-effort — if we can't write, the run still
  // proceeds (SSE clients keep getting events from memory).
  const ensureLogStream = (run) => {
    if (!run.eventsLogPath) return null;
    if (run.eventsLogStream) return run.eventsLogStream;
    // finish() has already closed + nulled this run's log stream. Re-opening it
    // here for a late event (async child-close diagnostic, trailing tool
    // callback, telemetry) would leak a file descriptor that nothing ever
    // closes. We gate on the explicit `eventsLogClosed` flag — NOT on terminal
    // status — so finish()'s own `end` emit (which runs while status is already
    // terminal but before the stream is closed) can still open + write + close
    // the log for a run that had no prior events. Late events still reach
    // memory + SSE clients below; we just stop persisting them to the closed
    // log. (#3408 P1 FD-leak fix; cf. #4163.)
    if (run.eventsLogClosed) return null;
    try {
      fs.mkdirSync(path.dirname(run.eventsLogPath), { recursive: true });
      run.eventsLogStream = fs.createWriteStream(run.eventsLogPath, { flags: 'a' });
      // Don't crash the daemon on a stream-level error; just stop
      // trying to use this stream so subsequent emits silently skip.
      run.eventsLogStream.on('error', () => {
        try { run.eventsLogStream?.destroy(); } catch { /* ignore */ }
        run.eventsLogStream = null;
      });
      return run.eventsLogStream;
    } catch {
      return null;
    }
  };

  const emit = (run, event, data) => {
    if (event === 'error') {
      const details = extractErrorDetails(data);
      if (details.error) run.error = details.error;
      if (details.errorCode) run.errorCode = details.errorCode;
    }
    const id = run.nextEventId++;
    const record = { id, event, data, timestamp: Date.now() };
    // Fold committed side effects BEFORE the ring buffer can drop this record,
    // so the finalization-time verdict survives truncation of run.events.
    if (onEventEmitted) {
      try { onEventEmitted(run, record); } catch { /* observer must never break emit */ }
    }
    run.events.push(record);
    if (run.events.length > maxEvents) run.events.splice(0, run.events.length - maxEvents);
    run.updatedAt = Date.now();
    const stream = ensureLogStream(run);
    if (stream) {
      try {
        stream.write(JSON.stringify(record) + '\n');
      } catch {
        // Stream-level write errors are caught by the on('error') above;
        // swallowing here keeps the SSE fan-out below from being skipped.
      }
    }
    for (const sse of run.clients) sse.send(event, data, id);
    return record;
  };

  const statusBody = (run) => ({
    id: run.id,
    projectId: run.projectId,
    conversationId: run.conversationId,
    assistantMessageId: run.assistantMessageId,
    agentId: run.agentId,
    designSystemId: run.designSystemId ?? null,
    designSystemRequestedId: run.designSystemRequestedId ?? null,
    designSystemSelectionSource: run.designSystemSelectionSource ?? null,
    designSystemDigest: run.designSystemDigest ?? null,
    appliedPluginSnapshotId: run.appliedPluginSnapshotId ?? null,
    pluginId: run.pluginId ?? null,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    cancelRequested: !!run.cancelRequested,
    childPid: typeof run.child?.pid === 'number' ? run.child.pid : run.childPid ?? null,
    processGroupId: run.processGroupId ?? null,
    childExited: !run.child || run.child.exitCode !== null || run.child.signalCode !== null,
    childExitObservedAt: run.childExitObservedAt ?? null,
    exitCode: run.exitCode,
    signal: run.signal,
    error: run.error ?? null,
    errorCode: run.errorCode ?? null,
    failureCategory: run.failureCategory ?? null,
    failureDetail: run.failureDetail ?? null,
    resumable: run.resumable ?? false,
    endedWithUnfinishedWork: !!run.endedWithUnfinishedWork,
    ...(Number.isFinite(run.artifactCount) ? { artifactCount: run.artifactCount } : {}),
    eventsLogPath: run.eventsLogPath ?? null,
    workspace: projectWorkspaceProvenance(run.projectMetadata),
    mediaExecution: run.mediaExecution ?? normalizeMediaExecutionPolicyForRun(null),
    toolBundle: summarizeRunToolBundle(run.toolBundle),
    ...(run.promptCache ? { promptCache: run.promptCache } : {}),
    ...(run.nativeSessionRecovery ? { nativeSessionRecovery: run.nativeSessionRecovery } : {}),
    ...(run.browserUse ? { browserUse: run.browserUse } : {}),
  });

  const finish = (run, status, code: number | null = null, signal: string | null = null) => {
    if (TERMINAL_RUN_STATUSES.has(run.status)) return;
    run.status = status;
    run.exitCode = code;
    run.signal = signal;
    run.updatedAt = Date.now();
    // Derive the work-completeness flag once, at the single terminal choke point,
    // from the signals the agent-event handler folded onto the run. Uses the
    // canonical predicate so it can never diverge from the web chat footer
    // (#1247 / #1060). A truncated turn (max_tokens) counts as unfinished even
    // if the last TodoWrite looked done. Absence of any TodoWrite snapshot keeps
    // the flag false, so a text-only answer stays "Completed".
    run.endedWithUnfinishedWork =
      Boolean(run.truncatedMidTurn) || todoSnapshotHasUnfinishedWork(run.lastTodoSnapshot);
    // Release run-scoped resources the starter registered (e.g. the minted
    // tool-token grant + agent event-sink entries). This runs on EVERY
    // terminal path — including a startup throw that never reached the child
    // lifecycle cleanup — so a failed run can never leave its capability token
    // live for the token TTL. Best-effort + one-shot.
    if (typeof run.onFinalize === 'function') {
      const finalize = run.onFinalize;
      run.onFinalize = null;
      try { finalize(); } catch { /* best-effort */ }
    }
    emit(run, 'end', {
      code,
      signal,
      status,
      resumable: run.resumable ?? false,
      endedWithUnfinishedWork: run.endedWithUnfinishedWork,
      ...(Number.isFinite(run.artifactCount) ? { artifactCount: run.artifactCount } : {}),
      failureCategory: run.failureCategory ?? null,
      failureDetail: run.failureDetail ?? null,
    });
    for (const sse of run.clients) sse.end();
    run.clients.clear();
    for (const waiter of run.waiters) waiter(statusBody(run));
    run.waiters.clear();
    // Close the event log stream now that no more events will be
    // emitted for this run. The file stays on disk for tail/grep.
    try { run.eventsLogStream?.end(); } catch { /* ignore */ }
    run.eventsLogStream = null;
    // Any event emitted after this point must not lazily re-open the log.
    run.eventsLogClosed = true;
    scheduleCleanup(run);
  };

  const fail = (run, code, message, init = {}) => {
    emit(run, 'error', createSseErrorPayload(code, message, init));
    finish(run, 'failed', 1, null);
  };

  const start = (run, starter) => {
    createRunLifecycleTracer(run).mark('start_requested');
    void starter(run).catch((err) => {
      fail(run, 'AGENT_EXECUTION_FAILED', err instanceof Error ? err.message : String(err));
    });
    return run;
  };

  const stream = (run, req, res) => {
    const sse = createSseResponse(res);
    const lastEventId = Number(req.get('Last-Event-ID') || req.query.after || 0);
    let sent = 0;
    for (const record of run.events) {
      if (!Number.isFinite(lastEventId) || record.id > lastEventId) {
        sse.send(record.event, record.data, record.id);
        sent++;
      }
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      // Guarantee a reattaching client sees a terminal signal even if its
      // cursor is at or past the final event id — otherwise the SSE
      // stream ends silently and the client falls back to status-only fetch.
      if (sent === 0 && run.events.length > 0) {
        const last = run.events[run.events.length - 1];
        sse.send(last.event, last.data, last.id);
      }
      sse.end();
      return;
    }
    run.clients.add(sse);
    res.on('close', () => {
      run.clients.delete(sse);
      sse.cleanup();
    });
  };

exec
/bin/bash -lc "rg -n 'export (async )?function|export const|detect|refresh|cache|listAgents|AGENT_DEFS|agentCapabilities' apps/daemon/src/runtimes/detection.ts apps/daemon/src/routes/daemon.ts apps/daemon/src/routes/chat.ts apps/daemon/src/server.ts apps/daemon/src/agents.ts | sed -n '1,300p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/daemon/src/runtimes/detection.ts:2:import { AGENT_DEFS } from './registry.js';
apps/daemon/src/runtimes/detection.ts:11:import { agentCapabilities } from './capabilities.js';
apps/daemon/src/runtimes/detection.ts:171:// installed CLI supports, so buildArgs can consult the cache. Extracted from
apps/daemon/src/runtimes/detection.ts:208:  // If detection probes the shim but chat/run spawns the native binary, the
apps/daemon/src/runtimes/detection.ts:236:  // so a single agent's detection wall is max(help, models, auth) ≈ 5s rather
apps/daemon/src/runtimes/detection.ts:237:  // than the sum ≈ 15s. `--help` capabilities are cached on `agentCapabilities`
apps/daemon/src/runtimes/detection.ts:246:    agentCapabilities.set(def.id, caps);
apps/daemon/src/runtimes/detection.ts:331:export async function detectAgents(
apps/daemon/src/runtimes/detection.ts:335:    AGENT_DEFS.map((def) => safeProbe(def, configuredEnvForAgent(configuredEnvByAgent, def.id))),
apps/daemon/src/runtimes/detection.ts:337:  // Refresh the validation cache from whatever we just surfaced to the UI
apps/daemon/src/runtimes/detection.ts:341:    const def = AGENT_DEFS[index];
apps/daemon/src/runtimes/detection.ts:351:// validation cache is refreshed per-agent (same effect as the batch path,
apps/daemon/src/runtimes/detection.ts:352:// just incrementally). `detectAgents` keeps the array contract for callers
apps/daemon/src/runtimes/detection.ts:353:// that don't care about incremental delivery (cache warm, analytics, chat).
apps/daemon/src/runtimes/detection.ts:354:export async function* detectAgentsStream(
apps/daemon/src/runtimes/detection.ts:357:  const tagged = AGENT_DEFS.map((def, index) =>
apps/daemon/src/server.ts:24:  detectDeckIntentSignal,
apps/daemon/src/server.ts:25:  detectMediaIntentSignal,
apps/daemon/src/server.ts:26:  detectPlatformIntentSignal,
apps/daemon/src/server.ts:30:import { emittedRenderableQuestionForm } from './question-form-detect.js';
apps/daemon/src/server.ts:183:  detectAgents,
apps/daemon/src/server.ts:215:import { amrModelLoadingCache } from './runtimes/amr-model-cache.js';
apps/daemon/src/server.ts:260:} from './plugins/plugin-asset-cache.js';
apps/daemon/src/server.ts:455:  refreshAccessToken,
apps/daemon/src/server.ts:483:  detectEntryFile,
apps/daemon/src/server.ts:579:import { refreshLiveArtifact } from './live-artifacts/refresh-service.js';
apps/daemon/src/server.ts:683:  detectSkillPluginCandidateOnRunSuccess,
apps/daemon/src/server.ts:847:// Disk cache + same-origin proxy for external preview media (cross-border CDN
apps/daemon/src/server.ts:848:// images/videos referenced by plugin example.html). See plugin-asset-cache.ts.
apps/daemon/src/server.ts:850:  cacheDir: path.join(RUNTIME_DATA_DIR, 'plugin-asset-cache'),
apps/daemon/src/server.ts:885:// In-memory OAuth state cache. Lives for the daemon process's lifetime.
apps/daemon/src/server.ts:925: * refresh against the same `tokenEndpoint` / `clientId` / `clientSecret`
apps/daemon/src/server.ts:927: * registering a new client_id that the upstream then rejects the refresh
apps/daemon/src/server.ts:929: * refreshed; the caller treats `null` as "needs reconnect".
apps/daemon/src/server.ts:931:async function refreshAndPersistToken(dataDir, serverId, current) {
apps/daemon/src/server.ts:932:  if (!current.refreshToken) return null;
apps/daemon/src/server.ts:934:  const tokenResp = await refreshAccessToken({
apps/daemon/src/server.ts:938:    refreshToken: current.refreshToken,
apps/daemon/src/server.ts:944:    refreshToken: tokenResp.refresh_token ?? current.refreshToken,
apps/daemon/src/server.ts:983:export const __forTestChatRunHandles = activeChatRunHandles;
apps/daemon/src/server.ts:985:export function __forTestEmitLiveArtifactEvent(
apps/daemon/src/server.ts:988:  artifact: { id: string; projectId?: string; title?: string; refreshStatus?: string },
apps/daemon/src/server.ts:1001:    refreshStatus: artifact.refreshStatus,
apps/daemon/src/server.ts:1023:    type: 'live_artifact_refresh',
apps/daemon/src/server.ts:1082:export const SSE_KEEPALIVE_INTERVAL_MS = 25_000;
apps/daemon/src/server.ts:1084:export function createAgentRuntimeEnv(
apps/daemon/src/server.ts:1148:export function createAgentRuntimeToolPrompt(
apps/daemon/src/server.ts:1168:export function createOpenDesignToolEnv({
apps/daemon/src/server.ts:1191:export function createDaemonDataDirConfiguredAgentEnv(
apps/daemon/src/server.ts:1200:export function normalizeProjectDisplayStatus(status) {
apps/daemon/src/server.ts:1204:export function composeProjectDisplayStatus(
apps/daemon/src/server.ts:1283:export function __forTestFilesystemWriteFileNamesFromRunEvents(events) {
apps/daemon/src/server.ts:1303:export function __forTestFilesystemEmptyAnswerFallbackText(fileNames) {
apps/daemon/src/server.ts:1307:export function shouldReportRunCompletedFromMessage(saved, body = {}) {
apps/daemon/src/server.ts:1317:export function telemetryPromptFromRunRequest(message, currentPrompt) {
apps/daemon/src/server.ts:1336:export const FORM_ANSWERED_SYSTEM_OVERRIDE = `## OVERRIDE \u2014 form already answered (this is turn 2 or later)
apps/daemon/src/server.ts:1361:export const FORM_ANSWERED_GENERIC_OVERRIDE = `## OVERRIDE \u2014 form already answered (this is turn 2 or later)
apps/daemon/src/server.ts:1402:export function composeChatUserRequestForAgent(
apps/daemon/src/server.ts:1433:export function createFinalizedMessageTelemetryReporter({
apps/daemon/src/server.ts:1581:export function shouldReportRunCompletionTelemetryFallbackStatus(status: unknown): boolean {
apps/daemon/src/server.ts:1904:export function createSseResponse(
apps/daemon/src/server.ts:1909:  res.setHeader('Cache-Control', 'no-cache, no-transform');
apps/daemon/src/server.ts:1995:export async function startServer({
apps/daemon/src/server.ts:2161:    /^\/projects\/[^/]+\/(?:raw|preview)\/|^\/codex-pets\/[^/]+\/spritesheet$|^\/asset-cache$/;
apps/daemon/src/server.ts:2429:  // hits a populated cache even if /api/agents hasn't been called yet.
apps/daemon/src/server.ts:2433:      return detectAgents(config.agentCliEnv ?? {});
apps/daemon/src/server.ts:2435:    .catch(() => detectAgents().catch(() => {}));
apps/daemon/src/server.ts:2438:    console.warn('[od] Failed to recover stale live artifact refreshes:', error);
apps/daemon/src/server.ts:2743:  const importDeps = { importClaudeDesignZip, projectDir, detectEntryFile };
apps/daemon/src/server.ts:2823:    refreshLiveArtifact,
apps/daemon/src/server.ts:3058:      let detectedAgentName: string | null = null;
apps/daemon/src/server.ts:3060:        const agents = await detectAgents(config.agentCliEnv ?? {}).catch(() => []);
apps/daemon/src/server.ts:3063:        detectedAgentName = available?.name ?? null;
apps/daemon/src/server.ts:3068:        agentName: getAgentDef(agentId)?.name ?? detectedAgentName ?? agentId,
apps/daemon/src/server.ts:3226:      res.setHeader('Cache-Control', 'no-cache');
apps/daemon/src/server.ts:4499:          if (isTokenExpired(tok) && tok.refreshToken) {
apps/daemon/src/server.ts:4501:              const refreshed = await refreshAndPersistToken(
apps/daemon/src/server.ts:4506:              if (refreshed) access = refreshed.accessToken;
apps/daemon/src/server.ts:4509:                '[mcp-oauth] refresh failed for',
apps/daemon/src/server.ts:4562:        freeformDeckSignal: detectDeckIntentSignal(message, currentPrompt),
apps/daemon/src/server.ts:4563:        mediaHintSignal: detectMediaIntentSignal(message, currentPrompt),
apps/daemon/src/server.ts:4564:        platformHintSignal: detectPlatformIntentSignal(message, currentPrompt),
apps/daemon/src/server.ts:4819:        const resumeCatalog = await amrModelLoadingCache.get(resumeProbe.cacheKey, {
apps/daemon/src/server.ts:4925:    // which flips mid-conversation as Bearers expire/refresh. Keeping it out of
apps/daemon/src/server.ts:4926:    // the cached stable prefix (daemonSystemPrompt) and re-sending it here in
apps/daemon/src/server.ts:4927:    // the per-turn slice keeps the upstream prompt-cache prefix byte-stable
apps/daemon/src/server.ts:4928:    // across resumes (protecting the conversation-history cache) while still
apps/daemon/src/server.ts:5577:    // adapter-named error even if /api/agents hadn't refreshed yet.
apps/daemon/src/server.ts:5638:      // Resolve the AMR model catalog through the SAME shared cache the UI's
apps/daemon/src/server.ts:5639:      // `/api/amr/models` endpoint serves (AmrModelLoadingCache): a cached
apps/daemon/src/server.ts:5641:      // `vela model preset` seed while a remote refresh runs in the background.
apps/daemon/src/server.ts:5651:      // AMR became unusable in packaged nightlies. Reusing the cache keeps that
apps/daemon/src/server.ts:5657:        const catalog = await amrModelLoadingCache.get(probe.cacheKey, {
apps/daemon/src/server.ts:5679:      // concrete id via the agent-wide cached model order; if it still is not,
apps/daemon/src/server.ts:5739:      // or stale) catalog we intentionally do NOT fail-close. The cached/preset
apps/daemon/src/server.ts:5947:          // refresh the stable hash to what the session now holds.
apps/daemon/src/server.ts:6183:    // If detection can't find the binary, surface a friendly SSE error
apps/daemon/src/server.ts:6194:          'Install it and refresh the agent list (GET /api/agents) before retrying.',
apps/daemon/src/server.ts:6789:    //   1. Token billing stops at the detection point, not at the
apps/daemon/src/server.ts:7287:      // detects them as an auth prompt. First-token timing is deliberately
apps/daemon/src/server.ts:7924:      const agents = await detectAgents(appConfig.agentCliEnv ?? {}).catch(() => []);
apps/daemon/src/server.ts:8065:    agents: { detectAgents, getAgentDef },
apps/daemon/src/server.ts:8070:      detectSkillPluginCandidateOnRunSuccess,
apps/daemon/src/server.ts:8094:      const agents = await detectAgents(appConfig.agentCliEnv ?? {}).catch(() => []);
apps/daemon/src/server.ts:8466:      detectSkillPluginCandidateOnRunSuccess,
apps/daemon/src/agents.ts:3:  AGENT_DEFS,
apps/daemon/src/agents.ts:7:export { detectAgents, detectAgentsStream } from './runtimes/detection.js';
apps/daemon/src/routes/daemon.ts:28:export function registerDaemonRoutes(app: Express, deps: RegisterDaemonRoutesDeps): void {
apps/daemon/src/routes/chat.ts:60:export function registerChatRoutes(app: Express, ctx: RegisterChatRoutesDeps) {
apps/daemon/src/routes/chat.ts:440:    // we work in a local string to detect the no-path and no-version
apps/daemon/src/routes/chat.ts:1482:    // back to a daemon-global cache that orphans the file. The web

exec
/bin/bash -lc "sed -n '120,360p' apps/daemon/src/runtimes/detection.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
 * `child_process.execFile` reports OS-level rejections with a string
 * `err.code` (`'ENOENT'`, `'EACCES'`, `'ENOTDIR'`) and non-zero exit
 * codes with a *numeric* `err.code` equal to the exit status, so the
 * two arms below are unambiguous.
 */
async function probeVersionAtPath(
  def: RuntimeAgentDef,
  resolved: string,
  env: NodeJS.ProcessEnv,
): Promise<VersionProbeOutcome> {
  try {
    const { stdout } = await execAgentFile(resolved, def.versionArgs, {
      env,
      timeout: def.versionProbeTimeoutMs ?? 3000,
    });
    const version = String(stdout).trim().split('\n')[0] ?? null;
    return { kind: 'spawned', version };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (typeof code === 'string') {
      if (code === 'EACCES') {
        return { kind: 'not-invocable', cause: 'not-executable' };
      }
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return { kind: 'not-invocable', cause: 'missing-target' };
      }
    } else if (typeof code === 'number' && (code === 126 || code === 127)) {
      return {
        kind: 'not-invocable',
        cause: code === 126 ? 'not-executable' : 'missing-target',
      };
    }
    return { kind: 'spawned', version: null };
  }
}

function unavailableAgent(
  def: RuntimeAgentDef,
  diagnostics: AgentDiagnostic[] = [],
): DetectedAgent {
  return {
    ...stripFns(def),
    models: def.fallbackModels ?? [DEFAULT_MODEL_OPTION],
    modelsSource: 'fallback',
    available: false,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...installMetaForAgent(def.id),
  };
}

// Probe the agent's `--help` once and record which advertised flags the
// installed CLI supports, so buildArgs can consult the cache. Extracted from
// the main probe so it can run concurrently with model + auth probing instead
// of blocking them. Returns the capability map (or null when the agent
// declares no help/capability metadata or the probe failed).
async function probeCapabilities(
  def: RuntimeAgentDef,
  launchPath: string,
  env: NodeJS.ProcessEnv,
): Promise<RuntimeCapabilityMap | null> {
  if (!def.helpArgs || !def.capabilityFlags) return null;
  try {
    const { stdout } = await execAgentFile(launchPath, def.helpArgs, {
      env,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const caps: RuntimeCapabilityMap = {};
    for (const [flag, key] of Object.entries(def.capabilityFlags)) {
      caps[key] = String(stdout).includes(flag);
    }
    return caps;
  } catch {
    // If --help fails, leave caps empty so buildArgs falls back to the safe
    // baseline (no optional flags).
    return {};
  }
}

async function probe(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): Promise<DetectedAgent> {
  // Detection must probe the exact path the runtime will spawn, not just the
  // PATH-visible shim. This is load-bearing for Codex under nvm/fnm/mise:
  // the discovered `codex` entry is often a `#!/usr/bin/env node` wrapper
  // that is not invocable from a GUI-launched app's stripped PATH, while the
  // launch resolver can still upgrade it to the packaged native Codex binary.
  // If detection probes the shim but chat/run spawns the native binary, the
  // UI incorrectly reports "not installed" until the user pins CODEX_BIN by
  // hand even though the real launch path is healthy.
  const launch = resolveAgentLaunch(def, configuredEnv);
  if (!launch.selectedPath || !launch.launchPath) {
    return unavailableAgent(def, [buildExecutableDiagnostic(def, configuredEnv)]);
  }
  const probeEnv = applyAgentLaunchEnv(
    spawnEnvForAgent(
      def.id,
      {
        ...process.env,
        ...(def.env || {}),
      },
      configuredEnv,
      undefined,
      { resolvedBin: launch.selectedPath },
    ),
    launch,
  );
  const outcome = await probeVersionAtPath(def, launch.launchPath, probeEnv);
  if (outcome.kind === 'not-invocable') {
    return unavailableAgent(def, [
      buildNotInvocableDiagnostic(def, launch, outcome.cause),
    ]);
  }
  // The version probe must finish first (it gates availability), but the
  // three post-version probes are independent reads — run them concurrently
  // so a single agent's detection wall is max(help, models, auth) ≈ 5s rather
  // than the sum ≈ 15s. `--help` capabilities are cached on `agentCapabilities`
  // for buildArgs to consult.
  const [caps, modelResult, auth] = await Promise.all([
    probeCapabilities(def, launch.launchPath, probeEnv),
    fetchModels(def, launch.launchPath, probeEnv),
    probeAgentAuthStatus(def, launch.launchPath, probeEnv),
  ]);
  const surfacedModelResult = withRememberedAmrModels(def, probeEnv, modelResult);
  if (caps) {
    agentCapabilities.set(def.id, caps);
  }
  const authDiagnostic = auth ? buildAuthDiagnostic(def, auth) : null;
  return {
    ...stripFns(def),
    models: surfacedModelResult.models,
    modelsSource: surfacedModelResult.source,
    available: true,
    path: launch.selectedPath,
    version: outcome.version,
    ...(auth
      ? {
          authStatus: auth.status,
          ...(auth.message ? { authMessage: auth.message } : {}),
        }
      : {}),
    ...(authDiagnostic ? { diagnostics: [authDiagnostic] } : {}),
    ...installMetaForAgent(def.id),
  };
}

function stripFns(
  def: RuntimeAgentDef,
): Omit<DetectedAgent, 'models' | 'modelsSource' | 'available' | 'path' | 'version'> {
  // Drop the buildArgs / listModels closures but keep declarative metadata
  // (reasoningOptions, streamFormat, name, bin, etc.). `models` is
  // populated separately by `fetchModels`, so we strip the static
  // `fallbackModels` slot here too. `helpArgs` / `capabilityFlags` /
  // `fallbackBins` / `maxPromptArgBytes` / `env` are probe-or-spawn-only
  // metadata and shouldn't bleed into the API response either.
  // `inactivityTimeoutMs` is a spawn-time hint for the chat-run watchdog
  // and is not part of the public AgentInfo contract — strip it here so
  // the runtime registry stays the only consumer.
  const {
    buildArgs,
    listModels,
    fetchModels,
    fallbackModels,
    helpArgs,
    capabilityFlags,
    fallbackBins,
    versionProbeTimeoutMs,
    maxPromptArgBytes,
    env,
    inactivityTimeoutMs,
    authProbe,
    ...rest
  } = def;
  return rest;
}

async function safeProbe(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): Promise<DetectedAgent> {
  try {
    return await probe(def, configuredEnv);
  } catch {
    // Fault isolation (issue #2297): one adapter's probe blowing up
    // — e.g. a synchronous filesystem throw during PATH walking on a
    // packaged Windows daemon, or an async rejection from one of the
    // post-launch probes — must not collapse the whole agent picker.
    // Without this guard the bare `Promise.all` rejected and the
    // `/api/agents` catch arm returned `[]`, so the UI silently lost
    // every CLI option and fell back to BYOK / Cloud only.
    return unavailableAgent(def);
  }
}

function rememberDetectedLiveModels(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string>,
  agent: DetectedAgent,
): void {
  if (def.id === 'amr' && agent.models.length === 0) return;
  const scope = def.id === 'amr'
    ? amrModelScopeFromEnv({
        ...process.env,
        ...(def.env || {}),
        ...configuredEnv,
      })
    : null;
  rememberLiveModels(agent.id, agent.models, scope);
}

export async function detectAgents(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
) {
  const results = await Promise.all(
    AGENT_DEFS.map((def) => safeProbe(def, configuredEnvForAgent(configuredEnvByAgent, def.id))),
  );
  // Refresh the validation cache from whatever we just surfaced to the UI
  // so /api/chat can accept any model the user could have just picked,
  // including ones that only showed up after a CLI re-auth.
  for (const [index, agent] of results.entries()) {
    const def = AGENT_DEFS[index];
    if (!def) continue;
    rememberDetectedLiveModels(def, configuredEnvForAgent(configuredEnvByAgent, def.id), agent);
  }
  return results;
}

// Streaming variant: yields each agent the moment its probe settles, in
// completion order rather than registry order, so the UI can paint a card
// as soon as it resolves instead of waiting for the slowest CLI. The model
// validation cache is refreshed per-agent (same effect as the batch path,
// just incrementally). `detectAgents` keeps the array contract for callers
// that don't care about incremental delivery (cache warm, analytics, chat).
export async function* detectAgentsStream(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
): AsyncGenerator<DetectedAgent> {
  const tagged = AGENT_DEFS.map((def, index) =>
    safeProbe(def, configuredEnvForAgent(configuredEnvByAgent, def.id)).then((agent) => {
      rememberDetectedLiveModels(def, configuredEnvForAgent(configuredEnvByAgent, def.id), agent);
      return { index, agent };

exec
/bin/bash -lc "sed -n '1,300p' apps/daemon/src/routes/daemon.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import path from 'node:path';
import type { Express, RequestHandler } from 'express';
import { readCurrentAppVersionInfo } from '../app-version.js';
import { getCritiqueMetrics, register } from '../metrics/index.js';
import { readConformanceHistory } from '../critique/conformance-history.js';
import { evaluateRollout } from '../critique/ratchet.js';
import { parseRolloutPhase } from '../critique/rollout.js';

export interface RegisterDaemonRoutesDeps {
  db: any;
  paths: {
    RUNTIME_DATA_DIR: string;
  };
  http: {
    requireLocalDaemonRequest: RequestHandler;
    sendApiError: (...args: any[]) => any;
  };
  host: string;
  getResolvedPort: () => number;
  getDaemonShuttingDown: () => boolean;
  sandboxRuntime: {
    enabled: boolean;
    roots?: unknown;
  };
  env: NodeJS.ProcessEnv;
}

export function registerDaemonRoutes(app: Express, deps: RegisterDaemonRoutesDeps): void {
  const { db, env, host, http, paths, sandboxRuntime } = deps;
  const { requireLocalDaemonRequest, sendApiError } = http;

  app.get('/api/daemon/status', async (_req, res) => {
    const versionInfo = await readCurrentAppVersionInfo();
    res.json({
      ok: true,
      version: versionInfo.version,
      bindHost: host,
      port: deps.getResolvedPort(),
      dataDir: paths.RUNTIME_DATA_DIR,
      mediaConfigDir: env.OD_MEDIA_CONFIG_DIR ?? null,
      sandboxMode: sandboxRuntime.enabled,
      sandbox: sandboxRuntime.enabled
        ? { enabled: true, roots: sandboxRuntime.roots }
        : { enabled: false },
      pid: process.pid,
      shuttingDown: deps.getDaemonShuttingDown(),
      installedPlugins: (() => {
        try {
          return (db.prepare('SELECT COUNT(*) AS n FROM installed_plugins').get())?.n ?? 0;
        } catch {
          return 0;
        }
      })(),
    });
  });

  app.get('/api/daemon/db', async (_req, res) => {
    try {
      const { inspectSqliteDatabase } = await import('../storage/db-inspect.js');
      const file = path.join(paths.RUNTIME_DATA_DIR, 'app.sqlite');
      const report = await inspectSqliteDatabase({ db, file });
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/agents/:agentId/oauth-launch', requireLocalDaemonRequest, async (req, res) => {
    const agentId = req.params.agentId;
    if (agentId !== 'antigravity') {
      return res.status(400).json({
        ok: false,
        error: `oauth-launch is only supported for antigravity, got ${agentId}`,
      });
    }
    try {
      const { launchAgentInSystemTerminal } = await import('../runtimes/terminal-launch.js');
      const result = await launchAgentInSystemTerminal('agy');
      if (result.ok) {
        return res.json({ ok: true, platform: result.platform, via: result.via });
      }
      return res.status(500).json({
        ok: false,
        platform: result.platform,
        error: result.reason,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: String(err),
      });
    }
  });

  app.post('/api/daemon/db/verify', requireLocalDaemonRequest, async (req, res) => {
    try {
      const { verifySqliteIntegrity } = await import('../storage/db-inspect.js');
      const quick = String(req.query.quick ?? '').toLowerCase();
      const report = verifySqliteIntegrity({ db, quick: quick === '1' || quick === 'true' });
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/daemon/db/vacuum', requireLocalDaemonRequest, async (_req, res) => {
    try {
      const { inspectSqliteDatabase } = await import('../storage/db-inspect.js');
      const file = path.join(paths.RUNTIME_DATA_DIR, 'app.sqlite');
      const before = await inspectSqliteDatabase({ db, file });
      const startedAt = Date.now();
      db.exec('VACUUM');
      const elapsedMs = Date.now() - startedAt;
      const after = await inspectSqliteDatabase({ db, file });
      res.json({
        ok: true,
        beforeBytes: before.sizeBytes,
        afterBytes:  after.sizeBytes,
        reclaimedBytes: Math.max(0, before.sizeBytes - after.sizeBytes),
        elapsedMs,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/daemon/shutdown', requireLocalDaemonRequest, (_req, res) => {
    res.status(202).json({ ok: true, scheduled: true });
    setImmediate(() => {
      try {
        process.emit('SIGTERM');
      } catch {
        // Best-effort; if the listener was removed the kernel SIGTERM fallback remains.
      }
    });
  });

  if (env.OD_METRICS_ENDPOINT !== 'disabled') {
    app.get('/api/metrics', async (_req, res) => {
      res.setHeader('Content-Type', register.contentType);
      res.send(await getCritiqueMetrics());
    });
  }

  const parsePositiveInt = (raw: unknown, fallback: number): number => {
    if (typeof raw !== 'string' || raw.length === 0) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const parseRate = (raw: unknown, fallback: number): number => {
    if (typeof raw !== 'string' || raw.length === 0) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
  };
  app.get('/api/critique/conformance', async (req, res) => {
    try {
      const windowDays = parsePositiveInt(req.query.windowDays, 14);
      const shippedThreshold = parseRate(req.query.shippedThreshold, 0.90);
      const cleanParseThreshold = parseRate(req.query.cleanParseThreshold, 0.95);
      const history = await readConformanceHistory(paths.RUNTIME_DATA_DIR, windowDays);
      const decision = evaluateRollout({
        current: parseRolloutPhase(env.OD_CRITIQUE_ROLLOUT_PHASE),
        history,
        windowDays,
        shippedThreshold,
        cleanParseThreshold,
      });
      res.json({ window: { days: windowDays, history }, decision });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });
}

exec
/bin/bash -lc "sed -n '1,260p' apps/daemon/src/runtimes/defs/claude.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import { agentCapabilities } from '../capabilities.js';
import { DEFAULT_MODEL_OPTION } from './shared.js';
import { loadMmdRouteModels } from '../mmd-routes.js';
import type { RuntimeAgentDef } from '../types.js';

const CLAUDE_FALLBACK_MODELS = [
  DEFAULT_MODEL_OPTION,
  { id: 'sonnet', label: 'Sonnet (alias)' },
  { id: 'opus', label: 'Opus (alias)' },
  { id: 'haiku', label: 'Haiku (alias)' },
  { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
  { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
  { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
];

export const claudeAgentDef = {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    // Drop-in forks that ship a CLI argv-compatible with `claude`. Tried in
    // order if `claude` itself isn't on PATH, so users on a single-binary
    // install (e.g. only OpenClaude — https://github.com/Gitlawb/openclaude
    // — issue #235) get auto-detected without writing wrapper scripts.
    fallbackBins: ['openclaude'],
    versionArgs: ['--version'],
    authProbe: {
      args: ['auth', 'status'],
      timeoutMs: 5000,
    },
    helpArgs: ['-p', '--help'],
    capabilityFlags: {
      // Flag string -> capability key. After probing `--help`, we set
      // `agentCapabilities[id][key] = true` for each substring that matches.
      // `--add-dir` and `--include-partial-messages` live under `claude -p`
      // subcommand, so we probe `claude -p --help` instead of `claude --help`.
      // Fixes issue #430: --add-dir never detected because it wasn't in global help.
      '--include-partial-messages': 'partialMessages',
      '--add-dir': 'addDir',
    },
    // `claude` has no list-models subcommand. Prefer local mmd/MMS routes
    // when present so proxy-backed Claude-compatible models appear in the
    // picker, then keep the built-in aliases as fallback hints.
    fallbackModels: CLAUDE_FALLBACK_MODELS,
    fetchModels: async (_resolvedBin, env) => loadMmdRouteModels(env, CLAUDE_FALLBACK_MODELS),
    // Prompt delivered via stdin to avoid both Linux `spawn E2BIG`
    // (MAX_ARG_STRLEN caps a single argv entry at ~128 KB) and Windows
    // `spawn ENAMETOOLONG` (CreateProcess caps the full command line at
    // ~32 KB direct, ~8 KB via .cmd shim). `claude -p` with no positional
    // prompt reads the prompt from stdin under `--input-format text` (the
    // default), which has no length cap. Mirrors the codex/gemini/opencode/
    // cursor/qwen entries below.
    buildArgs: (_prompt, _imagePaths, extraAllowedDirs = [], options = {}, runtimeContext = {}) => {
      const caps = agentCapabilities.get('claude') || {};
      // `--input-format stream-json` lets the daemon stream multiple JSONL
      // messages into stdin instead of closing it after the initial prompt,
      // keeping the turn open so the daemon can stream further user messages
      // mid-conversation. Paired with `--output-format stream-json` so the
      // adapter parses structured events (see claude-stream.ts).
      const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
      // `--include-partial-messages` lands richer streaming events but only
      // exists in newer Claude Code builds. Older installs reject it with
      // "unknown option" and exit 1, killing the chat. Gate on the probe.
      if (caps.partialMessages) {
        args.push('--include-partial-messages');
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && d.length > 0,
      );
      // `--add-dir` is older but still gate it for symmetry — old/forked
      // builds may lack it.
      if (dirs.length > 0 && caps.addDir !== false) {
        args.push('--add-dir', ...dirs);
      }
      // Continue Claude's own CLI session across turns so it keeps its
      // working memory (files read, edits made, tool history) instead of
      // re-deriving everything from the rendered transcript each turn.
      // `--resume <id>` continues a stored session; `--session-id <uuid>`
      // starts a new one with an id the daemon controls and persists.
      if (typeof runtimeContext.resumeSessionId === 'string' && runtimeContext.resumeSessionId) {
        args.push('--resume', runtimeContext.resumeSessionId);
      } else if (typeof runtimeContext.newSessionId === 'string' && runtimeContext.newSessionId) {
        args.push('--session-id', runtimeContext.newSessionId);
      }
      args.push('--permission-mode', 'bypassPermissions');
      return args;
    },
    promptViaStdin: true,
    promptInputFormat: 'stream-json',
    streamFormat: 'claude-stream-json',
    // Claude Code auto-loads `.mcp.json` from the project cwd at spawn,
    // so the daemon writes the user's external MCP servers there before
    // launching (server.ts handles the cwd guard).
    externalMcpInjection: 'claude-mcp-json',
    resumesSessionViaCli: true,
} satisfies RuntimeAgentDef;

exec
/bin/bash -lc "sed -n '1,300p' apps/daemon/src/runtimes/defs/codex.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import { DEFAULT_MODEL_OPTION, clampCodexReasoning } from './shared.js';
import type { RuntimeModelOption } from '../types.js';
import type { RuntimeAgentDef } from '../types.js';

export function parseCodexDebugModels(stdout: string): RuntimeModelOption[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(stdout || ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const models = (parsed as { models?: unknown }).models;
  if (!Array.isArray(models)) return null;

  const out = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>([DEFAULT_MODEL_OPTION.id]);
  for (const raw of models) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as {
      slug?: unknown;
      id?: unknown;
      display_name?: unknown;
      name?: unknown;
      visibility?: unknown;
    };
    if (entry.visibility === 'hidden') continue;
    const id =
      typeof entry.slug === 'string'
        ? entry.slug.trim()
        : typeof entry.id === 'string'
          ? entry.id.trim()
          : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label =
      typeof entry.display_name === 'string' && entry.display_name.trim()
        ? entry.display_name.trim()
        : typeof entry.name === 'string' && entry.name.trim()
          ? entry.name.trim()
          : id;
    out.push({ id, label });
  }
  return out.length > 1 ? out : null;
}

export function codexNeedsDangerFullAccessSandbox(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Operator override for deployments where Codex cannot create its
  // workspace-write sandbox, for example unprivileged Linux containers.
  // Only danger-full-access is accepted; unknown values keep the default path.
  if (env.OD_CODEX_SANDBOX?.trim() === 'danger-full-access') return true;
  if (platform === 'win32') return true;
  // WSL reports `linux` but Codex still hits the Windows read-only
  // workspace-write sandbox path when launched from there (#2834).
  return Boolean(env.WSL_DISTRO_NAME?.trim());
}

export const codexAgentDef = {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    // Codex exposes its installed model catalog through `debug models` on
    // recent CLIs. Older builds fall back to these static hints.
    listModels: {
      args: ['debug', 'models'],
      parse: parseCodexDebugModels,
      timeoutMs: 5000,
    },
    authProbe: {
      args: ['login', 'status'],
      timeoutMs: 5000,
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gpt-5.5', label: 'gpt-5.5' },
      { id: 'gpt-5.4', label: 'gpt-5.4' },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
      { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
      { id: 'gpt-5.1', label: 'gpt-5.1' },
      { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
      { id: 'gpt-5-codex', label: 'gpt-5-codex' },
      { id: 'gpt-5', label: 'gpt-5' },
      { id: 'o3', label: 'o3' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'none', label: 'None' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'XHigh' },
    ],
    // Prompt is delivered via stdin pipe (gated by `promptViaStdin: true`
    // below) to avoid Windows `spawn ENAMETOOLONG` while keeping Codex on
    // its structured JSON stream. Recent Codex CLI versions reject a bare
    // `-` argv sentinel — passing both the pipe and `-` produces
    // `error: unexpected argument '-' found` and the agent exits with
    // code 2 before any prompt is read (see issue #237). The pipe alone
    // is sufficient for stdin delivery.
    buildArgs: (
      _prompt,
      _imagePaths,
      extraAllowedDirs = [],
      options = {},
      runtimeContext = {},
    ) => {
      // Codex CLI's `workspace-write` sandbox blocks shell invocations on
      // Windows ("powershell.exe ... rejected: blocked by policy", #1721),
      // because Codex has no working OS-level sandbox on Windows and falls
      // back to a coarse policy that rejects any shell. macOS (Seatbelt)
      // and Linux (Landlock+seccomp) keep workspace-write because their
      // sandbox enforcement permits shell while restricting writes.
      const needsDangerFullAccess = codexNeedsDangerFullAccessSandbox();
      // Capture-style resume: when the daemon has a stored Codex thread id for
      // this conversation it asks the CLI to continue that session with
      // `exec resume <thread_id>` instead of `exec` (a fresh session). Codex
      // mints its own id, so the daemon does not specify one — it captures the
      // id from the create turn's `thread.started.thread_id` event (see the
      // json-event-stream `codex` parser) and replays it here on resume.
      const resumeSessionId =
        typeof runtimeContext.resumeSessionId === 'string' &&
        runtimeContext.resumeSessionId.length > 0
          ? runtimeContext.resumeSessionId
          : null;
      // `codex exec resume` rejects `--sandbox` (only valid on a fresh
      // `exec`); the sandbox mode must be passed as a `-c sandbox_mode=...`
      // config override. We mirror the exact same effective sandbox policy as
      // the create turn so Codex's per-turn `turn_context` block byte-matches
      // across turns and does not break the upstream prefix cache the resume
      // is meant to reuse.
      const sandboxArgs = needsDangerFullAccess
        ? resumeSessionId
          ? ['-c', 'sandbox_mode="danger-full-access"']
          : ['--sandbox', 'danger-full-access']
        : resumeSessionId
          ? [
              '-c',
              'sandbox_mode="workspace-write"',
              '-c',
              'sandbox_workspace_write.network_access=true',
            ]
          : [
              '--sandbox',
              'workspace-write',
              '-c',
              'sandbox_workspace_write.network_access=true',
            ];
      const args = resumeSessionId
        ? ['exec', 'resume', '--json', '--skip-git-repo-check', ...sandboxArgs]
        : ['exec', '--json', '--skip-git-repo-check', ...sandboxArgs];
      if (process.env.OD_CODEX_DISABLE_PLUGINS === '1') {
        args.push('--disable', 'plugins');
      }
      // `-C <cwd>` and `--add-dir <dir>` are CREATE-only flags: `codex exec
      // resume` rejects both (`error: unexpected argument '-C' found`), so
      // appending them on a resume turn would make the follow-up turn die
      // before the first event. The daemon already spawns the child with
      // `cwd: effectiveCwd`, and resuming by explicit SESSION_ID does not use
      // codex's cwd-based session filtering, so the resumed turn still runs in
      // the right workspace without `-C`. The extra writable dirs were granted
      // when the session was created and are carried by the resumed session.
      if (!resumeSessionId) {
        if (runtimeContext.cwd) {
          args.push('-C', runtimeContext.cwd);
        }
        const dirs = (extraAllowedDirs || []).filter(
          (d) => typeof d === 'string' && d.length > 0,
        );
        for (const d of dirs) {
          args.push('--add-dir', d);
        }
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      if (options.reasoning && options.reasoning !== 'default') {
        const effort = clampCodexReasoning(options.model, options.reasoning);
        // Codex accepts `-c key=value` config overrides; reasoning effort
        // is exposed as `model_reasoning_effort`.
        args.push('-c', `model_reasoning_effort="${effort}"`);
      }
      // The resume thread id is the positional SESSION_ID argument of
      // `codex exec resume`; it must come after the flags. The prompt is
      // delivered via stdin (promptViaStdin), so the thread id is the final
      // argv entry.
      if (resumeSessionId) {
        args.push(resumeSessionId);
      }
      return args;
    },
    promptViaStdin: true,
    // Codex's CLI carries its own session across spawns: on a follow-up turn
    // the daemon resumes the captured thread id instead of re-sending the
    // flattened transcript, so the first upstream call reuses the warm prefix
    // cache. Capture-style: the resume handle is the `thread.started.thread_id`
    // captured from the stream, not a daemon-minted id.
    resumesSessionViaCli: true,
    capturesSessionIdFromStream: true,
    streamFormat: 'json-event-stream',
    eventParser: 'codex',
} satisfies RuntimeAgentDef;

exec
/bin/bash -lc "sed -n '1,220p' apps/daemon/src/runtimes/defs/opencode.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import { DEFAULT_MODEL_OPTION, parseLineSeparatedModels } from './shared.js';
import { agentCapabilities } from '../capabilities.js';
import type { RuntimeAgentDef } from '../types.js';

const SKIP_PERMISSIONS_FLAG = '--dangerously-skip-permissions';

export const opencodeAgentDef = {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode-cli',
    fallbackBins: ['opencode'],
    versionArgs: ['--version'],
    helpArgs: ['run', '--help'],
    capabilityFlags: {
      [SKIP_PERMISSIONS_FLAG]: 'skipPermissions',
    },
    // `opencode models` prints `provider/model` per line. Real-world
    // `opencode models` calls can take >8s (network round-trip to the
    // provider registry), so the previous 8s budget timed out and fell back
    // to the hardcoded `fallbackModels`, hiding the user's actual catalog.
    // 15s matches the listModels budget the rest of the agent defs use
    // (devin, hermes, kiro, kilo, kimi, trae-cli, vibe, reasonix).
    listModels: {
      args: ['models'],
      parse: parseLineSeparatedModels,
      timeoutMs: 15_000,
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      {
        id: 'anthropic/claude-sonnet-4-5',
        label: 'anthropic/claude-sonnet-4-5',
      },
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
      { id: 'google/gemini-2.5-pro', label: 'google/gemini-2.5-pro' },
    ],
    // OpenCode's CLI help currently exposes model selection and session
    // controls, but not an explicit per-run reasoning / effort flag. Keep
    // `reasoningOptions` undefined and do not synthesize argv for
    // `options.reasoning`; that would advertise a control the adapter cannot
    // actually pass through. See issue #2828.
    //
    // Prompt delivered via stdin (`opencode run` with no message argv) to
    // avoid Windows `spawn ENAMETOOLONG` while preserving OpenCode's
    // structured stream. A literal `-` is parsed as a positional message by
    // OpenCode 1.14.x and can surface as "Session not found".
    buildArgs: (_prompt, _imagePaths, _extra, options = {}, runtimeContext = {}) => {
      const args = [
        'run',
        '--format',
        'json',
      ];
      if (agentCapabilities.get('opencode')?.skipPermissions) {
        args.push(SKIP_PERMISSIONS_FLAG);
      }
      // Capture-style resume: OpenCode mints its own session id (reported on
      // the stream as `sessionID`, e.g. `ses_...`). On a follow-up turn the
      // daemon continues that session with `-s <id>` instead of re-sending the
      // flattened transcript, so the first upstream call reuses the warm prefix
      // cache. `-s` continues an EXISTING session (the create turn passes no id
      // and we capture the one OpenCode generated), mirroring codex.
      const resumeSessionId =
        typeof runtimeContext.resumeSessionId === 'string' &&
        runtimeContext.resumeSessionId.length > 0
          ? runtimeContext.resumeSessionId
          : null;
      if (resumeSessionId) {
        args.push('-s', resumeSessionId);
      }
      if (options.model && options.model !== 'default') {
        args.push('-m', options.model);
      }
      return args;
    },
    promptViaStdin: true,
    // OpenCode's CLI carries its own session across spawns: on a follow-up turn
    // the daemon resumes the captured session id (`-s <id>`) instead of
    // re-flattening the transcript. Capture-style — the resume handle is the
    // `sessionID` captured from the stream, not a daemon-minted id.
    resumesSessionViaCli: true,
    capturesSessionIdFromStream: true,
    streamFormat: 'json-event-stream',
    eventParser: 'opencode',
    // OpenCode reads MCP servers from its layered config (global ~/.config
    // /opencode/opencode.json + project opencode.json + OPENCODE_CONFIG
    // + OPENCODE_CONFIG_CONTENT). The env-var form lets the daemon hand
    // user-configured external MCP servers to a single `opencode run`
    // invocation without polluting the user's saved config files. See
    // <https://opencode.ai/docs/config> and issue #2142.
    externalMcpInjection: 'opencode-env-content',
} satisfies RuntimeAgentDef;

exec
/bin/bash -lc "find apps/web/src/features -maxdepth 4 -type f | sort | sed -n '1,280p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/web/src/features/libraryUi.ts
apps/web/src/features/memory/async-commit-guard.ts
apps/web/src/features/memory/components/MemoryAdvancedModal.tsx
apps/web/src/features/memory/components/MemoryConnectedPanel.tsx
apps/web/src/features/memory/components/MemoryEntryCard.tsx
apps/web/src/features/memory/components/MemoryExtractionCard.tsx
apps/web/src/features/memory/components/MemoryHowPanel.tsx
apps/web/src/features/memory/components/MemoryList.tsx
apps/web/src/features/memory/components/MemoryManualEditor.tsx
apps/web/src/features/memory/constants.ts
apps/web/src/features/memory/dependencies.ts
apps/web/src/features/memory/formatters.ts
apps/web/src/features/memory/hooks/useMemoryConfig.hooks.ts
apps/web/src/features/memory/hooks/useMemoryConnectors.hooks.ts
apps/web/src/features/memory/hooks/useMemoryEntries.hooks.ts
apps/web/src/features/memory/hooks/useMemoryExtractions.hooks.ts
apps/web/src/features/memory/hooks/useMemoryExtractions.store.ts
apps/web/src/features/memory/hooks/useMemoryFlash.hooks.ts
apps/web/src/features/memory/hooks/useMemoryNavigation.hooks.ts
apps/web/src/features/memory/index.ts
apps/web/src/features/memory/ports.ts
apps/web/src/features/memory/rules.ts
apps/web/src/features/memory/types.ts

exec
/bin/bash -lc 'find apps/web/src/providers/memory -maxdepth 3 -type f | sort 2>/dev/null' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/web/src/providers/memory/config.ts
apps/web/src/providers/memory/connector-auth.ts
apps/web/src/providers/memory/connectors.ts
apps/web/src/providers/memory/entries.ts
apps/web/src/providers/memory/events.ts
apps/web/src/providers/memory/extractions.ts
apps/web/src/providers/memory/index.ts
apps/web/src/providers/memory/response-fields.ts

exec
/bin/bash -lc "sed -n '1,320p' docs/adr/0002-frontend-vertical-slice-decomposition.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# 0002. Frontend vertical-slice decomposition for large `apps/web` components

## Status

Proposed (tracking: [#5201](https://github.com/nexu-io/open-design/issues/5201))

## Context

Several `apps/web` component files have grown into god-components that are hard to test and change: `SettingsDialog.tsx` (~8,500 lines; ~30 `useState` in its main component), `FileViewer.tsx` (~12.8k), `ProjectView.tsx` (~8.7k), `ChatComposer.tsx` (~5,555 lines, 48 `useState`), and `MemorySection.tsx` (~2,636 lines — a single ~1,900-line function with 39 `useState`). Some also leak into accidental utility modules (other files import runtime helpers out of `SettingsDialog.tsx`).

The root problem is not file length; it is **state that leaked upward**. Section-scoped state (e.g. a settings section's BYOK/provider/AMR state) piled into the parent because the section was never given its own home. `MemorySection` demonstrates that extraction *alone* is cosmetic: it was pulled into its own file and is still a monolith, because the JSX moved but the state was never decomposed.

This repo is already coarsely layered — `packages/contracts/src/api/` holds wire DTOs shared web↔daemon, `apps/web/src/providers/` holds transport adapters, `apps/web/src/features/` exists as an (empty) app-local home — and boundaries are enforced by hand-rolled guard scripts wired into `pnpm guard`. The decomposition should extend those existing seams, not import a new framework. Repository boundary rules (test placement, contracts purity, cross-app import limits) live in `AGENTS.md`; this ADR MUST NOT restate them.

## Decision

Decompose large `apps/web` components using **vertical slicing** — one `features/<capability>/` folder owns everything for a capability — mapped onto four homes:

1. **Wire DTOs and SSE event unions → `packages/contracts/src/api/`.** Never redeclared in a slice; the daemon is a proven second consumer, so a slice-local copy would drift.
2. **Transport adapters (`fetch`, `EventSource`/SSE, OAuth browser bridges) → `apps/web/src/providers/`.** Placed here where there is a real multi-consumer seam (e.g. `/api/memory` is fetched from ~6 components, `/api/mcp/install-info` from 2). A single-adapter resource is a flat `providers/<resource>.ts`; a multi-adapter resource is a folder `providers/<resource>/` with one `index.ts` barrel.
3. **Ports, pure rules, UI-only types, state hooks, components → `apps/web/src/features/<slice>/`.** The slice owns its **port** (`ports.ts`) — the interface it depends on — and reaches transport only through a small `dependencies.ts` that binds a provider to that port. Pure/feature files may not import `providers/` directly, and slices may not import another slice's internals.
4. **Tests → `apps/web/tests/features/<slice>/`** (source stays source-only, per `AGENTS.md`).

Barrels mark boundaries, not folders: an `index.ts` exists at the slice root (public API), at a multi-adapter `providers/<resource>/`, and at a sub-slice boundary (e.g. `features/memory/connectors/`); `hooks/` and `components/` use direct relative imports and get no barrel.

Hooks are **feature-local and component-specific; there is no shared or app-level hook layer.** When two slices need similar logic, each owns its own hook rather than importing a shared one — reuse is explicitly not a goal, because slices tend to need highly specific behavior and duplicated wiring is cheap to write and safe to let diverge. The sharing rule is **asymmetric by intent**: share only what *correctness* requires — wire DTOs (where divergence is a wire break) and transport adapters (where divergence is a retry/auth bug) — and duplicate what is mere convenience, since a hook is just the composition of an injected port and pure rules. Components stay presentational: props in, JSX out, no state/logic/constants/fetch, so they test by rendering with props and asserting output.

Cross-cutting shell state (e.g. `SettingsConfigProvider` for `cfg`/autosave) is lifted into a context so sections stop prop-drilling. No server-state cache library (TanStack Query/SWR) is introduced; existing caching stays hand-rolled and behavior-preserving.

Rollout is **behavior-preserving and file-by-file**, not a repo-wide migration. Each PR takes **one god-component and makes it internally sane in a single complete pass** — all of that file's seams (wire DTOs → `contracts`, transport → a provider home, pure rules, feature-local hooks in `*.hooks.ts`, and a split into dumb sub-components) land together, because they are one coherent refactor of one file and are cheaper to review as a whole than as an artificially fragmented sequence. The bound is the file, not the seam: a canary PR must **not** sprawl outward into unrelated cleanup (broad `SettingsDialog` work, repo-wide framework reshaping, or new abstractions the slice does not yet need). `MemorySection` is the first canary (self-contained, single consumer, existing test), and its PR body calls out each seam — ports, providers, hooks, sub-components, rules — so reviewers see the refactor shape up front. Boundaries are checked by a hand-rolled, best-effort static-analysis guard added to `pnpm guard` (no `fetch`/`EventSource`/`window`/`localStorage` in feature or pure files; one transport home per route; a slice's internals are reachable only through its root `index.ts` barrel — this holds for cross-slice imports **and** for the orchestrator and any other file outside `features/**`, so the boundary a slice publishes is the boundary every consumer sees); orphaned provider exports are swept by `ts-prune`. This guard is not an adversarial security boundary — see its own header comment (`scripts/check-web-slice-boundaries.ts`) for the exact scope statement. It is hardened against realistic, non-adversarial gaps as they're found; a newly-discovered theoretical bypass is a follow-up to extend the guard, not a blocking finding against a PR that isn't the one introducing or exploiting it.

## Alternatives considered

- **Adapters in-slice, promoted on a second consumer.** More self-contained for single-consumer endpoints, but these endpoints are already multi-consumer, so an in-slice adapter forces other consumers to reach into the slice or duplicate the `fetch` (drift on retry/error/auth). A hand-rolled guard cannot detect a freshly-authored duplicate `fetch` in another slice. Rejected for shared endpoints; the slice keeps self-containment at the port layer instead.
- **Full Feature-Sliced Design** (`app`/`pages`/`widgets` layers + `steiger` linter). The `app`/`pages` layer names collide with the Next.js App Router's reserved `app/`, and the linter duplicates this repo's hand-rolled guards. Adopt the vertical-slice *principle*, not the branded taxonomy.
- **Colocated `components/settings/{lib,hooks}/`** (nest everything under `components/`). Smallest diff, but names a folder for components while it holds logic/state, and ignores the `contracts`/`providers` seams that already exist.
- **A shared / app-level hook layer for cross-slice logic.** Rejected: it reintroduces cross-slice coupling and "semi-global" hooks. Slices need specific behavior, duplicated wiring is cheap and safe to diverge, and pure rules (the only correctness-bearing part) can still be shared as plain functions if genuinely identical.
- **Introduce a server-state cache (TanStack Query / SWR).** Rejected here: that is a repo-wide framework migration and changes fetch semantics, which breaks behavior-preservation. It can be proposed separately later.
- **Leave the files as-is.** Rejected: testability and change-safety keep degrading, and the extraction is already half-started inconsistently.

## Consequences

Slice logic becomes testable against a hand-written fake implementing the in-slice port — no global `fetch` mocking, no module-path mocks; pure `rules.ts` tests need zero doubles; fixtures typed against `contracts` fail at compile time on a wire change. Transport gets a single source of truth per resource. The cost is that a small transport wrapper no longer sits physically inside the slice (mitigated: the port does, and `ts-prune` sweeps orphans), and a new guard script must be maintained. Because rollout is one-file-per-PR and behavior-preserving, each PR is independently reviewable and reversible.

### Testing & coverage strategy for a slice

A slice is expected to reach high coverage (the `MemorySection` canary lands at ≥95% statements/branches/functions/lines per file). The seams make this natural: hooks test through their injected fake port with `renderHook`; dumb components render under `@testing-library/react` + `I18nProvider(initial="en")`; providers mock global `fetch`; pure `rules`/`formatters` take no doubles. Tests live in `apps/web/tests/features/<slice>/`, not colocated.

Closing the final few percent surfaces "unreachable" branches. Do **not** reach for `/* v8 ignore */` or contort tests — classify the cause, because each has a clean, honest fix:

- **SSR / environment guards** (`if (typeof window === 'undefined') …`) in a `providers/` browser bridge: add a companion test with `// @vitest-environment node` at the top. Under the node env `window` genuinely doesn't exist, so the guard executes for real — genuine coverage, no source change, no mock.
- **Redundant or over-broad guards**: simplify the source behavior-preservingly. A component that re-checks a condition its formatter already gates on should render off the formatter's result directly; a private helper typed to accept `null` for a parameter its only caller never passes null should tighten that parameter. The dead branch disappears or becomes reachable, and the code reads better.
- **Type-required fallbacks the runtime guarantees** (e.g. `regExpMatch[1] ?? ''` where the pattern guarantees the group): use a non-null assertion with a one-line comment stating the guarantee, and tighten optional interface fields (`action?: string` → `action: string`) when a value's sole producer always sets it.

Measurement: the v8 text table silently drops rows — use `--coverage.reporter=json-summary` (per-file %s, authoritative) plus `--coverage.reporter=json` (`coverage-final.json`, for per-line/branch uncovered detail). Enforce the bar via a `coverage.thresholds` block only as a follow-up once the tests land, since it changes CI behavior for the whole package.

exec
/bin/bash -lc "rg -n '"'^export (type|interface|function|const)|''^type |''^interface '"' apps/web/src/components/ChatPane.tsx apps/web/src/components/ChatComposer.tsx apps/web/src/components/workspace/useConversationChat.ts apps/web/src/runtime/chat-events.ts apps/web/src/runtime/tool-events.ts apps/web/src/artifacts/*.ts | sed -n '1,360p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/web/src/components/workspace/useConversationChat.ts:49:export interface ConversationChatContext {
apps/web/src/components/workspace/useConversationChat.ts:59:export interface UseConversationChatResult {
apps/web/src/components/workspace/useConversationChat.ts:74:export function useConversationChat(
apps/web/src/components/ChatComposer.tsx:109:type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;
apps/web/src/components/ChatComposer.tsx:111:interface TrackedWorkspaceLinkedDir {
apps/web/src/components/ChatComposer.tsx:144:type ToolsTab = 'plugins' | 'skills' | 'mcp' | 'import';
apps/web/src/components/ChatComposer.tsx:146:type MentionTab = 'all' | 'tabs' | 'files' | 'plugins' | 'skills' | 'mcp' | 'connectors';
apps/web/src/components/ChatComposer.tsx:157:interface SlashCommand {
apps/web/src/components/ChatComposer.tsx:174:type DesignToolboxResourceKind =
apps/web/src/components/ChatComposer.tsx:182:interface DesignToolboxResourceIndex {
apps/web/src/components/ChatComposer.tsx:191:type DesignToolboxResourceBase = {
apps/web/src/components/ChatComposer.tsx:202:type DesignToolboxResource =
apps/web/src/components/ChatComposer.tsx:210:export type ChatSendOutcome = void | 'restore-draft';
apps/web/src/components/ChatComposer.tsx:212:interface Props {
apps/web/src/components/ChatComposer.tsx:319:export interface ChatComposerDraftOptions {
apps/web/src/components/ChatComposer.tsx:324:export interface ChatComposerHandle {
apps/web/src/components/ChatComposer.tsx:357:export interface ChatSendMeta {
apps/web/src/components/ChatComposer.tsx:389:export const ChatComposer = forwardRef<ChatComposerHandle, Props>(
apps/web/src/components/ChatPane.tsx:86:type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;
apps/web/src/components/ChatPane.tsx:103:type StarterPrompt = {
apps/web/src/components/ChatPane.tsx:455:interface Props {
apps/web/src/components/ChatPane.tsx:678:type Tab = 'chat' | 'comments';
apps/web/src/components/ChatPane.tsx:690:interface RunErrorDiagnosticInput {
apps/web/src/components/ChatPane.tsx:701:interface QueuedSendItem {
apps/web/src/components/ChatPane.tsx:709:interface QueuedSendUpdate {
apps/web/src/components/ChatPane.tsx:775:export function ChatPane({
apps/web/src/components/ChatPane.tsx:2747:interface AssistantCallbacks {
apps/web/src/components/ChatPane.tsx:2765:type ChatRenderItem = {
apps/web/src/components/ChatPane.tsx:3522:type QueuedSendDropEdge = 'before' | 'after';
apps/web/src/components/ChatPane.tsx:3524:interface QueuedSendDragState {
apps/web/src/components/ChatPane.tsx:3712:export function retryableAssistantMessage(
apps/web/src/components/ChatPane.tsx:3724:export function isAssistantMessageStreaming(
apps/web/src/components/ChatPane.tsx:3740:export function buildRunErrorDiagnosticText(input: RunErrorDiagnosticInput): string {
apps/web/src/components/ChatPane.tsx:4308:export function conversationMetaLabel(
apps/web/src/artifacts/markdown.ts:4:export function renderMarkdownToSafeHtml(markdown: string): string {
apps/web/src/artifacts/pointer.ts:1:interface HtmlPointerArtifactTargetInput {
apps/web/src/artifacts/pointer.ts:13:export function resolveHtmlPointerArtifactTarget(
apps/web/src/runtime/tool-events.ts:3:export function dedupeToolUsesById(events: AgentEvent[] | undefined): AgentEvent[] {
apps/web/src/artifacts/manifest.ts:67:export function artifactManifestNameFor(entry: string): string {
apps/web/src/artifacts/manifest.ts:71:export function createHtmlArtifactManifest(input: {
apps/web/src/artifacts/manifest.ts:96:export function serializeArtifactManifest(manifest: ArtifactManifest): string {
apps/web/src/artifacts/manifest.ts:100:export function parseArtifactManifest(raw: string): ArtifactManifest | null {
apps/web/src/artifacts/manifest.ts:151:export function inferLegacyManifest(input: {
apps/web/src/runtime/chat-events.ts:4:export interface RunFailureClassificationFields {
apps/web/src/runtime/chat-events.ts:12:export function runFailureFieldsFromError(
apps/web/src/runtime/chat-events.ts:26:export function appendErrorStatusEvent(
apps/web/src/runtime/chat-events.ts:71:export function removeErrorStatusEvent(
apps/web/src/artifacts/question-form.ts:30:export type QuestionType =
apps/web/src/artifacts/question-form.ts:56:export interface DirectionCard {
apps/web/src/artifacts/question-form.ts:73:export interface FormOption {
apps/web/src/artifacts/question-form.ts:79:export interface FormQuestion {
apps/web/src/artifacts/question-form.ts:110:export interface QuestionForm {
apps/web/src/artifacts/question-form.ts:125:export type FormSegment =
apps/web/src/artifacts/question-form.ts:136:export function splitOnQuestionForms(input: string): FormSegment[] {
apps/web/src/artifacts/question-form.ts:209:export function findFirstQuestionForm(
apps/web/src/artifacts/question-form.ts:222:export function stripTrailingOpenQuestionForm(
apps/web/src/artifacts/question-form.ts:245:export function hasUnterminatedQuestionForm(input: string): boolean {
apps/web/src/artifacts/question-form.ts:376:export function parsePartialQuestionForm(input: string): QuestionForm | null {
apps/web/src/artifacts/question-form.ts:745:export function formatFormAnswers(
apps/web/src/artifacts/question-form.ts:775:export function formOptionLabelForValue(
apps/web/src/artifacts/question-form.ts:783:export function formOptionValueForLabel(
apps/web/src/artifacts/validate.ts:53:export type HtmlArtifactValidationResult =
apps/web/src/artifacts/validate.ts:57:export function validateHtmlArtifact(content: string): HtmlArtifactValidationResult {
apps/web/src/artifacts/parser.ts:11:export type ArtifactEvent =
apps/web/src/artifacts/parser.ts:20:interface ParserState {
apps/web/src/artifacts/parser.ts:40:type OpenTagMatch =
apps/web/src/artifacts/parser.ts:161:export function createArtifactParser() {
apps/web/src/artifacts/markdown-context.ts:17:export const FENCE_OPEN_RE = /^```(\w[\w+-]*)?\s*$/;
apps/web/src/artifacts/markdown-context.ts:18:export const FENCE_CLOSE_RE = /^```\s*$/;
apps/web/src/artifacts/markdown-context.ts:21:export const INLINE_CODE_RE = /`[^`]+`/g;
apps/web/src/artifacts/markdown-context.ts:43:export function isRealArtifactOpenAt(content: string, idx: number): boolean {
apps/web/src/artifacts/markdown-context.ts:48:export type Range = readonly [number, number];
apps/web/src/artifacts/markdown-context.ts:61:export function computeSkipRanges(buffer: string): {
apps/web/src/artifacts/markdown-context.ts:133:export function rangeContains(ranges: ReadonlyArray<Range>, p: number): boolean {
apps/web/src/artifacts/types.ts:1:export type ArtifactKind =
apps/web/src/artifacts/types.ts:12:export type ArtifactRendererId =
apps/web/src/artifacts/types.ts:23:export type ArtifactExportKind =
apps/web/src/artifacts/types.ts:32:export type ArtifactStatus = 'streaming' | 'complete' | 'error';
apps/web/src/artifacts/types.ts:34:export interface ArtifactManifest {
apps/web/src/artifacts/renderer-registry.ts:6:export interface ArtifactRendererContext {
apps/web/src/artifacts/renderer-registry.ts:11:export interface ArtifactRenderer {
apps/web/src/artifacts/renderer-registry.ts:25:export interface ArtifactRenderMatch {
apps/web/src/artifacts/renderer-registry.ts:34:export const HtmlRenderer: ArtifactRenderer = {
apps/web/src/artifacts/renderer-registry.ts:46:export const DeckHtmlRenderer: ArtifactRenderer = {
apps/web/src/artifacts/renderer-registry.ts:57:export const ReactComponentRenderer: ArtifactRenderer = {
apps/web/src/artifacts/renderer-registry.ts:67:export const MarkdownRenderer: ArtifactRenderer = {
apps/web/src/artifacts/renderer-registry.ts:79:export const SvgRenderer: ArtifactRenderer = {
apps/web/src/artifacts/renderer-registry.ts:102:export const artifactRendererRegistry = new RendererRegistry([
apps/web/src/artifacts/recover.ts:3:type RecoverHtmlArtifactInput = {
apps/web/src/artifacts/recover.ts:40:export function recoverHtmlArtifactFromPrecedingDocument({
apps/web/src/artifacts/recover.ts:82:export function resolvePersistedArtifactHtml(input: RecoverHtmlArtifactInput): string {
apps/web/src/artifacts/recover.ts:86:export function recoverStandaloneHtmlDocument(sourceText: string | null | undefined): string | null {
apps/web/src/artifacts/recover.ts:92:export function recoverHtmlDocumentFromMarkdownFence(sourceText: string | null | undefined): string | null {
apps/web/src/artifacts/strip.ts:12:type MarkdownFenceRange = {
apps/web/src/artifacts/strip.ts:60:export function stripArtifact(content: string): string {
apps/web/src/artifacts/strip.ts:145:export function stripRecoveredHtmlFallbackForDisplay(content: string, sourceText = content): string {
apps/web/src/artifacts/strip.ts:172:export interface PersistedArtifactFileRef {
apps/web/src/artifacts/strip.ts:211:export function matchPersistedArtifactFile(
apps/web/src/artifacts/strip.ts:253:export function summarizeArtifactsForTranscript(
apps/web/src/artifacts/strip.ts:313:export interface StreamingArtifact {
apps/web/src/artifacts/strip.ts:338:export function splitStreamingArtifact(content: string): {

exec
/bin/bash -lc "rg -n \"from ['\\\"](\\.\\./|@/|@open-design)\" apps/web/src/components/ChatPane.tsx apps/web/src/components/ChatComposer.tsx | sed -n '1,260p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/web/src/components/ChatComposer.tsx:14:import { Button } from '@open-design/components';
apps/web/src/components/ChatComposer.tsx:15:import { useI18n } from '../i18n';
apps/web/src/components/ChatComposer.tsx:17:import type { Dict, Locale } from '../i18n/types';
apps/web/src/components/ChatComposer.tsx:21:} from '../i18n/content';
apps/web/src/components/ChatComposer.tsx:22:import { useAnalytics } from '../analytics/provider';
apps/web/src/components/ChatComposer.tsx:32:} from '../analytics/events';
apps/web/src/components/ChatComposer.tsx:36:} from '@open-design/contracts/analytics';
apps/web/src/components/ChatComposer.tsx:37:import { sessionModeToTracking } from '@open-design/contracts/analytics';
apps/web/src/components/ChatComposer.tsx:38:import { deriveUploadCohort } from '../analytics/upload-tracking';
apps/web/src/components/ChatComposer.tsx:39:import { projectRawUrl, uploadProjectFiles, openFolderDialog, fetchRecentLinkedDirs, pushRecentLinkedDir, dirExists, applyLibraryAsset, fetchLibraryAssetElementHtml } from "../providers/registry";
apps/web/src/components/ChatComposer.tsx:41:import { duplicatePluginAsProject, patchProject } from "../state/projects";
apps/web/src/components/ChatComposer.tsx:42:import { navigate } from '../router';
apps/web/src/components/ChatComposer.tsx:43:import { fetchMcpServers } from "../state/mcp";
apps/web/src/components/ChatComposer.tsx:44:import type { McpServerConfig, McpTemplate } from "../state/mcp";
apps/web/src/components/ChatComposer.tsx:45:import { listPlugins } from "../state/projects";
apps/web/src/components/ChatComposer.tsx:46:import type { AppConfig, ChatAttachment, ChatCommentAttachment, Project, ProjectFile, ProjectMetadata, SkillSummary } from "../types";
apps/web/src/components/ChatComposer.tsx:58:} from '@open-design/contracts';
apps/web/src/components/ChatComposer.tsx:59:import { buildVisualAnnotationAttachment, commentTargetDisplayName } from '../comments';
apps/web/src/components/ChatComposer.tsx:71:import type { LibraryAsset, LibraryElementMeta } from '@open-design/contracts';
apps/web/src/components/ChatComposer.tsx:83:} from '../runtime/design-toolbox';
apps/web/src/components/ChatComposer.tsx:94:} from '../utils/inlineMentions';
apps/web/src/components/ChatPane.tsx:17:import { hasOdCard } from '@open-design/contracts';
apps/web/src/components/ChatPane.tsx:18:import { useAnalytics } from '../analytics/provider';
apps/web/src/components/ChatPane.tsx:19:import { getResolvedDeviceId } from '../analytics/client';
apps/web/src/components/ChatPane.tsx:20:import { trackChatPanelClick, trackMessageQueueClick, trackRunFailedToastSurfaceView } from '../analytics/events';
apps/web/src/components/ChatPane.tsx:21:import { amrHandoffDeviceId, attributedAmrUrl, recordAmrEntry } from '../analytics/amr-attribution';
apps/web/src/components/ChatPane.tsx:22:import { useT } from '../i18n';
apps/web/src/components/ChatPane.tsx:23:import { startersForProduct, type ProductType } from '../onboarding/recommendation';
apps/web/src/components/ChatPane.tsx:24:import { starterCopyFor } from '../onboarding/starter-copy';
apps/web/src/components/ChatPane.tsx:30:} from '../runtime/design-toolbox';
apps/web/src/components/ChatPane.tsx:31:import { isRetryableAssistantTerminalFailure } from '../runtime/design-delivery';
apps/web/src/components/ChatPane.tsx:32:import type { Dict } from '../i18n/types';
apps/web/src/components/ChatPane.tsx:33:import { copyToClipboard } from '../lib/copy-to-clipboard';
apps/web/src/components/ChatPane.tsx:34:import { projectRawUrl } from '../providers/registry';
apps/web/src/components/ChatPane.tsx:35:import { takeComposerSeedFor } from '../state/libraryHandoff';
apps/web/src/components/ChatPane.tsx:36:import { splitOnQuestionForms } from '../artifacts/question-form';
apps/web/src/components/ChatPane.tsx:37:import { stripArtifact } from '../artifacts/strip';
apps/web/src/components/ChatPane.tsx:38:import type { TodoItem } from '../runtime/todos';
apps/web/src/components/ChatPane.tsx:39:import type { AppliedPluginSnapshot, ChatSessionMode, WorkspaceContextItem } from '@open-design/contracts';
apps/web/src/components/ChatPane.tsx:40:import type { TrackingProjectKind } from '@open-design/contracts/analytics';
apps/web/src/components/ChatPane.tsx:45:} from '../design-system-auto-prompt';
apps/web/src/components/ChatPane.tsx:46:import { isTodoWriteToolName, latestTodoWriteInputForPinnedCard } from '../runtime/todos';
apps/web/src/components/ChatPane.tsx:47:import type { AppConfig, ChatAttachment, ChatCommentAttachment, ChatMessage, ChatMessageFeedbackChange, Conversation, DesignSystemSummary, PreviewComment, Project, ProjectFile, ProjectMetadata, SkillSummary } from '../types';
apps/web/src/components/ChatPane.tsx:48:import { agentDisplayName } from '../utils/agentLabels';
apps/web/src/components/ChatPane.tsx:49:import { commentTargetDisplayName, commentsToAttachments, simplePositionLabel } from '../comments';
apps/web/src/components/ChatPane.tsx:66:} from '../runtime/amr-guidance';
apps/web/src/components/ChatPane.tsx:70:} from '../providers/daemon';
apps/web/src/components/ChatPane.tsx:71:import { RESUME_CONTINUE_PROMPT } from '../runtime/resume';

exec
/bin/bash -lc "find apps/web/src -maxdepth 3 -type d | sort | sed -n '1,280p'" in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
exec
/bin/bash -lc "find apps/web/src -maxdepth 3 -type f | sort | sed -n '1,360p'" in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
exec
/bin/bash -lc "find apps/web/src.orig -maxdepth 2 -type d | sort | sed -n '1,180p'" in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
apps/web/src.orig
apps/web/src.orig/analytics
apps/web/src.orig/artifacts
apps/web/src.orig/components
apps/web/src.orig/components/Theater
apps/web/src.orig/components/byok
apps/web/src.orig/components/composer
apps/web/src.orig/components/design-files
apps/web/src.orig/components/home-hero
apps/web/src.orig/components/pet
apps/web/src.orig/components/plugin-details
apps/web/src.orig/components/plugins-home
apps/web/src.orig/components/share-to-community
apps/web/src.orig/components/use-everywhere
apps/web/src.orig/components/workspace
apps/web/src.orig/edit-mode
apps/web/src.orig/features
apps/web/src.orig/hooks
apps/web/src.orig/i18n
apps/web/src.orig/i18n/locales
apps/web/src.orig/lib
apps/web/src.orig/media
apps/web/src.orig/observability
apps/web/src.orig/providers
apps/web/src.orig/runtime
apps/web/src.orig/state
apps/web/src.orig/styles
apps/web/src.orig/styles/home
apps/web/src.orig/styles/remixicon
apps/web/src.orig/styles/viewer
apps/web/src.orig/styles/workspace
apps/web/src.orig/utils

exec
/bin/bash -lc 'du -sh apps/web/src apps/web/src.orig 2>/dev/null' in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
  0B	apps/web/src
 17M	apps/web/src.orig

exec
/bin/bash -lc 'ls -ld apps/web/src apps/web/src.orig
file apps/web/src
readlink apps/web/src || true
od -An -tx1 -N80 apps/web/src 2>/dev/null || true' in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
lrwxr-xr-x@  1 la  staff   42 Jul  5 11:38 apps/web/src -> /Users/la/Desktop/Programming/Tovu/web/src
drwxr-xr-x@ 27 la  staff  864 Jul  5 09:43 apps/web/src.orig
apps/web/src: broken symbolic link to /Users/la/Desktop/Programming/Tovu/web/src
/Users/la/Desktop/Programming/Tovu/web/src

exec
/bin/bash -lc 'for f in .understand-anything/meta.json .understand-anything/config.json .understand-anything/knowledge-graph.json; do test -f "$f" && printf '"'\\n%s\\n' \""'$f" && (test "$f" = .understand-anything/knowledge-graph.json && sed -n '"'1,40p' \""'$f" || cat "$f"); done' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 exited 1 in 0ms:
exec
/bin/bash -lc 'for d in .codegraph .understand-anything .codebase-memory .code-review-graph ADS-project-knowledge/reports; do if test -e "$d"; then du -sh "$d"; find "$d" -maxdepth 3 -type f -print | sort | sed -n '"'1,220p'; fi; done" in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
 48K	ADS-project-knowledge/reports
ADS-project-knowledge/reports/README.md
ADS-project-knowledge/reports/continuity/design-systems-barrel-refactor/progress-ledger.md
ADS-project-knowledge/reports/handoff-design-systems-refactor.md
ADS-project-knowledge/reports/swarm-consensus/runs/2026-07-02-design-systems-index-architecture-consensus-report.md
ADS-project-knowledge/reports/swarm-consensus/smoke-tests/2026-07-02T014442Z-cli-smoke-test.json
ADS-project-knowledge/reports/swarm-consensus/smoke-tests/2026-07-16T160738Z-claude-discovery.md
ADS-project-knowledge/reports/swarm-consensus/smoke-tests/last-known-good.json

exec
/bin/bash -lc 'for d in .codegraph .understand-anything .codebase-memory .code-review-graph; do if test -e "$d"; then du -sh "$d"; find "$d" -maxdepth 2 -type f -print | sort | sed -n '"'1,160p'; fi; done" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
157M	.codegraph
.codegraph/.gitignore
.codegraph/codegraph.db
5.2M	.understand-anything
.understand-anything/.understandignore
.understand-anything/intermediate/batches.json
.understand-anything/intermediate/scan-result.json
.understand-anything/tmp/ua-import-map-input.json
.understand-anything/tmp/ua-import-map-output.json
.understand-anything/tmp/ua-scan-files.json
587M	.code-review-graph
.code-review-graph/.gitignore
.code-review-graph/graph.db

exec
/bin/bash -lc "ls -la AI-Dev-Shop | sed -n '1,120p'" in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
total 376
drwxr-xr-x@ 20 la  staff     640 Jul 16 09:07 .
drwxr-xr-x@ 61 la  staff    1952 Jul  5 09:46 ..
drwxr-xr-x@  5 la  staff     160 Jul 16 09:07 .claude
drwxr-xr-x@  3 la  staff      96 Jul  5 09:43 .gemini
-rw-r--r--@  1 la  staff    1324 Jul  5 09:43 .gitignore
drwxr-xr-x@ 11 la  staff     352 Jul 16 09:07 ADS-project-knowledge
-rw-r--r--@  1 la  staff   23805 Jul  5 09:43 AGENTS.md
-rw-r--r--@  1 la  staff   11245 Jul  5 09:43 AUDIT-WORK-CONVERGENCE-HANDOFF.md
-rw-r--r--@  1 la  staff    2601 Jul  5 09:43 CLAUDE.md
-rw-r--r--@  1 la  staff     947 Jul  5 09:43 GEMINI.md
-rw-r--r--@  1 la  staff   12545 Jul  5 09:43 README.md
drwxr-xr-x@ 23 la  staff     736 Jul  5 09:43 agents
drwxr-xr-x@ 13 la  staff     416 Jul  5 09:43 framework
drwxr-xr-x@ 19 la  staff     608 Jul  5 09:43 harness-engineering
-rw-r--r--@  1 la  staff    8476 Jul  5 09:43 init-hook-audit-HANDOFF.md
drwxr-xr-x@  9 la  staff     288 Jul  5 09:43 integrations
drwxr-xr-x@  9 la  staff     288 Jul  5 09:43 project-knowledge-template
-rw-r--r--@  1 la  staff     113 Jul  5 09:43 pytest.ini
drwxr-xr-x@ 97 la  staff    3104 Jul  5 09:43 skills
-rw-r--r--@  1 la  staff  110105 Jul  5 09:43 todo.md

exec
/bin/bash -lc "find AI-Dev-Shop -maxdepth 2 -type f | sort | sed -n '1,240p'" in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
AI-Dev-Shop/.claude/.ads-initialized
AI-Dev-Shop/.claude/settings.json
AI-Dev-Shop/.gemini/settings.json
AI-Dev-Shop/.gitignore
AI-Dev-Shop/ADS-project-knowledge/.gitignore
AI-Dev-Shop/ADS-project-knowledge/README.md
AI-Dev-Shop/AGENTS.md
AI-Dev-Shop/AUDIT-WORK-CONVERGENCE-HANDOFF.md
AI-Dev-Shop/CLAUDE.md
AI-Dev-Shop/GEMINI.md
AI-Dev-Shop/README.md
AI-Dev-Shop/framework/README.md
AI-Dev-Shop/harness-engineering/README.md
AI-Dev-Shop/init-hook-audit-HANDOFF.md
AI-Dev-Shop/integrations/IDEAS.md
AI-Dev-Shop/integrations/README.md
AI-Dev-Shop/integrations/backends.manifest.json
AI-Dev-Shop/project-knowledge-template/README.md
AI-Dev-Shop/pytest.ini
AI-Dev-Shop/skills/skills-lock.json
AI-Dev-Shop/todo.md

exec
/bin/bash -lc "sed -n '1,280p' AI-Dev-Shop/README.md 2>/dev/null || true" in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
# AI Dev Shop Foundation

Drop this toolkit into a project and point your coding agent at `AGENTS.md`.

`AGENTS.md` is the runtime authority. `README.md` is setup and maintainer guidance only.

## Install

Copy the toolkit into your project root:

```bash
cp -r AI-Dev-Shop/ your-project/AI-Dev-Shop/
```

Add this line to the startup file your tool reads at the project root:

```md
Read `AI-Dev-Shop/AGENTS.md` for the AI Dev Shop multi-agent pipeline.
```

Common entry points:
- `CLAUDE.md` for Claude Code
- `GEMINI.md` or `CLAUDE.md` for Gemini CLI and Codex CLI
<!-- - `.cursor/rules/*.mdc` for Cursor -->
<!-- - `.github/copilot-instructions.md` for GitHub Copilot -->

## What This Is

AI Dev Shop Foundation is a drop-in multi-agent delivery framework for coding agents. It turns an open-ended "build this feature" request into a structured pipeline with explicit stages for analysis, spec writing, architecture, test design, implementation, review, security, and docs.

In practice, this gives a repo a repeatable way to move from idea to working code without relying on a single giant prompt or ad hoc agent behavior.

```text
[VibeCoder] -> [CodeBase Analyzer] -> [System Design] -> Spec
-> [Red-Team] -> Software Architect -> [Database] -> TDD
-> Programmer -> [QA/E2E] -> TestRunner -> Code Review
-> [Refactor] -> Security -> [DevOps] -> [Docs] -> Done
```

- `[VibeCoder]` is an optional starting point - say "switch to vibecoder" or `/agent vibecoder` to prototype fast, then promote to the full pipeline when ready
- `[Observer]` is passive and active across all stages when enabled
- `[...]` stages are optional; dispatched by Coordinator when spec/ADR triggers them or when you specifically ask for them

## Spec Providers

The toolkit now treats the upstream planning framework as a provider.

- Default provider: `speckit`
- Swappable provider profiles: `openspec`, `bmad`
- Active provider file: `framework/spec-providers/active-provider.md`
- Provider contract: `framework/spec-providers/core/provider-contract.md`

This keeps provider-specific planning assumptions in one folder instead of spreading Speckit-only rules through the whole toolkit.

Current status:
- `speckit` is validated in this repo
- `openspec` is scaffolded but not yet tested end-to-end in this repo
- `bmad` is scaffolded but not yet tested end-to-end in this repo

## Quick Overview

- **For**: teams and solo builders who want coding agents to work through a defined software-delivery process instead of improvising
- **Does**: routes work through specialized agents like Coordinator, Spec, Software Architect, TDD, Programmer, Code Review, and Security
- **Produces**: durable artifacts such as specs, ADRs, task lists, test certifications, review findings, and project memory
- **Fits**: existing codebases and greenfield projects; the toolkit lives alongside your app rather than replacing it, while project-owned state lives in a sibling `ADS-project-knowledge/` folder

## Why It Exists

Most agent workflows are strong at generating code but weak at preserving intent, surfacing risks, and keeping decisions auditable. This toolkit adds:

- a runtime contract in `AGENTS.md`
- a standard pipeline from request to implementation
- a clean split between toolkit source and project-owned writable state
- clear human approval points before architecture, implementation, and shipping

## How It Works

1. Install the toolkit into your repository.
2. Point your coding tool at `AI-Dev-Shop/AGENTS.md`.
3. Confirm or switch the active spec provider in `framework/spec-providers/active-provider.md`.
4. Start in Coordinator mode or invoke a pipeline command.
5. The framework routes work through the right agents and writes project-owned artifacts under a sibling `ADS-project-knowledge/` folder.

## At A Glance

```text
Idea/request
  -> Coordinator routes work
  -> Specialists produce specs, architecture, tests, code, and reviews
  -> Humans approve key checkpoints
  -> Repository gains both implementation and a paper trail
```

## Slash Commands

Claude Code can load the built-in slash command templates. Install is opt-in and
collision-checked so it never overwrites a command your host already has (e.g. an
existing `/code-review`):

```bash
# Preview what would change (NEW / IDENTICAL / CONFLICT), no writes:
bash AI-Dev-Shop/framework/operations/scripts/install-slash-commands.sh --check
# Install the safe ones; conflicts are skipped unless you pass --overwrite:
bash AI-Dev-Shop/framework/operations/scripts/install-slash-commands.sh --install
```

Other hosts do not support native slash commands. For those, open the matching file in `framework/slash-commands/` and paste its contents manually.

Built-in templates include staged delivery commands plus utility commands such as `/audit-work`, `/cowork`, and `/handoff`.

## First-Time Project Setup

The easiest path is to ask your coding agent to run setup for you:

```text
Run AI Dev Shop first-time setup. Show me what you will create before writing files.
```

The agent should then:

1. Run the setup script in dry-run mode.
2. Show you the planned files and folders.
3. Wait for your approval.
4. Run the real setup script for you.

You do not need to run the Bash commands yourself unless you prefer manual setup.

Manual fallback:

```bash
bash AI-Dev-Shop/framework/operations/scripts/setup-project-knowledge.sh --dry-run
bash AI-Dev-Shop/framework/operations/scripts/setup-project-knowledge.sh
```

The setup script:

- Confirms the active provider from [framework/spec-providers/active-provider.md](framework/spec-providers/active-provider.md).
- Creates `ADS-project-knowledge/` as a sibling directory of `AI-Dev-Shop/`.
- Creates the shared workspace folders for specs, governance, memory, reports, metadata, and local scratch.
- Copies [framework/templates/bootstrap/workspace-gitignore.template](framework/templates/bootstrap/workspace-gitignore.template) to `ADS-project-knowledge/.gitignore` so `.local-artifacts/` stays local by default.
- Creates `ADS-project-knowledge/governance/constitution.md` from [framework/templates/bootstrap/constitution-template.md](framework/templates/bootstrap/constitution-template.md) if no constitution exists.
- Creates starter project memory files under `ADS-project-knowledge/memory/` without overwriting existing files.

After setup, customize and approve:

- `ADS-project-knowledge/governance/constitution.md`
- `ADS-project-knowledge/memory/project_memory.md`

For team projects, commit `ADS-project-knowledge/` to the host repo so other programmers and agents can see the same durable project context: specs, architecture decisions, review findings, reports, workflow notes, and memory. Do not commit `ADS-project-knowledge/.local-artifacts/`; it is local scratch space.

Optional for live website debugging: follow [framework/templates/bootstrap/playwright-mcp-setup.md](framework/templates/bootstrap/playwright-mcp-setup.md) to register the current browser-automation provider with your client. This is host setup, not a repo dependency.

After setup, start with the Coordinator in Review Mode, or run `/spec` once slash commands are installed.

Forward spec packages go under `ADS-project-knowledge/specs/` by default. Retained pipeline artifacts go under `ADS-project-knowledge/reports/`. Local scratch goes under `ADS-project-knowledge/.local-artifacts/`.

## Optional Live Browser Analysis

AI Dev Shop can use a host-configured browser automation provider to open a running app, inspect the rendered UI, and verify fixes against real browser behavior.

- Capability name: `browser_automation`
- Current provider mapping: Playwright MCP
- Ownership model: the user installs the MCP server in their client; the repo detects and uses it when present

This keeps the framework modular. If a better browser provider replaces Playwright later, the capability can stay the same while the provider mapping changes.

## Key Files

- [AGENTS.md](AGENTS.md): runtime contract, modes, routing rules
- [framework/spec-providers/active-provider.md](framework/spec-providers/active-provider.md): active planning provider and switch rules
- [framework/spec-providers/core/provider-contract.md](framework/spec-providers/core/provider-contract.md): provider boundary used by the pipeline
- [framework/operations/scripts/setup-project-knowledge.sh](framework/operations/scripts/setup-project-knowledge.sh): first-time workspace setup helper
- [framework/workflows/multi-agent-pipeline.md](framework/workflows/multi-agent-pipeline.md): detailed stage execution rules
- [framework/workflows/conventions.md](framework/workflows/conventions.md): file placement and writable/read-only rules
- [framework/spec-providers/speckit/provider.md](framework/spec-providers/speckit/provider.md): default provider mapping and current Speckit compatibility shims
- [framework/templates/adr-template.md](framework/templates/adr-template.md): ADR template used by Software Architect
- [harness-engineering/README.md](harness-engineering/README.md): harness layer, validators, rollout plan, and local source notes

Agent roster note: the toolkit is extensible. `AGENTS.md` lists the current default agents, not a fixed maximum count.

## Repository Architecture

This toolkit keeps its engine files grouped while preserving a clean split between framework source and project-owned state:

- **The Engine (Read-Only):** `agents/`, `skills/`, `framework/`, and `harness-engineering/` are the toolkit control surface. They stay read-only during normal host-project work so ADS can be updated independently without mixing framework logic with project state.
- **The Workspace Template (Repo-Local):** `project-knowledge-template/` is the committed template for the writable workspace shape. It ships defaults, examples, and bootstrap-ready files for specs, governance, memory, reports, metadata, local artifacts, and project-owned workflow notes.
- **The Project Workspace (Writable):** `ADS-project-knowledge/` is the project-owned sibling workspace. Agents write forward specs to `ADS-project-knowledge/specs/`, retained artifacts to `ADS-project-knowledge/reports/`, memory to `ADS-project-knowledge/memory/`, the real constitution to `ADS-project-knowledge/governance/constitution.md`, local scratch to `ADS-project-knowledge/.local-artifacts/`, and future workspace metadata to `ADS-project-knowledge/meta/`.

For the host application itself, keep app-specific product docs in the host repo, not in the toolkit internals. `AI-Dev-Shop/` ships the engine and templates; `ADS-project-knowledge/` is where the toolkit stores project-owned state that should travel with the host repo.

## Architecture Defaults

- Default macro shape: modular monolith.
- Feature ownership: vertical slices when boundaries matter.
- Use hexagonal boundaries where external I/O or business-critical logic justify them.
- Use Orc-BASH for React frontends.
- Do not force architecture ceremony onto trivial CRUD, scripts, or short-lived work.

## Design Philosophy

This toolkit is a portable, self-contained set of markdown files, templates, and agent instructions that can be dropped into a repository to standardize AI behavior and project governance without external databases or complex setup. The current default planning provider is Speckit, but provider selection is now isolated under `framework/spec-providers/` so the upstream planning surface can be swapped without rewriting the rest of the pipeline.

Furthermore, this framework is built on **Harness Engineering** principles. Rather than relying purely on prompt engineering to make an AI model smarter, this toolkit provides a deterministic "harness" (state machines, durable memory files, strict routing, and validation loops) that wraps the non-deterministic LLM. It treats the agent as the Model + the Harness.

## Maintainers

- Normal feature work should not edit `agents/`, `skills/`, `framework/spec-providers/`, `framework/templates/`, `framework/workflows/`, or `framework/slash-commands/`.
- If the user explicitly asks to maintain or upgrade the toolkit itself, treat that as framework maintainer work.
- Maintainer-only rollout notes and design history live under [harness-engineering/maintainers/README.md](harness-engineering/maintainers/README.md).
- Bootstrap-only scaffolding lives under [framework/templates/bootstrap/README.md](framework/templates/bootstrap/README.md).
- Archived audit artifacts live under [harness-engineering/archive/README.md](harness-engineering/archive/README.md).

exec
/bin/bash -lc "find AI-Dev-Shop -maxdepth 3 -type f \\( -iname '*govern*' -o -iname '*ledger*' -o -iname '*runner*' -o -name 'AGENTS.md' \\) -print | sort" in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
AI-Dev-Shop/AGENTS.md
AI-Dev-Shop/framework/templates/governance-adr-template.md
AI-Dev-Shop/framework/templates/progress-ledger-template.md
AI-Dev-Shop/harness-engineering/governance-scenarios/test_adr_governance.py
AI-Dev-Shop/skills/vercel-composition-patterns/AGENTS.md
AI-Dev-Shop/skills/vercel-react-best-practices/AGENTS.md
AI-Dev-Shop/skills/vercel-react-native-skills/AGENTS.md

exec
/bin/bash -lc 'du -sh AI-Dev-Shop' in /Users/la/Desktop/Programming/Jini
 succeeded in 0ms:
 12M	AI-Dev-Shop

exec
/bin/bash -lc 'cat .codegraph/.gitignore .code-review-graph/.gitignore' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# CodeGraph data files — local to each machine, not for committing.
# Ignore everything in .codegraph/ except this file itself, so transient
# files (the database, daemon.pid, sockets, logs) never show up in git.
*
!.gitignore
# Auto-generated by code-review-graph — do not commit database files.
# The graph.db contains absolute paths and code structure metadata.
*

exec
/bin/bash -lc 'file .codegraph/codegraph.db .code-review-graph/graph.db .understand-anything/intermediate/scan-result.json .understand-anything/intermediate/batches.json' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
.codegraph/codegraph.db:                            SQLite 3.x database, last written using SQLite version 3050000, writer version 2, read version 2, file counter 2, database pages 40244, 1st free page 39793, free pages 20393, cookie 0x20, schema 4, UTF-8, version-valid-for 2
.code-review-graph/graph.db:                        SQLite 3.x database, last written using SQLite version 3050004, writer version 2, read version 2, file counter 4, database pages 150170, cookie 0x28, schema 4, UTF-8, version-valid-for 4
.understand-anything/intermediate/scan-result.json: JSON data
.understand-anything/intermediate/batches.json:     ASCII text

exec
/bin/bash -lc "sqlite3 -readonly .codegraph/codegraph.db '.tables' 2>/dev/null | head -20 || true" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
exec
/bin/bash -lc "sqlite3 -readonly .code-review-graph/graph.db '.tables' 2>/dev/null | head -20 || true" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
exec
/bin/bash -lc "sed -n '1,80p' .understand-anything/intermediate/scan-result.json" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
{
  "name": "open-design",
  "description": "Local-first design product: detects your installed code-agent CLI, runs design skills + design systems, streams artifacts into a sandboxed preview. Note: this project has over 100 source files; consider scoping analysis to a subdirectory for faster results.",
  "languages": [
    "bicep",
    "config",
    "cts",
    "dll",
    "dockerfile",
    "exe",
    "html",
    "icns",
    "javascript",
    "json",
    "jsonl",
    "markdown",
    "nix",
    "powershell",
    "python",
    "shell",
    "template",
    "toml",
    "tpl",
    "txt",
    "typescript",
    "unknown",
    "xml",
    "yaml"
  ],
  "frameworks": [
    "Express",
    "GitHub Actions",
    "Next",
    "React",
    "Tailwind CSS",
    "Vitest"
  ],
  "files": [
    {
      "path": ".claude-plugin/marketplace.json",
      "language": "json",
      "sizeLines": 16,
      "fileCategory": "config"
    },
    {
      "path": ".claude/commands/od-contribute.md",
      "language": "markdown",
      "sizeLines": 23,
      "fileCategory": "docs"
    },
    {
      "path": ".claude/skills/od-contribute/agents/openai.yaml",
      "language": "yaml",
      "sizeLines": 13,
      "fileCategory": "config"
    },
    {
      "path": ".claude/skills/od-contribute/install.sh",
      "language": "shell",
      "sizeLines": 136,
      "fileCategory": "script"
    },
    {
      "path": ".claude/skills/od-contribute/references/design-system-anatomy.md",
      "language": "markdown",
      "sizeLines": 51,
      "fileCategory": "docs"
    },
    {
      "path": ".claude/skills/od-contribute/references/newcomer-tone.md",
      "language": "markdown",
      "sizeLines": 42,
      "fileCategory": "docs"
    },
    {
      "path": ".claude/skills/od-contribute/references/od-repo-map.md",
      "language": "markdown",
      "sizeLines": 38,
      "fileCategory": "docs"
    },

exec
/bin/bash -lc "sed -n '1,100p' .understand-anything/.understandignore" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# Generated output (not source)
graphify-out/

# Dependencies and build artifacts
node_modules/
dist/
.next/
vendor/
__pycache__/

# Lock files
*.lock
package-lock.json
pnpm-lock.yaml

# Binary/media assets
*.png
*.jpg
*.jpeg
*.gif
*.svg
*.ico
*.woff
*.woff2
*.ttf
*.eot
*.mp4
*.webm
*.pdf
*.webp

# CSS files
*.css

# Test files
*.test.ts
*.test.tsx
*.test.mts
*.test.js
*.test.mjs
*.spec.ts
*.spec.tsx
*.spec.js
**/tests/
**/__tests__/

# Design templates (rendered output, not source architecture)
design-templates/

# Landing page (separate marketing site)
apps/landing-page/

# Design system brand content
design-systems/

# Non-English i18n locale files (identical structure to en.ts)
apps/web/src/i18n/locales/ar.ts
apps/web/src/i18n/locales/de.ts
apps/web/src/i18n/locales/es-ES.ts
apps/web/src/i18n/locales/fa.ts
apps/web/src/i18n/locales/fr.ts
apps/web/src/i18n/locales/hu.ts
apps/web/src/i18n/locales/id.ts
apps/web/src/i18n/locales/ja.ts
apps/web/src/i18n/locales/ko.ts
apps/web/src/i18n/locales/pl.ts
apps/web/src/i18n/locales/pt-BR.ts
apps/web/src/i18n/locales/ru.ts
apps/web/src/i18n/locales/th.ts
apps/web/src/i18n/locales/tr.ts
apps/web/src/i18n/locales/uk.ts
apps/web/src/i18n/locales/zh-CN.ts
apps/web/src/i18n/locales/zh-TW.ts

# Translated docs (duplicates of English originals)
docs/i18n/

exec
/bin/bash -lc "sed -n '1,260p' package.json" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
{
  "name": "open-design",
  "version": "0.14.2",
  "private": true,
  "packageManager": "pnpm@10.33.2",
  "type": "module",
  "description": "Local-first design product: detects your installed code-agent CLI, runs design skills + design systems, streams artifacts into a sandboxed preview.",
  "license": "Apache-2.0",
  "bin": {
    "od": "./apps/daemon/bin/od.mjs"
  },
  "scripts": {
    "postinstall": "node ./scripts/postinstall.mjs",
    "tools-dev": "pnpm exec tools-dev",
    "tools-pack": "pnpm exec tools-pack",
    "tools-release": "pnpm exec tools-release",
    "tools-serve": "pnpm exec tools-serve",
    "nix:update-hash": "node --experimental-strip-types ./scripts/update-nix-pnpm-deps-hash.ts",
    "guard": "tsx ./scripts/guard.ts && node --import tsx --test scripts/style-policy.test.ts scripts/product-neutrality.test.ts scripts/web-import-isolation.test.ts scripts/check-cross-app-imports.test.ts scripts/check-ts-nocheck-imports.test.ts scripts/approve-fork-pr-workflows.test.ts scripts/lint-craft-references.test.ts scripts/check-design-system-manifests.test.ts scripts/check-plugin-preview-manifest.test.ts scripts/check-web-slice-boundaries.test.ts",
    "lint:craft": "tsx ./scripts/lint-craft-references.ts",
    "i18n:check": "tsx ./scripts/i18n-check.ts",
    "i18n:coverage": "tsx ./scripts/i18n-coverage-report.ts",
    "sync:community-pets": "node --experimental-strip-types scripts/sync-community-pets.ts",
    "bake:community-pets": "node --experimental-strip-types scripts/bake-community-pets.ts",
    "seed:test-projects": "node --experimental-strip-types scripts/seed-test-projects.ts",
    "seed:curated-design-skills": "node --experimental-strip-types scripts/seed-curated-design-skills.ts",
    "backfill:failed-runs": "node --experimental-strip-types scripts/backfill-failed-runs-with-artifacts.ts",
    "typecheck": "pnpm -r --workspace-concurrency=4 --if-present run typecheck && tsc -p scripts/tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@open-design/components": "workspace:*",
    "@open-design/daemon": "workspace:*",
    "@open-design/tools-dev": "workspace:*",
    "@open-design/tools-pack": "workspace:*",
    "@open-design/tools-release": "workspace:*",
    "@open-design/tools-serve": "workspace:*",
    "@types/node": "20.19.39",
    "tsx": "4.22.3",
    "typescript": "5.9.3"
  },
  "engines": {
    "node": "~24",
    "pnpm": ">=10.33.2 <11"
  },
  "pnpm": {
    "overrides": {
      "brace-expansion": "5.0.6",
      "devalue": "5.8.1",
      "fast-uri": "3.1.2",
      "hono": "4.12.19",
      "ip-address": "10.2.0",
      "postcss": "8.5.15",
      "protobufjs": "8.4.0",
      "qs": "6.15.2",
      "tmp": "0.2.7",
      "yaml": "2.9.0"
    },
    "onlyBuiltDependencies": [
      "better-sqlite3",
      "core-js",
      "electron",
      "electron-winstaller",
      "esbuild",
      "protobufjs",
      "sharp"
    ]
  }
}

exec
/bin/bash -lc "sed -n '1,180p' pnpm-workspace.yaml" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
packages:
  - packages/*
  - apps/*
  - tools/*
  - e2e

overrides:
  brace-expansion: 5.0.6
  devalue: 5.8.1
  fast-uri: 3.1.2
  hono: 4.12.19
  ip-address: 10.2.0
  postcss: 8.5.15
  protobufjs: 8.4.0
  qs: 6.15.2
  tmp: 0.2.7
  yaml: 2.9.0

onlyBuiltDependencies:
  - better-sqlite3
  - core-js
  - electron
  - electron-winstaller
  - esbuild
  - protobufjs
  - sharp

exec
/bin/bash -lc "ls -1 | rg -i 'license|notice|copying' || true" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
LICENSE

exec
/bin/bash -lc 'for f in LICENSE LICENSE.md NOTICE; do test -f "$f" && sed -n '"'1,120p' \""'$f"; done' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 exited 1 in 0ms:
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed

exec
/bin/bash -lc "sed -n '1,220p' packages/contracts/package.json" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
{
  "name": "@open-design/contracts",
  "version": "0.14.2",
  "private": true,
  "type": "module",
  "description": "Shared pure TypeScript contracts for the Open Design web/daemon boundary.",
  "main": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.mjs"
    },
    "./api/connectionTest": {
      "types": "./dist/api/connectionTest.d.ts",
      "default": "./dist/api/connectionTest.mjs"
    },
    "./api/amrWallet": {
      "types": "./dist/api/amrWallet.d.ts",
      "default": "./dist/api/amrWallet.mjs"
    },
    "./api/orbit": {
      "types": "./dist/api/orbit.d.ts",
      "default": "./dist/api/orbit.mjs"
    },
    "./api/finalize": {
      "types": "./dist/api/finalize.d.ts",
      "default": "./dist/api/finalize.mjs"
    },
    "./api/handoff": {
      "types": "./dist/api/handoff.d.ts",
      "default": "./dist/api/handoff.mjs"
    },
    "./api/providerModels": {
      "types": "./dist/api/providerModels.d.ts",
      "default": "./dist/api/providerModels.mjs"
    },
    "./api/reasoningExecution": {
      "types": "./dist/api/reasoningExecution.d.ts",
      "default": "./dist/api/reasoningExecution.mjs"
    },
    "./api/research": {
      "types": "./dist/api/research.d.ts",
      "default": "./dist/api/research.mjs"
    },
    "./runtime/deck-stage-fallback": {
      "types": "./dist/runtime/deck-stage-fallback.d.ts",
      "default": "./dist/runtime/deck-stage-fallback.mjs"
    },
    "./design-systems/components-manifest": {
      "types": "./dist/design-systems/components-manifest.d.ts",
      "default": "./dist/design-systems/components-manifest.mjs"
    },
    "./design-systems/derived-token-outputs": {
      "types": "./dist/design-systems/derived-token-outputs.d.ts",
      "default": "./dist/design-systems/derived-token-outputs.mjs"
    },
    "./design-systems/token-schema": {
      "types": "./dist/design-systems/token-schema.d.ts",
      "default": "./dist/design-systems/token-schema.mjs"
    },
    "./critique": {
      "types": "./dist/critique.d.ts",
      "default": "./dist/critique.mjs"
    },
    "./analytics": {
      "types": "./dist/analytics/index.d.ts",
      "default": "./dist/analytics/index.mjs"
    }
  },
  "scripts": {
    "build": "node ./esbuild.config.mjs && tsc -p tsconfig.json --emitDeclarationOnly",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.tests.json --noEmit"
  },
  "dependencies": {
    "@open-design/release": "workspace:*",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "esbuild": "0.28.0",
    "typescript": "5.9.3",
    "vitest": "4.1.6"
  }
}

exec
/bin/bash -lc "sed -n '1,220p' packages/sidecar/package.json" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
{
  "name": "@open-design/sidecar",
  "version": "0.14.2",
  "private": true,
  "type": "module",
  "main": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.mjs"
    }
  },
  "scripts": {
    "build": "node ./esbuild.config.mjs && tsc -p tsconfig.json --emitDeclarationOnly",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.tests.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "24.12.2",
    "esbuild": "0.28.0",
    "typescript": "6.0.3",
    "vitest": "4.1.6"
  },
  "engines": {
    "node": "~24"
  }
}

exec
/bin/bash -lc "sed -n '1,220p' packages/platform/package.json" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
{
  "name": "@open-design/platform",
  "version": "0.14.2",
  "private": true,
  "type": "module",
  "main": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.mjs"
    }
  },
  "scripts": {
    "build": "node ./esbuild.config.mjs && tsc -p tsconfig.json --emitDeclarationOnly",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.tests.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "24.12.2",
    "esbuild": "0.28.0",
    "typescript": "6.0.3",
    "vitest": "4.1.6"
  },
  "engines": {
    "node": "~24"
  }
}

exec
/bin/bash -lc "git for-each-ref --format='%(refname:short)' refs/heads refs/remotes | rg -i 'server|daemon|route|runtime|refactor|rewrite|chat' | sed -n '1,240p'
git log --all --date=short --format='%h %ad %d %s' --regexp-ignore-case --grep='startChatRun|server.ts|daemon.*route|route.*daemon|server decomposition|runtime extraction' | sed -n '1,240p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 11068ms:
2026-07-16 09:31:04.374 xcodebuild[33639:1027436]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:31:04.734 xcodebuild[33640:1027448]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:31:05.136 xcodebuild[33640:1027440] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-n7O9GCm9' (errno=Operation not permitted)
2026-07-16 09:31:06.157 xcodebuild[33641:1027461]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:31:06.484 xcodebuild[33642:1027468]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:31:06.810 xcodebuild[33642:1027465] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
arch/chat-run-extraction
arch/server-preamble-1
arch/server-preamble-2
arch/server-slice-5
arch/server-startserver-endgame
refactor/agent-protocol-barrel
refactor/contracts-metadata-block
refactor/db-barrel
refactor/download-barrel-split
refactor/events-barrel-split
refactor/host-barrel-split
refactor/langfuse-trace-barrel
refactor/platform-barrel-split
refactor/plugin-runtime-helpers
refactor/sidecar-barrel-split
refactor/sidecar-proto-barrel-split
refactor/web-chat-composer-slice
refactor/web-chat-composer-slice-pr
refactor/web-chat-pane-slice
refactor/web-file-viewer-slice
refactor/web-file-viewer-slice-clusterb
refactor/web-mcp-client-slice
refactor/web-memmodel-transport
refactor/web-memory-slice
fork/agent-runtime
fork/arch/chat-run-extraction
fork/arch/server-preamble-1
fork/arch/server-preamble-2
fork/arch/server-startserver-endgame
fork/chore/gha-runtime-optimization
fork/codex/amr-runtime-acp-main-pr
fork/codex/amr-runtime-acp-p0-issues-2-3-4
fork/codex/amr-runtime-acp-zoom-out
fork/codex/backport-same-run-retry-runtime-0.10.0
fork/codex/chat-comments-main
fork/codex/chat-queue-code-comments
fork/codex/chat-queue-send
fork/codex/daemon-diagnostics-coverage
fork/codex/design-system-manifest-runtime
fork/codex/fix-daemon-run-reload-recovery
fork/codex/hide-chat-plugin-use-action
fork/codex/issue-1288-chat-pane-feedback
fork/codex/kimi-gemini-runtime-triage
fork/codex/message-rendering-runtime
fork/codex/packaged-runtime-deps
fork/codex/preserve-structured-daemon-errors
fork/codex/restore-chat-message-roles
fork/codex/runtime-recovery-installer-sidecar-uninstall
fork/codex/runtime-todo-artifact-ui
fork/codex/same-run-retry-runtime
fork/codex/serveroptima-runner-poc
fork/codex/split-daemon-run-helpers
fork/codex/unified-daemon-startup
fork/explore/daemon-token-channel-injection
fork/feat/amr-runtime-acp
fork/feat/antigravity-runtime
fork/feat/chat-style-revamp
fork/feat/grok-build-runtime
fork/feat/remove-side-chat-entry
fork/fix/assistant-chat-link-handling
fork/fix/daemon-typecheck-core
fork/fix/daemon-typecheck-leaf
fork/fix/default-router-craft
fork/fix/diagnostics-capture-daemon-logs
fork/fix/github-metadata-daemon-proxy
fork/fix/system-proxy-agent-runtimes
fork/looper/4165-refactor-web-standardize-simpl-331c624489260a89
fork/looper/4166-refactor-web-migrate-settings-ee964dec7537d1ff
fork/new-agent-runtime-expactation
fork/refactor/agent-protocol-barrel
fork/refactor/contracts-metadata-block
fork/refactor/daemon-server-phase-0-2
fork/refactor/daemon-server-phase-3-route-dedupe
fork/refactor/daemon-server-phase-4-plugin-split
fork/refactor/db-barrel
fork/refactor/download-barrel-split
fork/refactor/events-barrel-split
fork/refactor/extract-ui-primitives
fork/refactor/host-barrel-split
fork/refactor/langfuse-trace-barrel
fork/refactor/platform-barrel-split
fork/refactor/plugin-runtime-helpers
fork/refactor/sidecar-barrel-split
fork/refactor/sidecar-proto-barrel-split
fork/refactor/web-automations-slice
fork/refactor/web-chat-composer-slice-pr
fork/refactor/web-chat-pane-slice
fork/refactor/web-chatcomposer-slice
fork/refactor/web-file-viewer-slice
fork/refactor/web-file-workspace-slice
fork/refactor/web-handoff-slice
fork/refactor/web-mcp-client-slice
fork/refactor/web-memory-slice
fork/refactor/web-project-view-slice
fork/refactor/web-settingsdialog-slice
fork/revert-1622-agent-runtime
fork/server-ts
fork/split-daemon-project-routes
fork/worktree-nextjs-16-refactor
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-qKB5ex9n' (errno=Operation not permitted)
2026-07-16 09:31:09.049 xcodebuild[33647:1027501]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:31:09.692 xcodebuild[33649:1027533]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:31:10.515 xcodebuild[33649:1027509] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-qB9AJrBa' (errno=Operation not permitted)
2026-07-16 09:31:11.771 xcodebuild[33654:1027571]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:31:12.150 xcodebuild[33656:1027584]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:31:12.598 xcodebuild[33656:1027575] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.

exec
/bin/bash -lc 'for ref in arch/chat-run-extraction arch/server-preamble-1 arch/server-preamble-2 arch/server-slice-5 arch/server-startserver-endgame fork/server-ts fork/refactor/daemon-server-phase-0-2 fork/refactor/daemon-server-phase-3-route-dedupe fork/refactor/daemon-server-phase-4-plugin-split fork/codex/split-daemon-run-helpers fork/split-daemon-project-routes; do git show -s --date=short --format="$ref %h %ad %s" "$ref" 2>/dev/null; done' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 51376ms:
arch/chat-run-extraction 780917104 2026-07-03 test(daemon): harden sse-shapes characterization suite per review
arch/server-preamble-1 cc8c26db5 2026-07-08 test(daemon): restore OD_DATA_DIR/OD_AGENT_HOME after the SSE-shapes suite
arch/server-preamble-2 e38e2b593 2026-07-03 refactor(daemon): extract assistant-message persistence from server.ts
arch/server-slice-5 f1aabe9e5 2026-07-03 refactor(daemon): dissolve the startServer god-function into feature modules
arch/server-startserver-endgame f1aabe9e5 2026-07-03 refactor(daemon): dissolve the startServer god-function into feature modules
fork/server-ts 7cbec2035 2026-05-11 fix: restore static resource mutation origin checks
fork/refactor/daemon-server-phase-0-2 2cc7883e0 2026-06-15 refactor(daemon): split server bootstrap routes
fork/refactor/daemon-server-phase-3-route-dedupe 75faa6a2b 2026-06-15 refactor(daemon): remove duplicate route registrations
fork/refactor/daemon-server-phase-4-plugin-split 58abd68c1 2026-06-15 refactor(daemon): split plugin routes
fork/codex/split-daemon-run-helpers 36afb0942 2026-06-23 fix(daemon): move run analytics helper under runtimes
fork/split-daemon-project-routes e2481b652 2026-06-22 fix(daemon): cover run route deps in context guard

exec
/bin/bash -lc "for ref in arch/chat-run-extraction arch/server-preamble-2 arch/server-startserver-endgame fork/refactor/daemon-server-phase-4-plugin-split fork/split-daemon-project-routes; do printf '%s ' \""'$ref"; git rev-list --left-right --count "$ref"...origin/main; printf '"'server-lines '; git show \""'$ref":apps/daemon/src/server.ts 2>/dev/null | wc -l; done
for ref in arch/server-startserver-endgame arch/chat-run-extraction; do printf '"'\\n%s files\\n' \""'$ref"; git diff --name-status origin/main..."$ref" -- apps/daemon/src packages/contracts/src | sed -n '"'1,260p'; done" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 53656ms:
2026-07-16 09:32:24.137 xcodebuild[33869:1028862]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:24.464 xcodebuild[33872:1028869]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:24.822 xcodebuild[33872:1028866] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-nSTJFXUv' (errno=Operation not permitted)
2026-07-16 09:32:25.653 xcodebuild[33883:1028895]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:26.003 xcodebuild[33884:1028900]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:26.319 xcodebuild[33884:1028899] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
4	162
server-lines     4784
arch/server-preamble-2 git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-SV9psfE4' (errno=Operation not permitted)
2026-07-16 09:32:32.336 xcodebuild[33896:1028970]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:32.720 xcodebuild[33899:1029032]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:33.064 xcodebuild[33899:1028985] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-jCRG100S' (errno=Operation not permitted)
2026-07-16 09:32:34.101 xcodebuild[33908:1029098]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:34.435 xcodebuild[33909:1029107]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:34.824 xcodebuild[33909:1029102] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
15	258
server-lines     4474
arch/server-startserver-endgame git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-hi5bu1a3' (errno=Operation not permitted)
2026-07-16 09:32:41.174 xcodebuild[33933:1029202]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:41.487 xcodebuild[33934:1029207]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:41.827 xcodebuild[33934:1029206] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-mIgM39TU' (errno=Operation not permitted)
2026-07-16 09:32:42.624 xcodebuild[33936:1029232]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:42.930 xcodebuild[33937:1029238]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:43.243 xcodebuild[33937:1029237] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
16	258
server-lines     3399
fork/refactor/daemon-server-phase-4-plugin-split git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-A19jtDMw' (errno=Operation not permitted)
2026-07-16 09:32:49.609 xcodebuild[33971:1029441]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:49.926 xcodebuild[33972:1029447]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:50.244 xcodebuild[33972:1029445] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-zJiWzcX0' (errno=Operation not permitted)
2026-07-16 09:32:51.071 xcodebuild[33973:1029452]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:51.377 xcodebuild[33974:1029463]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:51.704 xcodebuild[33974:1029460] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
2287	421
server-lines    12552
fork/split-daemon-project-routes git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-iKNL9A7Z' (errno=Operation not permitted)
2026-07-16 09:32:58.160 xcodebuild[34009:1029655]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:58.468 xcodebuild[34010:1029661]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:58.785 xcodebuild[34010:1029659] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-wBHt9rNi' (errno=Operation not permitted)
2026-07-16 09:32:59.592 xcodebuild[34011:1029666]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:32:59.897 xcodebuild[34012:1029671]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:00.219 xcodebuild[34012:1029670] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
2423	421
server-lines    10031

arch/server-startserver-endgame files
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-hzPbXaOy' (errno=Operation not permitted)
2026-07-16 09:33:06.520 xcodebuild[34052:1029823]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:06.930 xcodebuild[34053:1029848]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:07.584 xcodebuild[34053:1029827] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-mjLPJm2m' (errno=Operation not permitted)
2026-07-16 09:33:08.441 xcodebuild[34062:1029898]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:08.790 xcodebuild[34063:1029905]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:09.147 xcodebuild[34063:1029902] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
A	apps/daemon/src/assistant-message-persistence.ts
A	apps/daemon/src/chat-request-composition.ts
A	apps/daemon/src/daemon-request-guards.ts
A	apps/daemon/src/http/api-security-middleware.ts
A	apps/daemon/src/http/error-payloads.ts
A	apps/daemon/src/http/sse.ts
A	apps/daemon/src/media/task-registry.ts
A	apps/daemon/src/plugin-registry-view.ts
A	apps/daemon/src/plugin-share.ts
A	apps/daemon/src/project-display-status.ts
A	apps/daemon/src/prompts/run-context.ts
M	apps/daemon/src/routes/plugins/index.ts
A	apps/daemon/src/routes/plugins/project-handlers.ts
A	apps/daemon/src/run-event-analytics.ts
A	apps/daemon/src/run-telemetry-fallback.ts
A	apps/daemon/src/run-telemetry.ts
A	apps/daemon/src/runtimes/compose-daemon-system-prompt.ts
A	apps/daemon/src/runtimes/fire-pipeline-for-run.ts
A	apps/daemon/src/runtimes/start-chat-run.ts
M	apps/daemon/src/server.ts
A	apps/daemon/src/shell/commands.ts

arch/chat-run-extraction files
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-OSrLXs96' (errno=Operation not permitted)
2026-07-16 09:33:12.256 xcodebuild[34083:1030018]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:12.610 xcodebuild[34084:1030027]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:12.977 xcodebuild[34084:1030025] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Xjd2lCL1' (errno=Operation not permitted)
2026-07-16 09:33:13.940 xcodebuild[34085:1030045]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:14.361 xcodebuild[34086:1030053]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:14.763 xcodebuild[34086:1030049] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
A	apps/daemon/src/runtimes/start-chat-run.ts
M	apps/daemon/src/server.ts

exec
/bin/bash -lc "git show arch/chat-run-extraction:apps/daemon/src/runtimes/start-chat-run.ts | sed -n '1,320p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 4321ms:
2026-07-16 09:33:23.741 xcodebuild[34113:1030262]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:24.052 xcodebuild[34118:1030269]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:24.390 xcodebuild[34118:1030268] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-YgkFD0CG' (errno=Operation not permitted)
2026-07-16 09:33:25.234 xcodebuild[34120:1030318]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:25.585 xcodebuild[34123:1030323]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:25.935 xcodebuild[34123:1030322] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
// Authors: Leon Aburime using Claude Fable 5
// @ts-nocheck — carried over verbatim from server.ts's file-level @ts-nocheck.
// This module is a strangler-fig MOVE of the startChatRun closure; typing its
// 3,400 lines is a separate, later effort. New sibling code must NOT copy this.
/** @module start-chat-run
 * The chat-run engine: spawns the selected agent CLI for one run, streams and
 * decodes its output into run SSE events, and drives lifecycle (retry, resume,
 * artifacts, telemetry) to the terminal `end` event.
 *
 * Extracted from apps/daemon/src/server.ts as an explicit-deps factory.
 * `deps` carries the server.ts module-scope helpers/registries and
 * startServer locals the closure captured (see createStartChatRun call site in
 * server.ts). `deps.daemonUrl` is a live getter because server.ts reassigns
 * it after listen; everything else is bound once at factory time.
 */

import {
  spawn,
} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  executionProfileFromStreamFormat,
} from '@open-design/contracts';
import {
  emittedRenderableQuestionForm,
} from '../question-form-detect.js';
import {
  userFacingAgentLabel,
} from '../user-facing-agent-label.js';
import {
  buildBrowserUseRunState,
  isBrowserUseRequested,
  renderBrowserUseUnavailablePrompt,
} from '../browser-use-diagnostics.js';
import {
  UPLOAD_DIR,
  composeLiveInstructionPrompt,
  formatDesignFilesWorkspaceHint,
  formatProjectAttachmentHint,
  normalizeCommentAttachments,
  renderCommentAttachmentHint,
  resolveChatExtraAllowedDirs,
  describeStablePromptCache,
  resolveCodexGeneratedImagesDir,
  resolveGrantedCodexImagegenOverride,
  resolveResearchCommandContract,
  resolveSafeProjectAttachments,
  resolveSafePromptImagePaths,
  selectPromptImagePaths,
  validateCodexGeneratedImagesDir,
} from './chat-prompt-inputs.js';
import {
  applyClaudeStreamJsonRunBookkeeping,
  assertValidRuntimeDefInactivityTimeoutMs,
  bufferedAntigravityGeminiFirstTokenAt,
  classifyChatRunCloseStatus,
  looksLikeGeminiJsonEventStream,
  resolveAcpStageTimeoutMs,
  resolveActiveInactivityTimeoutMs,
  resolveChatRunArtifactQuietPeriodMs,
  resolveChatRunInactivityTimeoutMs,
} from './chat-run-lifecycle.js';
import {
  createCommandInvocation,
} from '@open-design/platform';
import {
  buildLiveArtifactsMcpServersForAgent,
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
  getAgentDef,
  isKnownModel,
  openDesignAmrTraceEnv,
  applyAgentLaunchEnv,
  resolveAgentLaunch,
  sanitizeCustomModel,
  spawnEnvForAgent,
} from '../agents.js';
import {
  getRememberedLiveModels,
  preferFreshLiveModels,
  rememberLiveModels,
  resolveDefaultModelFromOptions,
  resolveModelForAgent,
} from './models.js';
import {
  TerminalControlSequenceStripper,
} from './terminal-control.js';
import {
  persistPlainStreamArtifacts,
  plainStdoutFromRunEvents,
} from './plain-stream.js';
import {
  loadMmdRouteLaunchEnv,
} from './mmd-routes.js';
import {
  preparePromptFileForAgent,
} from './prompt-file.js';
import {
  buildOpenCodeByokProviderConfig,
} from './byok-opencode.js';
import {
  readVelaLoginStatus,
  resolveAmrProfile,
} from '../integrations/vela.js';
import {
  amrAccountFailureDetails,
  classifyAmrAccountFailureSignal,
} from '../integrations/vela-errors.js';
import {
  amrModelLoadingCache,
} from './amr-model-cache.js';
import {
  fetchVelaPresetModels,
  fetchVelaRemoteModelsWithRetry,
} from './defs/amr.js';
import {
  validateLinkedDirs,
} from '../linked-dirs.js';
import {
  getInstalledPlugin,
  getSnapshot,
} from '../plugins/index.js';
import {
  extractFromMessage,
} from '../memory.js';
import {
  attachAcpSession,
  attachPiRpcSession,
} from '../agent-protocol/index.js';
import {
  stageAmrImagePaths,
} from '../media/amr-image-staging.js';
import {
  createClaudeStreamHandler,
} from './claude-stream.js';
import {
  createAgentTitleMarkerStripper,
} from '../title-marker.js';
import {
  createRoleMarkerGuard,
} from '../role-marker-guard.js';
import {
  createToolLoopGuard,
  resolveToolLoopMode,
  type ToolLoopVerdict,
} from '../tool-loop-guard.js';
import {
  diagnoseClaudeCliFailure,
} from '../claude-diagnostics.js';
import {
  runOrchestrator,
} from '../critique/orchestrator.js';
import {
  createCopilotStreamHandler,
} from '../copilot-stream.js';
import {
  createJsonEventStreamHandler,
} from './json-event-stream.js';
import {
  antigravityAuthGuidance,
  antigravityQuotaGuidance,
  classifyAgentAuthFailure,
  classifyAgentServiceFailure,
  cursorAuthGuidance,
} from './auth.js';
import {
  readOpenCodeServiceFailure,
} from './opencode-log.js';
import {
  createAgentStderrVisibilityFilter,
} from '../amr-stderr-filter.js';
import {
  createQoderStreamHandler,
} from './qoder-stream.js';
import {
  createRunLifecycleTracer,
  runLifecycleMarkersForStreamEvent,
} from '../run-lifecycle-tracer.js';
import {
  deriveRunErrorCode,
  runResultFromStatus,
} from '../run-result.js';
import {
  classifyRunFailure,
  isResumableFailure,
} from '../run-failure-classification.js';
import {
  decideSafeRunRetry,
} from '../run-retry-policy.js';
import {
  diffRunArtifacts,
  snapshotProjectArtifacts,
} from '../run-artifact-fs.js';
import {
  AiHtmlVersionSnapshotError,
  snapshotAiHtmlVersionsForRun,
} from '../run-html-version-snapshots.js';
import {
  buildPromptStackTelemetry,
} from '../prompt-telemetry.js';
import {
  agentIdToTracking,
  modelIdForTracking,
} from '@open-design/contracts/analytics';
import {
  skillCwdAliasSegment,
  stageActiveSkill,
} from '../cwd-aliases.js';
import {
  buildAcpMcpServers,
  buildClaudeMcpJson,
  buildOpenCodeMcpConfigContent,
  isManagedProjectCwd,
  readMcpConfig,
} from '../mcp-config.js';
import {
  resolveExternalMcpServersForRun,
} from '../run-tool-bundle.js';
import {
  isTokenExpired,
  readAllTokens,
} from '../mcp-tokens.js';
import {
  agentCliEnvForAgent,
  readAppConfig,
} from '../app-config.js';
import {
  assertSandboxProjectRootAvailable,
  ensureProject,
  isRunTouchedProjectFile,
  listFiles,
  listProjectFolders,
  resolveProjectDir,
  SandboxImportedProjectError,
  reconcileHtmlArtifactManifest,
  writeProjectFile,
} from '../projects.js';
import {
  getConversation,
  getProject,
  normalizeConversationSessionMode,
  clearAgentSession,
  upsertAgentSession,
} from '../db.js';
import {
  computeIncludeStable,
  hashStableInstructions,
  isAgentResumeFailure,
  persistCapturedAgentSession,
  resolveAgentResumeContext,
} from '../agent-session-resume.js';
import {
  resolveAmrModelProbe,
} from './amr-model-probe.js';
import {
  CHAT_TOOL_ENDPOINTS,
  CHAT_TOOL_OPERATIONS,
  toolTokenRegistry,
} from '../tool-tokens.js';

export function createStartChatRun(deps: any) {
  const {
    ARTIFACTS_DIR,
    DESIGN_SYSTEMS_DIR,
    FORM_ANSWERED_GENERIC_OVERRIDE,
    FORM_ANSWERED_SYSTEM_OVERRIDE,
    FORM_ANSWERS_HEADER_RE,
    OD_BIN,
    OD_NODE_BIN,
    PROJECTS_DIR,
    PROJECT_ROOT,
    RUNTIME_DATA_DIR,
    SANDBOX_RUNTIME,
    SKILLS_DIR,
    activeChatAgentEventSinks,
    activeChatRunHandles,
    critiqueCfg,
    critiqueRunRegistry,
    critiqueWarnedAdapters,
    runArtifactBaselines,
    composeChatUserRequestForAgent,
    createAgentRuntimeEnv,
    createAgentRuntimeToolPrompt,
    createAmrModelUnavailablePayload,
    createSseErrorPayload,
    emitProjectEvent,
    filesystemEmptyAnswerFallbackText,
    filesystemWriteFileNamesFromRunEvents,
    hasGeneratedPluginArtifacts,
    isPluginAuthoringRun,
    persistRunEventToAssistantMessage,
    refreshAndPersistToken,
    renderRunContextPrompt,
    resolveRunProjectKindForAnalytics,
    rewriteKnownAgentStreamError,
    scanRunEventsForRetrySideEffects,
    telemetryPromptFromRunRequest,
    composeDaemonSystemPrompt,
    db,
    design,
  } = deps;
  const startChatRun = async (chatBody, run) => {
    const lifecycle = createRunLifecycleTracer(run);
    lifecycle.mark('chat_run_started');
    /** @type {Partial<ChatRequest> & { imagePaths?: string[] }} */
    chatBody = chatBody || {};
    const {
      agentId,
      message,
      currentPrompt,
      systemPrompt,
      imagePaths = [],
      projectId,
      conversationId,
      assistantMessageId,
      clientRequestId,
      skillId,

exec
/bin/bash -lc "git show arch/server-startserver-endgame:apps/daemon/src/runtimes/start-chat-run.ts | sed -n '1,360p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 3990ms:
2026-07-16 09:33:28.121 xcodebuild[34141:1030377]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:28.435 xcodebuild[34142:1030382]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:28.754 xcodebuild[34142:1030381] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-z91Zm6kS' (errno=Operation not permitted)
2026-07-16 09:33:29.559 xcodebuild[34143:1030388]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:29.861 xcodebuild[34144:1030393]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:30.184 xcodebuild[34144:1030392] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
// Authors: Leon Aburime using Claude Fable 5
// @ts-nocheck — carried over verbatim from server.ts's file-level @ts-nocheck.
// This module is a strangler-fig MOVE of the startChatRun closure; typing its
// 3,400 lines is a separate, later effort. New sibling code must NOT copy this.
/** @module start-chat-run
 * The chat-run engine: spawns the selected agent CLI for one run, streams and
 * decodes its output into run SSE events, and drives lifecycle (retry, resume,
 * artifacts, telemetry) to the terminal `end` event.
 *
 * Extracted from apps/daemon/src/server.ts as an explicit-deps factory.
 * `deps` carries the server.ts module-scope helpers/registries and
 * startServer locals the closure captured (see createStartChatRun call site in
 * server.ts). `deps.daemonUrl` is a live getter because server.ts reassigns
 * it after listen; everything else is bound once at factory time.
 */

import {
  spawn,
} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  executionProfileFromStreamFormat,
} from '@open-design/contracts';
import {
  emittedRenderableQuestionForm,
} from '../question-form-detect.js';
import {
  userFacingAgentLabel,
} from '../user-facing-agent-label.js';
import {
  buildBrowserUseRunState,
  isBrowserUseRequested,
  renderBrowserUseUnavailablePrompt,
} from '../browser-use-diagnostics.js';
import {
  UPLOAD_DIR,
  composeLiveInstructionPrompt,
  formatDesignFilesWorkspaceHint,
  formatProjectAttachmentHint,
  normalizeCommentAttachments,
  renderCommentAttachmentHint,
  resolveChatExtraAllowedDirs,
  describeStablePromptCache,
  resolveCodexGeneratedImagesDir,
  resolveGrantedCodexImagegenOverride,
  resolveResearchCommandContract,
  resolveSafeProjectAttachments,
  resolveSafePromptImagePaths,
  selectPromptImagePaths,
  validateCodexGeneratedImagesDir,
} from './chat-prompt-inputs.js';
import {
  applyClaudeStreamJsonRunBookkeeping,
  assertValidRuntimeDefInactivityTimeoutMs,
  bufferedAntigravityGeminiFirstTokenAt,
  classifyChatRunCloseStatus,
  looksLikeGeminiJsonEventStream,
  resolveAcpStageTimeoutMs,
  resolveActiveInactivityTimeoutMs,
  resolveChatRunArtifactQuietPeriodMs,
  resolveChatRunInactivityTimeoutMs,
} from './chat-run-lifecycle.js';
import {
  createCommandInvocation,
} from '@open-design/platform';
import {
  buildLiveArtifactsMcpServersForAgent,
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
  getAgentDef,
  isKnownModel,
  openDesignAmrTraceEnv,
  applyAgentLaunchEnv,
  resolveAgentLaunch,
  sanitizeCustomModel,
  spawnEnvForAgent,
} from '../agents.js';
import {
  getRememberedLiveModels,
  preferFreshLiveModels,
  rememberLiveModels,
  resolveModelForAgent,
} from './models.js';
import {
  loadMmdRouteLaunchEnv,
} from './mmd-routes.js';
import {
  preparePromptFileForAgent,
} from './prompt-file.js';
import {
  buildOpenCodeByokProviderConfig,
} from './byok-opencode.js';
import {
  readVelaLoginStatus,
  resolveAmrProfile,
} from '../integrations/vela.js';
import {
  amrAccountFailureDetails,
  classifyAmrAccountFailureSignal,
} from '../integrations/vela-errors.js';
import {
  amrModelLoadingCache,
} from './amr-model-cache.js';
import {
  fetchVelaPresetModels,
  fetchVelaRemoteModelsWithRetry,
} from './defs/amr.js';
import {
  validateLinkedDirs,
} from '../linked-dirs.js';
import {
  getInstalledPlugin,
  getSnapshot,
} from '../plugins/index.js';
import {
  extractFromMessage,
} from '../memory.js';
import {
  attachAcpSession,
} from '../acp.js';
import {
  attachPiRpcSession,
} from '../pi-rpc.js';
import {
  stageAmrImagePaths,
} from '../media/amr-image-staging.js';
import {
  createClaudeStreamHandler,
} from './claude-stream.js';
import {
  createAgentTitleMarkerStripper,
} from '../title-marker.js';
import {
  createRoleMarkerGuard,
} from '../role-marker-guard.js';
import {
  createToolLoopGuard,
  resolveToolLoopMode,
  type ToolLoopVerdict,
} from '../tool-loop-guard.js';
import {
  diagnoseClaudeCliFailure,
} from '../claude-diagnostics.js';
import {
  runOrchestrator,
} from '../critique/orchestrator.js';
import {
  createCopilotStreamHandler,
} from '../copilot-stream.js';
import {
  createJsonEventStreamHandler,
} from './json-event-stream.js';
import {
  antigravityAuthGuidance,
  antigravityQuotaGuidance,
  classifyAgentAuthFailure,
  classifyAgentServiceFailure,
  cursorAuthGuidance,
} from './auth.js';
import {
  readOpenCodeServiceFailure,
} from './opencode-log.js';
import {
  createAgentStderrVisibilityFilter,
} from '../amr-stderr-filter.js';
import {
  createQoderStreamHandler,
} from './qoder-stream.js';
import {
  createRunLifecycleTracer,
  runLifecycleMarkersForStreamEvent,
} from '../run-lifecycle-tracer.js';
import {
  deriveRunErrorCode,
  runResultFromStatus,
} from '../run-result.js';
import {
  classifyRunFailure,
  isResumableFailure,
} from '../run-failure-classification.js';
import {
  decideSafeRunRetry,
} from '../run-retry-policy.js';
import {
  diffRunArtifacts,
  snapshotProjectArtifacts,
} from '../run-artifact-fs.js';
import {
  AiHtmlVersionSnapshotError,
  snapshotAiHtmlVersionsForRun,
} from '../run-html-version-snapshots.js';
import {
  buildPromptStackTelemetry,
} from '../prompt-telemetry.js';
import {
  agentIdToTracking,
  modelIdForTracking,
} from '@open-design/contracts/analytics';
import {
  skillCwdAliasSegment,
  stageActiveSkill,
} from '../cwd-aliases.js';
import {
  buildAcpMcpServers,
  buildClaudeMcpJson,
  buildOpenCodeMcpConfigContent,
  isManagedProjectCwd,
  readMcpConfig,
} from '../mcp-config.js';
import {
  resolveExternalMcpServersForRun,
} from '../run-tool-bundle.js';
import {
  isTokenExpired,
  readAllTokens,
} from '../mcp-tokens.js';
import {
  agentCliEnvForAgent,
  readAppConfig,
} from '../app-config.js';
import {
  assertSandboxProjectRootAvailable,
  ensureProject,
  isRunTouchedProjectFile,
  listFiles,
  listProjectFolders,
  resolveProjectDir,
  SandboxImportedProjectError,
  reconcileHtmlArtifactManifest,
} from '../projects.js';
import {
  getConversation,
  getProject,
  normalizeConversationSessionMode,
  clearAgentSession,
  upsertAgentSession,
} from '../db.js';
import {
  computeIncludeStable,
  hashStableInstructions,
  isAgentResumeFailure,
  persistCapturedAgentSession,
  resolveAgentResumeContext,
} from '../agent-session-resume.js';
import {
  resolveAmrModelProbe,
} from './amr-model-probe.js';
import {
  CHAT_TOOL_ENDPOINTS,
  CHAT_TOOL_OPERATIONS,
  toolTokenRegistry,
} from '../tool-tokens.js';

export function createStartChatRun(deps: any) {
  const {
    ARTIFACTS_DIR,
    DESIGN_SYSTEMS_DIR,
    FORM_ANSWERED_GENERIC_OVERRIDE,
    FORM_ANSWERED_SYSTEM_OVERRIDE,
    FORM_ANSWERS_HEADER_RE,
    OD_BIN,
    OD_NODE_BIN,
    PROJECTS_DIR,
    PROJECT_ROOT,
    RUNTIME_DATA_DIR,
    SANDBOX_RUNTIME,
    SKILLS_DIR,
    activeChatAgentEventSinks,
    activeChatRunHandles,
    critiqueCfg,
    critiqueRunRegistry,
    critiqueWarnedAdapters,
    runArtifactBaselines,
    composeChatUserRequestForAgent,
    createAgentRuntimeEnv,
    createAgentRuntimeToolPrompt,
    createAmrModelUnavailablePayload,
    createSseErrorPayload,
    emitProjectEvent,
    filesystemEmptyAnswerFallbackText,
    filesystemWriteFileNamesFromRunEvents,
    hasGeneratedPluginArtifacts,
    isPluginAuthoringRun,
    persistRunEventToAssistantMessage,
    refreshAndPersistToken,
    renderRunContextPrompt,
    resolveRunProjectKindForAnalytics,
    rewriteKnownAgentStreamError,
    scanRunEventsForRetrySideEffects,
    telemetryPromptFromRunRequest,
    composeDaemonSystemPrompt,
    db,
    design,
  } = deps;
  const startChatRun = async (chatBody, run) => {
    const lifecycle = createRunLifecycleTracer(run);
    lifecycle.mark('chat_run_started');
    /** @type {Partial<ChatRequest> & { imagePaths?: string[] }} */
    chatBody = chatBody || {};
    const {
      agentId,
      message,
      currentPrompt,
      systemPrompt,
      imagePaths = [],
      projectId,
      conversationId,
      assistantMessageId,
      clientRequestId,
      skillId,
      skillIds,
      designSystemId,
      sessionMode,
      attachments = [],
      commentAttachments = [],
      model,
      reasoning,
      locale,
      research,
      context,
      titleGeneration,
      byokProvider,
      byokMediaDefaults,
    } = chatBody;
    lifecycle.mark('prompt_build_start');
    if (typeof projectId === 'string' && projectId) run.projectId = projectId;
    if (typeof conversationId === 'string' && conversationId)
      run.conversationId = conversationId;
    if (typeof assistantMessageId === 'string' && assistantMessageId)
      run.assistantMessageId = assistantMessageId;
    if (typeof clientRequestId === 'string' && clientRequestId)
      run.clientRequestId = clientRequestId;
    if (typeof agentId === 'string' && agentId) run.agentId = agentId;
    // Stash the original user prompt + per-turn config so the
    // langfuse-bridge report path can include them without reaching back
    // into chatBody across the createChatRunService boundary. Each field
    // is optional and only set when the chat body actually carried it.
    const telemetryPrompt = telemetryPromptFromRunRequest(message, currentPrompt);
    if (typeof telemetryPrompt === 'string') run.userPrompt = telemetryPrompt;
    if (typeof model === 'string' && model) run.model = model;
    if (typeof reasoning === 'string' && reasoning) run.reasoning = reasoning;
    if (typeof skillId === 'string' && skillId) run.skillId = skillId;
    if (typeof designSystemId === 'string' && designSystemId)
      run.designSystemId = designSystemId;
    const conversationSession =
      typeof conversationId === 'string' && conversationId
        ? getConversation(db, conversationId)
        : null;
    const runSessionMode =
      sessionMode === 'chat' || sessionMode === 'design' || sessionMode === 'plan'
        ? normalizeConversationSessionMode(sessionMode)
        : normalizeConversationSessionMode(conversationSession?.sessionMode);
    const def = getAgentDef(agentId);
    if (!def)
      return design.runs.fail(
        run,
        'AGENT_UNAVAILABLE',

exec
/bin/bash -lc "git show arch/server-startserver-endgame:apps/daemon/src/runtimes/compose-daemon-system-prompt.ts | sed -n '1,220p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 4120ms:
2026-07-16 09:33:32.149 xcodebuild[34150:1030412]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:32.458 xcodebuild[34151:1030422]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:32.805 xcodebuild[34151:1030420] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-IkrBTJAL' (errno=Operation not permitted)
2026-07-16 09:33:33.618 xcodebuild[34164:1030454]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:33.922 xcodebuild[34165:1030459]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:34.250 xcodebuild[34165:1030458] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
// Authors: Leon Aburime using Claude Fable 5
// @ts-nocheck — carried over verbatim from server.ts's file-level @ts-nocheck.
// This module is a strangler-fig MOVE of the composeDaemonSystemPrompt closure;
// typing it is a separate, later effort. New sibling code must NOT copy this.
/** @module compose-daemon-system-prompt
 * Builds the daemon's per-run system prompt: resolves the effective skill
 * (incl. composed @-mention skills and plugin-local SKILL.md overrides),
 * design-system body + compiled token assets, craft sections, personal
 * memory, critique-theater eligibility, media/voice options, plugin and
 * active-stage blocks, then delegates to composeSystemPrompt. Returns the
 * prompt plus the active skill dir(s), critique decision, design-system
 * selection, and telemetry parts consumed by the chat-run engine.
 *
 * Extracted from apps/daemon/src/server.ts as an explicit-deps factory
 * (same shape as createStartChatRun). `deps` carries the server.ts
 * module-scope constants/helpers and the startServer `db` handle the
 * closure captured; see the createComposeDaemonSystemPrompt call site.
 */

import { executionProfileFromStreamFormat } from '@open-design/contracts';
import { readAppConfig } from '../app-config.js';
import { loadCraftSections } from '../craft.js';
import { type SkillCritiquePolicy, isCritiqueEnabled, parseEnvEnabled, parseRolloutPhase } from '../critique/rollout.js';
import { narrowProjectCritiqueOverride } from '../critique/spawn-inputs.js';
import { getProject, getTemplate, normalizeConversationSessionMode } from '../db.js';
import { digestDesignSystemContext, resolveDesignSystemAssets } from '../design-systems/index.js';
import { listElevenLabsVoiceOptions } from '../integrations/elevenlabs-voices.js';
import { composeMemoryBody, readMemoryConfig } from '../memory.js';
import { getInstalledPlugin, getSnapshot, pluginPromptBlock } from '../plugins/index.js';
import { composeSystemPrompt, resolveExclusiveSurface } from '../prompts/system.js';
import { designSystemIdFromPluginSnapshot, resolveEffectiveDesignSystemSelection } from './chat-prompt-inputs.js';
import { findSkillById, resolveSkillId } from '../skills.js';

export function createComposeDaemonSystemPrompt(deps: any) {
  const {
    db,
    critiqueCfg,
    CRAFT_DIR,
    DESIGN_SYSTEMS_DIR,
    PROJECT_ROOT,
    RUNTIME_DATA_DIR,
    USER_DESIGN_SYSTEMS_DIR,
    ensureUserDesignSystemWorkspaceProject,
    isProjectUsableDesignSystem,
    listAllDesignSystems,
    listAllSkillLikeEntries,
    readAvailableDesignSystem,
    readDesignSystemWorkspaceTextFile,
  } = deps;
  const composeDaemonSystemPrompt = async ({
    agentId,
    projectId,
    skillId,
    skillIds,
    designSystemId,
    streamFormat,
    locale,
    sessionMode,
    connectedExternalMcp,
    appliedPluginSnapshotId,
    mediaExecution,
    byokMediaDefaults,
  }) => {
    const project =
      typeof projectId === 'string' && projectId
        ? getProject(db, projectId)
        : null;
    let appConfigForPrompt = null;
    try {
      appConfigForPrompt = await readAppConfig(RUNTIME_DATA_DIR);
    } catch (err) {
      console.warn('[app-config] readAppConfig failed', err);
    }
    let pluginDesignSystemId = null;
    if (
      typeof appliedPluginSnapshotId === 'string' &&
      appliedPluginSnapshotId.length > 0
    ) {
      try {
        pluginDesignSystemId = designSystemIdFromPluginSnapshot(
          getSnapshot(db, appliedPluginSnapshotId),
        );
      } catch (err) {
        console.warn(
          `[plugins] designSystem selection failed: ${err?.message ?? err}`,
        );
      }
    }
    const effectiveSkillId =
      typeof skillId === 'string' && skillId ? skillId : project?.skillId;
    const designSystemSelection = resolveEffectiveDesignSystemSelection({
      requestDesignSystemId: designSystemId,
      pluginDesignSystemId,
      projectDesignSystemId: project?.designSystemId,
      appDefaultDesignSystemId: appConfigForPrompt?.designSystemId,
      // A project row with designSystemId=null can mean the user picked
      // "No design system"; do not reapply the global default behind their back.
      allowAppDefault: project === null,
    });
    const effectiveDesignSystemId = designSystemSelection.id;
    const metadata = project?.metadata;
    let allSkillsPromise: ReturnType<typeof listAllSkillLikeEntries> | null = null;
    const loadAllSkills = async () => {
      allSkillsPromise ??= listAllSkillLikeEntries();
      return await allSkillsPromise;
    };

    // Per-turn skills picked via the composer's @-mention popover. They
    // never persist on the project — we just append their bodies after the
    // primary skill so the agent sees one combined block this turn.
    const effectiveCanonicalSkillId =
      typeof effectiveSkillId === 'string' && effectiveSkillId
        ? resolveSkillId(effectiveSkillId)
        : null;
    const adHocSkillIds = Array.isArray(skillIds)
      ? skillIds
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter(Boolean)
          .filter((id) => resolveSkillId(id) !== effectiveCanonicalSkillId)
      : [];

    let skillBody;
    let skillName;
    let skillMode;
    const skillModes = new Set<NonNullable<Parameters<typeof composeSystemPrompt>[0]['skillMode']>>();
    let skillCraftRequires = [];
    let activeSkillDir = null;
    const activeSkillDirs: string[] = [];
    // Per-skill Critique Theater override sourced from
    // `od.critique.policy` in the resolved skill's SKILL.md frontmatter.
    // `null` means the skill has no opinion and the lower-priority tiers
    // (project override, env override, rollout phase default) decide.
    let skillCritiquePolicy: SkillCritiquePolicy = null;
    let critiqueSkillId = effectiveCanonicalSkillId;
    const registerSkillMode = (
      mode: NonNullable<Parameters<typeof composeSystemPrompt>[0]['skillMode']> | null | undefined,
    ) => {
      if (!mode) return;
      skillModes.add(mode);
    };
    const registerPrimarySkillMode = (
      mode: NonNullable<Parameters<typeof composeSystemPrompt>[0]['skillMode']> | null | undefined,
    ) => {
      if (!mode) return;
      skillMode ??= mode;
      registerSkillMode(mode);
    };
    const registerSkillDir = (dir: string | null | undefined) => {
      if (typeof dir !== 'string' || dir.length === 0) return;
      if (!activeSkillDir) activeSkillDir = dir;
      if (!activeSkillDirs.includes(dir)) activeSkillDirs.push(dir);
    };
    const mergeSkillCritiquePolicy = (
      current: SkillCritiquePolicy,
      next: SkillCritiquePolicy,
    ): SkillCritiquePolicy => {
      if (next === 'opt-out') return 'opt-out';
      if (next === 'required') return current === 'opt-out' ? current : 'required';
      if (next === 'opt-in') {
        return current === 'required' || current === 'opt-out' ? current : 'opt-in';
      }
      return current;
    };
    if (effectiveSkillId) {
      // Span both functional skills and design templates so a project
      // saved against either surface keeps its system prompt after the
      // skills/design-templates split. See specs/current/skills-and-design-templates.md.
      const allSkills = await loadAllSkills();
      const skill = findSkillById(allSkills, effectiveSkillId);
      if (skill) {
        skillBody = skill.body;
        skillName = skill.name;
        registerPrimarySkillMode(skill.mode);
        registerSkillDir(skill.dir);
        skillCritiquePolicy = mergeSkillCritiquePolicy(
          skillCritiquePolicy,
          skill.critiquePolicy,
        );
        if (Array.isArray(skill.craftRequires))
          skillCraftRequires = skill.craftRequires;
      }
    }
    let composedSkillBlocks = '';
    if (adHocSkillIds.length > 0) {
      const allSkills = await loadAllSkills();
      const seen = new Set(
        effectiveCanonicalSkillId ? [String(effectiveCanonicalSkillId)] : [],
      );
      const blocks = [];
      const baseBody = skillBody && skillBody.trim().length > 0 ? skillBody : '';
      for (const id of adHocSkillIds) {
        const canonicalId = resolveSkillId(id);
        if (typeof canonicalId !== 'string' || canonicalId.length === 0) continue;
        if (seen.has(canonicalId)) continue;
        seen.add(canonicalId);
        const extra = findSkillById(allSkills, id);
        if (!extra) continue;
        registerSkillDir(extra.dir);
        registerSkillMode(extra.mode);
        if (!effectiveCanonicalSkillId && adHocSkillIds.length === 1) {
          registerPrimarySkillMode(extra.mode);
        }
        if (!critiqueSkillId || extra.critiquePolicy !== null) critiqueSkillId = canonicalId;
        skillCritiquePolicy = mergeSkillCritiquePolicy(
          skillCritiquePolicy,
          extra.critiquePolicy,
        );
        if (Array.isArray(extra.craftRequires)) {
          for (const craft of extra.craftRequires) {
            if (!skillCraftRequires.includes(craft)) skillCraftRequires.push(craft);
          }
        }
        blocks.push(
          `\n\n---\n\n## Composed skill — ${extra.name || id}\n\n${(extra.body || '').trim()}`,
        );
      }
      if (blocks.length > 0) {
        composedSkillBlocks = blocks.join('');
        skillBody = baseBody + composedSkillBlocks;
        if (!skillName) {

exec
/bin/bash -lc "git show arch/server-startserver-endgame:apps/daemon/src/http/sse.ts | sed -n '1,220p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 4314ms:
2026-07-16 09:33:36.361 xcodebuild[34174:1030520]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:36.705 xcodebuild[34177:1030527]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:37.071 xcodebuild[34177:1030524] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-zvwrcFwN' (errno=Operation not permitted)
2026-07-16 09:33:37.971 xcodebuild[34188:1030554]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:38.349 xcodebuild[34189:1030559]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:33:38.676 xcodebuild[34189:1030558] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
// Authors: Leon Aburime using Claude Fable 5
// @ts-nocheck — carried over verbatim from server.ts's file-level @ts-nocheck.
// The moved body is untyped JS-in-TS; typing it is a later effort and new
// sibling code must NOT copy this.
/** @module http/sse
 * Server-Sent Events transport helper.
 *
 * `createSseResponse` turns an Express `res` into an SSE stream: it writes the
 * event-stream headers, runs a keep-alive heartbeat, wires socket cleanup, and
 * returns a small `{ send, writeKeepAlive, cleanup, end }` handle that assembles
 * each `id/event/data` frame into a single write (so partial-event readers see
 * whole events). `SSE_KEEPALIVE_INTERVAL_MS` is the default heartbeat cadence.
 *
 * Extracted verbatim from apps/daemon/src/server.ts (strangler-fig slice 2).
 * server.ts imports `createSseResponse` back for its route deps objects and
 * re-exports both names to keep its public surface identical.
 */

/** Default keep-alive heartbeat cadence for {@link createSseResponse}, in ms. */
export const SSE_KEEPALIVE_INTERVAL_MS = 25_000;

/**
 * Wrap an Express `res` as a Server-Sent Events stream.
 *
 * Sets the event-stream headers, starts an unref'd keep-alive heartbeat (unless
 * `keepAliveIntervalMs <= 0`), and registers cleanup on socket close/finish.
 * @param res Express response to stream over.
 * @param opts `{ keepAliveIntervalMs }` — heartbeat cadence; defaults to
 *   {@link SSE_KEEPALIVE_INTERVAL_MS}, `0` disables the heartbeat.
 * @returns Handle `{ send(event, data, id?), writeKeepAlive, cleanup, end }`.
 *   `send` returns false once the socket is no longer writable.
 */
export function createSseResponse(
  res,
  { keepAliveIntervalMs = SSE_KEEPALIVE_INTERVAL_MS } = {},
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const canWrite = () => !res.destroyed && !res.writableEnded;
  const writeKeepAlive = () => {
    if (canWrite()) {
      res.write(': keepalive\n\n');
      return true;
    }
    return false;
  };

  let heartbeat = null;
  if (keepAliveIntervalMs > 0) {
    heartbeat = setInterval(writeKeepAlive, keepAliveIntervalMs);
    heartbeat.unref?.();
  }

  const cleanup = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  res.on('close', cleanup);
  res.on('finish', cleanup);

  return {
    /** @param {ChatSseEvent['event'] | ProxySseEvent['event'] | string} event */
    send(event, data, id: string | number | null | undefined = null) {
      if (!canWrite()) return false;
      // Assemble the full SSE event into a single write so id/event/data land
      // in one TCP chunk. Three separate writes would let `event: <type>` flush
      // ahead of the `data:` payload, which produces partial events for
      // consumers that read chunk-by-chunk (e.g. tests using a Response body
      // reader with a substring marker).
      const idLine = id !== null && id !== undefined ? `id: ${id}\n` : '';
      res.write(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    },
    writeKeepAlive,
    cleanup,
    end() {
      cleanup();
      if (canWrite()) {
        res.end();
      }
    },
  };
}

exec
/bin/bash -lc "git stash list --date=iso | sed -n '1,120p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 4787ms:
2026-07-16 09:36:29.187 xcodebuild[34724:1033612]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:36:29.557 xcodebuild[34728:1033653]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:36:30.054 xcodebuild[34728:1033623] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-6JUhLhPW' (errno=Operation not permitted)
2026-07-16 09:36:31.168 xcodebuild[34737:1033701]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:36:31.497 xcodebuild[34738:1033711]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:36:31.845 xcodebuild[34738:1033705] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
stash@{2026-07-11 11:12:01 -0700}: On refactor/web-chat-composer-slice: WIP memory-slice edits before switching to file-viewer branch

exec
/bin/bash -lc 'for ref in arch/chat-run-extraction arch/server-startserver-endgame; do base=$(git merge-base "$ref" origin/main); printf '"'\\n%s base=%s\\n' \""'$ref" "$base"; git log --reverse --format='"'%h %s' \""'$base..$ref"; done' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 16772ms:
2026-07-16 09:37:43.947 xcodebuild[34918:1034996]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:44.280 xcodebuild[34919:1035001]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:44.615 xcodebuild[34919:1035000] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-qz5OcmUv' (errno=Operation not permitted)
2026-07-16 09:37:45.408 xcodebuild[34920:1035018]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:45.718 xcodebuild[34921:1035023]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:46.033 xcodebuild[34921:1035022] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.

arch/chat-run-extraction base=6469a3e488fe1e4c3beb98010d99aeb71222961d
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-F47pVNcs' (errno=Operation not permitted)
2026-07-16 09:37:48.125 xcodebuild[34926:1035085]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:48.453 xcodebuild[34928:1035091]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:48.798 xcodebuild[34928:1035089] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-8bN7UbNs' (errno=Operation not permitted)
2026-07-16 09:37:49.674 xcodebuild[34935:1035120]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:50.083 xcodebuild[34936:1035130]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:50.401 xcodebuild[34936:1035124] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
75fd4afa4 test(daemon): golden characterization specs for startChatRun SSE event shapes
510a243e6 refactor(daemon): extract startChatRun into runtimes/start-chat-run.ts factory
43b993d33 fix(daemon): repair import regressions from the startChatRun move + sse-shapes test typecheck
780917104 test(daemon): harden sse-shapes characterization suite per review
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-D8OOMqR1' (errno=Operation not permitted)
2026-07-16 09:37:52.577 xcodebuild[34944:1035178]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:52.918 xcodebuild[34947:1035183]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:53.253 xcodebuild[34947:1035182] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-GxfylDSM' (errno=Operation not permitted)
2026-07-16 09:37:54.105 xcodebuild[34958:1035214]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:54.443 xcodebuild[34959:1035225]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:54.761 xcodebuild[34959:1035218] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.

arch/server-startserver-endgame base=f24bda9c97cf80a7d95c118ea7a5bbcdfe69f30d
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Cv0zWXb2' (errno=Operation not permitted)
2026-07-16 09:37:56.712 xcodebuild[34963:1035276]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:57.039 xcodebuild[34964:1035285]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:57.347 xcodebuild[34964:1035280] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-WCANN1Eo' (errno=Operation not permitted)
2026-07-16 09:37:58.139 xcodebuild[34965:1035299]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:58.443 xcodebuild[34966:1035304]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 09:37:58.752 xcodebuild[34966:1035303] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
1399eb921 test(daemon): golden characterization specs for startChatRun SSE event shapes
d20acc875 refactor(daemon): extract startChatRun into runtimes/start-chat-run.ts factory
4263deba5 fix(daemon): repair import regressions from the startChatRun move + sse-shapes test typecheck
6acdfd178 test(daemon): harden sse-shapes characterization suite per review
645f8c03e refactor(daemon): extract media task registry into media/task-registry.ts
679c9f573 refactor(daemon): extract SSE transport into http/sse.ts
1cdaf6a66 refactor(daemon): extract shell/gh exec helpers into shell/commands.ts
f8718bce2 refactor(daemon): remove dead duplicate OAuth-result-page helpers from server.ts
761d55465 refactor(daemon): extract run-context prompt helpers into prompts/run-context.ts
008184c65 refactor(daemon): extract run-event analytics scanners into run-event-analytics.ts
722f61f22 refactor(daemon): extract SSE/AMR error payloads + project-display-status
095886eb0 refactor(daemon): extract plugin manifest + plugin-share helpers into plugin-share.ts
c89320614 refactor(daemon): extract daemon HTTP request guards + live-artifact serving helpers
e4c03f508 refactor(daemon): extract run-telemetry + chat-request composition from server.ts
e38e2b593 refactor(daemon): extract assistant-message persistence from server.ts
f1aabe9e5 refactor(daemon): dissolve the startServer god-function into feature modules

exec
/bin/bash -lc "sed -n '1,16p' apps/daemon/src/server.ts
sed -n '1,10p' apps/daemon/src/runtimes/runs.ts
sed -n '1,40p' apps/daemon/src/agents.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
// @ts-nocheck
import type {
  DesktopExportArtifactInput,
  DesktopExportArtifactResult,
  DesktopExportPdfInput,
  DesktopExportPdfResult,
  DesktopRenderSlidesInput,
  DesktopRenderSlidesResult,
} from '@open-design/sidecar-proto';
import express from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// @ts-nocheck
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { todoSnapshotHasUnfinishedWork } from '@open-design/contracts';
import { normalizeMediaExecutionPolicyForRun } from '../media/policy.js';
import {
  normalizeRunToolBundleForRun,
  summarizeRunToolBundle,
} from '../run-tool-bundle.js';
// @ts-nocheck
export {
  AGENT_DEFS,
  getAgentDef,
  readLocalAgentProfileDefs,
} from './runtimes/registry.js';
export { detectAgents, detectAgentsStream } from './runtimes/detection.js';
export {
  resolveOnPath,
  inspectAgentExecutableResolution,
  resolveAgentExecutable,
} from './runtimes/executables.js';
export { applyAgentLaunchEnv, resolveAgentLaunch } from './runtimes/launch.js';
export { resolveAgentBin } from './runtimes/resolution.js';
export { openDesignAmrTraceEnv, spawnEnvForAgent } from './runtimes/env.js';
export { buildLiveArtifactsMcpServersForAgent } from './runtimes/mcp.js';
export {
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
} from './runtimes/prompt-budget.js';
export {
  rememberLiveModels,
  isKnownModel,
  sanitizeCustomModel,
} from './runtimes/models.js';

exec
/bin/bash -lc "sed -n '1,360p' packages/contracts/src/sse/chat.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import type { LiveArtifactRefreshStatus } from '../api/live-artifacts.js';
import type { RunFailureCategory, RunFailureDetail } from '../api/chat.js';
import type { SseErrorPayload } from '../errors.js';
import type { SseTransportEvent } from './common.js';

export type LiveArtifactSseAction = 'created' | 'updated' | 'deleted';
export type LiveArtifactRefreshSsePhase = 'started' | 'succeeded' | 'failed';

export interface LiveArtifactSsePayload {
  type: 'live_artifact';
  action: LiveArtifactSseAction;
  projectId: string;
  artifactId: string;
  title: string;
  /**
   * Refresh lifecycle state of the artifact at emit time. Typed against the
   * canonical `LiveArtifactRefreshStatus` enum used by the REST API so that
   * SSE consumers (web, CLI) can switch on the same union members without
   * widening to `string`. Optional because the daemon may omit the field on
   * legacy events; consumers must still null-check before narrowing.
   */
  refreshStatus?: LiveArtifactRefreshStatus;
}

export interface LiveArtifactRefreshSsePayload {
  type: 'live_artifact_refresh';
  phase: LiveArtifactRefreshSsePhase;
  projectId: string;
  artifactId: string;
  refreshId?: string;
  title?: string;
  refreshedSourceCount?: number;
  error?: string;
}

export interface PlainStreamArtifactSsePayload {
  type: 'artifact';
  source: 'plain-stream';
  name: string;
  path?: string;
  identifier?: string;
  artifactType?: string;
}

/**
 * Emitted by the daemon on `/api/projects/:id/events` when a new
 * conversation is inserted into a project from a path the open
 * project view can't observe through its own state — currently
 * Routines "Run now" in reuse-an-existing-project mode (#1361).
 *
 * Lives in `packages/contracts` so the daemon producer and the web
 * consumer share one type and can't drift as the stream grows.
 */
export interface ProjectConversationCreatedSsePayload {
  type: 'conversation-created';
  projectId: string;
  conversationId: string;
  title: string | null;
  createdAt: number;
}

export const CHAT_SSE_PROTOCOL_VERSION = 1;

export interface ChatSseStartPayload {
  runId?: string;
  agentId?: string;
  bin: string;
  protocolVersion?: typeof CHAT_SSE_PROTOCOL_VERSION;
  /** Legacy daemon-internal absolute cwd. Kept for compatibility during W2 adoption. */
  cwd?: string | null;
  projectId?: string | null;
  model?: string | null;
  reasoning?: string | null;
}

export interface ChatSseChunkPayload {
  chunk: string;
}

export interface ChatSseEndPayload {
  code: number | null;
  signal?: string | null;
  status?: 'succeeded' | 'failed' | 'canceled';
  /** Authoritative count of artifact files created or modified by this run.
   *  Present when the daemon resolved the run's filesystem/tool-stream diff
   *  before publishing the terminal frame. */
  artifactCount?: number;
  /** True when a `failed` run can be recovered by resuming the agent's CLI
   *  session (transient upstream drop / inactivity on a session-resuming
   *  runtime). Lets the chat offer a Continue affordance without a separate
   *  run-status fetch. Mirrors ChatRunStatusResponse.resumable. */
  resumable?: boolean;
  /** True when this terminal run ended with unfinished declared work (a
   *  non-`completed` TodoWrite task, or a max_tokens truncation). The browser
   *  reads it straight off the terminal frame and carries it onto the persisted
   *  assistant message so every status surface avoids showing "Completed" for an
   *  incomplete run. Mirrors ChatRunStatusResponse.endedWithUnfinishedWork. */
  endedWithUnfinishedWork?: boolean;
  /** Daemon failure classification for a `failed` run, so the chat can render
   *  specific guidance straight off the terminal frame without a status refetch.
   *  Mirror ChatRunStatusResponse.failureCategory / failureDetail. */
  failureCategory?: RunFailureCategory | null;
  failureDetail?: RunFailureDetail | null;
}

export type DaemonAgentPayload =
  | { type: 'status'; label: string; model?: string; ttftMs?: number; detail?: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'conversation_title'; title: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_start' }
  | LiveArtifactSsePayload
  | LiveArtifactRefreshSsePayload
  | PlainStreamArtifactSsePayload
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  /**
   * Live-only incremental tool-input fragment, emitted while the model is still
   * streaming a tool call's JSON arguments (Claude `input_json_delta`). `delta`
   * is a raw, possibly mid-token JSON fragment — not parseable on its own.
   * Consumers accumulate by `id` (the content-block id, equal to the eventual
   * `tool_use.id`) for real-time display and discard once the full `tool_use`
   * arrives. `name` is the tool name (known at content-block start) so the UI
   * can gate the live preview to code-writing tools. NOT persisted — see
   * `daemonAgentPayloadToPersistedAgentEvent`.
   */
  | { type: 'tool_input_delta'; id: string; name: string; delta: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'usage'; usage?: { input_tokens?: number; output_tokens?: number }; costUsd?: number; durationMs?: number; stopReason?: string | null }
  | { type: 'fabricated_role_marker'; marker: string; messageId?: string }
  // The agent is stuck repeating failing tool calls (see tool-loop-guard.ts).
  // `action: 'warn'` is an early heads-up the run may be looping; `'halt'` means
  // the daemon terminated the run at the hard ceiling. `signature` is a
  // truncated, human-readable form of the repeated action; `count` is how many
  // times it failed (consecutive run, or repeats of this exact action).
  | {
      type: 'tool_loop';
      reason: 'consecutive-errors' | 'repeated-failure';
      action: 'warn' | 'halt';
      toolName: string;
      signature: string;
      count: number;
    }
  | { type: 'raw'; line: string };

export type ChatSseEvent =
  | SseTransportEvent<'start', ChatSseStartPayload>
  | SseTransportEvent<'agent', DaemonAgentPayload>
  | SseTransportEvent<'stdout', ChatSseChunkPayload>
  | SseTransportEvent<'stderr', ChatSseChunkPayload>
  | SseTransportEvent<'error', SseErrorPayload>
  | SseTransportEvent<'end', ChatSseEndPayload>;

exec
/bin/bash -lc "sed -n '1,320p' packages/contracts/src/api/chat.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import type { ProjectFile } from './files';
import type { RunResultPackageResponse, RunWorkspace } from './workspaces.js';
import type {
  PreviewCommentAttachment,
  PreviewCommentMember,
  PreviewCommentPosition,
  PreviewCommentSelectionKind,
  PreviewAnnotationStyle,
  PreviewVisualMarkKind,
} from './comments';
import type { ResearchOptions } from './research';
import type { RunContextSelection } from './context.js';
import type { MediaExecutionPolicy } from './media.js';
import type { AppliedPluginSnapshot } from '../plugins/apply.js';
import type { McpAuthMode, McpServerConfig, McpTransport } from './mcp';
import type { TrackingRuntimeType } from '../analytics/public-params.js';
import type {
  TrackingRunFailureCategory,
  TrackingRunFailureDetail,
} from '../analytics/events.js';

// The daemon's run-failure taxonomy, re-exported under product-facing names so
// the run-status/error surface can carry the specific cause the daemon already
// classified (see apps/daemon/src/run-failure-classification.ts) instead of
// only the coarse `errorCode`. Same string unions as the analytics events, so
// producer and consumer can't drift.
export type RunFailureCategory = TrackingRunFailureCategory;
export type RunFailureDetail = TrackingRunFailureDetail;

export type ChatRole = 'user' | 'assistant';
export type ChatSessionMode = 'design' | 'chat' | 'plan';
export type ChatCommentSelectionKind = PreviewCommentSelectionKind | 'visual';
export type ByokChatProtocol =
  | 'anthropic'
  | 'openai'
  | 'azure'
  | 'google'
  | 'ollama'
  | 'senseaudio'
  | 'aihubmix';

export interface ByokChatProviderConfig {
  protocol: ByokChatProtocol;
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
  /** Explicit run-scoped provider policy for presets that do not require bearer credentials. */
  requiresApiKey?: boolean;
}

export interface ByokMediaDefaults {
  imageModel?: string;
  videoModel?: string;
  speechModel?: string;
  speechVoice?: string;
}

export interface ChatRequest {
  agentId: string;
  message: string;
  /** The latest user turn only, used for per-turn telemetry content. */
  currentPrompt?: string;
  systemPrompt?: string;
  projectId?: string | null;
  conversationId?: string | null;
  sessionMode?: ChatSessionMode;
  assistantMessageId?: string | null;
  clientRequestId?: string | null;
  skillId?: string | null;
  // Per-turn skill ids picked via the composer's @-mention popover. The
  // daemon concatenates each skill's body into the system prompt for
  // this run only — they are NOT persisted on the project. Use this to
  // assemble multiple capabilities (e.g. @web-search + @summarize) for
  // a single turn without binding the project to one of them.
  skillIds?: string[];
  designSystemId?: string | null;
  attachments?: string[];
  commentAttachments?: ChatCommentAttachment[];
  model?: string | null;
  reasoning?: string | null;
  /**
   * Run-scoped BYOK provider credentials for the daemon-backed OpenCode
   * adapter. The daemon must not persist this object; it is translated into
   * child env + OPENCODE_CONFIG_CONTENT for the current run only.
   */
  byokProvider?: ByokChatProviderConfig;
  /**
   * Run-scoped BYOK media defaults selected in the chat UI. The daemon uses
   * these to guide OpenCode-backed `od media generate` calls for this run only.
   */
  byokMediaDefaults?: ByokMediaDefaults;
  /** UI locale selected by the client, used by prompt composition for user-visible generated UI. */
  locale?: string;
  research?: ResearchOptions;
  context?: RunContextSelection;
  appliedPluginSnapshotId?: string | null;
  /**
   * Run-scoped media execution policy. Omitted means current Open Design
   * behavior: media generation is enabled and OD may execute its configured
   * local providers.
   */
  mediaExecution?: MediaExecutionPolicy;
  /**
   * Ask the selected run agent to emit a short title for this first turn.
   * The daemon strips the title marker from visible assistant text and falls
   * back to client-side naming when the marker is absent or malformed.
   */
  titleGeneration?: {
    enabled?: boolean;
  };
  /**
   * Run-scoped tool bundle supplied by an external orchestrator.
   * These servers are made available only to the spawned agent for this run
   * and are never written into the persistent Settings MCP registry.
   */
  toolBundle?: RunScopedToolBundle;
  /**
   * Optional analytics context for the v2 run_created / run_finished
   * events. The daemon never trusts these for behavior — they only
   * shape PostHog props. `entryFrom` is one of the documented
   * `entry_from` enums; `designSystemRunContext` carries the
   * DS-variant context (source counts, brand description length
   * bucket, DS origin) used by the design_system_project run shape.
   */
  analyticsHints?: ChatAnalyticsHints;
}

export type ChatAnalyticsEntryFrom =
  | 'new_project'
  | 'chat_composer'
  | 'design_system_create'
  | 'onboarding_design_system'
  | 'regenerate_from_review'
  // A turn started by the "Continue the run" affordance on a resumable failed
  // run. Lets run_created / run_finished isolate resume-continuations so the
  // recovery mechanism's usage and success rate are measurable.
  | 'resume_continue'
  // A turn started from a preview annotation: `comment` is the comment/board
  // pin flow (chat-new-line tool), `mark` is the Mark draw-overlay flow
  // (mark-pen tool). Both edit an existing artifact, so isolating them lets the
  // dashboard separate annotation-driven runs from plain composer sends.
  | 'comment'
  | 'mark'
  // A turn whose composer was seeded by a guided Next-step action (the
  // next-step card prefills a skill/prompt; the run fires on the following
  // Send). Best-effort: the pending tag is consumed by the next send.
  | 'next_step'
  // A turn that submits answers to an inline `<question-form>` clarification
  // (the question still being clarified, not a fresh create/edit intent).
  | 'question_answer';

export type ChatAnalyticsLengthBucket =
  | '0'
  | '1_50'
  | '51_200'
  | '201_500'
  | '500_plus';

export type ChatAnalyticsDesignSystemOrigin =
  | 'onboarding'
  | 'manual_create'
  | 'source_url'
  | 'github_repo'
  | 'local_code'
  | 'fig'
  | 'assets'
  | 'official_preset'
  | 'enterprise'
  | 'template'
  | 'mixed'
  | 'unknown';

export interface ChatAnalyticsDesignSystemRunContext {
  origin?: ChatAnalyticsDesignSystemOrigin;
  sourceCount?: number;
  hasBrandDescription?: boolean;
  brandDescriptionLengthBucket?: ChatAnalyticsLengthBucket;
  githubRepoCount?: number;
  localFolderCount?: number;
  figFileCount?: number;
  assetFileCount?: number;
}

export interface ChatAnalyticsHints {
  entryFrom?: ChatAnalyticsEntryFrom;
  projectKind?:
    | 'prototype'
    | 'live_artifact'
    | 'slide_deck'
    | 'template'
    | 'image'
    | 'video'
    | 'audio'
    | 'design_system'
    | 'other';
  designSystemRunContext?: ChatAnalyticsDesignSystemRunContext;
  // Session-dimension run context, computed client-side and stamped onto
  // run_created / run_finished so a session's run sequence is analysable
  // ("did this session reach an artifact, and on which turn?").
  // `turnIndex` is 0-based within the browser analytics session;
  // `isFirstRun` === (turnIndex === 0). `hasExistingArtifact` is true when the
  // project already had a generated artifact when this run was started
  // (project-scoped) — the run is an edit rather than a first creation.
  turnIndex?: number;
  isFirstRun?: boolean;
  hasExistingArtifact?: boolean;
  // Per-project run turn index (0-based, project-lifetime on this device):
  // "within THIS project, which prompt / follow-up number is this?". Unlike
  // `turnIndex` (session-wide, spans all projects and resets each browser
  // session), this persists in localStorage keyed by project id. Optional:
  // omitted when storage is unavailable (SSR / privacy mode).
  projectTurnIndex?: number;
  // Active execution runtime for THIS run, computed client-side at launch
  // (the only layer that can tell BYOK from amr_cloud). The daemon stamps it
  // onto run_created / run_finished, overriding its own BYOK-blind
  // derivation. Omitted means "let the daemon keep its derived value".
  runtimeType?: TrackingRuntimeType;
  // Analytics-only marker that THIS run is the AI-optimize ("enrich") pass on a
  // programmatically-extracted design system. The web AI-optimize path sets it;
  // the daemon uses it to emit `design_system_enrich_result` and to stamp the
  // `ai_refined` enrichment metadata on success. It carries no execution
  // semantics — omitting it just means the run is not an enrichment pass.
  dsEnrichment?: boolean;
}

export interface RunScopedMcpServerConfig extends Omit<McpServerConfig, 'enabled'> {
  /**
   * Omitted means enabled for this run. The daemon normalizes run-scoped
   * inputs through the same sanitizer as persisted MCP config, but callers
   * should not need to send persisted-settings boilerplate for disposable
   * tool bundles.
   */
  enabled?: boolean;
}

export interface RunScopedToolBundle {
  mcpServers?: RunScopedMcpServerConfig[];
}

export interface RunScopedToolBundleSummary {
  mcpServers: Array<{
    id: string;
    label?: string;
    templateId?: string;
    transport: McpTransport;
    enabled: boolean;
    authMode?: McpAuthMode;
  }>;
}

export type BrowserUseUnavailableReason = 'no-matching-browser-backend';

export type BrowserUseProbeFailureCategory =
  | 'not-probed'
  | 'registry-missing'
  | 'registry-unreadable';

export interface BrowserUseDiscoveryFacts {
  registryPath: string;
  registryExists: boolean;
  socketCount: number;
  candidateCount: number;
  staleCount: number;
  currentSessionIdPresent: boolean | null;
  probeFailureCategory: BrowserUseProbeFailureCategory;
  newestSocketAgeMs?: number;
  staleThresholdMs: number;
}

export interface BrowserUseRunState {
  requested: boolean;
  available: boolean;
  reason?: BrowserUseUnavailableReason;
  diagnostics: BrowserUseDiscoveryFacts;
}

export interface ChatRunCreateRequest extends ChatRequest {
  projectId: string;
  conversationId: string;
  assistantMessageId: string;
  clientRequestId: string;
}

/**
 * Minimal POST /api/runs shape accepted from MCP / SDK callers that do not
 * manage conversation state client-side. Only `projectId` is required;
 * `message` and `agentId` are optional — the daemon resolves `agentId` from
 * the saved app-config when it is omitted.
 */
export interface McpRunCreateRequest {
  projectId: string;
  message?: string;
  agentId?: string;
  skillId?: string;
  pluginId?: string;
  model?: string;
  pluginInputs?: Record<string, unknown>;
  mediaExecution?: MediaExecutionPolicy;
  toolBundle?: RunScopedToolBundle;
}

export const CHAT_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
] as const;

export type ChatRunStatus = (typeof CHAT_RUN_STATUSES)[number];

/** User-facing result delivery, kept separate from agent-process runStatus. */
export type ResultDeliveryState = 'delivered' | 'no_result' | 'delivery_failed';

export type ChatMessageFeedbackRating = 'positive' | 'negative';

export type ChatMessageFeedbackReasonCode =
  | 'matched_request'
  | 'strong_visual'
  | 'useful_structure'

exec
/bin/bash -lc "sed -n '1,280p' packages/contracts/src/api/registry.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
export type ModelCost = 'low' | 'medium' | 'high' | 'very_high';

export type ModelCapability = 'standard' | 'advanced' | 'best_quality';

export interface ModelMetadata {
  cost?: ModelCost;
  capability?: ModelCapability;
}

export interface AgentModelOption {
  id: string;
  label: string;
  /** Whether the current account/tier can use this model. */
  enabled?: boolean;
  /** Whether this is the default model for the current account/tier. */
  default?: boolean;
  /** USD price per 1M input tokens when reported by the provider/catalog. */
  inputPriceUsdPerMillion?: number;
  /** USD price per 1M output tokens when reported by the provider/catalog. */
  outputPriceUsdPerMillion?: number;
  /** Provider/catalog-owned model picker metadata. */
  metadata?: ModelMetadata;
}

/**
 * A typed "what should the UI do to fix this" intent attached to an
 * {@link AgentDiagnostic}. The UI renders a button per intent and owns the
 * concrete handler (open a URL, re-run detection, write an env override,
 * launch the OAuth terminal flow). Keeping the intent typed — rather than a
 * pre-baked button label + URL — means the Settings card, the unavailable
 * grid, and (PR-B) the `od agent healthcheck` CLI / health-check panel all
 * render the same fix affordances from one source of truth instead of each
 * re-deriving copy and wiring.
 */
export type AgentFixIntent =
  /** Open the agent's configuration / auth docs (`AgentInfo.docsUrl`). */
  | { kind: 'openDocs' }
  /** Open the agent's install / download page (`AgentInfo.installUrl`). */
  | { kind: 'openInstall' }
  /** Re-run agent detection (the Settings "Rescan" affordance). */
  | { kind: 'rescan' }
  /**
   * Prompt the user to point Open Design at an explicit binary by writing
   * `envKey` (e.g. `CURSOR_AGENT_BIN`) into `agentCliEnv`. Used when the CLI
   * is installed somewhere PATH detection can't reach.
   */
  | { kind: 'setEnv'; envKey: string }
  /** Clear a previously-set binary override so detection falls back to PATH. */
  | { kind: 'clearEnv'; envKey: string }
  /**
   * Launch the agent's interactive sign-in in a system terminal (today only
   * Antigravity's `agy`, via POST /api/agents/:id/oauth-launch).
   */
  | { kind: 'launchOAuth'; agentId: string };

/**
 * Why a CLI agent is unavailable or only partially usable, in a shape the UI
 * can render as "one-line reason + fix button(s)" instead of a silent grey
 * card. Emitted by daemon detection (PATH / executable resolution + the auth
 * probe) and reused by the connection-test / health-check surfaces so a
 * failure is always actionable.
 */
export type AgentDiagnosticReason =
  /** The binary (and any fallback names) was not found on PATH. */
  | 'not-on-path'
  /** A file matched but is not executable (missing +x / wrong PATHEXT). */
  | 'not-executable'
  /** A wrapper/shim was found but its target is gone (exit 126/127). */
  | 'shim-broken'
  /** A user-set `*_BIN` override points at a missing/invalid file. */
  | 'configured-bin-invalid'
  /** Installed and invocable, but the CLI is not authenticated. */
  | 'auth-missing'
  /** Installed, but auth status could not be verified. */
  | 'auth-unknown';

export type AgentDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface AgentDiagnostic {
  reason: AgentDiagnosticReason;
  severity: AgentDiagnosticSeverity;
  /** Short, human-readable, single-sentence explanation. */
  message: string;
  /** Optional longer context (e.g. the probe's stderr tail). */
  detail?: string;
  /**
   * Directories PATH detection searched, surfaced verbatim for the
   * `not-on-path` case so the user can see where we looked before being
   * asked to set an explicit binary path. Sourced from the daemon resolver,
   * never recomputed in the client.
   */
  searchedDirs?: string[];
  /** Ordered fix affordances the UI should offer for this diagnostic. */
  fixActions?: AgentFixIntent[];
}

export interface AgentInfo {
  id: string;
  name: string;
  bin: string;
  available: boolean;
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
  path?: string;
  version?: string | null;
  /**
   * Actionable reasons this agent is unavailable or only partially usable,
   * each carrying typed fix intents. Empty / omitted means "healthy"
   * (available and, where probed, authenticated).
   */
  diagnostics?: AgentDiagnostic[];
  models?: AgentModelOption[];
  /** Whether models came from the installed CLI or Open Design's static fallback. */
  modelsSource?: 'live' | 'fallback';
  reasoningOptions?: AgentModelOption[];
  /** HTTPS URL to install or download the CLI (vendor docs, GitHub README, npm). */
  installUrl?: string;
  /** Optional HTTPS URL for configuration / auth / usage docs. */
  docsUrl?: string;
  /**
   * How the daemon forwards the user's `.od/mcp-config.json` external MCP
   * servers to this runtime at spawn time. Mirrors the field on
   * `RuntimeAgentDef` in the daemon. Undefined means the runtime has no
   * native MCP transport wired yet, in which case the settings UI surfaces
   * a "configure MCP in the agent's own config file" hint instead of
   * silently dropping the servers (issue #2142).
   */
  externalMcpInjection?:
    | 'claude-mcp-json'
    | 'acp-merge'
    | 'opencode-env-content';
  /**
   * When `false`, the Settings model picker hides the "Custom (fill below)"
   * option and the free-text input. Use this for agents whose CLI doesn't
   * accept a model id (e.g. Antigravity `agy` has no `--model` flag yet —
   * upstream issue #35) or rejects free-form ids (AMR validates against the
   * live Vela catalog). Undefined === allow, matching the historical UX.
   */
  supportsCustomModel?: boolean;
}

export interface AgentsResponse {
  agents: AgentInfo[];
}

export type AmrModelsSource = 'preset' | 'remote';

export interface AmrModelsResponse {
  source: AmrModelsSource;
  models: AgentModelOption[];
  refreshing: boolean;
  stale?: boolean;
  remoteError?: string;
}

export type SkillSource = 'built-in' | 'user';

export interface SkillSummary {
  id: string;
  name: string;
  displayName?: Record<string, string>;
  description: string;
  descriptionI18n?: Record<string, string>;
  triggers: string[];
  mode:
    | 'prototype'
    | 'deck'
    | 'template'
    | 'design-system'
    | 'image'
    | 'video'
    | 'audio';
  surface?: 'web' | 'image' | 'video' | 'audio';
  platform?: 'desktop' | 'mobile' | null;
  scenario?: string | null;
  // Optional human-readable category (e.g. "image-generation", "video",
  // "design-systems"). Surfaced as a filter pill in Settings → Skills so a
  // large pre-loaded catalogue stays scannable. Free-form lowercase slug;
  // not part of system-prompt composition.
  category?: string | null;
  // Origin of the skill: 'built-in' lives under the repo's `skills/`
  // directory and cannot be deleted from the UI; 'user' lives under
  // `<runtimeData>/user-skills/` and is fully owned by the user (delete
  // / re-import allowed). New `import` endpoint always tags `user`.
  source?: SkillSource;
  previewType: string;
  designSystemRequired: boolean;
  defaultFor: string[];
  upstream: string | null;
  featured?: number | null;
  fidelity?: 'wireframe' | 'high-fidelity' | null;
  speakerNotes?: boolean | null;
  animations?: boolean | null;
  craftRequires?: string[];
  hasBody: boolean;
  examplePrompt: string;
  examplePromptI18n?: Record<string, string>;
  // True when this skill exists only to group derived `<parent>:<child>`
  // example cards. The Examples gallery hides such cards because their
  // preview would duplicate one of the derived cards and add no extra
  // information, but the entry stays in the listing so `findSkillById`
  // resolves the parent for system-prompt composition and "Use this
  // prompt" fast-create on a derived card still composes the parent's
  // SKILL.md body.
  aggregatesExamples: boolean;
}

// Body shape for POST /api/skills/import. The daemon turns this into a
// SKILL.md under `<runtimeData>/user-skills/<slug>/` and surfaces the
// freshly-listed summary in the response.
export interface SkillImportRequest {
  name: string;
  description?: string;
  body: string;
  triggers?: string[];
}

export interface SkillImportResponse {
  skill: SkillSummary;
}

// Body for PUT /api/skills/:id — update an existing skill's SKILL.md.
// The route param resolves to the canonical skill id; the daemon refuses
// updates whose body `name` differs from that id (rename = delete +
// re-import).
export interface SkillUpdateRequest {
  name?: string;
  description?: string;
  body: string;
  triggers?: string[];
}

export interface SkillUpdateResponse {
  skill: SkillSummary;
}

// Returned by GET /api/skills/:id/files — the on-disk file tree under
// the skill's directory, capped to a small number of entries to keep
// the payload bounded. Used by the Settings → Skills detail panel.
export interface SkillFileEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number | null;
}

export interface SkillFilesResponse {
  files: SkillFileEntry[];
}

export interface SkillDetail extends SkillSummary {
  body: string;
}

export interface SkillsResponse {
  skills: SkillSummary[];
}

export interface SkillResponse {
  skill: SkillDetail;
}

// Design templates share the SkillSummary/Detail shape (same SKILL.md
// frontmatter, same preview behavior) but live under a separate registry
// root so the EntryView Templates surface and the Settings → Skills surface
// stay decoupled. See specs/current/skills-and-design-templates.md.
export type DesignTemplateSummary = SkillSummary;
export type DesignTemplateDetail = SkillDetail;

export interface DesignTemplatesResponse {
  designTemplates: DesignTemplateSummary[];
}

export interface DesignTemplateResponse {
  designTemplate: DesignTemplateDetail;
}

export interface DesignSystemSummary {
  id: string;
  title: string;
  category: string;

exec
/bin/bash -lc "sed -n '1,280p' apps/daemon/src/routes/chat.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
import type { Express } from 'express';
import type { RouteDeps } from '../server-context.js';
import { seedProviderIfMissing } from '../media/config.js';
import {
  buildLegacyMaxTokensParam,
  buildMaxCompletionTokensParam,
  buildOpenAIChatTokenParam,
  isUnsupportedMaxTokensError,
} from '../integrations/openai-chat-token-params.js';
import {
  BYOK_SENSEAUDIO_TOOLS,
  BYOK_AIHUBMIX_TOOLS,
  executeGenerateImage,
  executeGenerateSpeech,
  executeGenerateVideo,
  executeAIHubMixGenerateImage,
  executeAIHubMixGenerateSpeech,
  executeAIHubMixGenerateVideo,
  isSenseAudioImageModel,
  isAIHubMixImageModel,
  isAIHubMixVideoModel,
  isAIHubMixSpeechModel,
  type BYOKToolContext,
  type ImageToolResult,
} from '../byok-tools.js';
import {
  AIHUBMIX_DEFAULT_BASE_URL,
  aihubmixHeaders,
  aihubmixAppCodeHeader,
  aihubmixOriginFromBase,
  classifyAIHubMixModel,
} from '../integrations/aihubmix.js';
import { isSafeId as isSafeProjectId } from '../projects.js';
import { projectKindToTracking } from '@open-design/contracts/analytics';
import { proxyDispatcherRequestInit, validateUserProviderBaseUrl } from '../connectionTest.js';
import { googleStreamGenerateContentUrl } from '../integrations/google-models.js';
import { createRoleMarkerGuard } from '../role-marker-guard.js';
import { authorizeReasoningEgress, sendReasoningEgressDenial } from '../reasoning-egress.js';

// Allowlist for the `/feedback` route. Mirrors the
// ChatMessageFeedbackReasonCode union in packages/contracts/src/api/chat.ts.
// Kept inline (not imported as a runtime value, since the contract type is
// type-only) so a stale client can't poison Langfuse with unknown categories.
const FEEDBACK_REASON_ALLOWLIST: ReadonlySet<string> = new Set([
  'matched_request',
  'strong_visual',
  'useful_structure',
  'easy_to_continue',
  'followed_design_system',
  'missed_request',
  'weak_visual',
  'incomplete_output',
  'hard_to_use',
  'missed_design_system',
  'other',
]);

export interface RegisterChatRoutesDeps extends RouteDeps<'db' | 'design' | 'http' | 'chat' | 'agents' | 'critique' | 'validation' | 'lifecycle' | 'paths' | 'telemetry'> {}

export function registerChatRoutes(app: Express, ctx: RegisterChatRoutesDeps) {
  const { db, design } = ctx;
  const { sendApiError, createSseResponse } = ctx.http;
  const { testProviderConnection, testAgentConnection, getAgentDef, isKnownModel, sanitizeCustomModel, listProviderModels } = ctx.agents;
  const {
    handleCritiqueArtifact,
    handleCritiqueInterrupt,
    critiqueArtifactsRoot,
    critiqueResponseCapBytes,
    critiqueRunRegistry,
  } = ctx.critique;
  const rejectProxyPluginContext = (body: Record<string, unknown>, res: any) => {
    if (
      (typeof body.pluginId === 'string' && body.pluginId.trim().length > 0) ||
      (
        typeof body.appliedPluginSnapshotId === 'string' &&
        body.appliedPluginSnapshotId.trim().length > 0
      )
    ) {
      sendApiError(
        res,
        409,
        'PLUGIN_REQUIRES_DAEMON',
        'Plugin runs must go through POST /api/runs so the daemon can resolve and pin the applied plugin snapshot.',
      );
      return true;
    }
    return false;
  };

  // Run lifecycle routes live in `routes/runs.ts`; this file owns feedback,
  // connection tests, critique handoff, and provider proxy routes.

  // Receives the user's thumbs-up/down (+ reason codes) for an assistant
  // turn and forwards it to Langfuse as a `score-create`. Web persists the
  // feedback itself via PUT /messages/:id; this endpoint exists only as a
  // telemetry side channel — the daemon is the single network egress for
  // Langfuse and gates on `telemetry.metrics + telemetry.content` consent.
  //
  // The consent + sink decision is fast (awaits a small file read, no
  // network); we await it so the response status honestly reflects whether
  // the score was enqueued, skipped for consent, or skipped because no
  // Langfuse sink is configured. The actual Langfuse network call happens
  // as a detached promise inside the bridge.
  app.post('/api/runs/:id/feedback', async (req, res) => {
    const runId = req.params.id;
    const body = (req.body ?? {}) as Partial<{
      projectId: string;
      conversationId: string;
      assistantMessageId: string;
      rating: 'positive' | 'negative';
      reasonCodes: string[];
      hasCustomReason: boolean;
      customReason: string;
    }>;
    if (!runId) {
      return sendApiError(res, 400, 'INVALID_RUN_ID', 'runId missing');
    }
    if (body.rating !== 'positive' && body.rating !== 'negative') {
      return sendApiError(res, 400, 'INVALID_RATING', 'rating must be positive or negative');
    }
    // Drop anything outside the contract-side reason allowlist and
    // deduplicate; otherwise a malformed or replayed client payload could
    // create unknown Langfuse categories or duplicate score ids in the
    // same batch.
    const reasonCodes = Array.isArray(body.reasonCodes)
      ? Array.from(
          new Set(
            body.reasonCodes.filter(
              (c): c is string =>
                typeof c === 'string' && FEEDBACK_REASON_ALLOWLIST.has(c),
            ),
          ),
        )
      : [];
    const customReason = typeof body.customReason === 'string' ? body.customReason : '';
    const reportFeedback = ctx.telemetry?.reportFeedback;
    if (!reportFeedback) {
      res.status(202).json({ status: 'skipped_no_sink' });
      return;
    }
    // Build score metadata bag that lands in the Langfuse score body.
    // Mirrors the PostHog event so analysts can cross-reference.
    const scoreMetadata: Record<string, unknown> = {
      projectId: body.projectId,
      conversationId: body.conversationId,
      assistantMessageId: body.assistantMessageId,
      hasCustomReason: body.hasCustomReason === true,
      customReason,
    };
    const outcome = await reportFeedback({
      runId,
      rating: body.rating,
      reasonCodes,
      hasCustomReason: body.hasCustomReason === true,
      customReason,
      scoreMetadata,
    });
    res.status(202).json(outcome);
  });

  // ---- Connection tests (single-shot JSON; no SSE) ------------------------
  // Settings dialog uses these to verify a config works without sending a
  // real chat. Always return HTTP 200 with `ok: false` on upstream-caused
  // failures so the web layer can render a categorized inline status without
  // unwrapping nested error envelopes; real 4xx/5xx here mean a malformed
  // request or daemon bug.
  app.post('/api/provider/models', async (req, res) => {
    const controller = new AbortController();
    const abortIfRequestAborted = () => {
      if ((req.aborted || !req.complete) && !res.writableEnded) {
        controller.abort();
      }
    };
    const abortIfResponseClosed = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.on('close', abortIfRequestAborted);
    res.on('close', abortIfResponseClosed);
    const body = req.body || {};
    const protocol = body.protocol;
    if (
      typeof protocol !== 'string' ||
      !['anthropic', 'openai', 'azure', 'google', 'ollama', 'senseaudio', 'aihubmix', 'bedrock'].includes(protocol)
    ) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'protocol must be one of anthropic|openai|azure|google|ollama|senseaudio|aihubmix|bedrock',
      );
    }
    // AIHubMix's catalogue (GET /api/v1/models?type=llm) is public, so its
    // model list loads without a key. Every other protocol needs the key to
    // hit its /v1/models endpoint.
    const apiKeyRequired = protocol !== 'aihubmix' && protocol !== 'bedrock';
    if (
      typeof body.baseUrl !== 'string' ||
      typeof body.apiKey !== 'string' ||
      !body.baseUrl.trim() ||
      (apiKeyRequired && !body.apiKey.trim())
    ) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        apiKeyRequired ? 'baseUrl and apiKey are required' : 'baseUrl is required',
      );
    }
    const reasoningDenial = authorizeReasoningEgress({
      policy: body.reasoningExecution,
      routeKind: 'provider_models',
      provider: protocol,
      resolvedBaseUrl: body.baseUrl,
    });
    if (reasoningDenial) return sendReasoningEgressDenial(res, reasoningDenial);
    try {
      const proxyDispatcher = proxyDispatcherRequestInit();
      try {
        const result = await listProviderModels({
          protocol,
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
          apiVersion:
            typeof body.apiVersion === 'string' ? body.apiVersion : undefined,
          signal: controller.signal,
          requestInit: proxyDispatcher.requestInit,
        });
        return res.json(result);
      } finally {
        await proxyDispatcher.close();
      }
    } catch (err: any) {
      console.warn(
        `[provider:models] uncaught: ${err instanceof Error ? err.message : String(err)}`,
      );
      return sendApiError(res, 500, 'INTERNAL', 'Provider model discovery failed');
    } finally {
      req.off('close', abortIfRequestAborted);
      res.off('close', abortIfResponseClosed);
    }
  });

  app.post('/api/test/connection', async (req, res) => {
    const controller = new AbortController();
    const abortIfRequestAborted = () => {
      if ((req.aborted || !req.complete) && !res.writableEnded) {
        controller.abort();
      }
    };
    const abortIfResponseClosed = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.on('close', abortIfRequestAborted);
    res.on('close', abortIfResponseClosed);
    const body = req.body || {};
    try {
      if (body.mode === 'provider') {
        const protocol = body.protocol;
        if (
          typeof protocol !== 'string' ||
          !['anthropic', 'openai', 'azure', 'google', 'ollama', 'senseaudio', 'aihubmix', 'bedrock'].includes(protocol)
        ) {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'protocol must be one of anthropic|openai|azure|google|ollama|senseaudio|aihubmix|bedrock',
          );
        }
        const apiKeyRequired = protocol !== 'bedrock';
        if (
          typeof body.baseUrl !== 'string' ||
          typeof body.apiKey !== 'string' ||
          typeof body.model !== 'string' ||
          !body.baseUrl.trim() ||
          (apiKeyRequired && !body.apiKey.trim()) ||
          !body.model.trim()
        ) {
          return sendApiError(
            res,

exec
/bin/bash -lc "rg --files apps/daemon/tests apps/web/tests | rg 'sse-shape|chat.*event|artifact.*parser|question-form|ChatPane|ChatComposer' | sed -n '1,220p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/web/tests/artifacts/question-form.test.ts
apps/web/tests/artifacts/parser.test.ts
apps/web/tests/components/ChatPane.connect-repo.test.tsx
apps/web/tests/components/ChatComposer.infinite-render.test.tsx
apps/web/tests/components/ChatPane.resume-failed.test.tsx
apps/web/tests/components/ChatComposer.context-pickers.test.tsx
apps/web/tests/components/ChatPane.imported-folder-artifacts.test.tsx
apps/web/tests/components/ChatPane.conversation-title.test.tsx
apps/web/tests/components/ChatPane.conversation-msg-count.test.tsx
apps/web/tests/components/ChatComposer.search.test.tsx
apps/daemon/tests/plugins-discovery-question-form-contract.test.ts
apps/web/tests/runtime/chat-events.test.ts
apps/web/tests/components/ChatPane.amr-auth-inline.test.tsx
apps/web/tests/components/ChatComposer.design-toolbox.test.tsx
apps/web/tests/components/ChatPane.streaming.test.tsx

codex
# Executive Recommendation

Choose a **package-first strangler extraction**: keep current upstream Open Design as the behavioral authority, build Jini as a clean publishable-package monorepo, and transfer one contract-tested capability at a time. Do not use the copied Open Design tree currently in Jini as the engine foundation: it still has Open Design remotes and package identities, contains extensive product content, and its active `apps/web/src` is a broken symlink to another repository. A greenfield rewrite would discard hard-won runtime behavior; copy-then-refactor would preserve every hidden product coupling; subtree/federation would make ownership and releases ambiguous. The strangler approach gives early value, preserves rollback paths, and makes each capability have exactly one owner after cutover.

## Verified Repository Evidence

- Open Design is at commit `f65eea0343014bd8dad179dd4701c5eb02e18df4` on `refactor/web-memory-slice`. Against the locally available `origin/main`, it is 36 commits ahead and 52 behind; it is one commit behind the fork branch.
- Open Design has untracked `ADS-project-knowledge/`, `apps/web/coverage/`, and the porting-plan document. It also has one stash from `refactor/web-chat-composer-slice`.
- Jini is at commit `478a85577aff5aff6d98e3aed8214fafc5003af5` on `integrated`; both remotes still point to Open Design. Its web source is represented as hundreds of deletions plus `apps/web/src -> /Users/la/Desktop/Programming/Tovu/web/src`, currently a broken symlink, and `apps/web/src.orig/`.
- Open Design’s working checkout is about 5.5 GB, including a 1.6 GB `.git`. A normal vendored copy is therefore unsuitable, even though a clean partial clone would be much smaller.
- The current composition roots remain exceptionally large and untyped: [server.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server.ts:1) is 8,635 lines and begins with `@ts-nocheck`; [cli.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/cli.ts) is 10,071 lines. `ChatPane`, `ChatComposer`, and `App` are 4,342, 5,608, and 2,677 lines respectively.
- Good seams already exist: [server-context.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server-context.ts), domain route registrars, [runtime definitions](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/defs), pure contracts, `platform`, `sidecar`, and `components`.
- The runtime system already models discovery, auth probing, model listing, prompt transports, native resume, ACP resume, MCP injection, and stream parsing in [runtimes/types.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/types.ts). This is the strongest initial extraction seam.
- The current run service remains process-memory-first with optional JSONL event logs and a 30-minute default TTL; see [runtimes/runs.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/runs.ts:1). Jini needs a durable event store rather than copying that lifecycle unchanged.
- The memory vertical-slice ADR and implementation are useful evidence, but not a universal template. See [ADR 0002](/Users/la/Desktop/Programming/OSS-Repos/open-design/docs/adr/0002-frontend-vertical-slice-decomposition.md) and `apps/web/src/features/memory/`.
- Codebase reports are not currently cloud-ready: CodeGraph databases are local ignored SQLite files of about 157 MB and 587 MB; Understand Anything has only intermediate scan/batch data, without a final `knowledge-graph.json` or `meta.json`; the Codebase Memory MCP entry for this checkout reports zero nodes and no root path.

# Controlling Questions — Direct Answers

**Jini repository strategy.** Use one Jini monorepo containing publishable packages, reference applications, the project runner, and the Open Design compatibility metadata. Open Design stays in its own repository. Do not retain a full reference checkout in Git; recreate an ignored sparse/partial clone on demand from a pinned source manifest. Preserve the current dirty Jini state before establishing a clean engine branch.

**Daemon architecture and portability.** The current daemon is not directly portable: it combines agent execution, conversations, runs, projects, skills, design systems, plugins, media, memory, telemetry, static serving, filesystem policy, and Open Design routes. Jini should make an embeddable application core primary, then expose HTTP, CLI, and sidecar adapters. Product behavior enters through typed ports at a composition root.

**Frontend architecture and reusable UI.** Extract a headless chat/artifact model first, followed by React components driven by transports and slots. Do not export `ChatPane` or `ChatComposer` wholesale. Jini packages must not depend on Next.js, Open Design projects, daemon URLs, analytics, design systems, plugins, or global CSS.

**Automation and cloud execution.** Use the repo-local `project-runner` as a pull-based state machine, with Codex and Claude as the initial execution backends. CI validates changes but does not own planning or leases. Tasks are claimed atomically, run in isolated branches/worktrees, and handed off through durable attempt records.

**Durable task/session ledger.** Commit task definitions, dependencies, decisions, validation specifications, final results, and concise handoffs. Keep lease tokens, credentials, raw model transcripts, local worktree paths, verbose logs, and temporary indexes ephemeral. Use atomic remote Git refs for cross-machine leases and local file locks when offline.

**Codebase-understanding reports.** Commit small, source-stamped architecture summaries, symbol indexes, seam maps, hotspot reports, and manifests. Store full SQLite/embedding databases locally or in object storage. A freshness check must reject reports whose source commit differs from the task’s required commit.

**AI-Dev-Shop and governance.** Keep `AI-Dev-Shop/` top-level as a pinned vendored subtree/snapshot with provenance. It defines roles, approval gates, specs, and review policy. `project-runner/` owns execution state, leasing, validation, and resumability. They must not maintain competing task lists.

**Reference repository size and provenance.** Do not commit `references/open-design/`, use a submodule, or copy the tree. Commit an upstream lock and source map; let the runner create an ignored sparse partial clone. Preserve authorship with history-aware patch transfer and record the original repository, commit, path, license, and modification notice.

**Compatibility, releases, and operations.** Version schemas and adapter interfaces independently with SemVer, runtime validation, negotiated protocol versions, conformance suites, golden mock traces, canary releases, and exact dependency pins during adoption. Every cutover retains a legacy switch until parity and recovery criteria pass.

**Cost and model use.** Prefer deterministic analysis first, then small/mini models for bounded summaries and mechanical transformations. Use strong reasoning models for boundary decisions, security reviews, migrations, parser/resume semantics, and final compatibility judgment. Refresh expensive graphs only when source structure changes materially.

# Proposed Repository Topology

```text
Jini/
├── .github/
├── AGENTS.md
├── LICENSE
├── NOTICE
├── package.json
├── pnpm-workspace.yaml
├── AI-Dev-Shop/                    # pinned vendored subtree/snapshot
├── ADS-project-knowledge/          # specs, ADRs, approvals, retained reports
├── project-runner/
│   ├── package.json
│   ├── config.yaml
│   ├── schemas/
│   ├── src/
│   │   ├── ledger/
│   │   ├── leases/
│   │   ├── sessions/
│   │   ├── git/
│   │   ├── context/
│   │   ├── runners/
│   │   └── validation/
│   ├── ledger/
│   │   ├── tasks/
│   │   ├── sessions/
│   │   └── compatibility/
│   └── tests/
├── packages/
│   ├── protocol/
│   ├── engine/
│   ├── runtime/
│   ├── runtime-node/
│   ├── persistence-sqlite/
│   ├── platform-node/
│   ├── daemon-node/
│   ├── client/
│   ├── cli/
│   ├── artifacts/
│   ├── chat-react/
│   └── sidecar/
├── integrations/
│   └── open-design/
│       ├── README.md
│       ├── upstream.lock.yaml
│       ├── ownership.yaml
│       ├── source-map.yaml
│       ├── compatibility/
│       └── migration-notes/
├── apps/
│   ├── reference-daemon/
│   └── reference-web/
├── examples/
│   ├── minimal-node/
│   └── minimal-react/
├── context/
│   ├── index.yaml
│   ├── current/
│   └── snapshots/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── migration/
│   ├── security/
│   └── releases/
└── tools/
    ├── context-export/
    ├── provenance/
    └── compatibility/
```

There should be no committed Open Design checkout inside this tree.

# Package and Module Boundaries

| Package | Responsibility and public API | Dependencies allowed | Dependencies forbidden | First consumer |
|---|---|---|---|---|
| `@jini/protocol` | Versioned DTOs, JSON Schemas, `RunEventV1`, errors, runtime descriptors | TypeScript, schema validator | Node, React, Express, SQLite, product types | All packages |
| `@jini/engine` | `JiniEngine`, run/conversation services, ports, lifecycle policy | `protocol` | Express, subprocess APIs, concrete stores, product prompts | Reference daemon |
| `@jini/runtime` | `RuntimeAdapterV1`, registry, normalized event model, capability negotiation | `protocol` | Node process APIs, product routes | `runtime-node` |
| `@jini/runtime-node` | CLI discovery, invocation, built-in runtime adapters, parser wiring | `runtime`, `platform-node` | Open Design data/project/plugin modules | Reference daemon |
| `@jini/persistence-sqlite` | Durable conversation, run, event, session-handle stores | `engine`, `protocol`, SQLite | HTTP, UI, runtime-specific behavior | Reference daemon |
| `@jini/platform-node` | Filesystem, subprocess, environment, path, process-control primitives | Node standard library | Product identifiers and route contracts | `runtime-node` |
| `@jini/daemon-node` | Composition helper and versioned HTTP/SSE transport | `engine`, stores, runtime, protocol | Product routes and UI | Reference daemon, OD |
| `@jini/client` | `JiniClient`, transport interface, HTTP implementation | `protocol` | React, Next.js, filesystem | Reference web |
| `@jini/cli` | Machine-readable client commands and embeddable CLI dispatcher | `client`, `protocol` | Product command trees | Reference app |
| `@jini/artifacts` | Artifact parser, manifests, headless renderer registry, question-form model | `protocol` where needed | React, iframe policy, OD file URLs | Reference web |
| `@jini/chat-react` | Provider, hooks, message list, composer primitives, slots, CSS variables | React peer, `client`, `artifacts`, `protocol` | Next.js, OD state/providers, analytics | Reference web |
| `@jini/sidecar` | Product-neutral bootstrap, IPC, runtime descriptors and shutdown | `platform-node`, `protocol` | Fixed app names, channel names, OD paths | Reference daemon |

A package is not created merely to hold one helper. These packages correspond to different runtime environments, security boundaries, or release contracts.

# Daemon Core and Adapter Design

The primary API is the embeddable library:

```text
Open Design composition root
  ├── OpenDesignProjectPort
  ├── OpenDesignPromptAugmenter
  ├── OpenDesignArtifactPolicy
  ├── OpenDesignCredentialPolicy
  └── OpenDesignTelemetrySink
           ↓
       JiniEngine
  ├── RunCoordinator
  ├── ConversationService
  ├── RuntimeRegistry
  ├── ArtifactService
  └── DurableEventStore
           ↓
  Node / SQLite / HTTP / sidecar adapters
```

Core ports should include:

- `RunStore`, `RunEventStore`, `ConversationStore`, `RuntimeSessionStore`
- `WorkspacePort` and `WorkspaceAuthorizationPolicy`
- `ArtifactStore` and `ArtifactPolicy`
- `ProcessLauncher`, `Clock`, `IdGenerator`, `CredentialStore`
- `PromptAugmenter`, `ContextProvider`, `TelemetrySink`
- `RuntimeRegistry` and `RuntimeAdapterResolver`

The daemon should expose all four requested forms:

- Embeddable library: authoritative application API.
- HTTP/SSE: versioned `/v1/*` transport over the same services.
- CLI: normally an HTTP client; an explicit embedded mode can be added later.
- Sidecar: discovery, bootstrap, health, shutdown, and runtime descriptor.

Default network binding should be `127.0.0.1:0`, with the actual port written to a protected runtime descriptor. Explicit `--host` and `--port` remain available. Ports must never influence persistent path identity.

Open Design product routes—brands, design systems, marketplace, memory, media, critique, deployment, updater behavior—mount beside Jini’s routes at the Open Design composition root.

The old rewrite branches are evidence, not merge candidates:

- `arch/chat-run-extraction` contains useful SSE characterization commits `75fd4afa4` and `780917104`. Port the tests and dependency inventory.
- Its `510a243e6` extraction still moves about 3,400 untyped lines behind `deps: any`; do not adopt it as the Jini runtime.
- `arch/server-startserver-endgame` at `f1aabe9e5` identifies useful seams such as SSE, request guards, prompt composition, telemetry, and chat request composition. It is 258 locally known upstream commits behind `origin/main`, so reimplement the seams against current source.
- The older `fork/refactor/daemon-server-*`, `fork/server-ts`, and project-route branches are even more divergent. Do not merge them wholesale.
- Current upstream route registrars, `ServerContext`, runtime definitions, parser modules, and mock traces are the correct starting evidence.

# Agent and CLI Discovery Design

`RuntimeAdapterV1` should preserve differences rather than collapse them:

```ts
interface RuntimeAdapterV1 {
  manifest: RuntimeManifestV1;
  discover(ctx: DiscoveryContext): Promise<InstallationCandidate[]>;
  probe(candidate: InstallationCandidate): Promise<RuntimeInstallation>;
  listModels?(installation: RuntimeInstallation): Promise<ModelCatalog>;
  prepareRun(input: PrepareRunInput): Promise<PreparedInvocation>;
  parse(streams: InvocationStreams): AsyncIterable<RunEventV1>;
  cancel(controller: InvocationController): Promise<void>;
  sendInput?(controller: InvocationController, input: MidTurnInput): Promise<void>;
  resume?(input: ResumeInput): Promise<PreparedInvocation>;
}
```

Capability fields should be discriminated values, not unrelated booleans:

```text
prompt: argv | stdin-text | stdin-jsonl | file
events: plain | jsonl | claude-stream | acp-json-rpc
resume: none | specified-id | captured-id | acp-load
midTurnInput: none | jsonl
models: static | command | remote
mcp: none | config-file | env-content | acp-merge
cancellation: signal | process-group | protocol
```

Source of truth:

- Adapter manifests in package code define supported behavior.
- A persisted detection snapshot reports what is actually installed.
- A launch always revalidates the selected executable and workspace policy.

Suggested SQLite record:

```text
runtime_installation(
  adapter_id, installation_id, canonical_path, path_fingerprint,
  version, auth_status, capabilities_json, models_json, models_source,
  config_hash, detected_at, expires_at, last_error_code
)
```

Refresh policy:

- Asynchronous scan at daemon startup.
- User/CLI-triggered refresh through the same `/v1/runtimes/refresh` API.
- Invalidate on PATH/configured-binary/config-hash changes.
- Five-minute availability/auth freshness; longer model-catalog freshness where probing is costly.
- Persisted results may render immediately as `stale: true`, but cannot authorize a spawn.

Security:

- Canonicalize paths and verify executable permissions.
- Never accept an unvalidated executable path from browser payloads.
- Keep credential values server-side and return only status.
- Redact environment, argv secrets, and native session handles from logs.
- Bind all UI and CLI consumers to the same runtime registry API.

# Frontend Feature-Slice and Reusable UI Design

Use three layers:

1. `@jini/artifacts`: pure artifact parsing, manifests, question forms, and renderer selection.
2. Headless chat state inside `@jini/chat-react`: reducer/controllers usable through hooks.
3. Presentational React components with explicit slots.

Core client contract:

```ts
interface ChatClient {
  createRun(input: CreateRunInput): Promise<RunHandle>;
  streamRun(runId: string, after?: number): AsyncIterable<RunEventV1>;
  cancelRun(runId: string): Promise<void>;
  sendRunInput?(runId: string, input: MidTurnInput): Promise<void>;
  loadConversation(id: string): Promise<Conversation>;
  listRuntimes(): Promise<RuntimeDescriptorV1[]>;
}
```

Required product slots/adapters:

- `scopeProvider` for project/workspace context
- `runtimePicker`, `modelPicker`, and capability-aware controls
- `attachmentResolver` and attachment renderer
- `artifactRegistry` and `filePreviewAdapter`
- `toolRendererRegistry`
- `questionFormHandler`
- `commentsAdapter` and `feedbackSink`
- `analyticsSink`
- `composerActions`
- design tokens/class-name hooks

The reusable package should use React peer dependencies, standard web APIs behind injected transports, CSS Modules/CSS variables, and no Next.js APIs. A Vite reference application must consume it.

## Frontend extraction sequence

1. Add characterization tests for artifact parsing, question forms, message ordering, Todo snapshots, queues, errors, attachments, and composer payloads.
2. Extract pure artifact types/parsers from `apps/web/src/artifacts/*`.
3. Move run-event folding, tool deduplication, message derivation, and conversation state into pure reducers.
4. Introduce `ChatClient` while the Open Design implementation still calls existing daemon providers.
5. Split `ChatPane` into controller, render-item builder, message list, message row, pinned-state region, and product slots.
6. Split `ChatComposer` into draft model, submit builder, input component, attachment tray, capability controls, and product action slots.
7. Extract generic message, question-form, tool-shell, artifact-shell, and composer components.
8. Build the Vite reference application using a fake/in-memory transport.
9. Publish a canary package and switch Open Design behind a feature flag.
10. Remove legacy components only after visual, accessibility, streaming, and compatibility parity.

Expected frontend effort is roughly 14–25 engineer-weeks, with 8–14 calendar weeks if work overlaps. Composer and file/artifact behavior create the largest uncertainty.

# Open Design Integration Strategy

Maintain an ownership manifest per capability:

```yaml
runtime-registry:
  state: od-owned | shadowed | jini-owned
  source_commit: ...
  jini_version: ...
  od_adapter_path: ...
  compatibility_suite: ...
```

Flow rules:

- Before cutover, bugs are fixed in Open Design and referenced by the extraction task.
- During shadowing, the same golden tests run against legacy and Jini implementations.
- After cutover, generic bugs are fixed in Jini first, released as a canary/patch, then consumed by an Open Design dependency bump.
- Product bugs stay in Open Design.
- No capability may remain indefinitely in two editable implementations.
- Open Design should consume exact Jini versions initially, then use controlled ranges after stability.
- Upstream Open Design changes are reviewed by source-map ownership. A changed extracted source path opens a compatibility task; it is not automatically copied into Jini.

The current memory branch should be reconciled onto current upstream separately. It should not define Jini’s baseline, and the stash should be preserved or promoted into a named branch/patch before any checkout cleanup.

# Project Runner and Durable Ledger

## Files

```text
project-runner/
├── config.yaml
├── schemas/
│   ├── task.schema.json
│   ├── attempt.schema.json
│   ├── lease.schema.json
│   └── validation-result.schema.json
├── ledger/
│   ├── tasks/JINI-0001.yaml
│   ├── sessions/JINI-0001/<attempt-id>/
│   │   ├── summary.md
│   │   ├── attempt.json
│   │   └── validation.json
│   └── compatibility/*.yaml
└── src/...
```

Task schema:

```yaml
schemaVersion: 1
id: JINI-0001
title: Establish protocol package
status: ready
priority: 20
repository: jini
source:
  branch: main
  commit: <exact-sha>
target:
  branchPrefix: task/JINI-0001
scope:
  include: [packages/protocol/**]
  exclude: [packages/runtime-node/**]
goal: Define versioned run and runtime contracts.
dependsOn: []
adrRefs: [docs/adr/0002-protocol-versioning.md]
compatibilityRefs: [runtime-events-v1]
approval:
  required: false
validation:
  - id: protocol-test
    cwd: .
    command: pnpm --filter @jini/protocol test
    required: true
    timeoutSeconds: 300
attemptLimit: 3
lastOutcome: null
```

## Task states and legal transitions

```text
draft → ready | cancelled
ready → claimed | cancelled
claimed → running | ready | blocked
running → awaiting_review | blocked | failed | ready
blocked → ready | cancelled
failed → ready | cancelled
awaiting_review → done | running | blocked
done → ready              # human-approved reopen only
any nonterminal → superseded
```

`claimed` and `running` are overlays from the active lease/attempt. Attempt outcomes are `active`, `handed_off`, `succeeded`, `failed`, or `abandoned`.

## Lease and locking model

- Cross-machine authority: remote branch/ref `jini-lease/<task-id>`.
- Claim: atomic ref creation; only one claimant succeeds.
- Renewal: heartbeat every ten minutes with a 45-minute TTL and expected-old-SHA compare-and-swap.
- Lease contains owner identity, attempt ID, branch, source commit, scope digest, expiry, and token hash.
- The secret lease token stays in ignored local state.
- Expired work is never silently discarded. Reaping records the branch head and an `abandoned` attempt before returning the task to `ready`.
- Offline mode uses an OS file lock and may not claim tasks marked `remoteRequired`.
- Active scope overlap is checked before claim. Overlap may be overridden only by an explicit coordination record.

A new agent selects work by filtering for:

1. `ready`;
2. all dependencies `done`;
3. required approvals satisfied;
4. source commit still valid;
5. no active lease;
6. no overlapping active scope;
7. then lowest priority number and stable task ID.

## Committed versus ephemeral

Committed:

- Task definitions and state changes
- ADR and compatibility links
- Attempt summaries and branch/commit identifiers
- Required validation commands and structured results
- Blockers, failure classification, final outcome
- Small sanitized logs needed to reproduce a failure

Ephemeral/local or object-storage-only:

- Lease secret
- Credentials and environment values
- Raw prompts and model transcripts unless explicitly approved
- Worktree paths and PIDs
- Full command logs and coverage artifacts
- Graph databases, embeddings, caches
- Native runtime session handles

## Engine run ledger

This is separate from the development task ledger. Jini’s daemon should durably store:

```text
runs(id, status, runtime_id, adapter_version, workspace_ref,
     lease_owner, lease_expires_at, last_event_seq, error_json, timestamps)

run_events(run_id, seq, event_type, payload_json, created_at)

runtime_sessions(conversation_id, runtime_id, encrypted_handle,
                 adapter_version, updated_at)
```

Engine run states:

```text
queued → starting → running → awaiting_input | cancelling
running → succeeded | failed | orphaned
awaiting_input → running | cancelling | failed
cancelling → cancelled | failed
orphaned → starting | failed | cancelled
```

Expired daemon leases produce `orphaned`; recovery resumes only when the adapter declares a compatible resume capability.

# Cloud Agent Workflow

1. `runner next` selects a safe task.
2. `runner claim JINI-#### --agent codex|claude` creates the lease and attempt.
3. The runner creates `task/<id>/<attempt>` from the exact source commit and an isolated worktree.
4. It materializes the task packet: instructions, ADRs, source-stamped context reports, scope, and validations.
5. The agent works only inside the declared repository and scope.
6. Heartbeats renew the lease; the runner records checkpoint commits and concise handoffs.
7. `runner validate` executes declared commands and writes structured results.
8. `runner handoff` preserves a resumable branch and session summary when context is low.
9. `runner submit` opens or updates the review branch/PR and marks `awaiting_review`.
10. Merge finalization marks `done`, clears the lease, refreshes affected context, and unblocks dependents.

Human checkpoints are required for repository rebaselining, public API/ADR changes, security-boundary changes, data migrations, licensing, breaking releases, and legacy removal. Characterization tests, mechanical moves, documentation refreshes, and bounded bug fixes may proceed autonomously.

AI-Dev-Shop owns role selection and approval policy. The runner merely enforces that policy and records execution; `AI-Dev-Shop/todo.md` must not become a second task ledger.

# CBM, Graphify, and Understand Anything Export Strategy

```text
context/
├── index.yaml
├── current/
│   ├── open-design.yaml
│   └── jini.yaml
└── snapshots/
    ├── open-design/<commit>/
    │   ├── manifest.json
    │   ├── overview.md
    │   ├── architecture.json
    │   ├── packages.json
    │   ├── symbols.ndjson.zst
    │   ├── hotspots.json
    │   ├── seams/
    │   ├── cbm-query-pack.json
    │   ├── graphify-summary.json
    │   └── understand-summary.json
    └── jini/<commit>/...
```

Every manifest records:

- Canonical repository URL
- Branch and exact commit
- Dirty-tree flag
- Tool name/version/config
- Generation time
- Included/excluded paths
- Export hashes
- Object-storage URI and checksum for large data
- Previous snapshot and refresh reason

Commit:

- Overview documents
- Package/dependency maps
- Top-symbol index
- Key inbound/outbound call summaries
- Hotspot and seam reports
- Small normalized graph exports
- Manifest and freshness metadata

Keep local or in object storage:

- `.codegraph/*.db`
- `.code-review-graph/*.db`
- Codebase Memory databases and embeddings
- Understand Anything intermediate batches and scratch data
- Raw absolute paths, caches, logs, and secrets
- Any single export over 10 MiB or snapshot set over 25 MiB

A task that declares `contextRequired: true` fails closed when its report commit differs from its source commit. Incremental reports may describe a commit range, but must never be presented as a full-current graph.

Current report status must be recorded as incomplete: no valid shareable CBM graph for this checkout, no completed Understand Anything graph, and only local ignored Graphify/CodeGraph databases.

# Migration Phases With Exit Criteria

| Phase | Work and exit criteria | Rollback |
|---|---|---|
| 0. Preserve and rebaseline | Preserve current Jini dirty work, broken symlink provenance, branch heads, stash, and remotes. Create an approved clean Jini engine baseline. No user work is lost. | Continue using existing Jini/OD checkouts unchanged. |
| 1. Characterize Open Design | Current upstream source selected; golden runtime, HTTP/SSE, artifact, chat, cancellation, and resume tests pass. Source map established. | Revert tests/docs only; runtime unchanged. |
| 2. Jini foundation | Protocol, engine ports, runner, leases, context manifests, reference apps, and package guards work without OD imports. | Jini remains unused; OD unaffected. |
| 3. Runtime vertical slice | Durable run ledger, runtime registry, discovery, one structured adapter, HTTP, CLI, and reference UI complete a real run. | Remove Jini canary; OD still owns execution. |
| 4. Open Design runtime canary | OD adapter can select legacy or Jini runtime. Golden mock traces and failure classifications match; security review passes. | Flip to legacy implementation and pin previous dependency. |
| 5. Runtime ownership transfer | Codex and Claude differences, resume, mid-turn input, auth, model discovery, cancellation, and crash recovery pass. Two OD releases use Jini by default. | Restore legacy default for one release; retain migrated data. |
| 6. Artifacts and frontend | Artifacts, reducers, message UI, and composer primitives are consumed through OD adapters. Vite reference app passes. | Feature flag switches individual UI slices to legacy. |
| 7. Second consumer | A real non-OD product uses runtime plus chat/artifacts without importing `open-design`. Conformance suite passes. | Keep packages pre-1.0; do not remove remaining compatibility paths. |
| 8. Stabilize and retire | Jini 1.0 contracts, security policy, support window, migration guide, and release ownership approved. Legacy OD paths removed capability-by-capability. | Pin prior Jini version; restore legacy path from retained release branch. |

# Daemon Extraction Sequence

1. Freeze generic event/error/runtime contracts from existing tests.
2. Extract `platform` and generic `sidecar` primitives with provenance.
3. Define durable run, event, conversation, and native-session stores.
4. Define `RuntimeAdapterV1` and capability negotiation.
5. Extract executable discovery, launch resolution, diagnostics, and config invalidation.
6. Add one structured adapter—Codex—plus recorded mock traces.
7. Add Claude to force validation of open stdin, stream-JSON, and specified-ID resume.
8. Build the generic run coordinator: prompt input, event normalization, cancellation, retry, resume, and recovery.
9. Add HTTP/SSE and CLI transports over the same services.
10. Add workspace, artifact, credential, and prompt-augmentation ports.
11. Implement the Open Design composition adapter.
12. Shadow and cut over one runtime path before extracting further product services.

The daemon path is roughly 18–34 engineer-weeks. The run coordinator and compatibility work dominate uncertainty.

# Testing and Compatibility Strategy

Required layers:

- Compile-time package-boundary guards
- Runtime schema validation at every HTTP/event boundary
- Adapter conformance tests supplied by Jini
- Recorded CLI trace replay for each runtime and parser
- Golden legacy-versus-Jini event comparisons
- SQLite migration/restart/crash tests
- HTTP and CLI parity tests
- Cancellation and process-tree termination tests
- Security tests for path traversal, origin/auth, credentials, env leakage, and unsafe executable overrides
- React reducer/component tests
- Accessibility and visual regression tests
- A minimal non-Next reference application
- Open Design end-to-end canaries using its existing tools-dev harness

Protocol changes carry a version field and migration function. Jini should support the current and previous minor adapter API during a documented deprecation window. Unknown event variants must be preserved as typed extension/raw events rather than discarded.

Proof of reusability requires a real second product before 1.0. The reference app proves packaging and decoupling, but does not by itself prove product fitness.

# Security, Recovery, Observability, and Cost

Security defaults:

- Localhost-only server unless explicitly configured otherwise
- Capability-scoped tool and filesystem grants
- Canonical workspace roots and allowed-directory checks
- Minimal child environment allowlist
- Opaque credential handles; no credentials in DTOs or logs
- Per-run MCP/tool configuration with trust policy
- Process-group cancellation and orphan reconciliation
- Versioned database migrations with backups and idempotent recovery
- Raw malformed stream retention in protected diagnostic storage

Observability should capture run ID, task ID, runtime/adapter version, model, state transitions, retries, resume attempts, event lag, token/cost data when reported, validation outcomes, and compatibility version—without recording prompt contents by default.

Cost controls:

- Deterministic scanners and graph queries before LLM summarization
- Small/mini models for scoped summaries, inventory classification, ledger maintenance, and mechanical moves
- Strong models for ADRs, security, parser semantics, migrations, and cross-package review
- At most one strong-model implementation pass and one independent strong review per high-risk task
- Incremental scoped graph refreshes; full refresh only after structural/package changes or release checkpoints
- Cache summaries by repository commit and tool configuration
- Hard task token/time budgets with handoff rather than unconstrained continuation

# Repository Size, Provenance, and Licensing

| Reference option | Decision |
|---|---|
| Vendored Open Design copy | Reject: duplication, confusing ownership, costly checkout |
| Git submodule | Reject as default: small pointer but fragile cloud/agent checkout and auth behavior |
| Git subtree | Reject for OD source: duplicates history/content and invites accidental edits |
| Sparse partial clone | Use on demand in ignored `.jini/cache/open-design/` |
| Generated source snapshot | Use only for deliberately extracted files with provenance |
| No local checkout | Default for consumers; runner materializes one when required |

`foundry/integrations/open-design/upstream.lock.yaml` should pin the canonical URL, user fork URL, relevant branches, commit SHAs, and selected patch/stash artifacts. `source-map.yaml` records each extracted module’s original path and commit.

Use `git format-patch`/`git am`, history-filtered transfer, or equivalent provenance-preserving methods for substantive code moves. Preserve original authors. Jini should retain Apache-2.0, add a `NOTICE`, retain upstream notices, and mark modified files as required by the license.

`AI-Dev-Shop/` is only about 12 MB locally, is required in every checkout, and consists largely of agent instructions/templates. Keep it as a pinned vendored subtree or synchronized snapshot with an upstream lock; a package or submodule would make cloud-agent availability less reliable.

# What Not to Generalize Yet

Keep these in Open Design until a second consumer demonstrates a common need:

- Brands and design-system catalogues
- Design templates and craft rules
- Plugin marketplace semantics
- Open Design project creation/import rules
- Memory and automation product behavior
- Media providers and model presets
- Critique Theater
- Library/community/social features
- Product analytics taxonomy
- Desktop updater/release-channel identity
- Open Design’s complete BYOK provider surface
- Deployment and design-finalization workflows

Jini may expose ports these features use, but should not own their domain models.

# Estimated Effort and Critical Path

Assuming two or three experienced engineers with agent assistance:

- Foundation, runner, protocol, provenance: 4–7 engineer-weeks
- Runtime core, discovery, persistence, Codex/Claude adapters: 14–24 engineer-weeks
- OD daemon adoption and compatibility: 8–16 engineer-weeks
- Artifacts and reusable frontend: 14–25 engineer-weeks
- Second-consumer hardening and 1.0 operations: 6–12 engineer-weeks

Work can overlap; a realistic elapsed range is roughly four to seven months. Total engineering effort is more meaningful than calendar precision and is likely 45–80 engineer-weeks. Uncertainty is high—approximately ±40%—because the largest seams are currently untyped and the second consumer is unspecified.

Model/tool cost should be controlled per task rather than estimated as a false dollar total. Graph generation and strong-model architecture/security review are the significant variable costs; tests, typechecking, and deterministic indexing should dominate routine validation.

# First 10 Concrete Implementation Tasks

Precondition: the user approves preserving the current dirty Jini state and creating a clean engine baseline.

| ID | Repository and scope | Goal | Validation |
|---|---|---|---|
| JINI-001 | Root: `package.json`, `pnpm-workspace.yaml`, `AGENTS.md`, `LICENSE`, `NOTICE`, `docs/adr/0001-*` | Create minimal Node 24/pnpm Jini workspace and neutrality guards. | `pnpm install --frozen-lockfile`; `pnpm guard`; `pnpm typecheck` |
| JINI-002 | `project-runner/schemas/**`, `project-runner/src/ledger/**`, `project-runner/tests/**` | Implement task parsing, transition validation, dependency resolution, and deterministic `next`. | `pnpm --filter @jini/project-runner test`; `pnpm --filter @jini/project-runner typecheck` |
| JINI-003 | `project-runner/src/leases/**`, `src/sessions/**`, tests | Implement local locks, remote-ref CAS leases, expiry/reap, scope-conflict detection, and handoffs. | Runner unit tests plus a temporary bare-remote integration test |
| JINI-004 | `foundry/integrations/open-design/{upstream.lock.yaml,source-map.yaml,ownership.yaml}`, `tools/provenance/**` | Record Open Design source refs and validate every imported file’s provenance/license fields. | `pnpm provenance:check`; `pnpm guard` |
| OD-001 | `apps/daemon/tests/runtimes/**`; port tests only from commits `75fd4afa4`/`780917104` | Establish current-upstream golden SSE/run behavior without moving implementation. | `pnpm --filter @open-design/daemon typecheck`; focused Vitest; `pnpm guard` |
| JINI-005 | `packages/protocol/src/**`, schemas and tests | Define `RunEventV1`, run states, errors, runtime descriptors, conversation DTOs, and version negotiation. | `pnpm --filter @jini/protocol test`; typecheck; schema fixture validation |
| JINI-006 | `packages/runtime/src/**`, tests | Define `RuntimeAdapterV1`, capability unions, registry, fake adapters, and conformance test kit. | `pnpm --filter @jini/runtime test`; typecheck |
| JINI-007 | `packages/persistence-sqlite/src/**`, migrations, tests | Implement durable run/event/conversation/session stores and restart recovery. | Package tests including crash/reopen and migration tests |
| JINI-008 | `packages/platform-node/**`, `packages/runtime-node/src/discovery/**`, tests | Extract product-neutral executable discovery and persisted detection snapshots. | Both package tests; PATH/config invalidation fixtures; `pnpm guard` |
| JINI-009 | `packages/runtime-node/src/adapters/codex/**`, mock fixtures | Add first real structured adapter with model/auth probes, captured-ID resume, cancellation, and event normalization. | Adapter conformance suite plus recorded Codex mock replay |
| JINI-010 | `packages/engine/**`, `packages/daemon-node/**`, `packages/client/**`, `packages/cli/**`, `apps/reference-daemon/**` | Complete one end-to-end run through library, HTTP/SSE, CLI, durable ledger, and Codex adapter. | Package tests; reference-daemon integration test; `jini run --json` smoke test |

Artifact characterization and extraction should be tasks 11–13; Open Design runtime canary adoption should begin only after task 10 is stable.

# Failure Modes and Reasons This Design Could Be Wrong

- Cross-repository releases may impose more coordination cost than temporarily hosting Jini packages inside Open Design.
- The daemon’s product prompt/artifact behavior may be too entangled to isolate without changing observable results.
- Generic UI slots may become an indirect reconstruction of every Open Design prop.
- Native CLI behavior may change too quickly for stable adapter packages.
- Remote Git-ref leasing may be disallowed by repository permissions; the lease backend would then need a transactional service.
- A second consumer may require a different language, runtime, or UI framework, invalidating the Node/React package emphasis.
- The copied Jini checkout may contain valuable uncommitted work not visible through its broken symlink; rebaselining before recovering it would be destructive.

Evidence that would change my strategy: an explicit maintainer agreement to host Jini packages inside Open Design for a bounded incubation period, or a second consumer whose deployment constraints rule out Node/React. In that case, I would incubate packages in the OD monorepo or make the protocol/conformance suite—not the implementation—the first Jini deliverable.

# Blind Spots

- **Viable missing option:** a protocol-only Jini repository containing schemas and conformance tests, with independent daemon/UI implementations remaining in their product repositories.
- **Question the group should be asking:** what exact second product, deployment environment, and first workflow must Jini support? Without that, “generic” APIs are being designed against only one real consumer.
- **Framing assumption most likely wrong:** daemon execution and reusable chat UI may not need to ship as one engine product or stabilize on the same release schedule.

# Assumptions

- Apache-2.0 remains the desired license.
- Jini remains TypeScript/Node 24 with pnpm.
- React remains the initial reusable UI target.
- Maintainers can change and release both repositories.
- Cloud agents have permission to create task branches and lease refs after approval.
- Open Design’s freshly fetched upstream main will be the behavioral source, not the current local branch.
- No existing external consumer depends on the present copied Jini repository.
- A real second consumer will be selected before Jini 1.0.

# Top Five Risks and Mitigations

1. **Hidden behavior loss in untyped god-files.** Mitigate with current-upstream characterization tests, shadow execution, mock trace replay, and small cuts.
2. **Open Design/Jini drift.** Mitigate with single-owner `ownership.yaml`, source maps, conformance kits, exact pins, and no long-lived duplicated implementation.
3. **Loss of current Jini work.** Mitigate by preserving the dirty tree, broken symlink target information, `src.orig`, branches, and stashes before rebaselining.
4. **Premature abstraction/package sprawl.** Mitigate by requiring a runtime/security/release reason for each package and delaying product domains until a second consumer exists.
5. **Subprocess and credential exposure.** Mitigate with canonical paths, capability grants, minimal environments, opaque credentials, protected session handles, and adversarial security tests.

# Decision Checklist

The user must approve these before implementation:

- [ ] Preserve the current dirty Jini state, then establish a clean engine baseline rather than refactoring the copied product tree.
- [ ] Canonical Jini repository owner/URL and whether it will be public.
- [ ] Apache-2.0 plus Open Design attribution/NOTICE policy.
- [ ] Publishable package scope, such as `@jini/*`.
- [ ] Package-first strangler strategy and two-repository ownership model.
- [ ] Initial runtime order: Codex first, Claude second.
- [ ] The concrete second consumer and its minimum acceptance workflow.
- [ ] Vendored/subtree synchronization policy for `AI-Dev-Shop/`.
- [ ] Permission for `project-runner` to create/delete remote lease branches and isolated worktrees.
- [ ] Security defaults for subprocess sandboxing, network access, tool grants, and telemetry.
- [ ] Which server-rewrite tests or patches should be recovered; no stale rewrite branch should be merged wholesale.
- [ ] Whether the frontend memory-slice and other local/stashed refactors should be rebased, archived, or completed separately.
- [ ] Release/deprecation window and how long Open Design legacy paths remain available.

## Self-assessment against the rubric

| Dimension | Score | Reason |
|---|---:|---|
| Reusability | 5 | Core packages prohibit product dependencies and require a second consumer. |
| Incremental migration | 5 | Capability-level flags, shadowing, and rollback are explicit. |
| Boundary clarity | 5 | Ports, package dependencies, composition ownership, and forbidden dependencies are defined. |
| Compatibility discipline | 5 | Conformance kits, source maps, golden traces, and exact pins prevent silent drift. |
| Frontend composability | 4 | Strong headless/slot design, but extraction remains substantial. |
| Runtime extensibility | 5 | Rich capability negotiation avoids a lowest-common-denominator adapter. |
| Operational safety | 4 | Security and recovery are explicit; implementation evidence is still pending. |
| Cloud resumability | 5 | Durable tasks, CAS leases, attempts, validation, and deterministic selection are specified. |
| Maintainability | 4 | Boundaries are strong, but the package count requires discipline. |
| Cost efficiency | 4 | Deterministic/scoped analysis is prioritized; full extraction remains expensive. |
| Provenance and sync | 5 | No duplicated source tree; locks, source maps, ownership, and licensing are explicit. |
| Time to first value | 4 | First executable runtime slice arrives early, though initial repository preservation is necessary. |

<<JINI_DEBATE_SUBMISSION_END>>
tokens used
412,491
# Executive Recommendation

Choose a **package-first strangler extraction**: keep current upstream Open Design as the behavioral authority, build Jini as a clean publishable-package monorepo, and transfer one contract-tested capability at a time. Do not use the copied Open Design tree currently in Jini as the engine foundation: it still has Open Design remotes and package identities, contains extensive product content, and its active `apps/web/src` is a broken symlink to another repository. A greenfield rewrite would discard hard-won runtime behavior; copy-then-refactor would preserve every hidden product coupling; subtree/federation would make ownership and releases ambiguous. The strangler approach gives early value, preserves rollback paths, and makes each capability have exactly one owner after cutover.

## Verified Repository Evidence

- Open Design is at commit `f65eea0343014bd8dad179dd4701c5eb02e18df4` on `refactor/web-memory-slice`. Against the locally available `origin/main`, it is 36 commits ahead and 52 behind; it is one commit behind the fork branch.
- Open Design has untracked `ADS-project-knowledge/`, `apps/web/coverage/`, and the porting-plan document. It also has one stash from `refactor/web-chat-composer-slice`.
- Jini is at commit `478a85577aff5aff6d98e3aed8214fafc5003af5` on `integrated`; both remotes still point to Open Design. Its web source is represented as hundreds of deletions plus `apps/web/src -> /Users/la/Desktop/Programming/Tovu/web/src`, currently a broken symlink, and `apps/web/src.orig/`.
- Open Design’s working checkout is about 5.5 GB, including a 1.6 GB `.git`. A normal vendored copy is therefore unsuitable, even though a clean partial clone would be much smaller.
- The current composition roots remain exceptionally large and untyped: [server.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server.ts:1) is 8,635 lines and begins with `@ts-nocheck`; [cli.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/cli.ts) is 10,071 lines. `ChatPane`, `ChatComposer`, and `App` are 4,342, 5,608, and 2,677 lines respectively.
- Good seams already exist: [server-context.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server-context.ts), domain route registrars, [runtime definitions](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/defs), pure contracts, `platform`, `sidecar`, and `components`.
- The runtime system already models discovery, auth probing, model listing, prompt transports, native resume, ACP resume, MCP injection, and stream parsing in [runtimes/types.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/types.ts). This is the strongest initial extraction seam.
- The current run service remains process-memory-first with optional JSONL event logs and a 30-minute default TTL; see [runtimes/runs.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/runs.ts:1). Jini needs a durable event store rather than copying that lifecycle unchanged.
- The memory vertical-slice ADR and implementation are useful evidence, but not a universal template. See [ADR 0002](/Users/la/Desktop/Programming/OSS-Repos/open-design/docs/adr/0002-frontend-vertical-slice-decomposition.md) and `apps/web/src/features/memory/`.
- Codebase reports are not currently cloud-ready: CodeGraph databases are local ignored SQLite files of about 157 MB and 587 MB; Understand Anything has only intermediate scan/batch data, without a final `knowledge-graph.json` or `meta.json`; the Codebase Memory MCP entry for this checkout reports zero nodes and no root path.

# Controlling Questions — Direct Answers

**Jini repository strategy.** Use one Jini monorepo containing publishable packages, reference applications, the project runner, and the Open Design compatibility metadata. Open Design stays in its own repository. Do not retain a full reference checkout in Git; recreate an ignored sparse/partial clone on demand from a pinned source manifest. Preserve the current dirty Jini state before establishing a clean engine branch.

**Daemon architecture and portability.** The current daemon is not directly portable: it combines agent execution, conversations, runs, projects, skills, design systems, plugins, media, memory, telemetry, static serving, filesystem policy, and Open Design routes. Jini should make an embeddable application core primary, then expose HTTP, CLI, and sidecar adapters. Product behavior enters through typed ports at a composition root.

**Frontend architecture and reusable UI.** Extract a headless chat/artifact model first, followed by React components driven by transports and slots. Do not export `ChatPane` or `ChatComposer` wholesale. Jini packages must not depend on Next.js, Open Design projects, daemon URLs, analytics, design systems, plugins, or global CSS.

**Automation and cloud execution.** Use the repo-local `project-runner` as a pull-based state machine, with Codex and Claude as the initial execution backends. CI validates changes but does not own planning or leases. Tasks are claimed atomically, run in isolated branches/worktrees, and handed off through durable attempt records.

**Durable task/session ledger.** Commit task definitions, dependencies, decisions, validation specifications, final results, and concise handoffs. Keep lease tokens, credentials, raw model transcripts, local worktree paths, verbose logs, and temporary indexes ephemeral. Use atomic remote Git refs for cross-machine leases and local file locks when offline.

**Codebase-understanding reports.** Commit small, source-stamped architecture summaries, symbol indexes, seam maps, hotspot reports, and manifests. Store full SQLite/embedding databases locally or in object storage. A freshness check must reject reports whose source commit differs from the task’s required commit.

**AI-Dev-Shop and governance.** Keep `AI-Dev-Shop/` top-level as a pinned vendored subtree/snapshot with provenance. It defines roles, approval gates, specs, and review policy. `project-runner/` owns execution state, leasing, validation, and resumability. They must not maintain competing task lists.

**Reference repository size and provenance.** Do not commit `references/open-design/`, use a submodule, or copy the tree. Commit an upstream lock and source map; let the runner create an ignored sparse partial clone. Preserve authorship with history-aware patch transfer and record the original repository, commit, path, license, and modification notice.

**Compatibility, releases, and operations.** Version schemas and adapter interfaces independently with SemVer, runtime validation, negotiated protocol versions, conformance suites, golden mock traces, canary releases, and exact dependency pins during adoption. Every cutover retains a legacy switch until parity and recovery criteria pass.

**Cost and model use.** Prefer deterministic analysis first, then small/mini models for bounded summaries and mechanical transformations. Use strong reasoning models for boundary decisions, security reviews, migrations, parser/resume semantics, and final compatibility judgment. Refresh expensive graphs only when source structure changes materially.

# Proposed Repository Topology

```text
Jini/
├── .github/
├── AGENTS.md
├── LICENSE
├── NOTICE
├── package.json
├── pnpm-workspace.yaml
├── AI-Dev-Shop/                    # pinned vendored subtree/snapshot
├── ADS-project-knowledge/          # specs, ADRs, approvals, retained reports
├── project-runner/
│   ├── package.json
│   ├── config.yaml
│   ├── schemas/
│   ├── src/
│   │   ├── ledger/
│   │   ├── leases/
│   │   ├── sessions/
│   │   ├── git/
│   │   ├── context/
│   │   ├── runners/
│   │   └── validation/
│   ├── ledger/
│   │   ├── tasks/
│   │   ├── sessions/
│   │   └── compatibility/
│   └── tests/
├── packages/
│   ├── protocol/
│   ├── engine/
│   ├── runtime/
│   ├── runtime-node/
│   ├── persistence-sqlite/
│   ├── platform-node/
│   ├── daemon-node/
│   ├── client/
│   ├── cli/
│   ├── artifacts/
│   ├── chat-react/
│   └── sidecar/
├── integrations/
│   └── open-design/
│       ├── README.md
│       ├── upstream.lock.yaml
│       ├── ownership.yaml
│       ├── source-map.yaml
│       ├── compatibility/
│       └── migration-notes/
├── apps/
│   ├── reference-daemon/
│   └── reference-web/
├── examples/
│   ├── minimal-node/
│   └── minimal-react/
├── context/
│   ├── index.yaml
│   ├── current/
│   └── snapshots/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── migration/
│   ├── security/
│   └── releases/
└── tools/
    ├── context-export/
    ├── provenance/
    └── compatibility/
```

There should be no committed Open Design checkout inside this tree.

# Package and Module Boundaries

| Package | Responsibility and public API | Dependencies allowed | Dependencies forbidden | First consumer |
|---|---|---|---|---|
| `@jini/protocol` | Versioned DTOs, JSON Schemas, `RunEventV1`, errors, runtime descriptors | TypeScript, schema validator | Node, React, Express, SQLite, product types | All packages |
| `@jini/engine` | `JiniEngine`, run/conversation services, ports, lifecycle policy | `protocol` | Express, subprocess APIs, concrete stores, product prompts | Reference daemon |
| `@jini/runtime` | `RuntimeAdapterV1`, registry, normalized event model, capability negotiation | `protocol` | Node process APIs, product routes | `runtime-node` |
| `@jini/runtime-node` | CLI discovery, invocation, built-in runtime adapters, parser wiring | `runtime`, `platform-node` | Open Design data/project/plugin modules | Reference daemon |
| `@jini/persistence-sqlite` | Durable conversation, run, event, session-handle stores | `engine`, `protocol`, SQLite | HTTP, UI, runtime-specific behavior | Reference daemon |
| `@jini/platform-node` | Filesystem, subprocess, environment, path, process-control primitives | Node standard library | Product identifiers and route contracts | `runtime-node` |
| `@jini/daemon-node` | Composition helper and versioned HTTP/SSE transport | `engine`, stores, runtime, protocol | Product routes and UI | Reference daemon, OD |
| `@jini/client` | `JiniClient`, transport interface, HTTP implementation | `protocol` | React, Next.js, filesystem | Reference web |
| `@jini/cli` | Machine-readable client commands and embeddable CLI dispatcher | `client`, `protocol` | Product command trees | Reference app |
| `@jini/artifacts` | Artifact parser, manifests, headless renderer registry, question-form model | `protocol` where needed | React, iframe policy, OD file URLs | Reference web |
| `@jini/chat-react` | Provider, hooks, message list, composer primitives, slots, CSS variables | React peer, `client`, `artifacts`, `protocol` | Next.js, OD state/providers, analytics | Reference web |
| `@jini/sidecar` | Product-neutral bootstrap, IPC, runtime descriptors and shutdown | `platform-node`, `protocol` | Fixed app names, channel names, OD paths | Reference daemon |

A package is not created merely to hold one helper. These packages correspond to different runtime environments, security boundaries, or release contracts.

# Daemon Core and Adapter Design

The primary API is the embeddable library:

```text
Open Design composition root
  ├── OpenDesignProjectPort
  ├── OpenDesignPromptAugmenter
  ├── OpenDesignArtifactPolicy
  ├── OpenDesignCredentialPolicy
  └── OpenDesignTelemetrySink
           ↓
       JiniEngine
  ├── RunCoordinator
  ├── ConversationService
  ├── RuntimeRegistry
  ├── ArtifactService
  └── DurableEventStore
           ↓
  Node / SQLite / HTTP / sidecar adapters
```

Core ports should include:

- `RunStore`, `RunEventStore`, `ConversationStore`, `RuntimeSessionStore`
- `WorkspacePort` and `WorkspaceAuthorizationPolicy`
- `ArtifactStore` and `ArtifactPolicy`
- `ProcessLauncher`, `Clock`, `IdGenerator`, `CredentialStore`
- `PromptAugmenter`, `ContextProvider`, `TelemetrySink`
- `RuntimeRegistry` and `RuntimeAdapterResolver`

The daemon should expose all four requested forms:

- Embeddable library: authoritative application API.
- HTTP/SSE: versioned `/v1/*` transport over the same services.
- CLI: normally an HTTP client; an explicit embedded mode can be added later.
- Sidecar: discovery, bootstrap, health, shutdown, and runtime descriptor.

Default network binding should be `127.0.0.1:0`, with the actual port written to a protected runtime descriptor. Explicit `--host` and `--port` remain available. Ports must never influence persistent path identity.

Open Design product routes—brands, design systems, marketplace, memory, media, critique, deployment, updater behavior—mount beside Jini’s routes at the Open Design composition root.

The old rewrite branches are evidence, not merge candidates:

- `arch/chat-run-extraction` contains useful SSE characterization commits `75fd4afa4` and `780917104`. Port the tests and dependency inventory.
- Its `510a243e6` extraction still moves about 3,400 untyped lines behind `deps: any`; do not adopt it as the Jini runtime.
- `arch/server-startserver-endgame` at `f1aabe9e5` identifies useful seams such as SSE, request guards, prompt composition, telemetry, and chat request composition. It is 258 locally known upstream commits behind `origin/main`, so reimplement the seams against current source.
- The older `fork/refactor/daemon-server-*`, `fork/server-ts`, and project-route branches are even more divergent. Do not merge them wholesale.
- Current upstream route registrars, `ServerContext`, runtime definitions, parser modules, and mock traces are the correct starting evidence.

# Agent and CLI Discovery Design

`RuntimeAdapterV1` should preserve differences rather than collapse them:

```ts
interface RuntimeAdapterV1 {
  manifest: RuntimeManifestV1;
  discover(ctx: DiscoveryContext): Promise<InstallationCandidate[]>;
  probe(candidate: InstallationCandidate): Promise<RuntimeInstallation>;
  listModels?(installation: RuntimeInstallation): Promise<ModelCatalog>;
  prepareRun(input: PrepareRunInput): Promise<PreparedInvocation>;
  parse(streams: InvocationStreams): AsyncIterable<RunEventV1>;
  cancel(controller: InvocationController): Promise<void>;
  sendInput?(controller: InvocationController, input: MidTurnInput): Promise<void>;
  resume?(input: ResumeInput): Promise<PreparedInvocation>;
}
```

Capability fields should be discriminated values, not unrelated booleans:

```text
prompt: argv | stdin-text | stdin-jsonl | file
events: plain | jsonl | claude-stream | acp-json-rpc
resume: none | specified-id | captured-id | acp-load
midTurnInput: none | jsonl
models: static | command | remote
mcp: none | config-file | env-content | acp-merge
cancellation: signal | process-group | protocol
```

Source of truth:

- Adapter manifests in package code define supported behavior.
- A persisted detection snapshot reports what is actually installed.
- A launch always revalidates the selected executable and workspace policy.

Suggested SQLite record:

```text
runtime_installation(
  adapter_id, installation_id, canonical_path, path_fingerprint,
  version, auth_status, capabilities_json, models_json, models_source,
  config_hash, detected_at, expires_at, last_error_code
)
```

Refresh policy:

- Asynchronous scan at daemon startup.
- User/CLI-triggered refresh through the same `/v1/runtimes/refresh` API.
- Invalidate on PATH/configured-binary/config-hash changes.
- Five-minute availability/auth freshness; longer model-catalog freshness where probing is costly.
- Persisted results may render immediately as `stale: true`, but cannot authorize a spawn.

Security:

- Canonicalize paths and verify executable permissions.
- Never accept an unvalidated executable path from browser payloads.
- Keep credential values server-side and return only status.
- Redact environment, argv secrets, and native session handles from logs.
- Bind all UI and CLI consumers to the same runtime registry API.

# Frontend Feature-Slice and Reusable UI Design

Use three layers:

1. `@jini/artifacts`: pure artifact parsing, manifests, question forms, and renderer selection.
2. Headless chat state inside `@jini/chat-react`: reducer/controllers usable through hooks.
3. Presentational React components with explicit slots.

Core client contract:

```ts
interface ChatClient {
  createRun(input: CreateRunInput): Promise<RunHandle>;
  streamRun(runId: string, after?: number): AsyncIterable<RunEventV1>;
  cancelRun(runId: string): Promise<void>;
  sendRunInput?(runId: string, input: MidTurnInput): Promise<void>;
  loadConversation(id: string): Promise<Conversation>;
  listRuntimes(): Promise<RuntimeDescriptorV1[]>;
}
```

Required product slots/adapters:

- `scopeProvider` for project/workspace context
- `runtimePicker`, `modelPicker`, and capability-aware controls
- `attachmentResolver` and attachment renderer
- `artifactRegistry` and `filePreviewAdapter`
- `toolRendererRegistry`
- `questionFormHandler`
- `commentsAdapter` and `feedbackSink`
- `analyticsSink`
- `composerActions`
- design tokens/class-name hooks

The reusable package should use React peer dependencies, standard web APIs behind injected transports, CSS Modules/CSS variables, and no Next.js APIs. A Vite reference application must consume it.

## Frontend extraction sequence

1. Add characterization tests for artifact parsing, question forms, message ordering, Todo snapshots, queues, errors, attachments, and composer payloads.
2. Extract pure artifact types/parsers from `apps/web/src/artifacts/*`.
3. Move run-event folding, tool deduplication, message derivation, and conversation state into pure reducers.
4. Introduce `ChatClient` while the Open Design implementation still calls existing daemon providers.
5. Split `ChatPane` into controller, render-item builder, message list, message row, pinned-state region, and product slots.
6. Split `ChatComposer` into draft model, submit builder, input component, attachment tray, capability controls, and product action slots.
7. Extract generic message, question-form, tool-shell, artifact-shell, and composer components.
8. Build the Vite reference application using a fake/in-memory transport.
9. Publish a canary package and switch Open Design behind a feature flag.
10. Remove legacy components only after visual, accessibility, streaming, and compatibility parity.

Expected frontend effort is roughly 14–25 engineer-weeks, with 8–14 calendar weeks if work overlaps. Composer and file/artifact behavior create the largest uncertainty.

# Open Design Integration Strategy

Maintain an ownership manifest per capability:

```yaml
runtime-registry:
  state: od-owned | shadowed | jini-owned
  source_commit: ...
  jini_version: ...
  od_adapter_path: ...
  compatibility_suite: ...
```

Flow rules:

- Before cutover, bugs are fixed in Open Design and referenced by the extraction task.
- During shadowing, the same golden tests run against legacy and Jini implementations.
- After cutover, generic bugs are fixed in Jini first, released as a canary/patch, then consumed by an Open Design dependency bump.
- Product bugs stay in Open Design.
- No capability may remain indefinitely in two editable implementations.
- Open Design should consume exact Jini versions initially, then use controlled ranges after stability.
- Upstream Open Design changes are reviewed by source-map ownership. A changed extracted source path opens a compatibility task; it is not automatically copied into Jini.

The current memory branch should be reconciled onto current upstream separately. It should not define Jini’s baseline, and the stash should be preserved or promoted into a named branch/patch before any checkout cleanup.

# Project Runner and Durable Ledger

## Files

```text
project-runner/
├── config.yaml
├── schemas/
│   ├── task.schema.json
│   ├── attempt.schema.json
│   ├── lease.schema.json
│   └── validation-result.schema.json
├── ledger/
│   ├── tasks/JINI-0001.yaml
│   ├── sessions/JINI-0001/<attempt-id>/
│   │   ├── summary.md
│   │   ├── attempt.json
│   │   └── validation.json
│   └── compatibility/*.yaml
└── src/...
```

Task schema:

```yaml
schemaVersion: 1
id: JINI-0001
title: Establish protocol package
status: ready
priority: 20
repository: jini
source:
  branch: main
  commit: <exact-sha>
target:
  branchPrefix: task/JINI-0001
scope:
  include: [packages/protocol/**]
  exclude: [packages/runtime-node/**]
goal: Define versioned run and runtime contracts.
dependsOn: []
adrRefs: [docs/adr/0002-protocol-versioning.md]
compatibilityRefs: [runtime-events-v1]
approval:
  required: false
validation:
  - id: protocol-test
    cwd: .
    command: pnpm --filter @jini/protocol test
    required: true
    timeoutSeconds: 300
attemptLimit: 3
lastOutcome: null
```

## Task states and legal transitions

```text
draft → ready | cancelled
ready → claimed | cancelled
claimed → running | ready | blocked
running → awaiting_review | blocked | failed | ready
blocked → ready | cancelled
failed → ready | cancelled
awaiting_review → done | running | blocked
done → ready              # human-approved reopen only
any nonterminal → superseded
```

`claimed` and `running` are overlays from the active lease/attempt. Attempt outcomes are `active`, `handed_off`, `succeeded`, `failed`, or `abandoned`.

## Lease and locking model

- Cross-machine authority: remote branch/ref `jini-lease/<task-id>`.
- Claim: atomic ref creation; only one claimant succeeds.
- Renewal: heartbeat every ten minutes with a 45-minute TTL and expected-old-SHA compare-and-swap.
- Lease contains owner identity, attempt ID, branch, source commit, scope digest, expiry, and token hash.
- The secret lease token stays in ignored local state.
- Expired work is never silently discarded. Reaping records the branch head and an `abandoned` attempt before returning the task to `ready`.
- Offline mode uses an OS file lock and may not claim tasks marked `remoteRequired`.
- Active scope overlap is checked before claim. Overlap may be overridden only by an explicit coordination record.

A new agent selects work by filtering for:

1. `ready`;
2. all dependencies `done`;
3. required approvals satisfied;
4. source commit still valid;
5. no active lease;
6. no overlapping active scope;
7. then lowest priority number and stable task ID.

## Committed versus ephemeral

Committed:

- Task definitions and state changes
- ADR and compatibility links
- Attempt summaries and branch/commit identifiers
- Required validation commands and structured results
- Blockers, failure classification, final outcome
- Small sanitized logs needed to reproduce a failure

Ephemeral/local or object-storage-only:

- Lease secret
- Credentials and environment values
- Raw prompts and model transcripts unless explicitly approved
- Worktree paths and PIDs
- Full command logs and coverage artifacts
- Graph databases, embeddings, caches
- Native runtime session handles

## Engine run ledger

This is separate from the development task ledger. Jini’s daemon should durably store:

```text
runs(id, status, runtime_id, adapter_version, workspace_ref,
     lease_owner, lease_expires_at, last_event_seq, error_json, timestamps)

run_events(run_id, seq, event_type, payload_json, created_at)

runtime_sessions(conversation_id, runtime_id, encrypted_handle,
                 adapter_version, updated_at)
```

Engine run states:

```text
queued → starting → running → awaiting_input | cancelling
running → succeeded | failed | orphaned
awaiting_input → running | cancelling | failed
cancelling → cancelled | failed
orphaned → starting | failed | cancelled
```

Expired daemon leases produce `orphaned`; recovery resumes only when the adapter declares a compatible resume capability.

# Cloud Agent Workflow

1. `runner next` selects a safe task.
2. `runner claim JINI-#### --agent codex|claude` creates the lease and attempt.
3. The runner creates `task/<id>/<attempt>` from the exact source commit and an isolated worktree.
4. It materializes the task packet: instructions, ADRs, source-stamped context reports, scope, and validations.
5. The agent works only inside the declared repository and scope.
6. Heartbeats renew the lease; the runner records checkpoint commits and concise handoffs.
7. `runner validate` executes declared commands and writes structured results.
8. `runner handoff` preserves a resumable branch and session summary when context is low.
9. `runner submit` opens or updates the review branch/PR and marks `awaiting_review`.
10. Merge finalization marks `done`, clears the lease, refreshes affected context, and unblocks dependents.

Human checkpoints are required for repository rebaselining, public API/ADR changes, security-boundary changes, data migrations, licensing, breaking releases, and legacy removal. Characterization tests, mechanical moves, documentation refreshes, and bounded bug fixes may proceed autonomously.

AI-Dev-Shop owns role selection and approval policy. The runner merely enforces that policy and records execution; `AI-Dev-Shop/todo.md` must not become a second task ledger.

# CBM, Graphify, and Understand Anything Export Strategy

```text
context/
├── index.yaml
├── current/
│   ├── open-design.yaml
│   └── jini.yaml
└── snapshots/
    ├── open-design/<commit>/
    │   ├── manifest.json
    │   ├── overview.md
    │   ├── architecture.json
    │   ├── packages.json
    │   ├── symbols.ndjson.zst
    │   ├── hotspots.json
    │   ├── seams/
    │   ├── cbm-query-pack.json
    │   ├── graphify-summary.json
    │   └── understand-summary.json
    └── jini/<commit>/...
```

Every manifest records:

- Canonical repository URL
- Branch and exact commit
- Dirty-tree flag
- Tool name/version/config
- Generation time
- Included/excluded paths
- Export hashes
- Object-storage URI and checksum for large data
- Previous snapshot and refresh reason

Commit:

- Overview documents
- Package/dependency maps
- Top-symbol index
- Key inbound/outbound call summaries
- Hotspot and seam reports
- Small normalized graph exports
- Manifest and freshness metadata

Keep local or in object storage:

- `.codegraph/*.db`
- `.code-review-graph/*.db`
- Codebase Memory databases and embeddings
- Understand Anything intermediate batches and scratch data
- Raw absolute paths, caches, logs, and secrets
- Any single export over 10 MiB or snapshot set over 25 MiB

A task that declares `contextRequired: true` fails closed when its report commit differs from its source commit. Incremental reports may describe a commit range, but must never be presented as a full-current graph.

Current report status must be recorded as incomplete: no valid shareable CBM graph for this checkout, no completed Understand Anything graph, and only local ignored Graphify/CodeGraph databases.

# Migration Phases With Exit Criteria

| Phase | Work and exit criteria | Rollback |
|---|---|---|
| 0. Preserve and rebaseline | Preserve current Jini dirty work, broken symlink provenance, branch heads, stash, and remotes. Create an approved clean Jini engine baseline. No user work is lost. | Continue using existing Jini/OD checkouts unchanged. |
| 1. Characterize Open Design | Current upstream source selected; golden runtime, HTTP/SSE, artifact, chat, cancellation, and resume tests pass. Source map established. | Revert tests/docs only; runtime unchanged. |
| 2. Jini foundation | Protocol, engine ports, runner, leases, context manifests, reference apps, and package guards work without OD imports. | Jini remains unused; OD unaffected. |
| 3. Runtime vertical slice | Durable run ledger, runtime registry, discovery, one structured adapter, HTTP, CLI, and reference UI complete a real run. | Remove Jini canary; OD still owns execution. |
| 4. Open Design runtime canary | OD adapter can select legacy or Jini runtime. Golden mock traces and failure classifications match; security review passes. | Flip to legacy implementation and pin previous dependency. |
| 5. Runtime ownership transfer | Codex and Claude differences, resume, mid-turn input, auth, model discovery, cancellation, and crash recovery pass. Two OD releases use Jini by default. | Restore legacy default for one release; retain migrated data. |
| 6. Artifacts and frontend | Artifacts, reducers, message UI, and composer primitives are consumed through OD adapters. Vite reference app passes. | Feature flag switches individual UI slices to legacy. |
| 7. Second consumer | A real non-OD product uses runtime plus chat/artifacts without importing `open-design`. Conformance suite passes. | Keep packages pre-1.0; do not remove remaining compatibility paths. |
| 8. Stabilize and retire | Jini 1.0 contracts, security policy, support window, migration guide, and release ownership approved. Legacy OD paths removed capability-by-capability. | Pin prior Jini version; restore legacy path from retained release branch. |

# Daemon Extraction Sequence

1. Freeze generic event/error/runtime contracts from existing tests.
2. Extract `platform` and generic `sidecar` primitives with provenance.
3. Define durable run, event, conversation, and native-session stores.
4. Define `RuntimeAdapterV1` and capability negotiation.
5. Extract executable discovery, launch resolution, diagnostics, and config invalidation.
6. Add one structured adapter—Codex—plus recorded mock traces.
7. Add Claude to force validation of open stdin, stream-JSON, and specified-ID resume.
8. Build the generic run coordinator: prompt input, event normalization, cancellation, retry, resume, and recovery.
9. Add HTTP/SSE and CLI transports over the same services.
10. Add workspace, artifact, credential, and prompt-augmentation ports.
11. Implement the Open Design composition adapter.
12. Shadow and cut over one runtime path before extracting further product services.

The daemon path is roughly 18–34 engineer-weeks. The run coordinator and compatibility work dominate uncertainty.

# Testing and Compatibility Strategy

Required layers:

- Compile-time package-boundary guards
- Runtime schema validation at every HTTP/event boundary
- Adapter conformance tests supplied by Jini
- Recorded CLI trace replay for each runtime and parser
- Golden legacy-versus-Jini event comparisons
- SQLite migration/restart/crash tests
- HTTP and CLI parity tests
- Cancellation and process-tree termination tests
- Security tests for path traversal, origin/auth, credentials, env leakage, and unsafe executable overrides
- React reducer/component tests
- Accessibility and visual regression tests
- A minimal non-Next reference application
- Open Design end-to-end canaries using its existing tools-dev harness

Protocol changes carry a version field and migration function. Jini should support the current and previous minor adapter API during a documented deprecation window. Unknown event variants must be preserved as typed extension/raw events rather than discarded.

Proof of reusability requires a real second product before 1.0. The reference app proves packaging and decoupling, but does not by itself prove product fitness.

# Security, Recovery, Observability, and Cost

Security defaults:

- Localhost-only server unless explicitly configured otherwise
- Capability-scoped tool and filesystem grants
- Canonical workspace roots and allowed-directory checks
- Minimal child environment allowlist
- Opaque credential handles; no credentials in DTOs or logs
- Per-run MCP/tool configuration with trust policy
- Process-group cancellation and orphan reconciliation
- Versioned database migrations with backups and idempotent recovery
- Raw malformed stream retention in protected diagnostic storage

Observability should capture run ID, task ID, runtime/adapter version, model, state transitions, retries, resume attempts, event lag, token/cost data when reported, validation outcomes, and compatibility version—without recording prompt contents by default.

Cost controls:

- Deterministic scanners and graph queries before LLM summarization
- Small/mini models for scoped summaries, inventory classification, ledger maintenance, and mechanical moves
- Strong models for ADRs, security, parser semantics, migrations, and cross-package review
- At most one strong-model implementation pass and one independent strong review per high-risk task
- Incremental scoped graph refreshes; full refresh only after structural/package changes or release checkpoints
- Cache summaries by repository commit and tool configuration
- Hard task token/time budgets with handoff rather than unconstrained continuation

# Repository Size, Provenance, and Licensing

| Reference option | Decision |
|---|---|
| Vendored Open Design copy | Reject: duplication, confusing ownership, costly checkout |
| Git submodule | Reject as default: small pointer but fragile cloud/agent checkout and auth behavior |
| Git subtree | Reject for OD source: duplicates history/content and invites accidental edits |
| Sparse partial clone | Use on demand in ignored `.jini/cache/open-design/` |
| Generated source snapshot | Use only for deliberately extracted files with provenance |
| No local checkout | Default for consumers; runner materializes one when required |

`foundry/integrations/open-design/upstream.lock.yaml` should pin the canonical URL, user fork URL, relevant branches, commit SHAs, and selected patch/stash artifacts. `source-map.yaml` records each extracted module’s original path and commit.

Use `git format-patch`/`git am`, history-filtered transfer, or equivalent provenance-preserving methods for substantive code moves. Preserve original authors. Jini should retain Apache-2.0, add a `NOTICE`, retain upstream notices, and mark modified files as required by the license.

`AI-Dev-Shop/` is only about 12 MB locally, is required in every checkout, and consists largely of agent instructions/templates. Keep it as a pinned vendored subtree or synchronized snapshot with an upstream lock; a package or submodule would make cloud-agent availability less reliable.

# What Not to Generalize Yet

Keep these in Open Design until a second consumer demonstrates a common need:

- Brands and design-system catalogues
- Design templates and craft rules
- Plugin marketplace semantics
- Open Design project creation/import rules
- Memory and automation product behavior
- Media providers and model presets
- Critique Theater
- Library/community/social features
- Product analytics taxonomy
- Desktop updater/release-channel identity
- Open Design’s complete BYOK provider surface
- Deployment and design-finalization workflows

Jini may expose ports these features use, but should not own their domain models.

# Estimated Effort and Critical Path

Assuming two or three experienced engineers with agent assistance:

- Foundation, runner, protocol, provenance: 4–7 engineer-weeks
- Runtime core, discovery, persistence, Codex/Claude adapters: 14–24 engineer-weeks
- OD daemon adoption and compatibility: 8–16 engineer-weeks
- Artifacts and reusable frontend: 14–25 engineer-weeks
- Second-consumer hardening and 1.0 operations: 6–12 engineer-weeks

Work can overlap; a realistic elapsed range is roughly four to seven months. Total engineering effort is more meaningful than calendar precision and is likely 45–80 engineer-weeks. Uncertainty is high—approximately ±40%—because the largest seams are currently untyped and the second consumer is unspecified.

Model/tool cost should be controlled per task rather than estimated as a false dollar total. Graph generation and strong-model architecture/security review are the significant variable costs; tests, typechecking, and deterministic indexing should dominate routine validation.

# First 10 Concrete Implementation Tasks

Precondition: the user approves preserving the current dirty Jini state and creating a clean engine baseline.

| ID | Repository and scope | Goal | Validation |
|---|---|---|---|
| JINI-001 | Root: `package.json`, `pnpm-workspace.yaml`, `AGENTS.md`, `LICENSE`, `NOTICE`, `docs/adr/0001-*` | Create minimal Node 24/pnpm Jini workspace and neutrality guards. | `pnpm install --frozen-lockfile`; `pnpm guard`; `pnpm typecheck` |
| JINI-002 | `project-runner/schemas/**`, `project-runner/src/ledger/**`, `project-runner/tests/**` | Implement task parsing, transition validation, dependency resolution, and deterministic `next`. | `pnpm --filter @jini/project-runner test`; `pnpm --filter @jini/project-runner typecheck` |
| JINI-003 | `project-runner/src/leases/**`, `src/sessions/**`, tests | Implement local locks, remote-ref CAS leases, expiry/reap, scope-conflict detection, and handoffs. | Runner unit tests plus a temporary bare-remote integration test |
| JINI-004 | `foundry/integrations/open-design/{upstream.lock.yaml,source-map.yaml,ownership.yaml}`, `tools/provenance/**` | Record Open Design source refs and validate every imported file’s provenance/license fields. | `pnpm provenance:check`; `pnpm guard` |
| OD-001 | `apps/daemon/tests/runtimes/**`; port tests only from commits `75fd4afa4`/`780917104` | Establish current-upstream golden SSE/run behavior without moving implementation. | `pnpm --filter @open-design/daemon typecheck`; focused Vitest; `pnpm guard` |
| JINI-005 | `packages/protocol/src/**`, schemas and tests | Define `RunEventV1`, run states, errors, runtime descriptors, conversation DTOs, and version negotiation. | `pnpm --filter @jini/protocol test`; typecheck; schema fixture validation |
| JINI-006 | `packages/runtime/src/**`, tests | Define `RuntimeAdapterV1`, capability unions, registry, fake adapters, and conformance test kit. | `pnpm --filter @jini/runtime test`; typecheck |
| JINI-007 | `packages/persistence-sqlite/src/**`, migrations, tests | Implement durable run/event/conversation/session stores and restart recovery. | Package tests including crash/reopen and migration tests |
| JINI-008 | `packages/platform-node/**`, `packages/runtime-node/src/discovery/**`, tests | Extract product-neutral executable discovery and persisted detection snapshots. | Both package tests; PATH/config invalidation fixtures; `pnpm guard` |
| JINI-009 | `packages/runtime-node/src/adapters/codex/**`, mock fixtures | Add first real structured adapter with model/auth probes, captured-ID resume, cancellation, and event normalization. | Adapter conformance suite plus recorded Codex mock replay |
| JINI-010 | `packages/engine/**`, `packages/daemon-node/**`, `packages/client/**`, `packages/cli/**`, `apps/reference-daemon/**` | Complete one end-to-end run through library, HTTP/SSE, CLI, durable ledger, and Codex adapter. | Package tests; reference-daemon integration test; `jini run --json` smoke test |

Artifact characterization and extraction should be tasks 11–13; Open Design runtime canary adoption should begin only after task 10 is stable.

# Failure Modes and Reasons This Design Could Be Wrong

- Cross-repository releases may impose more coordination cost than temporarily hosting Jini packages inside Open Design.
- The daemon’s product prompt/artifact behavior may be too entangled to isolate without changing observable results.
- Generic UI slots may become an indirect reconstruction of every Open Design prop.
- Native CLI behavior may change too quickly for stable adapter packages.
- Remote Git-ref leasing may be disallowed by repository permissions; the lease backend would then need a transactional service.
- A second consumer may require a different language, runtime, or UI framework, invalidating the Node/React package emphasis.
- The copied Jini checkout may contain valuable uncommitted work not visible through its broken symlink; rebaselining before recovering it would be destructive.

Evidence that would change my strategy: an explicit maintainer agreement to host Jini packages inside Open Design for a bounded incubation period, or a second consumer whose deployment constraints rule out Node/React. In that case, I would incubate packages in the OD monorepo or make the protocol/conformance suite—not the implementation—the first Jini deliverable.

# Blind Spots

- **Viable missing option:** a protocol-only Jini repository containing schemas and conformance tests, with independent daemon/UI implementations remaining in their product repositories.
- **Question the group should be asking:** what exact second product, deployment environment, and first workflow must Jini support? Without that, “generic” APIs are being designed against only one real consumer.
- **Framing assumption most likely wrong:** daemon execution and reusable chat UI may not need to ship as one engine product or stabilize on the same release schedule.

# Assumptions

- Apache-2.0 remains the desired license.
- Jini remains TypeScript/Node 24 with pnpm.
- React remains the initial reusable UI target.
- Maintainers can change and release both repositories.
- Cloud agents have permission to create task branches and lease refs after approval.
- Open Design’s freshly fetched upstream main will be the behavioral source, not the current local branch.
- No existing external consumer depends on the present copied Jini repository.
- A real second consumer will be selected before Jini 1.0.

# Top Five Risks and Mitigations

1. **Hidden behavior loss in untyped god-files.** Mitigate with current-upstream characterization tests, shadow execution, mock trace replay, and small cuts.
2. **Open Design/Jini drift.** Mitigate with single-owner `ownership.yaml`, source maps, conformance kits, exact pins, and no long-lived duplicated implementation.
3. **Loss of current Jini work.** Mitigate by preserving the dirty tree, broken symlink target information, `src.orig`, branches, and stashes before rebaselining.
4. **Premature abstraction/package sprawl.** Mitigate by requiring a runtime/security/release reason for each package and delaying product domains until a second consumer exists.
5. **Subprocess and credential exposure.** Mitigate with canonical paths, capability grants, minimal environments, opaque credentials, protected session handles, and adversarial security tests.

# Decision Checklist

The user must approve these before implementation:

- [ ] Preserve the current dirty Jini state, then establish a clean engine baseline rather than refactoring the copied product tree.
- [ ] Canonical Jini repository owner/URL and whether it will be public.
- [ ] Apache-2.0 plus Open Design attribution/NOTICE policy.
- [ ] Publishable package scope, such as `@jini/*`.
- [ ] Package-first strangler strategy and two-repository ownership model.
- [ ] Initial runtime order: Codex first, Claude second.
- [ ] The concrete second consumer and its minimum acceptance workflow.
- [ ] Vendored/subtree synchronization policy for `AI-Dev-Shop/`.
- [ ] Permission for `project-runner` to create/delete remote lease branches and isolated worktrees.
- [ ] Security defaults for subprocess sandboxing, network access, tool grants, and telemetry.
- [ ] Which server-rewrite tests or patches should be recovered; no stale rewrite branch should be merged wholesale.
- [ ] Whether the frontend memory-slice and other local/stashed refactors should be rebased, archived, or completed separately.
- [ ] Release/deprecation window and how long Open Design legacy paths remain available.

## Self-assessment against the rubric

| Dimension | Score | Reason |
|---|---:|---|
| Reusability | 5 | Core packages prohibit product dependencies and require a second consumer. |
| Incremental migration | 5 | Capability-level flags, shadowing, and rollback are explicit. |
| Boundary clarity | 5 | Ports, package dependencies, composition ownership, and forbidden dependencies are defined. |
| Compatibility discipline | 5 | Conformance kits, source maps, golden traces, and exact pins prevent silent drift. |
| Frontend composability | 4 | Strong headless/slot design, but extraction remains substantial. |
| Runtime extensibility | 5 | Rich capability negotiation avoids a lowest-common-denominator adapter. |
| Operational safety | 4 | Security and recovery are explicit; implementation evidence is still pending. |
| Cloud resumability | 5 | Durable tasks, CAS leases, attempts, validation, and deterministic selection are specified. |
| Maintainability | 4 | Boundaries are strong, but the package count requires discipline. |
| Cost efficiency | 4 | Deterministic/scoped analysis is prioritized; full extraction remains expensive. |
| Provenance and sync | 5 | No duplicated source tree; locks, source maps, ownership, and licensing are explicit. |
| Time to first value | 4 | First executable runtime slice arrives early, though initial repository preservation is necessary. |

<<JINI_DEBATE_SUBMISSION_END>>
SEAT1_DONE exit=0
