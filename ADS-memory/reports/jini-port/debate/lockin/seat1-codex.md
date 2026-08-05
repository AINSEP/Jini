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
session id: 019f6c1e-0880-7502-b80e-4a65391ed706
--------
user
# Jini Engine — Round 2: Break the "A" kernel, then lock it

You are ONE independent expert. You will NOT see other reviewers' answers. The architecture is DECIDED: Option A — a small kernel + typed route-pack/provider registration contract, with OD's daemon as the first adapter behind the facade. Your job is NOT to propose a different architecture and NOT to copy any other codebase's structure. Your job is to **try to break THIS specific design** against four criteria, then tell us how to lock it.

## Read

- THE DESIGN (attack this): `.../jini-debate/A-design.md`
- Round-1 convergent conclusions (context): `.../jini-debate/round1-synthesis.md`
- Constraint (no OD tilt, many consumers): `.../jini-debate/round2-constraint.md`
(dir: `/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/`)

Grounding repos (read-only; verify claims here): `/Users/la/Desktop/Programming/OSS-Repos/open-design` and `open-design-agentic`, and consumers `/Users/la/Desktop/Programming/{Open-Marketing,Tovu-Runner}`.

IMPORTANT SCOPE:
- Architecture is A. Do not relitigate A-vs-alternatives.
- bolt.diy is a FEATURE WISHLIST (deploy, live preview, terminal, diff/lock), NOT architecture to copy. Do not propose importing its structure.
- OD-sync is a hard requirement (the OD daemon stays format-patch-able as the first adapter). A fix that breaks OD-sync is not acceptable.

## Evaluate the design against these four criteria via concrete scenarios

Criteria: **M1 Modularity** (one change → one module; impls swappable) · **M2 Extensibility** (add provider/tool/agent/consumer = additive, zero central-switchboard edit) · **M3 Scale** (holds at 30 providers / 50 tools / 5 consumers without the composition root or types degrading) · **M4 Minimal integration complexity** (fewest moving parts for a new consumer to get chat+runs working).

Run the design through these scenarios and report where it strains or breaks:
- **S1** Add a "deploy to Netlify" provider — files/packages touched? any kernel edit? (M1/M2)
- **S2** Add a new coding-agent CLI — zero-switchboard? (M2)
- **S3** Stand up a brand-new product wanting only chat+runs — minimum it must implement (M4)
- **S4** Swap a provider impl (e.g. sqlite persistence → postgres) — blast radius (M1)
- **S5** A consumer using NONE of OD's design/artifact concepts — does `createDaemon` boot green? (tilt test)
- **S6** Scale to 30 providers / 50 tools / 5 route-packs — does the union-of-deps composition type explode or stay legible? (M3)
- **S7** An upstream OD security fix lands on OD's daemon — does it still `format-patch` into `products/open-design/daemon/`? (OD-sync test)

## Produce (decisive; ~1,500-2,000 words)

1. **Does A-design pass S1-S7?** Verdict per scenario (pass / strains / breaks) with the specific reason.
2. **The sharpest flaws** — 4-6 concrete weaknesses in THIS design (kernel noun set, the union-of-deps composition contract, the app-service layer, the tool-exec boundary, the OD-first-adapter/sync seam, the package cut). Each: flaw → why it bites → concrete fix. Be specific about the composition contract — is "union of route-pack deps" actually sound and legible at scale, or does it need a different mechanism (e.g. typed provider tokens / a DI container / capability tokens)?
3. **The locked package set + composition contract** — your final corrected version of A-design's package list and the `createDaemon` contract. Small deltas only; this is lock-in, not redesign.
4. **First 10 extraction tasks** — dependency-ordered, resumable, each with an acceptance gate that proves neutrality (non-OD fixture boot / packed-tarball) AND preserves OD-sync.
5. **The one thing most likely to make A rot over 2 years**, and the guardrail that prevents it.

Ground claims in the real repos. Distinguish verified from inferred. Read-only. Your entire final message IS your answer.

codex
I’ll treat this as an architecture stress review, using the `understand` codebase-analysis skill because the answer needs verified repo grounding. I’ll first read its instructions and the three debate documents, then inspect the relevant daemon, agentic, and consumer seams read-only.
exec
/bin/bash -lc "sed -n '1,240p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
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


exec
/bin/bash -lc "wc -l /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md && sed -n '241,520p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md && sed -n '521,900p' /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
     838 /Users/la/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md
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

codex
The full `understand` workflow would generate graph files and delegate batch analysis; this review is explicitly read-only and does not authorize sub-agents, so I’m limiting the skill’s influence to its architecture-oriented inspection method. I’ll use the repository’s existing knowledge graph if available, then targeted source reads for evidence.
exec
/bin/bash -lc "wc -l \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/A-design.md\" \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1-synthesis.md\" \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round2-constraint.md\" && sed -n '1,260p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/A-design.md\" && sed -n '1,260p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1-synthesis.md\" && sed -n '1,260p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round2-constraint.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
      91 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/A-design.md
      33 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1-synthesis.md
      14 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round2-constraint.md
     138 total
# Jini Engine — "A" Architecture (corrected kernel + ports), for lock-in

Decision made: **Option A** — an abstracted daemon kernel with a typed port/route-pack contract, with **OD's daemon as the first adapter behind the facade** (so upstream OD fixes still `git format-patch` in). This doc folds in the five round-1 fixes. Round 2's job: break this against modularity / extensibility / scale / minimal-integration-complexity, then lock it.

## Core principle

The engine is a **small kernel + a registration contract**. Products don't modify the kernel; they *register* providers, tools, and route-packs and supply their own dependency bundle. OD is just the first product.

## The kernel (drawn at the true minimum — round-1 fix #1)

The kernel knows only these neutral nouns. NO projects, artifacts, design-systems, brands, marketplace in the kernel.

- **RunLifecycle** — start/stream/cancel/resume an agent turn; owns run state.
- **EventSink / EventBus** — the normalized run-event stream (versioned; ordering, replay cursor, idempotency key, cancellation — round-1 fix #4).
- **AgentExecutor** — spawns/drives a coding-agent process via `@jini/agent-runtime` (the existing add-a-file/zero-switchboard registry).
- **ToolRegistry** — discover + call tools, with a real **execution boundary**: authorization, confirmation, audit, timeout, result-size limit (round-1 fix #4). "Tools" = actions.
- **ProviderRegistry** — pluggable infra capabilities keyed by kind: model backends, storage, auth, db, deploy targets, etc. "Providers" = infra. (Terminology fix #5: never say "capability" — it's `Provider` xor `Tool`.)
- **Principal/AuthN** — request principal + authorization context (not just a credential store — round-1 fix #4).

## Composition contract (round-1 fixes #2 and #3 — no global port bag)

There is **no single `DaemonPorts` object**. Instead:

- Each **route-pack** (a cohesive feature: chat, runs, terminal, or an OD product feature) declares its OWN dependency interface: `deps: { runStore, eventSink, … }`.
- The composition function computes the **union** of all registered route-packs' deps and requires the host to satisfy exactly that union. `createDaemon({ routePacks, providers })` → the type system rejects a daemon whose route-packs need a dep no provider supplies. This is a real check (not the vacuous `K extends keyof DaemonPorts`).
- Kernel services (RunLifecycle/EventSink/AgentExecutor/ToolRegistry/ProviderRegistry) are always present; everything else is a route-pack dep.

## App-service layer (round-1 fix #4)

Business logic lives in an **app-service layer** consumed identically by BOTH transports. Route handlers are thin.

- `@jini/http` — HTTP/SSE transport; registers route-packs; no business logic.
- `@jini/cli` — first-class CLI (`--json`, `--prompt-file`) over the SAME app-services. Dual-track is a first-class contract, not an afterthought (this is a big part of "agent-ready": external agents drive the engine via CLI/HTTP/MCP).

## OD as first adapter + the OD-sync strategy (your `daemon/` requirement)

- The engine lifts only the **genuinely generic, stable** parts of OD's daemon that OD already treats as reusable: `agent-runtime` (runtimes/defs/parsers/discovery), `platform`, `sidecar`. These rarely change shape, so lifting them doesn't break OD-sync much.
- OD's **product daemon stays OD-shaped** as the first adapter (`products/open-design/daemon/`), registering OD route-packs (design-systems, brands, figma, deploy-of-designs) and supplying OD's dep bundle. Because it stays structurally close to OD, `git format-patch` from upstream OD keeps applying to it.
- Net: you keep OD-fix-sync where the churn actually is (the product daemon), while the kernel stays clean and neutral.

## Package set (~10 engine packages)

```
@jini/protocol        versioned wire types: run events, tool/provider descriptors, errors,
                      cancellation/replay/idempotency semantics (pure TS, no deps)
@jini/kernel          RunLifecycle, EventSink, AgentExecutor, ToolRegistry, ProviderRegistry,
                      Principal/AuthN, the createDaemon composition function, app-service layer
@jini/agent-runtime   runtimes registry + per-CLI defs + stream parsers + discovery (add-a-file)
@jini/persistence     run/event/conversation stores behind ports; sqlite default impl
@jini/http            HTTP/SSE transport + route-pack registration
@jini/cli             first-class CLI over the app-services (--json)
@jini/platform        OS process/file primitives (verbatim lift)
@jini/sidecar         NDJSON-IPC runtime (+ sidecar-proto; identity injected)
@jini/chat-core       framework-free chat types + pure parsers
@jini/chat-react      refactored ChatPane/ChatComposer → headless hooks + slots
@jini/artifacts-react renderer registry + srcDoc sandbox
@jini/components      generic primitives
# deferred until a 2nd host exists: @jini/desktop-host (electron/tauri + RenderService port)
```

## Products & consumers (separate repos, consume packed/published @jini/*)

```
products/open-design/   OD daemon adapter (format-patch target) + OD route-packs + design/brands/figma + OD web
                        (may live in its own repo; consumes @jini/* as published packages)
```
OD, Open-Marketing, Tovu-Runner are each their own repo consuming `@jini/*`. NO consumer-shaped folders inside the engine — only `examples/minimal-host/` (imports ONLY @jini/*, the neutrality lint target + CI smoke).

## Neutrality gate (round-1 fix #3 — prove, don't assert)

Acceptance for the kernel = a **non-OD fixture** (`examples/minimal-host`) boots `createDaemon` with a stub provider bundle (no project/design/artifact concepts) and completes a chat run + a tool call. API-snapshot review on every `@jini/*` public surface. NOT "OD still works."

## Automation (separate repo, per round-1)

AI-Dev-Shop (pipeline defs) + ADS-memory (durable decisions) + project-runner (execution runtime: queue/lease/sandbox). Consumed by Jini and every consumer alike; not inside the engine.

## Roadmap modules (bolt.diy WISHLIST — features to add later, NOT architecture to copy)

These are `ProviderRegistry`/`ToolRegistry` entries or small modules added when needed — they do not shape the kernel:
- `@jini/deploy` — Netlify / Vercel / GitHub Pages deploy-target providers.
- `code-exec` / live dev-server preview — a provider + preview-URL contract (impl later).
- `terminal` — PTY provider.
- diff-review + edit-lock — tool-execution-boundary UI helpers.

## The five round-1 fixes, mapped

1. Kernel drawn at true minimum (not de-branded ServerContext) → the kernel noun list above.
2. Real composition check (union of route-pack deps) not vacuous `PortsCoverRoutes`.
3. Neutrality proven by non-OD fixture boot + API snapshots.
4. Added: CLI package, shared app-service layer, protocol versioning/cancellation/replay, tool-exec security boundary, Principal/AuthN.
5. Terminology locked: `Provider` (infra) vs `Tool` (action); "capability" banned.
# Round 1 Structure Debate — Convergent Conclusions (input to round 2)

Three independent seats (codex gpt-5.6-sol, agy Gemini 3.1 Pro, Claude Fable 5) critiqued the proposed Jini structure. They converged strongly. Summary of what they agreed on (this is the CURRENT best direction — round 2 must harden it OR beat it):

## Unanimous conclusions

1. **Eject `foundry/integrations/open-design` from the engine repo.** Publish `@jini/*`; every consumer (OD, Open-Marketing, Zana, Tovu) is its own repo consuming versioned/packed packages. An in-tree favored consumer guarantees the engine boundary warps to serve it. Test consumers against `pnpm pack` tarballs, never embed one.

2. **Drop `workspace-react`.** The app shell IS product identity → per-product. Engine ships headless hooks (`chat-react`) + dumb primitives (`components`) only.

3. **The `createDaemon({10 ports})` spine is a hidden OD tilt** — a de-branded OD `ServerContext` (verified ~40 mostly-`any` fields; ports encode WorkspaceStore-with-projects, listDesignSystems, artifact rendering, marketplace). `PortsCoverRoutes<>` is a vacuous type check. FIX: minimal kernel = lifecycle + run store + event sink + agent executor + **tool registry + provider registry**; each route pack brings its own deps; OD's ports become one product's injected bundle. Build the spine from the ZERO-OD consumer (Zana's ProviderRegistry/ToolRegistry), then prove OD fits.

4. **Merge ~19-23 packages → ~8.** sidecar-proto→sidecar; registry-protocol→plugin-runtime; release/metatool/download/diagnostics→parked tooling; persistence interfaces→core (+ `sqlite` adapter); defer `desktop-host` until a 2nd host exists; `agui` stays optional/consumer-side (its API is literally `encodeOdEventForAgui(OdNativeEvent)` — OD-bound, needs a neutral wire contract not a rename).

5. **Automation OUT of the engine repo** (separate repo). AI-Dev-Shop = pipeline defs (HOW); project-runner = execution service (WHICH/WHO/WHAT — queue/lease/sandbox/run-events); ADS-memory = durable decisions/knowledge. One canonical job state machine. (Verified: ADS-memory's specs_as_built/architecture.md is a placeholder, dependency-graph.yaml empty, two duplicate ADS-memory dirs — NOT adopt-as-is.)

6. **Provider/tool registry + capability descriptor = v1 core** (2 consumers re-derived it). **PARK code-exec + terminal impls** — Zana's capability packages are still stubs (built slice = core+db+ai+daemon only), so their isolation/lifecycle/security contract isn't real yet. Ship the port design doc, not the impl.

7. **Prove neutrality, don't infer it.** String-scans + zero-import moves ≠ semantic neutrality. Gate on a **Zana-shaped fixture booting the daemon with no project/artifact/design assumptions**, compiled against packed tarballs + API-snapshot review. Acceptance = zero-OD boot, NOT OD parity.

## Verified corrections to the original proposal

- agentic's Vite path is DEV-ONLY (vite.config says Next remains the production build) — production Vite is real unstarted work.
- Open-Marketing's product-neutrality.test.ts is weak (orchestrator-copy check, not OD-noun/route-semantics).
- ADS-memory is aspirational/duplicated, not adopt-as-is.

## Missing pieces the seats flagged (add to plan)

first-class CLI package + shared app-service layer used by BOTH http+cli · protocol versioning/replay-cursors/cancellation/idempotency · real tool-execution security boundary (authz/confirmation/audit/timeouts/result-limits) · auth/principals/tenancy (not just credential store) · plugin trust policy (signature/permissions/isolation) · production-Vite acceptance (Electron assets, deep links, CSP, offline) · threat models for imported workspaces/symlinks/PTY/srcDoc.

## Corrected consumer-fixture model (user correction)

NO consumer-shaped folders inside the engine. In-repo = only a tiny synthetic `examples/minimal-host` (imports ONLY @jini/*, the lint target + CI smoke). Real neutrality gate = each REAL external consumer repo (Zana/Tovu/OD/OM) consuming packed/published @jini/* in its own cross-repo CI.
# Round 2 — Binding constraint added by the user (applies to ALL seats)

The user has clarified the single most important requirement, and it overrides any round-1 assumption to the contrary:

**Jini is a GENERAL-PURPOSE reusable engine intended for MANY future projects — not for Open Design, and not for "Open Design + Tovu" specifically. The engine core must have NO Open Design tilt.**

Concretely:

1. **No OD tilt in the core.** Nothing Open-Design-specific may live in the engine packages. The core is designed to be adopted by arbitrary future products that are not yet known.
2. **Open Design is just the first consumer.** All OD-specific behavior — design systems, brands, design templates, figma, deploy, critique, marketplace, media pipeline, OD analytics, OD route shapes, OD data-root semantics — lives under `foundry/integrations/open-design/` (adapter + product data), NOT in the engine.
3. **Tovu (and any other current app) is another consumer, not a co-designer of the core.** Do NOT shape the core around the specific needs of OD or Tovu. The "two-consumer rule" is fine as an anti-over-abstraction check, but the target is genuine multi-project reusability, not a bespoke OD/Tovu shared core.
4. **This re-weights the evaluation.** Reusability and boundary-clarity (a second, third, Nth unrelated product can adopt the engine without importing product assumptions) now dominate. Any recommendation that gets the engine "born inside" the OD monorepo, or that treats OD product structure as the engine's natural shape, is disfavored unless it can show the core stays product-agnostic.

Every seat must now RE-EVALUATE its round-1 recommendation under this constraint: keep it, amend it, or change strategy — and say explicitly what changes and why.

mcp: codebase-memory-mcp/list_projects started
mcp: codebase-memory-mcp/list_projects (completed)
codex
The design documents expose the main tension already: “exact union of route-pack deps” promises compile-time closure, but does not specify identity, collision handling, optional/multi bindings, lifetimes, or runtime validation. I’m now checking whether today’s OD daemon and consumers make those omissions theoretical or immediately costly.
mcp: codebase-memory-mcp/get_architecture started
mcp: codebase-memory-mcp/get_architecture (failed)
user cancelled MCP tool call
mcp: codebase-memory-mcp/get_architecture started
mcp: codebase-memory-mcp/get_architecture (failed)
user cancelled MCP tool call
mcp: codebase-memory-mcp/get_architecture started
mcp: codebase-memory-mcp/get_architecture (failed)
user cancelled MCP tool call
mcp: codebase-memory-mcp/get_architecture started
mcp: codebase-memory-mcp/get_architecture (failed)
user cancelled MCP tool call
mcp: codebase-memory-mcp/get_architecture started
mcp: codebase-memory-mcp/get_architecture (failed)
user cancelled MCP tool call
exec
/bin/bash -lc "sed -n '1,260p' apps/AGENTS.md && sed -n '1,260p' apps/daemon/AGENTS.md 2>/dev/null || true && sed -n '1,220p' packages/AGENTS.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
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
/bin/bash -lc "wc -l apps/daemon/src/server.ts apps/daemon/src/server-context.ts apps/daemon/src/route-context-contract.ts apps/daemon/src/cli.ts && sed -n '1,260p' apps/daemon/src/server-context.ts && sed -n '1,260p' apps/daemon/src/route-context-contract.ts && rg --files apps/daemon/src/runtimes/defs apps/daemon/src/routes packages | sed -n '1,260p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
    8635 apps/daemon/src/server.ts
     148 apps/daemon/src/server-context.ts
      56 apps/daemon/src/route-context-contract.ts
   10071 apps/daemon/src/cli.ts
   18910 total
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
apps/daemon/src/runtimes/defs/cursor-agent.ts
apps/daemon/src/routes/vela.ts
apps/daemon/src/runtimes/defs/qoder.ts
apps/daemon/src/runtimes/defs/codex.ts
apps/daemon/src/runtimes/defs/grok-build.ts
apps/daemon/src/runtimes/defs/claude.ts
apps/daemon/src/runtimes/defs/mimo.ts
apps/daemon/src/runtimes/defs/copilot.ts
apps/daemon/src/routes/media.ts
apps/daemon/src/runtimes/defs/amp.ts
apps/daemon/src/routes/deploy.ts
apps/daemon/src/runtimes/defs/aider.ts
apps/daemon/src/routes/library.ts
apps/daemon/src/runtimes/defs/pi.ts
apps/daemon/src/routes/terminal.ts
apps/daemon/src/runtimes/defs/hermes.ts
apps/daemon/src/routes/memory.ts
apps/daemon/src/runtimes/defs/kilo.ts
apps/daemon/src/routes/whats-new.ts
apps/daemon/src/runtimes/defs/opencode.ts
apps/daemon/src/routes/handoff.ts
apps/daemon/src/runtimes/defs/shared.ts
apps/daemon/src/routes/static-resource.ts
apps/daemon/src/runtimes/defs/reasonix.ts
apps/daemon/src/routes/genui.ts
apps/daemon/src/routes/automation.ts
apps/daemon/src/runtimes/defs/trae-cli.ts
apps/daemon/src/routes/host-tools.ts
apps/daemon/src/runtimes/defs/deepseek.ts
apps/daemon/src/routes/telemetry.ts
apps/daemon/src/runtimes/defs/qwen.ts
apps/daemon/src/runtimes/defs/amr.ts
apps/daemon/src/routes/routine.ts
apps/daemon/src/runtimes/defs/kimi.ts
apps/daemon/src/runtimes/defs/codebuddy.ts
apps/daemon/src/runtimes/defs/kiro.ts
apps/daemon/src/runtimes/defs/antigravity.ts
apps/daemon/src/runtimes/defs/byok-opencode.ts
apps/daemon/src/runtimes/defs/devin.ts
apps/daemon/src/runtimes/defs/vibe.ts
apps/daemon/src/routes/project/index.ts
apps/daemon/src/routes/project/cancel-owned-runs.ts
apps/daemon/src/routes/project/conversations.ts
apps/daemon/src/routes/project/comments.ts
apps/daemon/src/routes/live-artifact.ts
apps/daemon/src/routes/chat.ts
apps/daemon/src/routes/active-context.ts
apps/daemon/src/routes/attribution.ts
apps/daemon/src/routes/social-share.ts
apps/daemon/src/routes/xai.ts
packages/agui-adapter/src/encode.ts
packages/agui-adapter/src/index.ts
packages/agui-adapter/src/types.ts
packages/agui-adapter/esbuild.config.mjs
packages/agui-adapter/tsconfig.json
packages/agui-adapter/package.json
packages/agui-adapter/tsconfig.tests.json
apps/daemon/src/routes/plugins/index.ts
apps/daemon/src/routes/plugins/assets.ts
apps/daemon/src/routes/plugins/marketplaces.ts
apps/daemon/src/routes/runs.ts
apps/daemon/src/routes/open-design-public-metadata.ts
apps/daemon/src/routes/design-systems.ts
apps/daemon/src/routes/design-system-tool.ts
apps/daemon/src/routes/daemon.ts
packages/plugin-runtime/src/digest.ts
packages/plugin-runtime/src/merge.ts
packages/plugin-runtime/src/resolve.ts
packages/plugin-runtime/src/pipeline-fallback.ts
packages/plugin-runtime/src/index.ts
packages/launcher-proto/src/index.ts
packages/launcher-proto/esbuild.config.mjs
packages/launcher-proto/tsconfig.json
packages/launcher-proto/package.json
packages/launcher-proto/tsconfig.tests.json
packages/agui-adapter/tests/encode.test.ts
packages/registry-protocol/tsconfig.json
packages/registry-protocol/package.json
packages/registry-protocol/tsconfig.tests.json
packages/registry-protocol/src/backend.ts
packages/registry-protocol/src/index.ts
packages/registry-protocol/src/schemas.ts
packages/registry-protocol/esbuild.config.mjs
packages/plugin-runtime/src/adapters/agent-skill.ts
packages/plugin-runtime/src/adapters/claude-plugin.ts
packages/plugin-runtime/src/validate.ts
packages/plugin-runtime/package.json
packages/plugin-runtime/tsconfig.tests.json
packages/launcher-proto/tests/index.test.ts
packages/contracts/esbuild.config.mjs
packages/contracts/tsconfig.json
packages/contracts/package.json
packages/registry-protocol/tests/backend.test.ts
packages/contracts/tsconfig.tests.json
packages/plugin-runtime/src/parsers/frontmatter.ts
packages/plugin-runtime/src/parsers/manifest.ts
packages/plugin-runtime/src/parsers/marketplace.ts
packages/diagnostics/src/redaction.ts
packages/diagnostics/src/agent-logs.ts
packages/diagnostics/src/index.ts
packages/diagnostics/src/manifest.ts
packages/diagnostics/src/zip.ts
packages/diagnostics/src/sources.ts
packages/plugin-runtime/esbuild.config.mjs
packages/diagnostics/src/contract.ts
packages/plugin-runtime/tsconfig.json
packages/diagnostics/vitest.config.ts
packages/diagnostics/esbuild.config.mjs
packages/diagnostics/tsconfig.json
packages/diagnostics/package.json
packages/contracts/src/plugins/index.ts
packages/contracts/src/plugins/manifest.ts
packages/contracts/src/plugins/events.ts
packages/contracts/src/plugins/scenario-defaults.ts
packages/contracts/src/plugins/share-actions.ts
packages/contracts/src/plugins/context.ts
packages/contracts/src/plugins/marketplace.ts
packages/contracts/src/plugins/plugin-url.ts
packages/contracts/src/plugins/installed.ts
packages/contracts/src/plugins/apply.ts
packages/contracts/src/errors.ts
packages/contracts/src/critique.ts
packages/contracts/src/index.ts
packages/host/src/detection.ts
packages/host/src/index.ts
packages/host/src/normalize.ts
packages/host/src/protocol.ts
packages/host/src/actions.ts
packages/host/src/testing.ts
packages/host/esbuild.config.mjs
packages/host/tsconfig.json
packages/host/package.json
packages/host/tsconfig.tests.json
packages/contracts/src/artifacts/od-card.ts
packages/plugin-runtime/tests/official-token-map.test.ts
packages/diagnostics/tests/zip.test.ts
packages/diagnostics/tests/redaction.test.ts
packages/diagnostics/tests/agent-logs.test.ts
packages/diagnostics/tests/crash-dumps.test.ts
packages/plugin-runtime/tests/pipeline-fallback.test.ts
packages/plugin-runtime/tests/adapter-agent-skill.test.ts
packages/plugin-runtime/tests/digest.test.ts
packages/plugin-runtime/tests/parsers.test.ts
packages/plugin-runtime/tests/validate.test.ts
packages/plugin-runtime/tests/merge.test.ts
packages/contracts/src/analytics/events/page-view.ts
packages/contracts/src/analytics/events/design-system-helpers.ts
packages/contracts/src/analytics/events/onboarding.ts
packages/contracts/src/analytics/events/ui-click.ts
packages/contracts/src/analytics/events/surface-view.ts
packages/contracts/src/analytics/events/event-payload.ts
packages/contracts/src/analytics/events/event-names.ts
packages/contracts/src/analytics/events/mappers.ts
packages/contracts/src/analytics/events/shared-enums.ts
packages/contracts/src/analytics/events/design-systems.ts
packages/contracts/src/analytics/events/result-events.ts
packages/contracts/src/analytics/index.ts
packages/contracts/src/analytics/events.ts
packages/contracts/src/analytics/observability.ts
packages/contracts/src/analytics/public-params.ts
packages/contracts/src/analytics/artifact-id.ts
packages/host/tests/index.test.ts
packages/contracts/tests/official-system-prompt.test.ts
packages/contracts/tests/analytics-design-system-helpers.test.ts
packages/contracts/tests/handoff-contract.test.ts
packages/contracts/tests/system-prompt-metadata-block.test.ts
packages/contracts/tests/plugin-url.test.ts
packages/contracts/tests/plugin-block.test.ts
packages/contracts/tests/run-completeness.test.ts
packages/contracts/tests/analytics-agent-provider.test.ts
packages/contracts/tests/analytics-session-mode.test.ts
packages/contracts/tests/mcp-run-contract.test.ts
packages/contracts/tests/atom-block.test.ts
packages/contracts/tests/analytics-project-kind.test.ts
packages/contracts/tests/components-manifest.test.ts
packages/contracts/tests/scenario-defaults.test.ts
packages/contracts/tests/system-prompt-api-mode.test.ts
packages/contracts/tests/errors.test.ts
packages/contracts/tests/plugins-manifest.test.ts
packages/contracts/tests/system-prompt-audio-voices.test.ts
packages/contracts/tests/library-upload-policy.test.ts
packages/contracts/tests/system-prompt-web-clone.test.ts
packages/contracts/tests/system-prompt.test.ts
packages/contracts/tests/amr-wallet.test.ts
packages/contracts/tests/critique.test.ts
packages/contracts/tests/analytics-run-finished-contract.test.ts
packages/contracts/tests/package-runtime.test.ts
packages/contracts/tests/directions.test.ts
packages/contracts/tests/media-contracts.test.ts
packages/contracts/tests/deck-stage-fallback.test.ts
packages/contracts/tests/connection-test.test.ts
packages/contracts/tests/system-prompt-active-design-system.test.ts
packages/contracts/tests/social-share.test.ts
packages/contracts/tests/automations.test.ts
packages/contracts/tests/error-codes.test.ts
packages/contracts/src/sse/proxy.ts
packages/contracts/src/sse/chat.ts
packages/contracts/src/common.ts
packages/contracts/src/sse/common.ts
packages/contracts/src/examples.ts
packages/contracts/src/execution-profile.ts
packages/contracts/src/design-systems/components-manifest.ts
packages/contracts/src/design-systems/token-schema.ts
packages/contracts/src/design-systems/derived-token-outputs.ts
packages/contracts/src/tasks.ts
packages/contracts/src/agent-tools/descriptor.ts
packages/contracts/src/agent-tools/task.ts
packages/contracts/src/agent-tools/index.ts
packages/contracts/src/agent-tools/manifest.ts
packages/contracts/src/agent-tools/registry.ts
packages/contracts/src/agent-tools/actions.ts
packages/contracts/src/runtime/deck-stage-fallback.ts
packages/contracts/src/api/routines.ts
packages/contracts/src/api/projects.ts
packages/contracts/src/api/plugin-candidates.ts
packages/contracts/src/api/app-config.ts
packages/contracts/src/api/figma.ts
packages/contracts/src/api/comments.ts
packages/contracts/src/api/amrWallet.ts
packages/contracts/src/api/workspaces.ts
packages/contracts/tests/context-schema.test.ts
packages/contracts/src/api/social-share.ts
packages/contracts/src/api/mcp.ts
packages/contracts/src/api/agent-sessions.ts
packages/contracts/src/api/brands.ts
packages/contracts/src/api/artifacts.ts
packages/contracts/src/api/github.ts
packages/contracts/src/api/automations.ts
packages/contracts/src/api/context.ts
packages/contracts/src/api/community.ts
packages/contracts/src/api/attribution.ts
packages/contracts/src/api/chat.ts
packages/contracts/src/api/live-artifacts.ts
packages/sidecar-proto/src/index.ts
packages/contracts/src/prompts/deck-framework.ts
packages/contracts/src/prompts/atom-block.ts
packages/contracts/src/prompts/system.ts
packages/sidecar-proto/esbuild.config.mjs
packages/contracts/src/prompts/media-contract.ts
packages/sidecar-proto/tsconfig.json
packages/contracts/src/prompts/discovery.ts
packages/sidecar-proto/package.json
packages/contracts/src/prompts/directions.ts
packages/sidecar-proto/tsconfig.tests.json
packages/contracts/src/prompts/plugin-block.ts
packages/contracts/src/prompts/official-system.ts
packages/contracts/src/api/providerModels.ts
packages/contracts/src/api/finalize.ts
packages/contracts/src/api/export.ts
packages/contracts/src/api/connectionTest.ts
packages/contracts/src/api/host-tools.ts
packages/contracts/src/api/proxy.ts
packages/sidecar/package.json
packages/sidecar/tsconfig.tests.json
packages/sidecar/tsconfig.json
packages/sidecar/esbuild.config.mjs
packages/AGENTS.md
packages/download/tsconfig.json
packages/download/package.json
packages/download/tsconfig.tests.json

exec
/bin/bash -lc "rg -n \"runtimes/defs|from './defs|from \\\"./defs|RUNTIME|runtimeDefs|RuntimeAgentDef|SUBCOMMAND_MAP|register.*Routes\\(\" apps/daemon/src/runtimes apps/daemon/src/agents.ts apps/daemon/src/server.ts apps/daemon/src/cli.ts | sed -n '1,300p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
apps/daemon/src/runtimes/amr-model-probe.ts:34:    velaRuntimeKey: env.VELA_RUNTIME_KEY ?? '',
apps/daemon/src/runtimes/chat-run-lifecycle.ts:9:      `RuntimeAgentDef.inactivityTimeoutMs must be a non-negative integer, got ${String(agentDefault)}. ` +
apps/daemon/src/runtimes/prompt-budget.ts:1:import type { RuntimeAgentDef, RuntimePromptBudgetError } from './types.js';
apps/daemon/src/runtimes/prompt-budget.ts:4:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/prompt-budget.ts:42:  def: RuntimeAgentDef | null | undefined,
apps/daemon/src/runtimes/prompt-budget.ts:151:  def: RuntimeAgentDef | null | undefined,
apps/daemon/src/runtimes/prompt-budget.ts:218:  def: RuntimeAgentDef | null | undefined,
apps/daemon/src/runtimes/defs/qwen.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/qwen.ts:29:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/cursor-agent.ts:3:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/cursor-agent.ts:106:} satisfies RuntimeAgentDef;
apps/daemon/src/server.ts:219:} from './runtimes/defs/amr.js';
apps/daemon/src/server.ts:763:// Defined after RUNTIME_DATA_DIR is resolved below.
apps/daemon/src/server.ts:807:const RUNTIME_DATA_DIR = resolveDataDir(process.env.OD_DATA_DIR, PROJECT_ROOT, {
apps/daemon/src/server.ts:810:const SANDBOX_RUNTIME = resolveSandboxRuntimeConfig(SANDBOX_MODE_ENABLED, RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:811:ensureSandboxRuntimeDirs(SANDBOX_RUNTIME);
apps/daemon/src/server.ts:812:const PLUGIN_LOCKFILE_PATH = path.join(RUNTIME_DATA_DIR, 'od-plugin-lock.json');
apps/daemon/src/server.ts:813:// Canonical (realpath-resolved) form of RUNTIME_DATA_DIR for the few callers
apps/daemon/src/server.ts:816:// and would never start-with the raw RUNTIME_DATA_DIR. Keep RUNTIME_DATA_DIR
apps/daemon/src/server.ts:819:const RUNTIME_DATA_DIR_CANONICAL = (() => {
apps/daemon/src/server.ts:821:    return fs.realpathSync(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:823:    return RUNTIME_DATA_DIR;
apps/daemon/src/server.ts:833:  dataDir: RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:835:const ARTIFACTS_DIR = path.join(RUNTIME_DATA_DIR, 'artifacts');
apps/daemon/src/server.ts:839:const CRITIQUE_ARTIFACTS_DIR = path.join(RUNTIME_DATA_DIR, 'critique-artifacts');
apps/daemon/src/server.ts:840:const PROJECTS_DIR = path.join(RUNTIME_DATA_DIR, 'projects');
apps/daemon/src/server.ts:841:const USER_SKILLS_DIR = path.join(RUNTIME_DATA_DIR, 'skills');
apps/daemon/src/server.ts:842:const USER_DESIGN_SYSTEMS_DIR = path.join(RUNTIME_DATA_DIR, 'design-systems');
apps/daemon/src/server.ts:845:const BRANDS_DIR = path.join(RUNTIME_DATA_DIR, 'brands');
apps/daemon/src/server.ts:846:const PLUGIN_REGISTRY_ROOTS = registryRootsForDataDir(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:850:  cacheDir: path.join(RUNTIME_DATA_DIR, 'plugin-asset-cache'),
apps/daemon/src/server.ts:855:const USER_DESIGN_TEMPLATES_DIR = path.join(RUNTIME_DATA_DIR, 'design-templates');
apps/daemon/src/server.ts:871:// the clipper / `od library import`. Derived from RUNTIME_DATA_DIR per the
apps/daemon/src/server.ts:873:const LIBRARY_DIR = path.join(RUNTIME_DATA_DIR, 'library');
apps/daemon/src/server.ts:879:const orbitService = new OrbitService(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:1093:      OD_DATA_DIR: RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:1097:    SANDBOX_RUNTIME,
apps/daemon/src/server.ts:1103:  if (SANDBOX_RUNTIME.enabled) {
apps/daemon/src/server.ts:1179:    OD_DATA_DIR: RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:1196:    OD_DATA_DIR: RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:1414:  // `RuntimeAgentDef.resumesSessionViaCli`.
apps/daemon/src/server.ts:2246:  const db = openDatabase(PROJECT_ROOT, { dataDir: RUNTIME_DATA_DIR });
apps/daemon/src/server.ts:2274:  configureConnectorCredentialStore(new FileConnectorCredentialStore(RUNTIME_DATA_DIR));
apps/daemon/src/server.ts:2275:  configureComposioConfigStore(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:2276:  composioConnectorProvider.configureCatalogCache(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:2430:  void readAppConfig(RUNTIME_DATA_DIR)
apps/daemon/src/server.ts:2448:  registerMemoryRoutes(app, {
apps/daemon/src/server.ts:2450:    paths: { RUNTIME_DATA_DIR, PROJECT_ROOT, PROJECTS_DIR },
apps/daemon/src/server.ts:2454:  registerAutomationRoutes(app, {
apps/daemon/src/server.ts:2455:    paths: { RUNTIME_DATA_DIR },
apps/daemon/src/server.ts:2469:  const telemetry = registerTelemetryRoutes(app, {
apps/daemon/src/server.ts:2470:    dataDir: RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:2478:      runsLogDir: path.join(RUNTIME_DATA_DIR, 'runs'),
apps/daemon/src/server.ts:2506:    dataDir: RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:2576:  const attributionService = registerAttributionRoutes(app, {
apps/daemon/src/server.ts:2580:    paths: { RUNTIME_DATA_DIR },
apps/daemon/src/server.ts:2589:    RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:2590:    RUNTIME_DATA_DIR_CANONICAL,
apps/daemon/src/server.ts:2642:  registerDaemonRoutes(app, {
apps/daemon/src/server.ts:2644:    paths: { RUNTIME_DATA_DIR },
apps/daemon/src/server.ts:2649:    sandboxRuntime: SANDBOX_RUNTIME,
apps/daemon/src/server.ts:2654:  registerOpenDesignPublicMetadataRoutes(app, {
apps/daemon/src/server.ts:2659:  registerWhatsNewRoutes(app, {
apps/daemon/src/server.ts:2663:  registerPluginEventRoutes(app, {
apps/daemon/src/server.ts:2667:  registerConnectorRoutes(app, {
apps/daemon/src/server.ts:2686:      runsDir: path.join(RUNTIME_DATA_DIR, 'runs'),
apps/daemon/src/server.ts:2687:      dataDir: RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:2878:  registerMcpRoutes(app, {
apps/daemon/src/server.ts:2883:  registerXaiRoutes(app, {
apps/daemon/src/server.ts:2888:  registerActiveContextRoutes(app, {
apps/daemon/src/server.ts:2893:  registerHostToolsRoutes(app, {
apps/daemon/src/server.ts:2901:  registerLibraryRoutes(app, {
apps/daemon/src/server.ts:2950:  registerSocialShareRoutes(app, { http: httpDeps });
apps/daemon/src/server.ts:2951:  registerProjectRoutes(app, {
apps/daemon/src/server.ts:2968:  registerTerminalRoutes(app, {
apps/daemon/src/server.ts:2976:  registerImportRoutes(app, {
apps/daemon/src/server.ts:2992:  registerStaticResourceRoutes(app, {
apps/daemon/src/server.ts:3018:  registerDesignSystemRoutes(app, {
apps/daemon/src/server.ts:3044:  registerBrandRoutes(app, {
apps/daemon/src/server.ts:3049:    dataDir: RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:3054:      const config = await readAppConfig(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:3072:  registerProjectArtifactRoutes(app, {
apps/daemon/src/server.ts:3079:  registerLiveArtifactRoutes(app, {
apps/daemon/src/server.ts:3087:  registerDesignSystemToolRoutes(app, {
apps/daemon/src/server.ts:3098:  registerDeployRoutes(app, {
apps/daemon/src/server.ts:3106:  registerFinalizeRoutes(app, {
apps/daemon/src/server.ts:3114:  registerHandoffRoutes(app, {
apps/daemon/src/server.ts:3123:  registerDeploymentCheckRoutes(app, { db, http: httpDeps, deploy: deployDeps });
apps/daemon/src/server.ts:3125:  registerProjectExportRoutes(app, {
apps/daemon/src/server.ts:3136:  registerProjectFileRoutes(app, {
apps/daemon/src/server.ts:3149:  registerMediaRoutes(app, {
apps/daemon/src/server.ts:3166:  registerVelaRoutes(app, {
apps/daemon/src/server.ts:3167:    paths: { RUNTIME_DATA_DIR },
apps/daemon/src/server.ts:3387:  registerPluginRoutes(app, {
apps/daemon/src/server.ts:3414:  registerAtomRoutes(app, {
apps/daemon/src/server.ts:3418:  registerPluginMarketplaceRoutes(app, {
apps/daemon/src/server.ts:3424:  registerPluginAssetRoutes(app, {
apps/daemon/src/server.ts:3433:  registerGenuiRoutes(app, {
apps/daemon/src/server.ts:3439:  registerProjectPluginRoutes(app, {
apps/daemon/src/server.ts:3466:  registerProjectUploadRoutes(app, {
apps/daemon/src/server.ts:3498:      appConfigForPrompt = await readAppConfig(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:3744:      memoryBody = await composeMemoryBody(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:3757:      const memCfg = await readMemoryConfig(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:4276:        return design.runs.fail(run, 'AGENT_RUNTIME_DEF_INVALID', err.message);
apps/daemon/src/server.ts:4315:        await extractFromMessage(RUNTIME_DATA_DIR, message);
apps/daemon/src/server.ts:4466:    if (!SANDBOX_RUNTIME.enabled) {
apps/daemon/src/server.ts:4468:        externalMcpConfig = await readMcpConfig(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:4485:      sandboxMode: SANDBOX_RUNTIME.enabled,
apps/daemon/src/server.ts:4490:        const stored = await readAllTokens(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:4502:                RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:4778:      const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:4818:        const resumeProbe = await resolveAmrModelProbe({ dataDir: RUNTIME_DATA_DIR, env: process.env, readAppConfig });
apps/daemon/src/server.ts:5656:        const probe = await resolveAmrModelProbe({ dataDir: RUNTIME_DATA_DIR, env: process.env, readAppConfig });
apps/daemon/src/server.ts:5824:        './runtimes/defs/antigravity.js'
apps/daemon/src/server.ts:6363:          './runtimes/defs/antigravity.js'
apps/daemon/src/server.ts:6465:            RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:6481:                  RUNTIME_DATA_DIR,
apps/daemon/src/server.ts:7919:    const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:8060:  registerRunRoutes(app, {
apps/daemon/src/server.ts:8064:    paths: { PROJECTS_DIR, RUNTIME_DATA_DIR },
apps/daemon/src/server.ts:8090:    const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
apps/daemon/src/server.ts:8395:          const evolution = await ingestRoutineConnectorEvolution(RUNTIME_DATA_DIR, {
apps/daemon/src/server.ts:8494:  registerRoutineRoutes(app, {
apps/daemon/src/server.ts:8496:    paths: { RUNTIME_DATA_DIR },
apps/daemon/src/server.ts:8508:  registerChatRoutes(app, {
apps/daemon/src/runtimes/models.ts:1:import type { RuntimeAgentDef, RuntimeModelOption } from './types.js';
apps/daemon/src/runtimes/models.ts:56:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/models.ts:76:  def: RuntimeAgentDef,
apps/daemon/src/cli.ts:56:// below: top-level `await SUBCOMMAND_MAP[first](rest)` runs runMedia
apps/daemon/src/cli.ts:93:// above: `od mcp install <agent>` dispatches through SUBCOMMAND_MAP during
apps/daemon/src/cli.ts:260:// top-of-file SUBCOMMAND_MAP dispatch during module evaluation; a `const`
apps/daemon/src/cli.ts:273:// reachable through the top-of-file SUBCOMMAND_MAP dispatch, which runs during
apps/daemon/src/cli.ts:283:// SUBCOMMAND_MAP dispatch, which runs during module evaluation —
apps/daemon/src/cli.ts:315:const SUBCOMMAND_MAP = {
apps/daemon/src/cli.ts:497:if (first && SUBCOMMAND_MAP[first]) {
apps/daemon/src/cli.ts:500:  await SUBCOMMAND_MAP[first](rest);
apps/daemon/src/runtimes/defs/amr.ts:6:import type { RuntimeAgentDef, RuntimeModelOption } from '../types.js';
apps/daemon/src/runtimes/defs/amr.ts:29://   VELA_RUNTIME_KEY  — OpenRouter (or compatible) API key
apps/daemon/src/runtimes/defs/amr.ts:671:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/prompt-file.ts:4:import type { RuntimeAgentDef } from './types.js';
apps/daemon/src/runtimes/prompt-file.ts:12:  def: RuntimeAgentDef | null | undefined,
apps/daemon/src/runtimes/defs/qoder.ts:3:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/qoder.ts:58:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/types.ts:67:// Marker on a RuntimeAgentDef declaring that the adapter's CLI maintains
apps/daemon/src/runtimes/types.ts:98:export type RuntimeAgentDef = {
apps/daemon/src/runtimes/types.ts:253:  RuntimeAgentDef,
apps/daemon/src/runtimes/auth.ts:3:import type { RuntimeAgentDef, RuntimeEnv } from './types.js';
apps/daemon/src/runtimes/auth.ts:358:  def: Pick<RuntimeAgentDef, 'id' | 'name' | 'authProbe'>,
apps/daemon/src/runtimes/defs/kimi.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/kimi.ts:27:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/local-profiles.ts:13:  RuntimeAgentDef,
apps/daemon/src/runtimes/local-profiles.ts:18:const RUNTIME_PROJECT_ROOT = path.resolve(
apps/daemon/src/runtimes/local-profiles.ts:42:      RUNTIME_PROJECT_ROOT,
apps/daemon/src/runtimes/local-profiles.ts:127:  baseDefs: RuntimeAgentDef[],
apps/daemon/src/runtimes/local-profiles.ts:128:): RuntimeAgentDef | null {
apps/daemon/src/runtimes/local-profiles.ts:199:  baseDefs: RuntimeAgentDef[],
apps/daemon/src/runtimes/local-profiles.ts:200:): RuntimeAgentDef[] {
apps/daemon/src/runtimes/local-profiles.ts:216:  const defs: RuntimeAgentDef[] = [];
apps/daemon/src/runtimes/env.ts:24:const RUNTIME_MODULE_PROJECT_ROOT = resolveProjectRootFromNestedModule(
apps/daemon/src/runtimes/env.ts:211:    RUNTIME_MODULE_PROJECT_ROOT,
apps/daemon/src/runtimes/defs/codex.ts:3:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/codex.ts:207:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/launch.ts:4:import type { RuntimeAgentDef } from './types.js';
apps/daemon/src/runtimes/launch.ts:16:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/defs/codebuddy.ts:3:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/codebuddy.ts:127:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/detection.ts:23:  RuntimeAgentDef,
apps/daemon/src/runtimes/detection.ts:47:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/detection.ts:58:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/detection.ts:126:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/detection.ts:157:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/detection.ts:176:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/detection.ts:200:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/detection.ts:268:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/detection.ts:298:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/detection.ts:316:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/defs/grok-build.ts:3:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/grok-build.ts:110:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/mcp.ts:1:import type { RuntimeAgentDef } from './types.js';
apps/daemon/src/runtimes/mcp.ts:10:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/diagnostics.ts:4:import type { AgentDiagnostic, RuntimeAgentDef } from './types.js';
apps/daemon/src/runtimes/diagnostics.ts:23:  def: Pick<RuntimeAgentDef, 'id' | 'name' | 'bin'>,
apps/daemon/src/runtimes/diagnostics.ts:61:  def: Pick<RuntimeAgentDef, 'id' | 'name'>,
apps/daemon/src/runtimes/diagnostics.ts:88:  def: Pick<RuntimeAgentDef, 'id' | 'name'>,
apps/daemon/src/runtimes/defs/kiro.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/kiro.ts:21:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/hermes.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/hermes.ts:52:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/registry.ts:1:import { amrAgentDef } from './defs/amr.js';
apps/daemon/src/runtimes/registry.ts:2:import { claudeAgentDef } from './defs/claude.js';
apps/daemon/src/runtimes/registry.ts:3:import { codexAgentDef } from './defs/codex.js';
apps/daemon/src/runtimes/registry.ts:4:import { devinAgentDef } from './defs/devin.js';
apps/daemon/src/runtimes/registry.ts:5:import { opencodeAgentDef } from './defs/opencode.js';
apps/daemon/src/runtimes/registry.ts:6:import { byokOpenCodeAgentDef } from './defs/byok-opencode.js';
apps/daemon/src/runtimes/registry.ts:7:import { hermesAgentDef } from './defs/hermes.js';
apps/daemon/src/runtimes/registry.ts:8:import { traeCliAgentDef } from './defs/trae-cli.js';
apps/daemon/src/runtimes/registry.ts:9:import { grokBuildAgentDef } from './defs/grok-build.js';
apps/daemon/src/runtimes/registry.ts:10:import { kimiAgentDef } from './defs/kimi.js';
apps/daemon/src/runtimes/registry.ts:11:import { cursorAgentDef } from './defs/cursor-agent.js';
apps/daemon/src/runtimes/registry.ts:12:import { qwenAgentDef } from './defs/qwen.js';
apps/daemon/src/runtimes/registry.ts:13:import { qoderAgentDef } from './defs/qoder.js';
apps/daemon/src/runtimes/registry.ts:14:import { copilotAgentDef } from './defs/copilot.js';
apps/daemon/src/runtimes/registry.ts:15:import { ampAgentDef } from './defs/amp.js';
apps/daemon/src/runtimes/registry.ts:16:import { piAgentDef } from './defs/pi.js';
apps/daemon/src/runtimes/registry.ts:17:import { kiroAgentDef } from './defs/kiro.js';
apps/daemon/src/runtimes/registry.ts:18:import { kiloAgentDef } from './defs/kilo.js';
apps/daemon/src/runtimes/registry.ts:19:import { vibeAgentDef } from './defs/vibe.js';
apps/daemon/src/runtimes/registry.ts:20:import { deepseekAgentDef } from './defs/deepseek.js';
apps/daemon/src/runtimes/registry.ts:21:import { aiderAgentDef } from './defs/aider.js';
apps/daemon/src/runtimes/registry.ts:22:import { antigravityAgentDef } from './defs/antigravity.js';
apps/daemon/src/runtimes/registry.ts:23:import { codebuddyAgentDef } from './defs/codebuddy.js';
apps/daemon/src/runtimes/registry.ts:24:import { reasonixAgentDef } from './defs/reasonix.js';
apps/daemon/src/runtimes/registry.ts:25:import { mimoAgentDef } from './defs/mimo.js';
apps/daemon/src/runtimes/registry.ts:27:import type { RuntimeAgentDef } from './types.js';
apps/daemon/src/runtimes/registry.ts:29:const BASE_AGENT_DEFS: RuntimeAgentDef[] = [
apps/daemon/src/runtimes/registry.ts:58:  baseDefs: RuntimeAgentDef[] = BASE_AGENT_DEFS,
apps/daemon/src/runtimes/registry.ts:59:): RuntimeAgentDef[] {
apps/daemon/src/runtimes/registry.ts:63:export const AGENT_DEFS: RuntimeAgentDef[] = [
apps/daemon/src/runtimes/registry.ts:76:export function getAgentDef(id: string): RuntimeAgentDef | null {
apps/daemon/src/runtimes/defs/byok-opencode.ts:3:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/byok-opencode.ts:23:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/antigravity.ts:12:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/antigravity.ts:254:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/claude.ts:4:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/claude.ts:98:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/executables.ts:9:import type { RuntimeAgentDef } from './types.js';
apps/daemon/src/runtimes/executables.ts:11:const RUNTIME_PROJECT_ROOT = path.resolve(
apps/daemon/src/runtimes/executables.ts:53:    RUNTIME_PROJECT_ROOT,
apps/daemon/src/runtimes/executables.ts:178:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/executables.ts:240:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/executables.ts:283:function codexAppBundleExecutable(def: RuntimeAgentDef): string | null {
apps/daemon/src/runtimes/executables.ts:315:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/executables.ts:322:  def: RuntimeAgentDef,
apps/daemon/src/runtimes/defs/reasonix.ts:4:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/reasonix.ts:76:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/kilo.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/kilo.ts:21:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/devin.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/devin.ts:46:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/opencode.ts:3:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/opencode.ts:91:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/mimo.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/mimo.ts:26:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/pi.ts:3:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/pi.ts:100:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/vibe.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/vibe.ts:21:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/trae-cli.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/trae-cli.ts:23:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/deepseek.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/deepseek.ts:53:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/amp.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/amp.ts:57:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/copilot.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/copilot.ts:80:} satisfies RuntimeAgentDef;
apps/daemon/src/runtimes/defs/aider.ts:2:import type { RuntimeAgentDef } from '../types.js';
apps/daemon/src/runtimes/defs/aider.ts:63:} satisfies RuntimeAgentDef;

exec
/bin/bash -lc "sed -n '1,140p' apps/daemon/src/runtimes/registry.ts && sed -n '90,280p' apps/daemon/src/runtimes/types.ts && sed -n '300,530p' apps/daemon/src/cli.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
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
  'plugin-requires-daemon':   71,
  'snapshot-stale':           72,
  'genui-surface-awaiting':   73,
  'desktop-auth-pending':     74,
  'desktop-import-token-rejected': 75,
};
const PLUGIN_LIST_FILTER_FLAGS = new Set([
  ...PLUGIN_STRING_FLAGS,
  'task-kind', 'mode', 'tag', 'trust',
]);
const PLUGIN_LIST_BOOLEAN_FLAGS = new Set([
  ...PLUGIN_BOOLEAN_FLAGS,
  'bundled', 'no-bundled',
]);

const SUBCOMMAND_MAP = {
  artifacts: runArtifacts,
  media: runMedia,
  mcp: runMcp,
  amr: runAmr,
  research: runResearch,
  plugin: runPlugin,
  ui: runUi,
  marketplace: runMarketplace,
  share: runShare,
  brand: runBrand,
  brands: runBrand,
  project: runProject,
  automation: runAutomation,
  automations: runAutomation,
  memory: runMemory,
  run: runRun,
  files: runFiles,
  templates: runTemplates,
  conversation: runConversation,
  chat: runChat,
  daemon: runDaemon,
  atoms: runAtoms,
  skills: runSkills,
  'design-systems': runDesignSystems,
  craft: runCraft,
  diagnostics: runDiagnostics,
  export: runExport,
  status: runStatus,
  version: runVersion,
  'whats-new': runWhatsNew,
  doctor: runDoctor,
  config: runConfig,
  library: runLibrary,
  figma: runFigma,
};

const EXPORT_STRING_FLAGS = new Set([
  'daemon-url', 'project', 'format', 'out', 'output', 'image-format', 'title', 'file',
]);
const EXPORT_BOOLEAN_FLAGS = new Set(['help', 'h', 'json', 'deck', 'page', 'no-deck']);
// EXPORT_FORMATS / EXPORT_IMAGE_FORMATS are the shared contract DTO (single
// source of truth for the web/daemon/CLI export surface), imported above.

function printExportHelp() {
  console.log(`Usage:
  od export <file> --project <id> --format <fmt> [options]

Programmatic export of an HTML/deck artifact to PDF, image, or PPTX. Runs
entirely from the rendered design (no model/agent calls). Rasterization uses
the desktop runtime's bundled Chromium, so a desktop/packaged runtime must be
reachable; otherwise the command reports that the renderer is unavailable.

Formats:  ${EXPORT_FORMATS.join(', ')}

Options:
  --project <id>           Project id (required)
  --format <fmt>           One of: ${EXPORT_FORMATS.join(' | ')} (required)
  --out <path>             Write the file here (defaults to the suggested name)
  --image-format <fmt>     png | jpeg (for --format image)
  --deck                   Treat the artifact as a multi-slide deck
  --page, --no-deck        Treat the artifact as a normal scrollable page
  --title <title>          Title used for metadata / default filename
  --json                   Print a machine-readable result envelope
  --daemon-url <url>       Override daemon URL

Examples:
  od export index.html --project p1 --format pdf --out page.pdf
  od export slide.html --project p1 --format image --image-format png --out slide.png
  od export deck.html --project p1 --format pptx --out deck.pptx`);
}

async function runExport(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    printExportHelp();
    process.exit(args.length === 0 ? 2 : 0);
  }
  let flags;
  try {
    flags = parseFlags(args, { string: EXPORT_STRING_FLAGS, boolean: EXPORT_BOOLEAN_FLAGS });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const pos = positionalArgs(args, EXPORT_STRING_FLAGS);
  const file = flags.file || pos[0];
  const projectId = flags.project || process.env.OD_PROJECT_ID;
  const format = flags.format;
  if (!file || !projectId || !format) {
    printExportHelp();
    process.exit(2);
  }
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
    console.error(`invalid --format: ${format} (expected ${EXPORT_FORMATS.join(' | ')})`);
    process.exit(2);
  }
  if (flags['image-format'] && !(EXPORT_IMAGE_FORMATS as readonly string[]).includes(flags['image-format'])) {
    console.error(`invalid --image-format: ${flags['image-format']} (expected ${EXPORT_IMAGE_FORMATS.join(' | ')})`);
    process.exit(2);
  }
  if (flags['image-format'] && format !== 'image') {
    console.error('--image-format is only valid with --format image');
    process.exit(2);
  }
  const base = await cliDaemonBaseUrl(flags);
  // All three formats rasterize through the desktop screenshot renderer so the
  // CLI matches the UI exactly. In particular `pdf` uses `/export/pdf-image`
  // (one raster page per deck slide / per viewport for a page) — NOT the generic
  // `/export` vector `printToPDF` path, which drops CJK glyphs in the packaged
  // runtime and is the bug this feature exists to avoid.
  const exportPath = exportRoutePath(format);
  let deckMode;
  try {
    deckMode = resolveExportCliDeckMode({
      format,
      deck: flags.deck === true,
      page: flags.page === true,
      noDeck: flags['no-deck'] === true,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const requestBody = buildExportCliRequestBody({
    fileName: file,
    format,
    deck: deckMode,
    ...(format === 'image' && flags['image-format'] ? { imageFormat: flags['image-format'] } : {}),
    ...(flags.title ? { title: flags.title } : {}),
  });
  let resp;
  try {
    resp = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/${exportPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    surfaceFetchError(err, base);
    process.exit(3);
  }
  if (!resp.ok) return structuredHttpFailure(resp);
  const buffer = Buffer.from(await resp.arrayBuffer());
  let out = flags.out || flags.output;
  if (!out) {
    const cd = resp.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const plain = /filename="([^"]+)"/i.exec(cd);
    if (star && star[1]) {
      try { out = decodeURIComponent(star[1]); } catch { out = plain && plain[1] ? plain[1] : null; }
    } else if (plain && plain[1]) {
      out = plain[1];
    }
    if (!out) {
      const ext = format === 'image'
        ? (flags['image-format'] === 'jpeg' ? 'jpg' : 'png')
        : format === 'pptx' ? 'pptx' : 'pdf';
      out = `artifact.${ext}`;
    }
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(out, buffer);
  if (flags.json) {
    return process.stdout.write(
      JSON.stringify(buildExportCliResultEnvelope({ path: out, bytes: buffer.length, format }), null, 2) + '\n',
    );
  }
  console.log(`wrote ${out} (${buffer.length} bytes)`);
}

if (argv[0] === 'mcp' && argv[1] === 'live-artifacts') {
  try {
    const { exitCode } = await runLiveArtifactsMcpServer();
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: { message } })}\n`);
    process.exit(1);
  }
}

const first = argv.find((a) => !a.startsWith('-'));
if (first && SUBCOMMAND_MAP[first]) {
  const idx = argv.indexOf(first);
  const rest = [...argv.slice(0, idx), ...argv.slice(idx + 1)];
  await SUBCOMMAND_MAP[first](rest);
  process.exit(0);
}

if (argv[0] === 'tools' && argv[1] === 'live-artifacts') {
  runLiveArtifactsToolCli(argv.slice(2))
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ ok: false, error: { message } })}\n`);
      process.exitCode = 1;
    });
} else if (argv[0] === 'tools' && argv[1] === 'connectors') {
  runConnectorsToolCli(argv.slice(2))
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ ok: false, error: { message } })}\n`);
      process.exitCode = 1;
    });
} else if (argv[0] === 'tools' && argv[1] === 'directions') {
  // Agent-facing pull layer for the direction library: the slim prompt
  // carries only an id+label index and the agent fetches the chosen
  // direction's full spec (palette, font stacks, posture) here.
  runDirectionsToolCli(argv.slice(2));
} else if (argv[0] === 'tools' && argv[1] === 'design-systems') {
  runDesignSystemsToolCli(argv.slice(2))

exec
/bin/bash -lc 'for d in /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic /Users/la/Desktop/Programming/Open-Marketing /Users/la/Desktop/Programming/Tovu-Runner /Users/la/Desktop/Programming/Tovu; do if [ -d "$d" ]; then echo "$d"; find "$d" -name AGENTS.md -maxdepth 3 -print | head -20; else echo "MISSING $d"; fi; done' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 998ms:
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/pack/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/tools/serve/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/plugins/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-templates/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.github/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/skills/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/e2e/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/packaged/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/landing-page/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/_schema/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing
/Users/la/Desktop/Programming/Open-Marketing/tools/pack/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/tools/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/tools/serve/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/plugins/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/design-templates/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/packages/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/.github/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/skills/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/e2e/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/apps/packaged/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/apps/daemon/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/apps/landing-page/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/apps/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/design-systems/_schema/AGENTS.md
/Users/la/Desktop/Programming/Tovu-Runner
/Users/la/Desktop/Programming/Tovu-Runner/web/AGENTS.md
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/AGENTS.md
/Users/la/Desktop/Programming/Tovu-Runner/AGENTS.md
/Users/la/Desktop/Programming/Tovu
/Users/la/Desktop/Programming/Tovu/AI-Dev-Shop/AGENTS.md
/Users/la/Desktop/Programming/Tovu/AGENTS.md

exec
/bin/bash -lc "sed -n '1,220p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AGENTS.md && sed -n '1,220p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/AGENTS.md && sed -n '1,220p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/AGENTS.md && sed -n '1,220p' /Users/la/Desktop/Programming/Open-Marketing/AGENTS.md && sed -n '1,220p' /Users/la/Desktop/Programming/Tovu-Runner/AGENTS.md" in /Users/la/Desktop/Programming/OSS-Repos/open-design
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
# apps/AGENTS.md

Follow the root `AGENTS.md` first. This file only records module-level boundaries for `apps/`.

## Active apps

- `apps/web`: Next.js 16 App Router + React 18 web runtime. Entrypoints live in `apps/web/app/`; the main client shell is `apps/web/src/App.tsx`. During local `tools-dev` web runs, `apps/web/next.config.ts` rewrites `/api/*`, `/artifacts/*`, and `/frames/*` to `OD_PORT`.
- `apps/daemon`: Express + SQLite local daemon and `od` bin. It owns REST/SSE APIs, agent CLI spawning, skills, design systems, artifact persistence, static serving, and daemon-managed data. Before describing or changing daemon data paths, read the root `AGENTS.md` section **Daemon data directory contract**; it is mandatory and must not be restated here.
- `apps/desktop`: Electron shell. Desktop does not guess the web port; it reads runtime status through sidecar IPC and opens the reported web URL.
- `apps/packaged`: Thin packaged Electron runtime entry. It starts packaged daemon/web sidecars, registers the `od://` entry protocol, and delegates desktop host behavior to `apps/desktop`.

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
# Agent Entry Point

Read this file first when entering the repository. This repository boots agent
behavior from `AI-Dev-Shop/AGENTS.md`; that is mandatory, not optional. This
root file then adds the project-specific boundaries, lookup map, and mandatory
contracts the AI Dev Shop framework must respect while working here.

## AI Dev Shop framework

Before doing user-facing work, read and follow:

- `AI-Dev-Shop/AGENTS.md`

That file is the canonical multi-agent software-development framework for this
repo. It governs coordinator modes, pipeline behavior, agent routing, startup,
slash-command conventions, and delegated-agent rules. If it conflicts with this
file on agent-framework behavior, `AI-Dev-Shop/AGENTS.md` wins. If the question
is about repository layout, code ownership, commands, daemon data paths,
validation, or contribution boundaries, this root file and the docs it links are
the project-specific source of truth.

## Repository map

For workspace layout, package ownership, common commands, PR/review workflow,
web UI conventions, and "where should I look?" questions, read:

- `docs/repo-map.md`

After entering these directories, also read their local agent guide before
editing:

- `.github/AGENTS.md`
- `apps/AGENTS.md`
- `packages/AGENTS.md`
- `tools/AGENTS.md`
- `e2e/AGENTS.md`
- `skills/AGENTS.md`
- `design-templates/AGENTS.md`
- `plugins/AGENTS.md`

For packaged updater code, release-channel identity, installer behavior, or
updater UI, read `tools/pack/AGENTS.md` section "Packaged auto-update
architecture and harness" before editing.

## Architecture and protocols

For system topology and protocol detail, read:

- `docs/architecture.md`
- `docs/spec.md`
- `docs/skills-protocol.md`
- `docs/agent-adapters.md`
- `docs/modes.md`

## Code discovery

This project uses codebase-memory-mcp to maintain a knowledge graph of the
codebase. Prefer graph tools over grep/glob/file-search for code discovery:

1. `search_graph` — find functions, classes, routes, variables by pattern.
2. `trace_path` — trace callers, callees, impact, or data flow.
3. `get_code_snippet` — read specific function/class source code.
4. `query_graph` — run Cypher queries for complex patterns.
5. `get_architecture` — get high-level project structure.

Fall back to `rg` or direct file reads for string literals, error messages,
configuration, non-code files, or when the graph is stale or insufficient.

# Mandatory Root Contracts

These contracts are intentionally kept in root `AGENTS.md` because they are
repository-wide rules and other docs point here as the canonical source.

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

- Use `pnpm tools-dev` as the only local development lifecycle entry point.
- Keep root scripts reserved for true repo-level checks and tools control-plane
  entrypoints: `pnpm guard`, `pnpm typecheck`, `pnpm tools-dev`,
  `pnpm tools-pack`, and `pnpm tools-serve`.
- Do not add or restore root lifecycle aliases: `pnpm dev`, `pnpm dev:all`,
  `pnpm daemon`, `pnpm preview`, or `pnpm start`.
- Do not add root aggregate `pnpm build` or `pnpm test` aliases. Build/test
  commands must stay package-scoped (`pnpm --filter <package> ...`) or
  tool-scoped (`pnpm tools-pack ...`).
- Do not add root e2e aliases; e2e package commands and ownership rules live in
  `e2e/AGENTS.md`.
- Ports are governed by `tools-dev` flags: `--daemon-port` and `--web-port`.
- `tools-dev` exports `OD_PORT` for the web proxy target and `OD_WEB_PORT` for
  the web listener; do not use `NEXT_PORT`.

## Boundary constraints

- Workspace packages come from `pnpm-workspace.yaml`: `apps/*`, `packages/*`,
  `tools/*`, and `e2e`.
- Runtime target is Node `~24` and `pnpm@10.33.2`; use Corepack so the pnpm
  version pinned in `package.json` is selected.
- New project-owned entrypoints, modules, scripts, tests, reporters, and
  configs should default to TypeScript.
- Residual JavaScript is limited to generated output, vendored dependencies,
  explicitly documented compatibility build artifacts, and the allowlist in
  `scripts/guard.ts`.
- Tests under `apps/`, `packages/`, and `tools/` live in a
  package/app/tool-level `tests/` directory sibling to `src/`; keep `src/`
  source-only and do not add new `*.test.ts` or `*.test.tsx` files under
  `src/`. Playwright UI automation belongs to `e2e/ui/`, not app packages.
- App packages must not import another app's private `src/` or `tests/`
  implementation as a shared helper. In particular, `apps/web/**` must not
  import `apps/daemon/src/**`; web/daemon integration belongs behind HTTP APIs,
  `packages/contracts`, and app-local provider boundaries.
- Cross-app, cross-runtime, or repository-resource consistency checks belong in
  `e2e/tests/` when they need to observe more than one app/package boundary;
  promote reusable logic to a pure package instead of borrowing another app's
  private source.
- Keep shared API DTOs, SSE event unions, error shapes, task shapes, and
  example payloads in `packages/contracts`; update contracts before wiring
  divergent web/daemon request or response shapes.
- Keep `packages/contracts` pure TypeScript and free of Next.js, Express, Node
  filesystem/process APIs, browser APIs, SQLite, daemon internals, and sidecar
  control-plane dependencies.
- App business logic must not know about sidecar/control-plane concepts. Keep
  sidecar awareness in `apps/<app>/sidecar` or the desktop sidecar entry
  wrapper.
- Sidecar process stamps must have exactly five fields: `app`, `mode`,
  `namespace`, `ipc`, and `source`.
- Orchestration layers (`tools-dev`, `tools-pack`, packaged launchers) must
  call package primitives; do not hand-build `--od-stamp-*` args or
  process-scan regexes.
- Packaged runtime paths must be namespace-scoped and independent from
  daemon/web ports; ports are transient transport details only.
- Default runtime files live under `<project-root>/.tmp/<source>/<namespace>/...`;
  POSIX IPC sockets are fixed at `/tmp/open-design/ipc/<namespace>/<app>.sock`.
- `apps/nextjs` and `packages/shared` have been removed; do not recreate or
  reference them.
- Local runtime data, `.tmp/`, Playwright reports, and agent scratch
  directories must stay out of git.

## Capability exposure: UI and CLI

Every user-facing capability must be reachable through both the web UI and the
`od` CLI (`apps/daemon/src/cli.ts`). Shipping a feature with only one of the two
surfaces is a regression.

- The CLI is the embeddability contract. External agents drive Open Design
  through `od` subcommands; they do not render the web UI.
- Both surfaces must call the same `/api/*` endpoints. Do not let the CLI talk
# AGENTS.md

## Repository-Specific Instructions

- For any work anywhere in this repository, read and follow `AI-Dev-Shop/AGENTS.md`.
- Treat `AI-Dev-Shop/AGENTS.md` as the mandatory bootstrap and governing agent instruction file for this workspace, not just for the `AI-Dev-Shop/` subtree.
- On the first user message in this repository, boot with `AI-Dev-Shop/AGENTS.md` loaded before any substantive reply.
- If `AI-Dev-Shop/AGENTS.md` is missing or unreadable, state that explicitly and stop.

## Always Consult

Before proposing architecture changes, implementation plans, or new platform modules in this workspace, consult:

- `tovu-architecture.md` section `13. User Friction Coverage (Living Backlog)`
- `tovu-architecture.md` section `14. Meta-Coding Framework (Spec-First + Test-First + Pattern-First)`
- `tovu/PROJECT_MEMORY.md` when the task is about the `tovu/` project
- `tovu/src/INFO.md` when the task is about module layout in `tovu/`

## Execution Rules

- Treat sections 13 and 14 as governing constraints for architecture decisions.
- Do not bypass dependency inversion or modular boundaries for speed.
- Prefer swappable ports/adapters over provider-coupled implementations in core.

exec
/bin/bash -lc "find /Users/la/Desktop/Programming/Tovu-Runner -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | sort | sed -n '1,220p' && find /Users/la/Desktop/Programming/Open-Marketing -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | sort | sed -n '1,180p' && find /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | sort | sed -n '1,180p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
/Users/la/Desktop/Programming/Tovu-Runner/.DS_Store
/Users/la/Desktop/Programming/Tovu-Runner/.claude/settings.json
/Users/la/Desktop/Programming/Tovu-Runner/.claude/settings.local.json
/Users/la/Desktop/Programming/Tovu-Runner/.codebase-memory/.gitattributes
/Users/la/Desktop/Programming/Tovu-Runner/.codebase-memory/artifact.json
/Users/la/Desktop/Programming/Tovu-Runner/.codebase-memory/graph.db.zst
/Users/la/Desktop/Programming/Tovu-Runner/.gitignore
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T15-16-23-598Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T15-16-36-655Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T15-16-51-175Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T15-20-08-892Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T15-20-18-596Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T15-48-57-332Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T15-49-17-865Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T16-17-10-107Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T16-30-56-267Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T16-32-00-753Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T16-46-07-359Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T16-47-03-621Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T16-51-46-957Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T17-26-53-264Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T17-33-04-070Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-07T17-55-06-312Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-23T04-02-29-159Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-23T04-02-33-741Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-23T04-02-48-320Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/console-2026-04-23T04-03-00-752Z.log
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T15-16-26-345Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T15-48-59-781Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T15-49-23-288Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T16-30-56-803Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T16-31-17-942Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T16-32-04-813Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T16-38-25-067Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T16-47-03-827Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T17-26-44-370Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-07T17-26-53-492Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-23T04-02-31-252Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-23T04-02-36-997Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-23T04-02-50-273Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/.playwright-mcp/page-2026-04-23T04-03-04-067Z.yml
/Users/la/Desktop/Programming/Tovu-Runner/AGENTS.md
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/.gitignore
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/AGENTS.md
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/AUDIT-WORK-CONVERGENCE-HANDOFF.md
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/CLAUDE.md
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/GEMINI.md
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/README.md
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/init-hook-audit-HANDOFF.md
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/pytest.ini
/Users/la/Desktop/Programming/Tovu-Runner/AI-Dev-Shop/todo.md
/Users/la/Desktop/Programming/Tovu-Runner/CLAUDE.md
/Users/la/Desktop/Programming/Tovu-Runner/README.md
/Users/la/Desktop/Programming/Tovu-Runner/docs/.DS_Store
/Users/la/Desktop/Programming/Tovu-Runner/docs/README.md
/Users/la/Desktop/Programming/Tovu-Runner/package.json
/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh
/Users/la/Desktop/Programming/Tovu-Runner/scripts/verify-architecture-split.sh
/Users/la/Desktop/Programming/Tovu-Runner/todos.md
/Users/la/Desktop/Programming/Tovu-Runner/web/AGENTS.md
/Users/la/Desktop/Programming/Tovu-Runner/web/PROJECT_MEMORY.md
/Users/la/Desktop/Programming/Tovu-Runner/web/README.md
/Users/la/Desktop/Programming/Tovu-Runner/web/index.html
/Users/la/Desktop/Programming/Tovu-Runner/web/package-lock.json
/Users/la/Desktop/Programming/Tovu-Runner/web/package.json
/Users/la/Desktop/Programming/Tovu-Runner/web/tsconfig.json
/Users/la/Desktop/Programming/Tovu-Runner/web/vite.config.ts
/Users/la/Desktop/Programming/Open-Marketing/.DS_Store
/Users/la/Desktop/Programming/Open-Marketing/.claude-plugin/marketplace.json
/Users/la/Desktop/Programming/Open-Marketing/.claude/settings.local.json
/Users/la/Desktop/Programming/Open-Marketing/.codebase-memory/.gitattributes
/Users/la/Desktop/Programming/Open-Marketing/.codebase-memory/artifact.json
/Users/la/Desktop/Programming/Open-Marketing/.codebase-memory/graph.db.zst
/Users/la/Desktop/Programming/Open-Marketing/.dockerignore
/Users/la/Desktop/Programming/Open-Marketing/.github/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/.github/CODEOWNERS
/Users/la/Desktop/Programming/Open-Marketing/.github/actionlint.yaml
/Users/la/Desktop/Programming/Open-Marketing/.github/labeler.yml
/Users/la/Desktop/Programming/Open-Marketing/.github/pull_request_template.md
/Users/la/Desktop/Programming/Open-Marketing/.gitignore
/Users/la/Desktop/Programming/Open-Marketing/.node-version
/Users/la/Desktop/Programming/Open-Marketing/.od/app-config.json
/Users/la/Desktop/Programming/Open-Marketing/.od/app.sqlite
/Users/la/Desktop/Programming/Open-Marketing/.od/app.sqlite-shm
/Users/la/Desktop/Programming/Open-Marketing/.od/app.sqlite-wal
/Users/la/Desktop/Programming/Open-Marketing/.od/installation.json
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/console-2026-06-30T17-12-42-838Z.log
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/console-2026-06-30T17-32-25-547Z.log
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/console-2026-06-30T17-38-06-058Z.log
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/console-2026-06-30T17-42-23-791Z.log
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/console-2026-06-30T17-51-30-941Z.log
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-13-19-590Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-32-29-180Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-32-49-521Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-32-58-636Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-33-39-414Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-33-48-022Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-38-09-142Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-42-28-249Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-42-54-756Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-43-18-255Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-43-31-342Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-51-38-402Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-51-45-866Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.playwright-mcp/page-2026-06-30T17-51-50-650Z.yml
/Users/la/Desktop/Programming/Open-Marketing/.vaunt/config.yaml
/Users/la/Desktop/Programming/Open-Marketing/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/.gitignore
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/AUDIT-WORK-CONVERGENCE-HANDOFF.md
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/CLAUDE.md
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/GEMINI.md
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/README.md
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/init-hook-audit-HANDOFF.md
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/pytest.ini
/Users/la/Desktop/Programming/Open-Marketing/AI-Dev-Shop/todo.md
/Users/la/Desktop/Programming/Open-Marketing/CHANGELOG.md
/Users/la/Desktop/Programming/Open-Marketing/CLAUDE.md
/Users/la/Desktop/Programming/Open-Marketing/CONTEXT.md
/Users/la/Desktop/Programming/Open-Marketing/CONTRIBUTING.md
/Users/la/Desktop/Programming/Open-Marketing/LICENSE
/Users/la/Desktop/Programming/Open-Marketing/MAINTAINERS.md
/Users/la/Desktop/Programming/Open-Marketing/PRIVACY.md
/Users/la/Desktop/Programming/Open-Marketing/QUICKSTART.md
/Users/la/Desktop/Programming/Open-Marketing/README.md
/Users/la/Desktop/Programming/Open-Marketing/RELEASE-NOTES-0.10.0.md
/Users/la/Desktop/Programming/Open-Marketing/ROADMAP.md
/Users/la/Desktop/Programming/Open-Marketing/TRANSLATIONS.md
/Users/la/Desktop/Programming/Open-Marketing/apps/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/clipper/README.md
/Users/la/Desktop/Programming/Open-Marketing/clipper/background.js
/Users/la/Desktop/Programming/Open-Marketing/clipper/brand-capture.js
/Users/la/Desktop/Programming/Open-Marketing/clipper/capture.js
/Users/la/Desktop/Programming/Open-Marketing/clipper/content.js
/Users/la/Desktop/Programming/Open-Marketing/clipper/i18n.js
/Users/la/Desktop/Programming/Open-Marketing/clipper/manifest.json
/Users/la/Desktop/Programming/Open-Marketing/clipper/popup.css
/Users/la/Desktop/Programming/Open-Marketing/clipper/popup.html
/Users/la/Desktop/Programming/Open-Marketing/clipper/popup.js
/Users/la/Desktop/Programming/Open-Marketing/console-errors.log
/Users/la/Desktop/Programming/Open-Marketing/craft/FUTURE_SECTIONS.md
/Users/la/Desktop/Programming/Open-Marketing/craft/README.md
/Users/la/Desktop/Programming/Open-Marketing/craft/accessibility-baseline.md
/Users/la/Desktop/Programming/Open-Marketing/craft/animation-discipline.md
/Users/la/Desktop/Programming/Open-Marketing/craft/anti-ai-slop.md
/Users/la/Desktop/Programming/Open-Marketing/craft/color.md
/Users/la/Desktop/Programming/Open-Marketing/craft/form-validation.md
/Users/la/Desktop/Programming/Open-Marketing/craft/laws-of-ux.md
/Users/la/Desktop/Programming/Open-Marketing/craft/rtl-and-bidi.md
/Users/la/Desktop/Programming/Open-Marketing/craft/state-coverage.md
/Users/la/Desktop/Programming/Open-Marketing/craft/typography-hierarchy-editorial.md
/Users/la/Desktop/Programming/Open-Marketing/craft/typography-hierarchy.md
/Users/la/Desktop/Programming/Open-Marketing/craft/typography.md
/Users/la/Desktop/Programming/Open-Marketing/data/contributors.json
/Users/la/Desktop/Programming/Open-Marketing/data/events.jsonl
/Users/la/Desktop/Programming/Open-Marketing/deploy/.env.example
/Users/la/Desktop/Programming/Open-Marketing/deploy/.gitignore
/Users/la/Desktop/Programming/Open-Marketing/deploy/Dockerfile
/Users/la/Desktop/Programming/Open-Marketing/deploy/README.md
/Users/la/Desktop/Programming/Open-Marketing/deploy/docker-compose.yml
/Users/la/Desktop/Programming/Open-Marketing/design-browser-task-handoff.md
/Users/la/Desktop/Programming/Open-Marketing/design-systems/README.md
/Users/la/Desktop/Programming/Open-Marketing/design-templates/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/docs/MOCKS-CONTRACT-CHECK.md
/Users/la/Desktop/Programming/Open-Marketing/docs/agent-adapters.md
/Users/la/Desktop/Programming/Open-Marketing/docs/ai-native-observability-trace-analysis.md
/Users/la/Desktop/Programming/Open-Marketing/docs/architecture.md
/Users/la/Desktop/Programming/Open-Marketing/docs/atoms.md
/Users/la/Desktop/Programming/Open-Marketing/docs/blog-indexing-automation.md
/Users/la/Desktop/Programming/Open-Marketing/docs/blog-indexing-status.json
/Users/la/Desktop/Programming/Open-Marketing/docs/blog-indexing-status.md
/Users/la/Desktop/Programming/Open-Marketing/docs/code-review-guidelines.md
/Users/la/Desktop/Programming/Open-Marketing/docs/codex-pets.md
/Users/la/Desktop/Programming/Open-Marketing/docs/critique-theater.md
/Users/la/Desktop/Programming/Open-Marketing/docs/design-system-tracking-spec.md
/Users/la/Desktop/Programming/Open-Marketing/docs/design-systems.md
/Users/la/Desktop/Programming/Open-Marketing/docs/external-media-orchestration.md
/Users/la/Desktop/Programming/Open-Marketing/docs/install-guide.md
/Users/la/Desktop/Programming/Open-Marketing/docs/mautic-architecture.md
/Users/la/Desktop/Programming/Open-Marketing/docs/modes.md
/Users/la/Desktop/Programming/Open-Marketing/docs/new-agent-runtime-acp.md
/Users/la/Desktop/Programming/Open-Marketing/docs/notebooklm.md
/Users/la/Desktop/Programming/Open-Marketing/docs/orchestrator-workspaces.md
/Users/la/Desktop/Programming/Open-Marketing/docs/plugins-spec.md
/Users/la/Desktop/Programming/Open-Marketing/docs/plugins-spec.zh-CN.md
/Users/la/Desktop/Programming/Open-Marketing/docs/publishing-a-plugin.md
/Users/la/Desktop/Programming/Open-Marketing/docs/publishing-a-plugin.zh-CN.md
/Users/la/Desktop/Programming/Open-Marketing/docs/references.md
/Users/la/Desktop/Programming/Open-Marketing/docs/repo-map.md
/Users/la/Desktop/Programming/Open-Marketing/docs/roadmap.md
/Users/la/Desktop/Programming/Open-Marketing/docs/self-hosting-a-registry.md
/Users/la/Desktop/Programming/Open-Marketing/docs/skills-contributing.md
/Users/la/Desktop/Programming/Open-Marketing/docs/skills-protocol.md
/Users/la/Desktop/Programming/Open-Marketing/docs/spec.md
/Users/la/Desktop/Programming/Open-Marketing/docs/v0.8.0-announcement.md
/Users/la/Desktop/Programming/Open-Marketing/docs/v0.8.0-announcement.zh-CN.md
/Users/la/Desktop/Programming/Open-Marketing/docs/windows-troubleshooting.md
/Users/la/Desktop/Programming/Open-Marketing/docs/wsl-setup.md
/Users/la/Desktop/Programming/Open-Marketing/e2e/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/e2e/package.json
/Users/la/Desktop/Programming/Open-Marketing/e2e/playwright.config.ts
/Users/la/Desktop/Programming/Open-Marketing/e2e/playwright.visual.config.ts
/Users/la/Desktop/Programming/Open-Marketing/e2e/tsconfig.json
/Users/la/Desktop/Programming/Open-Marketing/e2e/vitest.config.ts
/Users/la/Desktop/Programming/Open-Marketing/figma-plugin/IR.md
/Users/la/Desktop/Programming/Open-Marketing/figma-plugin/README.md
/Users/la/Desktop/Programming/Open-Marketing/figma-plugin/code.js
/Users/la/Desktop/Programming/Open-Marketing/figma-plugin/manifest.json
/Users/la/Desktop/Programming/Open-Marketing/figma-plugin/ui.html
/Users/la/Desktop/Programming/Open-Marketing/flake.lock
/Users/la/Desktop/Programming/Open-Marketing/flake.nix
/Users/la/Desktop/Programming/Open-Marketing/handoffs/2026-06-30-agui-copilot-chat.md
/Users/la/Desktop/Programming/Open-Marketing/handoffs/2026-06-30-settings-section-registry.md
/Users/la/Desktop/Programming/Open-Marketing/handoffs/2026-07-08-copilotkit-agentic-chat.md
/Users/la/Desktop/Programming/Open-Marketing/handoffs/2026-07-09-agentic-chat-debate-and-spike.md
/Users/la/Desktop/Programming/Open-Marketing/mise.toml
/Users/la/Desktop/Programming/Open-Marketing/mocks/README.md
/Users/la/Desktop/Programming/Open-Marketing/mocks/manifest.json
/Users/la/Desktop/Programming/Open-Marketing/mocks/mock-agent.mjs
/Users/la/Desktop/Programming/Open-Marketing/nix/README.md
/Users/la/Desktop/Programming/Open-Marketing/nix/home-manager.nix
/Users/la/Desktop/Programming/Open-Marketing/nix/module-common.nix
/Users/la/Desktop/Programming/Open-Marketing/nix/nixos.nix
/Users/la/Desktop/Programming/Open-Marketing/nix/package-daemon.nix
/Users/la/Desktop/Programming/Open-Marketing/nix/package-web.nix
/Users/la/Desktop/Programming/Open-Marketing/nix/pnpm-deps.nix
/Users/la/Desktop/Programming/Open-Marketing/package.json
/Users/la/Desktop/Programming/Open-Marketing/packages/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/plugins/AGENTS.md
/Users/la/Desktop/Programming/Open-Marketing/plugins/README.md
/Users/la/Desktop/Programming/Open-Marketing/plugins/README.zh-CN.md
/Users/la/Desktop/Programming/Open-Marketing/pnpm-lock.yaml
/Users/la/Desktop/Programming/Open-Marketing/pnpm-workspace.yaml
/Users/la/Desktop/Programming/Open-Marketing/scripts/approve-fork-pr-workflows.test.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/approve-fork-pr-workflows.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/backfill-failed-runs-with-artifacts.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/bake-community-pets.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/bake-html-ppt-examples.mjs
/Users/la/Desktop/Programming/Open-Marketing/scripts/bake-plugin-previews.mjs
/Users/la/Desktop/Programming/Open-Marketing/scripts/batch-design-system-test.test.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/batch-design-system-test.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/check-components-fixtures.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/check-components-manifest-extraction.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/check-cross-app-imports.test.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/check-cross-app-imports.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/check-design-system-flag-parity.ts
/Users/la/Desktop/Programming/Open-Marketing/scripts/check-design-system-manifests.test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.claude-plugin/marketplace.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.claude/.ads-initialized
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.claude/settings.local.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.dockerignore
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.env.local
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.gitattributes
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.github/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.github/CODEOWNERS
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.github/actionlint.yaml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.github/labeler.yml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.github/pull_request_template.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.gitignore
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.node-version
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/app-config.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/app.sqlite
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/app.sqlite-shm
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/app.sqlite-wal
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.od/installation.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.vaunt/config.yaml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/.gitignore
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/ADS-memory/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/.gitignore
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/AUDIT-WORK-CONVERGENCE-HANDOFF.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/CLAUDE.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/GEMINI.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/init-hook-audit-HANDOFF.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/pytest.ini
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/AI-Dev-Shop/todo.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/CHANGELOG.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/CLAUDE.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/CONTEXT.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/CONTRIBUTING.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/LICENSE
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/MAINTAINERS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/PRIVACY.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/QUICKSTART.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/RELEASE-NOTES-0.10.0.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/TRANSLATIONS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/background.js
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/brand-capture.js
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/capture.js
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/content.js
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/i18n.js
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/manifest.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/popup.css
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/popup.html
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/clipper/popup.js
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/FUTURE_SECTIONS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/accessibility-baseline.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/animation-discipline.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/anti-ai-slop.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/color.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/form-validation.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/laws-of-ux.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/rtl-and-bidi.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/state-coverage.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/typography-hierarchy-editorial.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/typography-hierarchy.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/craft/typography.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/data/contributors.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/data/events.jsonl
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/.env.example
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/.gitignore
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/Dockerfile
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/Dockerfile.local
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/docker-compose.linux.yml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/deploy/docker-compose.yml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-browser-task-handoff.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-systems/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/design-templates/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/MOCKS-CONTRACT-CHECK.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/agent-adapters.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/ai-native-observability-trace-analysis.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/architecture.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/atoms.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/blog-indexing-automation.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/blog-indexing-status.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/blog-indexing-status.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/code-review-guidelines.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/codex-pets.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/critique-theater.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/design-system-tracking-spec.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/design-systems.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/external-media-orchestration.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/install-guide.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/modes.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/new-agent-runtime-acp.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/notebooklm.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/orchestrator-workspaces.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/plugins-spec.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/plugins-spec.zh-CN.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/publishing-a-plugin.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/publishing-a-plugin.zh-CN.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/references.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/roadmap.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/self-hosting-a-registry.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/skills-contributing.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/skills-protocol.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/spec.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/v0.8.0-announcement.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/v0.8.0-announcement.zh-CN.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/whats-new.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/windows-troubleshooting.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/wsl-setup.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/e2e/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/e2e/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/e2e/playwright.config.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/e2e/playwright.visual.config.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/e2e/tsconfig.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/e2e/vitest.config.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/figma-plugin/IR.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/figma-plugin/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/figma-plugin/code.js
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/figma-plugin/manifest.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/figma-plugin/ui.html
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/flake.lock
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/flake.nix
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/mise.toml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/mocks/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/mocks/manifest.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/mocks/mock-agent.mjs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/nix/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/nix/home-manager.nix
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/nix/module-common.nix
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/nix/nixos.nix
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/nix/package-daemon.nix
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/nix/package-web.nix
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/nix/pnpm-deps.nix
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/package.json
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/plugins/AGENTS.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/plugins/README.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/plugins/README.zh-CN.md
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/pnpm-lock.yaml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/pnpm-workspace.yaml
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/approve-fork-pr-workflows.test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/approve-fork-pr-workflows.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/backfill-failed-runs-with-artifacts.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/bake-community-pets.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/bake-html-ppt-examples.mjs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/bake-plugin-previews.mjs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/batch-design-system-test.test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/batch-design-system-test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-agent-tools-import-isolation.test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-agent-tools-import-isolation.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-components-fixtures.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-components-manifest-extraction.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-cross-app-imports.test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-cross-app-imports.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-design-system-flag-parity.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-design-system-manifests.test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-design-system-manifests.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-design-system-package-quality.test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-design-system-package-quality.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-plugin-preview-manifest.test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-plugin-preview-manifest.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/check-tokens-fixture-sync.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/extract-components-manifest.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/generate-design-system-system-assets.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/guard.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/i18n-check.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/i18n-coverage-report.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/import-prompt-templates.mjs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/install-unsafe-dmg.sh
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/lint-craft-references.test.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/lint-craft-references.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/normalize-plugin-scenarios.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/notebooklm-export-github.ts
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/plugin-previews-diff.mjs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/plugin-previews-diff.test.mjs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/plugin-previews-gc.mjs
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/scripts/plugin-previews-gc.test.mjs

exec
/bin/bash -lc "sed -n '1,240p' /Users/la/Desktop/Programming/Tovu-Runner/README.md && sed -n '1,220p' /Users/la/Desktop/Programming/Tovu-Runner/package.json && sed -n '1,220p' /Users/la/Desktop/Programming/Tovu-Runner/web/package.json && find /Users/la/Desktop/Programming/Tovu-Runner/web/src -maxdepth 3 -type f | sort | sed -n '1,260p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# Tovu-AI-CMS

Tovu AI CMS architecture research and implementation scaffold.

## Key paths

- `tovu/`: active implementation project
- `tovu-architecture.md`: architecture and design principles
- `docs/`: organized architecture, strategy, research, and archive material
- `docs/architecture/README.md`: architecture hub for humans
- `docs/architecture/CONTEXT-PACKET.md`: shared packet for future LLM sessions
- `docs/architecture/LLM-NAVIGATION.md`: compact navigation layer for LLMs
- `docs/architecture/AI Foundation/`: AI layer foundation design (model gateway, trust boundaries, PII, secrets, CRDT collab, WP migration)
- `docs/user-complaints/`: cross-model complaint research used for friction analysis
- `other-repos/`: local external reference repos kept out of this repo via `.gitignore`
- `todos.md`: roadmap and parity checklist
- `wordpress_specs/`: top-level WordPress learning/spec reference set
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
{
  "name": "tovu",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "dev:vite": "vite",
    "build:vite": "vite build",
    "start": "node dist/src/index.js",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build:binary": "node tooling/build-binary.mjs",
    "desktop": "npm --prefix apps/desktop run dev",
    "test": "node --import tsx --test src/**/*.test.ts vue/src/**/*.test.ts"
  },
  "dependencies": {
    "express": "^4.21.2",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.13.10",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "esbuild": "^0.28.1",
    "postject": "^1.0.0-alpha.6",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vite": "^6.0.7"
  }
}
/Users/la/Desktop/Programming/Tovu-Runner/web/src/.DS_Store
/Users/la/Desktop/Programming/Tovu-Runner/web/src/App.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin-shell/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin-shell/__specs__/navigation.spec.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin-shell/__tests__/navigation.test.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin-shell/index.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin-shell/navigation.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin/Admin.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin/AdminContent.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin/AdminSidebar.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin/AdminTopBar.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin/admin.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/admin/sitemap.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/analytics/error-tracking.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/analytics/provider.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/appearance/Appearance.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/appearance/appearance.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/assistant/ChatFab.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/assistant/assistant.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/components/pet/DesktopPetSurface.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/__specs__/core-contracts.spec.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/__tests__/README.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/change-set.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/command.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/commands/repo.memory.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/events/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/events/index.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/events/memory-bus.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/events/outbox-worker.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/index.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/core/ports.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/index.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/index.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/post.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/post/repo.memory.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/index.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/presentation.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/presentation/repo.memory.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/create.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/index.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/features/workspace/repo.memory.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/headless/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/headless/__specs__/headless-contracts.spec.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/headless/contracts.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/headless/index.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/Composer.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/Home.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/ModeToggle.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/NavRail.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/RecentProjects.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/ThemePicker.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/TopBar.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/data.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/home.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/home/icons.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/i18n/index.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/index.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/index.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/integrations/Integrations.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/integrations/integrations.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/main.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/media/Media.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/media/MediaAdaptive.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/media/MediaStudio.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/media/data.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/media/media.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/nav.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/observability/install.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/pages/PlaceholderPage.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/pages/pages.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/plugins/Plugins.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/plugins/plugins.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__specs__/README.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__specs__/http-workspace.spec.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__tests__/README.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/__tests__/packet-one-routes.test.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/app.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/error-mapping/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/http/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/middleware/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/middleware/admin-static.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/middleware/dev-auth.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/middleware/dev-cors.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/request-context/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/INFO.md
/Users/la/Desktop/Programming/Tovu-Runner/web/src/server/routes/types.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/settings/Settings.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/settings/settings.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/shell-theme/ThemeProvider.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/shell-theme/controller.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/shell-theme/skins.ts
/Users/la/Desktop/Programming/Tovu-Runner/web/src/shell-theme/theme.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/styles/home/index.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/themes/Themes.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/themes/themes.css
/Users/la/Desktop/Programming/Tovu-Runner/web/src/websites/Websites.tsx
/Users/la/Desktop/Programming/Tovu-Runner/web/src/websites/data.ts

exec
/bin/bash -lc 'for d in /Users/la/Desktop/Programming/OSS-Repos/open-design /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic /Users/la/Desktop/Programming/Open-Marketing; do echo "$d"; git -C "$d" remote -v | sed -n '"'1,8p'; git -C \""'$d" log -1 --format='"'%H %cs %s'; done && shasum apps/daemon/src/server.ts /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts /Users/la/Desktop/Programming/Open-Marketing/apps/daemon/src/server.ts && wc -l /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts /Users/la/Desktop/Programming/Open-Marketing/apps/daemon/src/server.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
exec
/bin/bash -lc "sed -n '1,180p' .git/config && sed -n '1,180p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/.git/config && sed -n '1,180p' /Users/la/Desktop/Programming/Open-Marketing/.git/config && wc -l apps/daemon/src/server.ts /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts /Users/la/Desktop/Programming/Open-Marketing/apps/daemon/src/server.ts && cmp -s apps/daemon/src/server.ts /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts; echo \"agentic_cmp="'$?"; cmp -s apps/daemon/src/server.ts /Users/la/Desktop/Programming/Open-Marketing/apps/daemon/src/server.ts; echo "om_cmp=$?"' in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
[core]
	repositoryformatversion = 0
	filemode = true
	bare = false
	logallrefupdates = true
	ignorecase = true
	precomposeunicode = true
[remote "origin"]
	url = https://github.com/nexu-io/open-design.git
	fetch = +refs/heads/main:refs/remotes/origin/main
[branch "main"]
	remote = origin
	merge = refs/heads/main
	vscode-merge-base = origin/main
[remote "fork"]
	url = https://github.com/leonaburime-ucla/open-design.git
	fetch = +refs/heads/*:refs/remotes/fork/*
[branch "design-systems-capability-barrels"]
	vscode-merge-base = origin/main
	remote = fork
	merge = refs/heads/design-systems-capability-barrels
[branch "cli-capability-barrels"]
	vscode-merge-base = fork/design-systems-capability-barrels
[branch "arch/chat-run-extraction"]
	remote = fork
	vscode-merge-base = origin/main
	merge = refs/heads/arch/chat-run-extraction
[branch "automation-capability-barrel"]
	vscode-merge-base = origin/main
[branch "memory-capability-barrel"]
	vscode-merge-base = origin/main
[branch "arch/server-preamble-1"]
	vscode-merge-base = origin/main
	remote = fork
	merge = refs/heads/arch/server-preamble-1
[branch "library-capability-barrel"]
	vscode-merge-base = origin/main
	remote = fork
	merge = refs/heads/library-capability-barrel
[branch "arch/server-preamble-2"]
	vscode-merge-base = fork/arch/server-preamble-1
	remote = fork
	merge = refs/heads/arch/server-preamble-2
[branch "mcp-capability-barrel"]
	remote = fork
	vscode-merge-base = origin/main
	merge = refs/heads/mcp-capability-barrel
[branch "run-capability-barrel"]
	vscode-merge-base = origin/main
	remote = fork
	merge = refs/heads/run-capability-barrel
[branch "project-capability-barrel"]
	vscode-merge-base = origin/main
[branch "agents-capability-barrel"]
	vscode-merge-base = fork/design-systems-capability-barrels
	remote = fork
	merge = refs/heads/agents-capability-barrel
[branch "codex-capability-barrel"]
	vscode-merge-base = fork/design-systems-capability-barrels
[branch "export-capability-barrel"]
	vscode-merge-base = fork/design-systems-capability-barrels
[branch "telemetry-capability-barrel"]
	vscode-merge-base = fork/design-systems-capability-barrels
[branch "arch/server-startserver-endgame"]
	vscode-merge-base = fork/arch/server-preamble-2
	remote = fork
	merge = refs/heads/arch/server-startserver-endgame
[branch "arch/server-slice-5"]
	vscode-merge-base = fork/arch/server-startserver-endgame
[branch "integrated"]
	vscode-merge-base = origin/main
	remote = fork
	merge = refs/heads/integrated
[branch "worktree-agent-ab8693b02ac43d625"]
	vscode-merge-base = origin/main
[branch "guard/ts-nocheck-unresolved-imports"]
	remote = fork
	vscode-merge-base = origin/main
	merge = refs/heads/guard/ts-nocheck-unresolved-imports
[branch "worktree-agent-a177e99dbbd88eb4f"]
	vscode-merge-base = origin/main
[branch "worktree-agent-a1c238efb77b6afe4"]
	vscode-merge-base = origin/main
[branch "arch/finalize-capability-barrel"]
	vscode-merge-base = origin/main
[branch "arch/skills-capability-barrel"]
	vscode-merge-base = origin/main
[branch "worktree-agent-a3813d509b49e2d63"]
	vscode-merge-base = origin/main
[branch "worktree-agent-a9b2f487efd9ea515"]
	vscode-merge-base = origin/main
[branch "worktree-agent-a40f6d5580d23dcaf"]
	vscode-merge-base = origin/main
[branch "refactor/download-barrel-split"]
	vscode-merge-base = origin/main
[branch "worktree-agent-afd82f51a0ef08123"]
	vscode-merge-base = origin/main
[branch "arch/plugins-capability-barrel"]
	vscode-merge-base = origin/main
[branch "arch/brands-capability-barrel"]
	vscode-merge-base = origin/main
[branch "refactor/sidecar-barrel-split"]
	vscode-merge-base = origin/main
[branch "refactor/sidecar-proto-barrel-split"]
	vscode-merge-base = origin/main
[branch "refactor/host-barrel-split"]
	vscode-merge-base = origin/main
[branch "worktree-agent-af6b2a161e1dd2ab9"]
	vscode-merge-base = origin/main
[branch "refactor/events-barrel-split"]
	vscode-merge-base = origin/main
[branch "refactor/plugin-runtime-helpers"]
	remote = origin
	merge = refs/heads/main
[branch "refactor/contracts-metadata-block"]
	remote = origin
	merge = refs/heads/main
[branch "arch/observability-capability-barrel"]
	vscode-merge-base = origin/main
[branch "integrated-trunk"]
	remote = fork
	merge = refs/heads/integrated-trunk
	vscode-merge-base = fork/arch/prompt-templates-media-decouple
[branch "arch/config-flat-grouping"]
	remote = fork
	merge = refs/heads/arch/config-flat-grouping
[branch "arch/auth-flat-grouping"]
	remote = fork
	merge = refs/heads/arch/auth-flat-grouping
[branch "arch/migration-flat-grouping"]
	remote = fork
	merge = refs/heads/arch/migration-flat-grouping
[branch "arch/browser-flat-grouping"]
	remote = fork
	merge = refs/heads/arch/browser-flat-grouping
[branch "arch/cli-help-flat-grouping"]
	remote = fork
	merge = refs/heads/arch/cli-help-flat-grouping
[branch "arch/design-flat-grouping"]
	remote = fork
	merge = refs/heads/arch/design-flat-grouping
	vscode-merge-base = origin/main
[branch "arch/plugins-fold-decouple"]
	remote = fork
	merge = refs/heads/arch/plugins-fold-decouple
[branch "arch/prompt-templates-media-decouple"]
	remote = fork
	merge = refs/heads/arch/prompt-templates-media-decouple
[branch "arch/split-tools-connectors-cli"]
	remote = fork
	vscode-merge-base = origin/main
	merge = refs/heads/arch/split-tools-connectors-cli
[branch "refactor/langfuse-trace-barrel"]
	remote = fork
	vscode-merge-base = origin/main
	merge = refs/heads/refactor/langfuse-trace-barrel
[branch "worktree-agent-a57935d6b94817286"]
	vscode-merge-base = origin/main
[branch "refactor/db-barrel"]
	vscode-merge-base = origin/main
	remote = fork
	merge = refs/heads/refactor/db-barrel
[branch "worktree-agent-a97a2537a5339f2f1"]
	vscode-merge-base = origin/main
[branch "refactor/agent-protocol-barrel"]
	remote = fork
	vscode-merge-base = origin/main
	merge = refs/heads/refactor/agent-protocol-barrel
[branch "refactor/web-memory-slice"]
	remote = fork
	vscode-merge-base = origin/main
	merge = refs/heads/refactor/web-memory-slice
[branch "feat/agent-ready-contracts"]
	remote = fork
	merge = refs/heads/feat/agent-ready-contracts
[branch "settings-finish"]
	remote = fork
	merge = refs/heads/refactor/web-settingsdialog-slice
[branch "refactor/web-chat-composer-slice"]
	vscode-merge-base = fork/refactor/web-settingsdialog-slice
[core]
	repositoryformatversion = 0
	filemode = true
	bare = false
	logallrefupdates = true
	ignorecase = true
	precomposeunicode = true
[remote "origin"]
	url = https://github.com/nexu-io/open-design.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "refactor/web-file-viewer-slice"]
	remote = origin
	merge = refs/heads/refactor/web-file-viewer-slice
[remote "fork"]
	url = https://github.com/leonaburime-ucla/open-design.git
	fetch = +refs/heads/*:refs/remotes/fork/*
[branch "main"]
	remote = origin
	merge = refs/heads/main
[core]
	repositoryformatversion = 0
	filemode = true
	bare = false
	logallrefupdates = true
	ignorecase = true
	precomposeunicode = true
[remote "origin"]
	url = https://github.com/nexu-io/open-design.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
	remote = origin
	merge = refs/heads/main
	vscode-merge-base = origin/main
[remote "ainsep"]
	url = https://github.com/AINSEP/Open-Marketing.git
	fetch = +refs/heads/*:refs/remotes/ainsep/*
[branch "settings-section-registry"]
	vscode-merge-base = origin/main
[merge "ours"]
	driver = true
[branch "arch/chat-run-extraction"]
	vscode-merge-base = origin/main
    8635 apps/daemon/src/server.ts
    8616 /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts
    9452 /Users/la/Desktop/Programming/Open-Marketing/apps/daemon/src/server.ts
   26703 total
agentic_cmp=1
om_cmp=1

exec
/bin/bash -lc "sed -n '1,260p' /Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh && sed -n '1,260p' /Users/la/Desktop/Programming/Tovu-Runner/scripts/verify-architecture-split.sh && sed -n '1,260p' /Users/la/Desktop/Programming/Tovu-Runner/web/src/core/ports.ts && sed -n '1,260p' /Users/la/Desktop/Programming/Tovu-Runner/web/src/server/app.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
#!/usr/bin/env bash
# Run Tovu's engine processes in the FOREGROUND — each streams its own output
# and stops on Ctrl-C. Run them in separate terminals for independent control:
#
#   npm run daemon    # terminal 1: backend API on :7456
#   npm run web       # terminal 2: web UI, proxies /api -> daemon
#
# Engine = Tovu's own open-design checkout (default: sibling Jini).
# Override with TOVU_ENGINE=/path/to/engine. Ports: OD_PORT (daemon, 7456),
# WEB_PORT (web, 3000).
set -euo pipefail

ENGINE="${TOVU_ENGINE:-$HOME/Desktop/Programming/OSS-Repos/Jini}"
TOVU_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_SRC="$TOVU_ROOT/web/src"
DAEMON_PORT="${OD_PORT:-7456}"
WEB_PORT="${WEB_PORT:-3000}"

[ -d "$ENGINE/apps/daemon" ] || { echo "engine not found at: $ENGINE (set TOVU_ENGINE)" >&2; exit 1; }

bind_web() {
  # One-time: preserve the engine's original UI, then point web src at Tovu.
  if [ -d "$ENGINE/apps/web/src" ] && [ ! -L "$ENGINE/apps/web/src" ] && [ ! -e "$ENGINE/apps/web/src.orig" ]; then
    mv "$ENGINE/apps/web/src" "$ENGINE/apps/web/src.orig"
    echo "preserved engine UI -> apps/web/src.orig"
  fi
  ln -sfn "$WEB_SRC" "$ENGINE/apps/web/src"
}

case "${1:-}" in
  daemon)
    echo "▶ daemon (foreground) — http://127.0.0.1:$DAEMON_PORT · /api/health · Ctrl-C to stop"
    cd "$ENGINE/apps/daemon"
    exec node dist/cli.js --no-open --port "$DAEMON_PORT"
    ;;
  web)
    bind_web
    echo "▶ web (foreground) — http://127.0.0.1:$WEB_PORT · proxies /api -> daemon :$DAEMON_PORT · Ctrl-C to stop"
    echo "  (start the daemon first: npm run daemon)"
    cd "$ENGINE/apps/web"
    # NODE_PATH mirrors what the engine's orchestrator sets so the symlinked
    # Tovu src resolves react / @open-design/* from the engine's node_modules.
    # --webpack instead of turbopack keeps dev-server memory down.
    exec env \
      NODE_PATH="$ENGINE/apps/web/node_modules:$ENGINE/node_modules" \
      OD_PORT="$DAEMON_PORT" \
      PORT="$WEB_PORT" \
      pnpm exec next dev --webpack --port "$WEB_PORT"
    ;;
  *)
    echo "usage: bash scripts/dev.sh {daemon|web}" >&2
    exit 1
    ;;
esac
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL_FILE="$ROOT_DIR/tovu-architecture.md"
ARCH_DIR="$ROOT_DIR/docs/architecture"
SECTIONS_DIR="$ARCH_DIR/sections"
APPENDICES_DIR="$ARCH_DIR/appendices"
MAP_FILE="$ARCH_DIR/MIGRATION-MAP.yaml"

if [[ ! -f "$CANONICAL_FILE" ]]; then
  echo "Missing canonical file: $CANONICAL_FILE" >&2
  exit 1
fi

if [[ ! -d "$SECTIONS_DIR" ]]; then
  echo "Missing sections directory: $SECTIONS_DIR" >&2
  exit 1
fi

if [[ ! -d "$APPENDICES_DIR" ]]; then
  echo "Missing appendices directory: $APPENDICES_DIR" >&2
  exit 1
fi

if [[ ! -f "$MAP_FILE" ]]; then
  echo "Missing migration map: $MAP_FILE" >&2
  exit 1
fi

shopt -s nullglob
export LC_ALL=C

section_files=("$SECTIONS_DIR"/*.md)
appendix_files=("$APPENDICES_DIR"/*.md)

if [[ ${#section_files[@]} -ne 15 ]]; then
  echo "Expected 15 section files, found ${#section_files[@]}" >&2
  exit 1
fi

if [[ ${#appendix_files[@]} -ne 27 ]]; then
  echo "Expected 27 appendix files, found ${#appendix_files[@]}" >&2
  exit 1
fi

map_entries="$(grep -c '^  - id:' "$MAP_FILE" || true)"
if [[ "$map_entries" -ne 42 ]]; then
  echo "Expected 42 migration-map entries, found $map_entries" >&2
  exit 1
fi

validate_map_hashes() {
  local expected_count="$1"
  local count=0
  local path=""
  local expected_hash=""
  local actual_hash=""

  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]+path:[[:space:]](.+)$ ]]; then
      path="${BASH_REMATCH[1]}"
      continue
    fi

    if [[ "$line" =~ ^[[:space:]]+sha256:[[:space:]]([0-9a-f]{64})$ ]]; then
      expected_hash="${BASH_REMATCH[1]}"

      if [[ -z "$path" ]]; then
        echo "Migration map hash entry missing preceding path." >&2
        exit 1
      fi

      if [[ ! -f "$ROOT_DIR/$path" ]]; then
        echo "Mapped file missing: $ROOT_DIR/$path" >&2
        exit 1
      fi

      actual_hash="$(shasum -a 256 "$ROOT_DIR/$path" | awk '{print $1}')"
      if [[ "$actual_hash" != "$expected_hash" ]]; then
        echo "SHA-256 mismatch for $path" >&2
        echo "Expected: $expected_hash" >&2
        echo "Actual:   $actual_hash" >&2
        exit 1
      fi

      count=$((count + 1))
      path=""
    fi
  done < "$MAP_FILE"

  if [[ "$count" -ne "$expected_count" ]]; then
    echo "Expected $expected_count validated hashes, found $count" >&2
    exit 1
  fi

  echo "Validated per-file SHA-256 hashes: $count"
}

validate_map_hashes "$map_entries"

reassembled_file="$(mktemp)"
trap 'rm -f "$reassembled_file"' EXIT

for file in "${section_files[@]}"; do
  cat "$file" >> "$reassembled_file"
done

for file in "${appendix_files[@]}"; do
  cat "$file" >> "$reassembled_file"
done

if cmp -s "$CANONICAL_FILE" "$reassembled_file"; then
  canonical_hash="$(shasum -a 256 "$CANONICAL_FILE" | awk '{print $1}')"
  reassembled_hash="$(shasum -a 256 "$reassembled_file" | awk '{print $1}')"
  echo "Verification passed."
  echo "Canonical SHA-256:   $canonical_hash"
  echo "Reassembled SHA-256: $reassembled_hash"
  exit 0
fi

echo "Verification failed: reassembled content differs from $CANONICAL_FILE" >&2
diff -u "$CANONICAL_FILE" "$reassembled_file" | sed -n '1,200p' >&2
exit 1
/**
 * @file Core port contracts for the Tovu runtime.
 *
 * Purpose:
 * Defines the stable interfaces that domain/application code depends on.
 *
 * How it relates to the project:
 * - `features/*` import these contracts to stay framework/provider-agnostic.
 * - `core/memory-bus.ts` provides in-memory implementations for local dev/tests.
 * - `core/outbox-worker.ts` orchestrates reliable async delivery using these ports.
 * - `server/app.ts` composes concrete implementations and runs the slice.
 *
 * Architectural role:
 * This file is the dependency inversion seam. Concrete infrastructure can change
 * without changing feature logic as long as implementations satisfy these types.
 */
/**
 * Shared primitives and runtime ports used by the Tovu core.
 *
 * Design goal:
 * Core/domain code depends on interfaces from this file only, never on concrete
 * infrastructure SDKs or framework-specific implementations.
 */
export type UUID = string;
export type ISODateTime = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

/**
 * Immutable domain event emitted by synchronous command handlers and delivered
 * asynchronously via the outbox pipeline.
 */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  /** Unique identifier for the event record. */
  id: UUID;
  /** Stable event name, e.g. `workspace.created`. */
  name: string;
  /** ISO timestamp describing when the event was produced. */
  occurredAt: ISODateTime;
  /** Optional aggregate root identifier related to this event. */
  aggregateId?: UUID;
  /**
   * Tenant/workspace boundary. Required: every domain event belongs to a
   * workspace (ADR-007). Platform-level events must be a deliberate future
   * decision, not an omission.
   */
  workspaceId: UUID;
  /**
   * Principal (user or AI agent) that caused this event. Reserved change-set
   * vocabulary (ADR-008); optional until the identity library lands.
   */
  actorId?: UUID;
  /**
   * Change set this event belongs to, enabling propose/preview/apply/revert
   * grouping. Reserved change-set vocabulary (ADR-008).
   */
  changeSetId?: UUID;
  /** Event-specific payload. */
  payload: TPayload;
  /** Free-form metadata (trace IDs, source, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Event bus abstraction used by the application layer.
 *
 * This is intentionally generic so implementations can be in-memory, queue-based,
 * broker-based, or provider-managed without changing domain logic.
 */
export interface EventBusPort {
  /** Publish a single event to subscribers. */
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;
  /** Publish multiple events in order. */
  publishBatch<TPayload>(events: Array<DomainEvent<TPayload>>): Promise<void>;
  /**
   * Subscribe a handler to an event name.
   * Returns an async unsubscriber function.
   */
  subscribe<TPayload>(
    eventName: string,
    handler: (event: DomainEvent<TPayload>) => Promise<void>
  ): Promise<() => Promise<void>>;
}

/**
 * Persisted outbox row used for reliable async event delivery.
 */
export interface OutboxRecord {
  /** Primary key for the outbox row (same as `event.id`). */
  id: UUID;
  /**
   * The full event envelope. The outbox must preserve everything the producer
   * emitted (workspaceId, aggregateId, actorId, occurredAt, metadata) so
   * delivery replays the original event, not a reconstruction.
   */
  event: DomainEvent;
  /** Delivery lifecycle state. */
  status: "pending" | "processing" | "delivered" | "failed";
  /** Number of delivery attempts so far. */
  attempts: number;
  /** Retry eligibility timestamp. */
  nextAttemptAt: ISODateTime;
  /** Most recent delivery failure reason. */
  lastError?: string;
  /** Row creation timestamp. */
  createdAt: ISODateTime;
}

/**
 * Reliable outbox contract.
 *
 * Command handlers enqueue events here in the same unit of work as the write.
 * A worker later claims and delivers rows to the event bus.
 */
export interface OutboxPort {
  /** Append an event for later delivery. */
  enqueue(event: DomainEvent): Promise<void>;
  /** Claim pending rows for processing. */
  claimPending(batchSize: number, nowIso: ISODateTime): Promise<OutboxRecord[]>;
  /** Mark a row as delivered. */
  markDelivered(id: UUID): Promise<void>;
  /** Mark a row as failed and set next retry time. */
  markFailed(id: UUID, error: string, nextAttemptAt: ISODateTime): Promise<void>;
}

/** Clock abstraction to make time deterministic in tests. */
export interface ClockPort {
  /** Current wall-clock time as ISO string. */
  nowIso(): ISODateTime;
}

/** ID generator abstraction to keep ID strategy swappable and testable. */
export interface IdGeneratorPort {
  /** Create a new globally unique ID. */
  newId(): UUID;
}
import express from "express";
import { randomUUID } from "node:crypto";

import type { JsonObject } from "../core/ports";
import { InMemoryEventBus, InMemoryOutbox, processOutbox } from "../core/events";
import { InMemoryPostRepo } from "../features/post";
import { InMemoryPresentationSettingsRepo } from "../features/presentation";
import { createWorkspace, InMemoryWorkspaceRepo, WorkspaceConflictError, WorkspaceValidationError } from "../features/workspace";
import path from "node:path";

import { applyDevCors } from "./middleware/dev-cors";
import { registerAdminStatic } from "./middleware/admin-static";
import { registerAuthRoutes, requireAdminSession } from "./middleware/dev-auth";
import { registerAdminPostListRoute } from "./routes/admin/posts/list";
import { registerSiteRoutes } from "./routes/site/pages";
import { registerAdminPresentationGetRoute } from "./routes/admin/presentation/get";
import { registerAdminPresentationPatchRoute } from "./routes/admin/presentation/patch-active-theme";
import { registerAdminPostGetRoute } from "./routes/admin/posts/get-by-id";
import { registerAdminPostUpdateRoute } from "./routes/admin/posts/update";
import { registerContentPostGetRoute } from "./routes/content/posts/get-by-slug";
import { registerHealthRoute } from "./routes/ops/health";
import type { RouteDeps } from "./routes/types";

/**
 * @file HTTP composition root and route wiring.
 *
 * Purpose:
 * Assembles concrete adapters and exposes API endpoints.
 *
 * How it relates to the project:
 * - Wires in-memory adapters from `src/core/events` and `src/features/workspace`.
 * - Calls `createWorkspace` slice for command handling.
 * - Triggers `processOutbox` after successful writes to deliver async events.
 *
 * Architectural role:
 * Keeps transport concerns (HTTP, status codes, request parsing) separate from
 * domain logic. Feature code remains reusable outside Express.
 */
const seededWorkspace = {
  id: "workspace-local",
  name: "Local Tovu Workspace",
  slug: "local-tovu",
  createdAt: "2026-04-06T00:00:00.000Z",
};

const seededWelcomeDoc: JsonObject = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Welcome to Tovu" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "This editor is now using a real " },
        { type: "text", text: "TipTap", marks: [{ type: "bold" }] },
        { type: "text", text: " document with styled prose instead of an empty demo box." },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Use it to pressure-test the shell before we fill in the rest of the CMS." },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Bold", marks: [{ type: "bold" }] },
                { type: "text", text: " and " },
                { type: "text", text: "italic", marks: [{ type: "italic" }] },
                { type: "text", text: " formatting should be obvious immediately." },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Lists, quotes, and code blocks should round-trip through the API." },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Switch themes in Appearance to verify the frontend actually changes." },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Build the skateboard first, but make sure it actually rolls." },
          ],
        },
      ],
    },
    {
      type: "codeBlock",
      content: [{ type: "text", text: "console.log('Tovu shell is live');" }],
    },
  ],
};

function createRouteDeps(): RouteDeps {
  const workspaceRepo = new InMemoryWorkspaceRepo([seededWorkspace]);
  const postRepo = new InMemoryPostRepo([
    {
      id: "post-home",
      workspaceId: seededWorkspace.id,
      title: "Welcome to Tovu",
      slug: "welcome",
      bodyJson: seededWelcomeDoc,
      status: "published",
      updatedAt: "2026-04-06T00:00:00.000Z",
      version: 1,
    },
    {
      id: "post-glass-demo",
      workspaceId: seededWorkspace.id,
      title: "Glassmorphic Demo Notes",
      slug: "glass-demo",
      bodyJson: {
        type: "doc",
        content: [
          {
            type: "heading",
            level: 2,
            content: [{ type: "text", text: "Theme Switching Check" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Use this seeded post to verify that the frontend really changes when the active theme changes.",
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Paper should feel editorial and warm." }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Atlas should feel bold and atmospheric." }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Glassmorphic should feel translucent and layered." }],
                  },
                ],
              },
            ],
          },
        ],
      },
      status: "published",
      updatedAt: "2026-04-06T00:00:00.000Z",
      version: 1,
    },
  ]);
  const presentationRepo = new InMemoryPresentationSettingsRepo([
    {
      workspaceId: seededWorkspace.id,
      activeThemeId: "paper",
      updatedAt: "2026-04-06T00:00:00.000Z",
    },
  ]);

  return {
    workspaceId: seededWorkspace.id,
    workspaceRepo,
    postRepo,
    presentationRepo,
    outbox: new InMemoryOutbox(),
    bus: new InMemoryEventBus(),
    clock: { nowIso: () => new Date().toISOString() },
    idGen: { newId: () => randomUUID() },
  };
}

export function createApp(routeDeps: RouteDeps = createRouteDeps()) {
  const app = express();
  applyDevCors(app);
  app.use(express.json());

  void routeDeps.bus.subscribe("workspace.created", async (event) => {
    // Demonstration side effect. Replace with indexers/webhooks/etc.
    console.log("event handled:", event.name, event.payload);
  });

  registerHealthRoute(app, routeDeps);

  // Session auth: login/logout/me are ungated; everything else under
  // /api/admin requires a session (dev-grade until the permissions feature).
  registerAuthRoutes(app);
  app.use("/api/admin", requireAdminSession);

  registerAdminPostListRoute(app, routeDeps);
  registerAdminPostGetRoute(app, routeDeps);
  registerAdminPostUpdateRoute(app, routeDeps);
  registerAdminPresentationGetRoute(app, routeDeps);
  registerAdminPresentationPatchRoute(app, routeDeps);
  registerContentPostGetRoute(app, routeDeps);

  // Built admin SPA (apps/admin/dist) at /admin; helpful 503 when unbuilt.
  registerAdminStatic(app, {
    distDir: process.env.TOVU_ADMIN_DIST ?? path.resolve(__dirname, "../../apps/admin/dist"),
  });

  /**
   * Create workspace route.
   *
   * Hybrid execution model:
   * - synchronous command path for validation + persistence
   * - outbox flush to run async side effects reliably
   */
  app.post("/workspaces", async (req, res) => {
    try {
      const { id } = await createWorkspace(
        {

exec
/bin/bash -lc "rg -n \"class (ProviderRegistry|ToolRegistry)|interface (ProviderRegistry|ToolRegistry)|type (ProviderRegistry|ToolRegistry)|ProviderRegistry|ToolRegistry|capability descriptor|CapabilityDescriptor|registerProvider|registerTool\" /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages /Users/la/Desktop/Programming/Tovu-Runner/web/src /Users/la/Desktop/Programming/Open-Marketing/apps /Users/la/Desktop/Programming/Open-Marketing/packages | sed -n '1,320p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 702ms:
/Users/la/Desktop/Programming/Open-Marketing/apps/web/src/runtime/tool-renderers.ts:73:export function registerToolRenderer(name: string, renderer: ToolRenderer): () => void {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/contracts/src/agent-tools/registry.ts:21:export interface AgentToolRegistry {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src/index.ts:1:export { createSqliteAgentToolRegistry } from './sqlite-registry.js';
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src/sqlite-registry.ts:1:// SQLite-backed implementation of the `AgentToolRegistry` port
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src/sqlite-registry.ts:14:  type AgentToolRegistry,
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src/sqlite-registry.ts:38:export function createSqliteAgentToolRegistry({ db }: { db: SqliteDb }): AgentToolRegistry {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:4:import { createSqliteAgentToolRegistry } from '../src/sqlite-registry.js';
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:33:describe('createSqliteAgentToolRegistry', () => {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:35:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:42:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:47:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:56:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:66:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:76:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:88:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:10:  registerToolRenderer,
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:88:    const dispose = registerToolRenderer('xyz', r);
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:97:    registerToolRenderer('xyz', a);
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:98:    registerToolRenderer('xyz', b);
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:105:    const disposeA = registerToolRenderer('xyz', a);
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:106:    registerToolRenderer('xyz', b);
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:116:    registerToolRenderer('render_chart', ({ status, args }) => (
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:169:    registerToolRenderer('render_chart', ({ status, result }) => (
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:182:    registerToolRenderer('Bash', () => null);
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:191:    registerToolRenderer('Bash', ({ args }) => (
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:219:    const disposeA = registerToolRenderer('render_chart', (props) => <HookfulCardA {...props} />);
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:231:    registerToolRenderer('render_chart', (props) => <HookfulCardB {...props} />);
/Users/la/Desktop/Programming/Open-Marketing/apps/web/tests/runtime/tool-renderers.test.tsx:242:    registerToolRenderer('Bash', () => {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/routes/browser-actions.ts:2:import type { AgentToolRegistry, BrowserActionResult, JsonValue } from '@open-design/contracts';
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/routes/browser-actions.ts:16:    registry: AgentToolRegistry;
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts:597:import { createSqliteAgentToolRegistry } from '@open-design/agent-tools';
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts:2455:  const agentToolRegistry = createSqliteAgentToolRegistry({ db });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts:2456:  await registerBrowserActionTools(agentToolRegistry);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts:3047:    browserActions: { registry: agentToolRegistry, pendingBrowserActions },
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/browser-actions/tools.ts:1:import type { AgentToolRegistry, BrowserToolDescriptor } from '@open-design/contracts';
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/browser-actions/tools.ts:116:export async function registerBrowserActionTools(registry: AgentToolRegistry): Promise<void> {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/mcp-browser-actions-server.ts:33:// the SQLite-backed agentToolRegistry.
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/src/runtime/tool-renderers.ts:73:export function registerToolRenderer(name: string, renderer: ToolRenderer): () => void {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:10:  registerToolRenderer,
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:88:    const dispose = registerToolRenderer('xyz', r);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:97:    registerToolRenderer('xyz', a);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:98:    registerToolRenderer('xyz', b);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:105:    const disposeA = registerToolRenderer('xyz', a);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:106:    registerToolRenderer('xyz', b);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:116:    registerToolRenderer('render_chart', ({ status, args }) => (
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:169:    registerToolRenderer('render_chart', ({ status, result }) => (
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:182:    registerToolRenderer('Bash', () => null);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:191:    registerToolRenderer('Bash', ({ args }) => (
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:219:    const disposeA = registerToolRenderer('render_chart', (props) => <HookfulCardA {...props} />);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:231:    registerToolRenderer('render_chart', (props) => <HookfulCardB {...props} />);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/web/tests/runtime/tool-renderers.test.tsx:242:    registerToolRenderer('Bash', () => {

exec
/bin/bash -lc "sed -n '1,260p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/contracts/src/agent-tools/registry.ts && sed -n '1,260p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src/sqlite-registry.ts && sed -n '1,240p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/browser-actions/tools.ts && sed -n '1,180p' /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/routes/browser-actions.ts" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
// Agent-tool registry PORT — a pure interface describing the boundary reviewers
// evaluate now. This is TYPES ONLY. The IMPLEMENTATION is slice 2: it lives in a
// new standalone `packages/agent-tools` package, is persisted in the daemon's
// SQLite store under the resolved data root, and MUST NOT import `apps/*` or any
// project-specific code (enforced by a `check-cross-app-imports.ts`-style guard
// wired into `pnpm guard`). Contracts stays runtime-free — nothing here has a body.

import type { AgentToolDescriptor, AgentToolName } from './descriptor.js';
import type {
  AgentToolManifest,
  AgentToolSearchQuery,
  AgentToolSearchResult,
} from './manifest.js';

/**
 * The port the rest of the system depends on to declare, look up, list, and
 * search capability tools. Methods are async because the backing store is
 * SQLite (see the RFC "Registry persistence"); the port itself carries no
 * transport, no persistence detail, and no app/project coupling.
 */
export interface AgentToolRegistry {
  /** Declare (or replace by `name`) a tool. Idempotent on the descriptor name. */
  register(descriptor: AgentToolDescriptor): Promise<void>;
  /** Look up one tool by its stable name; `undefined` if not registered. */
  get(name: AgentToolName): Promise<AgentToolDescriptor | undefined>;
  /** Assemble the full advertised catalog for a run (the `tools/list` analog). */
  manifest(runId: string): Promise<AgentToolManifest>;
  /** Progressive/paged discovery over a large registry (the `tools/search` analog). */
  search(query: AgentToolSearchQuery): Promise<AgentToolSearchResult>;
}
// SQLite-backed implementation of the `AgentToolRegistry` port
// (`@open-design/contracts/agent-tools/registry.ts`). Receives an
// already-open `better-sqlite3` handle via constructor injection — this
// package never resolves a data directory or opens its own connection; the
// daemon (the sole caller) owns that and hands in the handle, exactly like
// `DatabaseRegistryBackend` in `apps/daemon/src/registry/database-backend.ts`.

import type Database from 'better-sqlite3';
import {
  AGENT_ACTIONS_PROTOCOL_VERSION,
  type AgentToolDescriptor,
  type AgentToolManifest,
  type AgentToolName,
  type AgentToolRegistry,
  type AgentToolSearchQuery,
  type AgentToolSearchResult,
  type ApiToolDescriptor,
} from '@open-design/contracts';
import { ensureAgentToolTables } from './migrations.js';

type SqliteDb = Database.Database;

interface AgentToolRow {
  name: string;
  surface: string;
  descriptor_json: string;
  updated_at: string;
}

const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;

function rowToDescriptor(row: AgentToolRow): AgentToolDescriptor {
  return JSON.parse(row.descriptor_json) as AgentToolDescriptor;
}

/** Constructs the SQLite-backed registry, running its own migration on `db`. */
export function createSqliteAgentToolRegistry({ db }: { db: SqliteDb }): AgentToolRegistry {
  ensureAgentToolTables(db);

  const upsertStmt = db.prepare(`
    INSERT INTO agent_tools (name, surface, descriptor_json, updated_at)
    VALUES (@name, @surface, @descriptorJson, @updatedAt)
    ON CONFLICT(name) DO UPDATE SET
      surface = excluded.surface,
      descriptor_json = excluded.descriptor_json,
      updated_at = excluded.updated_at
  `);
  const getStmt = db.prepare(`SELECT * FROM agent_tools WHERE name = ?`);
  const listAllStmt = db.prepare(`SELECT * FROM agent_tools ORDER BY name`);
  const searchPageStmt = db.prepare(`
    SELECT * FROM agent_tools
    WHERE surface = 'api'
      AND (@query IS NULL OR name LIKE @likePattern OR descriptor_json LIKE @likePattern)
      AND (@cursor IS NULL OR name > @cursor)
    ORDER BY name
    LIMIT @limitPlusOne
  `);
  const searchCountStmt = db.prepare(`
    SELECT COUNT(*) AS total FROM agent_tools
    WHERE surface = 'api'
      AND (@query IS NULL OR name LIKE @likePattern OR descriptor_json LIKE @likePattern)
  `);

  return {
    async register(descriptor: AgentToolDescriptor): Promise<void> {
      upsertStmt.run({
        name: descriptor.name,
        surface: descriptor.surface,
        descriptorJson: JSON.stringify(descriptor),
        updatedAt: new Date().toISOString(),
      });
    },

    async get(name: AgentToolName): Promise<AgentToolDescriptor | undefined> {
      const row = getStmt.get(name) as AgentToolRow | undefined;
      return row ? rowToDescriptor(row) : undefined;
    },

    async manifest(runId: string): Promise<AgentToolManifest> {
      const rows = listAllStmt.all() as AgentToolRow[];
      return {
        protocolVersion: AGENT_ACTIONS_PROTOCOL_VERSION,
        runId,
        tools: rows.map(rowToDescriptor),
      };
    },

    async search(query: AgentToolSearchQuery): Promise<AgentToolSearchResult> {
      const limit = Math.min(query.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
      const likePattern = query.query ? `%${query.query}%` : null;
      const rows = searchPageStmt.all({
        query: query.query ?? null,
        likePattern,
        cursor: query.cursor ?? null,
        limitPlusOne: limit + 1,
      }) as AgentToolRow[];
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const total = (searchCountStmt.get({ query: query.query ?? null, likePattern }) as { total: number })
        .total;
      return {
        tools: pageRows.map((row) => rowToDescriptor(row) as ApiToolDescriptor),
        nextCursor: hasMore ? pageRows[pageRows.length - 1]!.name : undefined,
        total,
      };
    },
  };
}
import type { AgentToolRegistry, BrowserToolDescriptor } from '@open-design/contracts';

// [FABLE, §E]: `ui.click` is constrained to elements carrying a
// `data-agent-target="<value>"` attribute (an explicit, author-controlled
// allowlist) — never a free-form CSS selector. An unconstrained
// `document.querySelector(<model-supplied selector>)?.click()` could hit
// "Delete project," submit forms, or trigger paid generation — anything the
// user can click — which breaks the `viewStateOnly: true` contract this
// descriptor asserts. The `target` field's description documents that
// constraint for the model; `apps/web/src/providers/dom.ts`'s
// `clickElement` enforces it at the DOM layer.
export const NAVIGATION_GOTO_TOOL: BrowserToolDescriptor = {
  name: 'navigation.goto',
  surface: 'browser',
  viewStateOnly: true,
  description: "Navigate the user's browser to a route within Open Design.",
  inputSchema: {
    type: 'object',
    required: ['route'],
    properties: { route: { type: 'string' } },
    additionalProperties: false,
  },
};

export const UI_CLICK_TOOL: BrowserToolDescriptor = {
  name: 'ui.click',
  surface: 'browser',
  viewStateOnly: true,
  description: 'Click an agent-addressable UI control (nav/tab/panel-toggle only).',
  inputSchema: {
    type: 'object',
    required: ['target'],
    properties: {
      target: { type: 'string', description: 'A data-agent-target value, not a raw CSS selector.' },
    },
    additionalProperties: false,
  },
};

// [FABLE, §E extended]: `ui.fill` uses a SEPARATE allowlist attribute,
// `data-agent-field`, rather than reusing `data-agent-target` — an element
// being clickable and being fillable are different author decisions (e.g.
// "rename project" may be agent-writable while "billing email" simply never
// carries the attribute). `field` is resolved the same way `target` is for
// `ui.click`: an exact attribute match, never a raw selector. Never submits
// — committing stays a separately-allowlisted `ui.click` on an explicit
// submit control, so a fill can't accidentally trigger one. See
// apps/web/src/providers/dom/browser-actions.dom.ts's `fillField`.
export const UI_FILL_TOOL: BrowserToolDescriptor = {
  name: 'ui.fill',
  surface: 'browser',
  viewStateOnly: true,
  description: 'Set the value of an agent-addressable text input, textarea, or contenteditable. Never submits the form.',
  inputSchema: {
    type: 'object',
    required: ['field', 'value'],
    properties: {
      field: { type: 'string', description: 'A data-agent-field value, not a raw CSS selector.' },
      value: { type: 'string', maxLength: 20000 },
    },
    additionalProperties: false,
  },
};

export const UI_WAIT_FOR_TOOL: BrowserToolDescriptor = {
  name: 'ui.waitFor',
  surface: 'browser',
  viewStateOnly: true,
  description: 'Wait for an agent-addressable target (data-agent-target or data-agent-field) to reach a state, so a multi-step sequence can verify each step before the next.',
  inputSchema: {
    type: 'object',
    required: ['target', 'state'],
    properties: {
      target: { type: 'string', description: 'A data-agent-target or data-agent-field value.' },
      state: { type: 'string', enum: ['visible', 'hidden', 'enabled'] },
      // Capped well inside the 30s dispatch timeout (DEFAULT_DISPATCH_TIMEOUT_MS
      // in pending-invocations.ts) so a wait can never itself starve the
      // dispatch into an ambiguous TIMEOUT.
      timeoutMs: { type: 'integer', minimum: 100, maximum: 10000, default: 5000 },
    },
    additionalProperties: false,
  },
};

// [FABLE, §E extended]: the mirror image of MAX_ERROR_MESSAGE_LENGTH in
// routes/browser-actions.ts — everything this tool returns flows straight
// into live model context, so it returns a bounded, structured allowlist
// projection (route + agent-addressable elements' id/role/label/state),
// never raw DOM/innerHTML. `value` is surfaced only for a field explicitly
// marked `data-agent-observe="value"`; reading form values by default would
// leak whatever the user typed regardless of whether the field's
// `data-agent-field` opt-in ever promised to expose it for reading.
export const UI_OBSERVE_TOOL: BrowserToolDescriptor = {
  name: 'ui.observe',
  surface: 'browser',
  viewStateOnly: true,
  description: 'Read the current route and a bounded, structured snapshot of agent-addressable UI (labels, roles, visible/disabled state, and opted-in field values) — never raw DOM. Use to verify state between steps instead of acting blind.',
  inputSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: 'Optional data-agent-target/data-agent-field prefix filter.' },
    },
    additionalProperties: false,
  },
};

export const BROWSER_ACTION_TOOLS: BrowserToolDescriptor[] = [
  NAVIGATION_GOTO_TOOL,
  UI_CLICK_TOOL,
  UI_FILL_TOOL,
  UI_WAIT_FOR_TOOL,
  UI_OBSERVE_TOOL,
];

/** Registers the slice-2 static browser-action tool set once at daemon startup. Idempotent (registry upserts by name). */
export async function registerBrowserActionTools(registry: AgentToolRegistry): Promise<void> {
  for (const descriptor of BROWSER_ACTION_TOOLS) {
    await registry.register(descriptor);
  }
}
import type { Express } from 'express';
import type { AgentToolRegistry, BrowserActionResult, JsonValue } from '@open-design/contracts';
import { AGENT_ACTIONS_PROTOCOL_VERSION, BROWSER_ACTION_ERROR_CODES } from '@open-design/contracts';
import type { PendingBrowserActions } from '../browser-actions/pending-invocations.js';
import type { RouteDeps } from '../server-context.js';

// Bound the string a browser client can send back into `error.message` — it
// flows directly into live model context on a failed dispatch, an
// unbounded string here is a prompt-injection channel qualitatively
// different from GenUI's respond route (which only corrupts a recorded
// human decision, never mid-turn model context). [FABLE, §D]
const MAX_ERROR_MESSAGE_LENGTH = 2000;

export interface RegisterBrowserActionRoutesDeps extends RouteDeps<'design' | 'http' | 'auth'> {
  browserActions: {
    registry: AgentToolRegistry;
    pendingBrowserActions: PendingBrowserActions;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const BROWSER_ACTION_ERROR_CODE_SET = new Set<string>(BROWSER_ACTION_ERROR_CODES);

function parseBrowserActionResultBody(
  body: unknown,
  invocationId: string,
  tool: string,
): BrowserActionResult | null {
  if (!isPlainObject(body)) return null;

  if (body.ok === true) {
    const okResult: Extract<BrowserActionResult, { ok: true }> = {
      protocolVersion: AGENT_ACTIONS_PROTOCOL_VERSION,
      invocationId,
      tool,
      ok: true,
      result: ('result' in body ? body.result : null) as Extract<BrowserActionResult, { ok: true }>['result'],
    };
    return okResult;
  }

  if (body.ok === false) {
    const error = isPlainObject(body.error) ? body.error : {};
    const code = typeof error.code === 'string' && BROWSER_ACTION_ERROR_CODE_SET.has(error.code)
      ? (error.code as (typeof BROWSER_ACTION_ERROR_CODES)[number])
      : 'EXECUTION_FAILED';
    const rawMessage = typeof error.message === 'string' ? error.message : 'browser action failed';
    const message = rawMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH);
    const errResult: Extract<BrowserActionResult, { ok: false }> =
      'details' in error
        ? {
            protocolVersion: AGENT_ACTIONS_PROTOCOL_VERSION,
            invocationId,
            tool,
            ok: false,
            error: { code, message, details: error.details as JsonValue },
          }
        : {
            protocolVersion: AGENT_ACTIONS_PROTOCOL_VERSION,
            invocationId,
            tool,
            ok: false,
            error: { code, message },
          };
    return errResult;
  }

  return null;
}

export function registerBrowserActionRoutes(app: Express, ctx: RegisterBrowserActionRoutesDeps): void {
  const { design } = ctx;
  const { sendApiError, requireLocalDaemonRequest } = ctx.http;
  const { authorizeToolRequest } = ctx.auth;
  const { registry, pendingBrowserActions } = ctx.browserActions;

  // Called by the `od mcp browser-actions` bridge subprocess. Private
  // MCP-bridge<->daemon transport leg, not the tool's public surface (both
  // registered tools are BrowserToolDescriptors — `api?: never; cli?:
  // never` — so this route is exempt from the UI/CLI dual-track law, same
  // as `/api/tools/live-artifacts/create`).
  app.post('/api/tools/browser-actions/dispatch', async (req, res) => {
    try {
      const toolGrant = authorizeToolRequest(req, res, 'browser-actions:dispatch');
      if (!toolGrant) return;

      const body = isPlainObject(req.body) ? req.body : {};
      const runId = typeof body.runId === 'string' ? body.runId : '';
      const tool = typeof body.tool === 'string' ? body.tool : '';
      const input = 'input' in body ? body.input : {};

      // [FABLE, §D]: without this check, run A's bridge (holding a
      // perfectly valid token for run A) could dispatch — and receive
      // results for — actions attributed to run B, since the request body
      // (not just the bearer token) names the target run.
      if (!runId || runId !== toolGrant.runId) {
        return sendApiError(res, 403, 'FORBIDDEN', 'runId must match the tool token grant', {
          details: { suppliedRunId: runId },
        });
      }

      const run = design.runs.get(runId);
      if (!run) {
        return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
      }

      const descriptor = await registry.get(tool);
      if (!descriptor) {
        return sendApiError(res, 404, 'TOOL_NOT_AVAILABLE', `tool "${tool}" is not registered`, {
          details: { tool },
        });
      }

      const result = await pendingBrowserActions.dispatch(run, tool, input);
      res.json(result);
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

  // Called by a browser tab before it executes the DOM side effect for a
  // `browser_action_request` it received off the run's SSE broadcast. Every
  // subscribed tab (e.g. two open tabs on the same run) gets the same
  // broadcast; only the tab whose claim returns `true` may execute — this is
  // the fix for the multi-tab double-execution bug (two tabs both clicking
  // the same button, double-firing whatever mutation it triggers). Same
  // local-request gate as the result route below, for the same reason.
  app.post(
    '/api/runs/:runId/browser-actions/:invocationId/claim',
    requireLocalDaemonRequest,
    (req, res) => {
      try {
        const { invocationId } = req.params;
        const body = isPlainObject(req.body) ? req.body : {};
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        if (!sessionId) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'body must include a string "sessionId"');
        }

        if (!pendingBrowserActions.isPending(invocationId)) {
          return sendApiError(res, 404, 'NOT_FOUND', 'invocation not found, already resolved, or superseded');
        }

        const claimed = pendingBrowserActions.claim(invocationId, sessionId);
        res.json({ claimed });
      } catch (err) {
        sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
      }
    },
  );

  // Called by the browser once the DOM action has executed. This daemon
  // binds loopback-only by default and refuses non-loopback bind without
  // OD_API_TOKEN; requireLocalDaemonRequest is the explicit, deliberate gate
  // that turns what would otherwise be an accidental CSRF gap (no CORS
  // middleware + JSON content-type forcing a preflight this daemon won't
  // answer) into a checked boundary — not an argument from
  // `invocationId` unguessability, which is broadcast on the run's SSE
  // stream and persisted to events.jsonl, so anyone positioned to receive
  // it is equally positioned to read it. [FABLE, §D]
  app.post('/api/runs/:runId/browser-actions/:invocationId/result', requireLocalDaemonRequest, (req, res) => {
    try {
      const { invocationId } = req.params;
      const body = isPlainObject(req.body) ? req.body : {};
      const tool = typeof body.tool === 'string' ? body.tool : '';
      const result = parseBrowserActionResultBody(body, invocationId, tool);
      if (!result) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'body must be a BrowserActionResult');
      }

      const resolved = pendingBrowserActions.resolve(invocationId, result);
      if (!resolved) {
        // Also covers the intended replay-guard outcome: the daemon's own
        // dispatch timeout already untracks an invocation once its
        // `expiresAt` passes, so a late/duplicate result naturally 404s
        // here without a separate expiry check duplicating that state.
        return sendApiError(res, 404, 'NOT_FOUND', 'invocation not found, already resolved, or superseded');

exec
/bin/bash -lc "rg -l \"export interface Register.*RoutesDeps\" apps/daemon/src | wc -l; rg -n \"extends RouteDeps<\" apps/daemon/src/routes apps/daemon/src/*-routes.ts | wc -l; rg -n \"\\bdb\\.(prepare|exec|transaction)|\\bctx\\.db\\b\" apps/daemon/src/routes apps/daemon/src/*-routes.ts | sed -n '1,220p'; rg -l \"satisfies RuntimeAgentDef\" apps/daemon/src/runtimes/defs | wc -l; rg -n \"register[A-Za-z]+Routes\\(app\" apps/daemon/src/server.ts | wc -l; rg -n \"AgentToolRegistry|createSqliteAgentToolRegistry|registerBrowserActionTools\" /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages | sed -n '1,160p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 171ms:
      25
      42
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts:595:import { registerBrowserActionTools } from './browser-actions/tools.js';
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts:597:import { createSqliteAgentToolRegistry } from '@open-design/agent-tools';
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts:2455:  const agentToolRegistry = createSqliteAgentToolRegistry({ db });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts:2456:  await registerBrowserActionTools(agentToolRegistry);
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src/index.ts:1:export { createSqliteAgentToolRegistry } from './sqlite-registry.js';
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/contracts/src/agent-tools/registry.ts:21:export interface AgentToolRegistry {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src/sqlite-registry.ts:1:// SQLite-backed implementation of the `AgentToolRegistry` port
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src/sqlite-registry.ts:14:  type AgentToolRegistry,
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/src/sqlite-registry.ts:38:export function createSqliteAgentToolRegistry({ db }: { db: SqliteDb }): AgentToolRegistry {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:4:import { createSqliteAgentToolRegistry } from '../src/sqlite-registry.js';
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:33:describe('createSqliteAgentToolRegistry', () => {
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:35:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:42:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:47:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:56:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:66:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:76:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/agent-tools/tests/sqlite-registry.test.ts:88:    const registry = createSqliteAgentToolRegistry({ db: freshDb() });

exec
/bin/bash -lc "wc -l apps/daemon/src/routes/chat.ts apps/daemon/src/routes/runs.ts apps/daemon/src/routes/deploy.ts apps/daemon/src/routes/terminal.ts apps/daemon/src/db.ts && sed -n '1,160p' apps/daemon/src/routes/chat.ts && sed -n '1,150p' apps/daemon/src/routes/runs.ts && rg -n \"function openDatabase|export function openDatabase|class .*Store|interface .*Store\" apps/daemon/src/db.ts apps/daemon/src/storage apps/daemon/src | sed -n '1,240p'" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
    2267 apps/daemon/src/routes/chat.ts
    1489 apps/daemon/src/routes/runs.ts
     261 apps/daemon/src/routes/deploy.ts
     109 apps/daemon/src/routes/terminal.ts
    2306 apps/daemon/src/db.ts
    6432 total
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

import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  defaultScenarioPluginIdForProjectMetadata,
  RUN_RESULT_PACKAGE_SCHEMA,
  type AppliedPluginSnapshot,
  type ArtifactManifest,
  type ChatRunStatus,
  type ChatRunStatusResponse,
  type ProjectMetadata as ContractProjectMetadata,
  type RunResultPackageResponse,
} from '@open-design/contracts';
import {
  deriveConfigureGlobals,
  modelIdForTracking,
  sessionModeToTracking,
  type TrackingDesignSystemSource,
  type TrackingDesignSystemKind,
  type TrackingDesignSystemEditSurface,
} from '@open-design/contracts/analytics';
import type { OdNativeEvent } from '@open-design/agui-adapter';
import { newInsertId, readAnalyticsContext } from '../analytics.js';
import type { AnalyticsContext } from '../analytics.js';
import { spawnEnvForAgent } from '../agents.js';
import { agentCliEnvForAgent, readAppConfig } from '../app-config.js';
import {
  codexSessionIdFromRunEvents,
  readCodexRolloutFirstCall,
} from '../codex-rollout-usage.js';
import type { ConnectorService } from '../connectors/service.js';
import {
  getConversation,
  getProject,
  listConversations,
  normalizeConversationSessionMode,
  updateProject,
  upsertMessage,
} from '../db.js';
import { readVelaLoginStatus } from '../integrations/vela.js';
import {
  deriveLangfuseDeliveryState,
  readTelemetrySinkConfig,
} from '../langfuse-trace.js';
import { parseMediaExecutionPolicyInput } from '../media/policy.js';
import { isManagedProjectCwd } from '../mcp-config.js';
import {
  buildConnectorProbe,
  getInstalledPlugin,
  resolvePluginSnapshot,
} from '../plugins/index.js';
import {
  assertSandboxProjectRootAvailable,
  isSafeId,
  listFiles,
  resolveProjectDir,
  SandboxImportedProjectError,
} from '../projects.js';
import {
  amrUserIdForRunAnalytics,
  agentProviderIdForRunAnalytics,
  hasExplicitRequestedModelForAnalytics,
  runtimeTypeForRunAnalytics,
  scanRunEventsForUsageAnalytics,
  summarizeRunTimingAnalytics,
  type RunEventForAnalyticsObservability,
  type RunTelemetryTimestamps,
} from '../run-analytics-observability.js';
import {
  diffRunArtifacts,
  snapshotProjectArtifacts,
  type RunArtifactBaseline,
} from '../run-artifact-fs.js';
import type { RunEventForDiagnostics } from '../run-diagnostics.js';
import { summarizeRunDiagnosticsForAnalytics } from '../run-diagnostics.js';
import type { RunEventForFailureClassification } from '../run-failure-classification.js';
import { classifyRunFailure } from '../run-failure-classification.js';
import { deriveRunErrorCode, runResultFromStatus } from '../run-result.js';
import type { RunStatusForAnalytics } from '../run-result.js';
import {
  parseRunToolBundleForRequest,
  validateRunToolBundleForAgent,
} from '../run-tool-bundle.js';
import type { DetectedAgent, RuntimeAgentDef } from '../runtimes/types.js';
import {
  deriveActivationMilestones,
  runAskedUserQuestion,
} from '../runtimes/run-artifacts.js';
import {
  runArtifactCountForRun,
  runDesignSystemCreatedForRun,
  runPreviewModuleCountForRun,
} from '../runtimes/run-lifecycle-analytics.js';

type SqliteDb = Database.Database;
type JsonRecord = Record<string, unknown>;
type ApiRequest = Request<Record<string, string>, unknown, JsonRecord>;
type ApiResponse = Response<unknown>;
type ProjectMetadata = (Partial<ContractProjectMetadata> & JsonRecord) | null | undefined;
type AgentCliEnv = Parameters<typeof agentCliEnvForAgent>[0];
type RunDeliveryTarget = 'managed-project' | 'external-project' | 'none';

interface ProjectRecord {
  id: string;
  name: string;
  designSystemId?: string | null;
  metadata?: ProjectMetadata;
  appliedPluginSnapshotId?: string | null;
}

interface ConversationRecord {
  id: string;
  createdAt?: number;
}

interface RunEventRecord
  extends RunEventForAnalyticsObservability,
    RunEventForDiagnostics,
    RunEventForFailureClassification {
  id: number;
  event: string;
  data: unknown;
  timestamp?: number;
}

interface SseClient {
  send(event: string, data: unknown, id?: number): void;
  end(): void;
  cleanup?(): void;
}

interface ChatRun {
  id: string;
  projectId: string | null;
  conversationId: string | null;
  assistantMessageId: string | null;
  agentId: string | null;
  model?: string | null;
  status: ChatRunStatus;
  createdAt: number;
  updatedAt: number;
  cancelRequested?: boolean;
  exitCode?: number | null;
  signal?: string | null;
  error?: string | null;
  errorCode?: string | null;
  projectMetadata?: ProjectMetadata;
  appliedPluginSnapshotId?: string | null;
  pluginId?: string | null;
apps/daemon/src/db.ts:34:export function openDatabase(projectRoot: string, { dataDir }: { dataDir?: string } = {}): SqliteDb {
apps/daemon/src/tool-tokens.ts:76:interface StoredToolTokenGrant extends ToolTokenGrant {
apps/daemon/src/services/plugin-share-tasks.ts:25:export interface CreatePluginShareTaskStoreDeps {
apps/daemon/src/live-artifacts/store.ts:51:export interface LiveArtifactStorePaths {
apps/daemon/src/live-artifacts/store.ts:66:export interface LiveArtifactStoreSummary {
apps/daemon/src/live-artifacts/store.ts:71:export interface LiveArtifactStoreRecord {
apps/daemon/src/live-artifacts/store.ts:190:export interface LiveArtifactPreviewRenderRecord extends LiveArtifactStoreRecord {
apps/daemon/src/live-artifacts/store.ts:219:export class LiveArtifactStoreValidationError extends Error {
apps/daemon/src/routes/media.ts:24:export interface RegisterMediaRoutesDeps extends RouteDeps<'db' | 'design' | 'http' | 'paths' | 'ids' | 'auth' | 'media' | 'appConfig' | 'orbit' | 'nativeDialogs' | 'projectStore' | 'projectFiles' | 'conversations' | 'research'> {}
apps/daemon/src/routes/deploy.ts:4:export interface RegisterDeployRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'ids' | 'deploy' | 'projectStore'> {}
apps/daemon/src/import-export-routes.ts:25:export interface RegisterImportRoutesDeps extends RouteDeps<'db' | 'http' | 'uploads' | 'node' | 'ids' | 'paths' | 'imports' | 'auth' | 'projectStore' | 'conversations' | 'projectFiles' | 'validation'> {}
apps/daemon/src/import-export-routes.ts:402:export interface RegisterProjectExportRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'node' | 'ids' | 'projectStore' | 'exports' | 'projectFiles' | 'validation'> {}
apps/daemon/src/import-export-routes.ts:1449:export interface RegisterFinalizeRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'validation' | 'finalize'> {}
apps/daemon/src/routes/project/index.ts:61:export interface RegisterProjectRoutesDeps extends RouteDeps<'db' | 'design' | 'http' | 'paths' | 'projectStore' | 'projectFiles' | 'conversations' | 'templates' | 'status' | 'events' | 'ids' | 'telemetry' | 'appConfig' | 'agents' | 'validation'> {}
apps/daemon/src/routes/project/index.ts:2436:export interface RegisterProjectFileRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'uploads' | 'node' | 'projectStore' | 'projectFiles' | 'documents' | 'artifacts' | 'projectPreviewScopes'> {}
apps/daemon/src/routes/project/index.ts:3900:export interface RegisterProjectUploadRoutesDeps extends RouteDeps<'db' | 'http' | 'uploads' | 'node' | 'paths' | 'projectStore' | 'projectFiles'> {}
apps/daemon/src/routes/project/conversations.ts:9:export interface RegisterProjectConversationRoutesDeps extends RouteDeps<'db' | 'design' | 'http' | 'paths' | 'projectStore' | 'conversations' | 'ids' | 'telemetry' | 'appConfig' | 'agents'> {}
apps/daemon/src/connectors/service.ts:147:export interface ConnectorCredentialStore {
apps/daemon/src/connectors/service.ts:169:export class InMemoryConnectorCredentialStore implements ConnectorCredentialStore {
apps/daemon/src/connectors/service.ts:192:export class FileConnectorCredentialStore implements ConnectorCredentialStore {
apps/daemon/src/routes/project/comments.ts:4:export interface RegisterProjectCommentRoutesDeps extends RouteDeps<'db' | 'projectStore' | 'conversations'> {}
apps/daemon/src/routes/live-artifact.ts:4:export interface RegisterLiveArtifactRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'auth' | 'liveArtifacts' | 'projectStore'> {}
apps/daemon/src/routes/active-context.ts:7:export interface RegisterActiveContextRoutesDeps extends RouteDeps<'db' | 'http' | 'projectStore'> {}
apps/daemon/src/routes/active-context.ts:20:interface ActiveContextStore {
apps/daemon/src/orbit.ts:165:interface OrbitSummaryStore {
apps/daemon/src/routes/design-systems.ts:35:export interface RegisterDesignSystemRoutesDeps extends RouteDeps<'db' | 'paths' | 'projectFiles' | 'projectStore'> {
apps/daemon/src/integrations/xai-tokens.ts:23:export interface StoredXAIToken {
apps/daemon/src/db.ts:34:export function openDatabase(projectRoot: string, { dataDir }: { dataDir?: string } = {}): SqliteDb {
apps/daemon/src/mcp-tokens.ts:26:export interface StoredMcpToken {

codex
Repo evidence confirms the risk is concrete: OD’s `server.ts` is 8,635 lines, `cli.ts` 10,071, there are 42 route registrations and 32 route-dependency interfaces, while chat/runs handlers are 2,267/1,489 lines and still import product concepts and raw SQLite. The agent registry also manually imports and appends 25 definitions, contradicting the design’s “existing add-a-file/zero-switchboard” premise.
 succeeded in 169148ms:
2026-07-16 11:10:44.499 xcodebuild[61464:1188260]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:10:45.533 xcodebuild[61474:1188286]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:10:47.956 xcodebuild[61474:1188264] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-8h5KPCXc' (errno=Operation not permitted)
2026-07-16 11:10:51.492 xcodebuild[61501:1188492]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:10:52.931 xcodebuild[61503:1188533]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:10:55.049 xcodebuild[61503:1188505] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
fork	https://github.com/leonaburime-ucla/open-design.git (fetch)
fork	https://github.com/leonaburime-ucla/open-design.git (push)
origin	https://github.com/nexu-io/open-design.git (fetch)
origin	https://github.com/nexu-io/open-design.git (push)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-UvZ0kJF4' (errno=Operation not permitted)
2026-07-16 11:11:04.063 xcodebuild[61547:1189022]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:05.176 xcodebuild[61556:1189041]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:06.732 xcodebuild[61556:1189027] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-hgFLRr4D' (errno=Operation not permitted)
2026-07-16 11:11:10.849 xcodebuild[61584:1189365]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:12.954 xcodebuild[61626:1189518]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:15.371 xcodebuild[61626:1189404] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
f65eea0343014bd8dad179dd4701c5eb02e18df4 2026-07-14 fix(web): fix 3 nettee bugs, 2 self-found races, push memory-slice coverage to ~97%
/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-m6HOIJ2I' (errno=Operation not permitted)
2026-07-16 11:11:29.343 xcodebuild[61723:1190539]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:31.018 xcodebuild[61741:1190732]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:32.651 xcodebuild[61741:1190584] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-I00mFEsS' (errno=Operation not permitted)
2026-07-16 11:11:36.784 xcodebuild[61793:1191246]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:38.005 xcodebuild[61802:1191374]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:39.507 xcodebuild[61802:1191263] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
fork	https://github.com/leonaburime-ucla/open-design.git (fetch)
fork	https://github.com/leonaburime-ucla/open-design.git (push)
origin	https://github.com/nexu-io/open-design.git (fetch)
origin	https://github.com/nexu-io/open-design.git (push)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-7CSHTn3q' (errno=Operation not permitted)
2026-07-16 11:11:51.311 xcodebuild[61942:1192396]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:53.152 xcodebuild[61953:1192556]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:11:55.897 xcodebuild[61953:1192432] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-qCbOauhy' (errno=Operation not permitted)
2026-07-16 11:12:01.531 xcodebuild[62011:1193243]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:12:03.893 xcodebuild[62027:1193398]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:12:06.798 xcodebuild[62027:1193268] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
951fa5f1541c3b7af23ccb07e3e60b294def56b1 2026-07-12 tools-dev: let --dev-server fall back to an ambient OD_WEB_DEV_SERVER
/Users/la/Desktop/Programming/Open-Marketing
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-XMyhju5B' (errno=Operation not permitted)
2026-07-16 11:12:22.271 xcodebuild[62148:1194575]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:12:24.383 xcodebuild[62158:1194652]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:12:27.137 xcodebuild[62158:1194583] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Uxywnjbq' (errno=Operation not permitted)
2026-07-16 11:12:35.370 xcodebuild[62192:1195180]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:12:37.608 xcodebuild[62199:1195289]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:12:40.562 xcodebuild[62199:1195185] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
ainsep	https://github.com/AINSEP/Open-Marketing.git (fetch)
ainsep	https://github.com/AINSEP/Open-Marketing.git (push)
origin	https://github.com/nexu-io/open-design.git (fetch)
origin	https://github.com/nexu-io/open-design.git (push)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-WQA1ASn6' (errno=Operation not permitted)
2026-07-16 11:12:59.992 xcodebuild[62294:1196215]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:13:02.717 xcodebuild[62304:1196291]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:13:05.978 xcodebuild[62304:1196238] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Xa3U2KSe' (errno=Operation not permitted)
2026-07-16 11:13:16.578 xcodebuild[62359:1196693]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-07-16 11:13:20.596 xcodebuild[62359:1196629] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
9d343ab684760eb932928f045ecc8da95c30486b 2026-07-08 docs(handoff): CopilotKit agentic chat architecture session (2026-07-08)
perl: warning: Setting locale failed.
perl: warning: Please check that your locale settings:
	LC_ALL = "C.UTF-8",
	LC_CTYPE = "C.UTF-8",
	LANG = "en_US.UTF-8"
    are supported and installed on your system.
perl: warning: Falling back to a fallback locale ("en_US.UTF-8").
48129225b561c30372ba980375ea33aec9471699  apps/daemon/src/server.ts
a169a6f206bd83d5c9e2919858780a0362fa62ce  /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts
37ebe9b15f93f6f4b813aba8452cf43bd7b5ff85  /Users/la/Desktop/Programming/Open-Marketing/apps/daemon/src/server.ts
    8616 /Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/apps/daemon/src/server.ts
    9452 /Users/la/Desktop/Programming/Open-Marketing/apps/daemon/src/server.ts
   18068 total

codex
# Verdict

Option A is still the right architecture, but the current A-design is not lockable as written. It passes S1, strains on S4/S5, and breaks S2/S3/S6/S7. The critical correction is to replace the structural “union of dependency objects” with typed provider tokens plus runtime validation, and to turn OD-sync from an aspiration into an enforced patch lane.

Grounding is verified where noted: OD currently has an 8,635-line [server.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server.ts), a 10,071-line [cli.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/cli.ts), 42 route registrations, and 32 route-dependency interfaces. Its [ServerContext](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server-context.ts:96) still has roughly 40 mostly-`any` product-shaped fields. Chat and run handlers remain 2,267 and 1,489 lines and directly import OD concepts and SQLite ([chat.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/routes/chat.ts:1), [runs.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/routes/runs.ts:1)). Conclusions about future Jini behavior are inferred from those verified seams.

## 1. S1–S7

| Scenario | Verdict | Reason |
|---|---|---|
| **S1 Netlify provider** | **Pass, with a lock** | It should add one provider module/package, tests, and one consumer opt-in such as `netlifyProvider()`. No kernel or deploy route-pack edit. The generic `deploy.publish` action remains a Tool; the Netlify client is a Provider bound into a multi-valued `DeployTarget` token. If adding Netlify requires editing a central provider-kind union, registry switch, or deploy service, M2 has failed. |
| **S2 New coding-agent CLI** | **Breaks as written** | A-design calls the existing runtime registry “add-a-file/zero-switchboard.” It is not: [registry.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/registry.ts:1) manually imports and appends 25 definitions. Lock this as external agent packs registered by the consumer; for Jini-owned built-ins, generate the manifest during build and guard it in CI. No handwritten registry edit. |
| **S3 New chat+runs product** | **Breaks** | `createDaemon({ routePacks, providers })` does not state who creates the run store, replayable event log, executor, principal resolver, tool boundary, HTTP listener, or CLI. A consumer currently has to understand the architecture before using it. Tovu-Runner illustrates the pain: its [dev script](/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:1) points at an entire Jini/OD checkout and symlinks its UI rather than consuming a small host contract. Provide a Node host preset with SQLite, local eventing, HTTP/SSE, and CLI wiring. |
| **S4 SQLite → Postgres** | **Strains** | With a proper `RunStore`/`EventLog` token, the intended blast radius is the Postgres adapter plus one binding change. But “same TypeScript interface” is insufficient: transaction boundaries, ordering, cursor durability, cancellation races, and migration ownership must have an adapter conformance suite. Current OD routes still use raw `db.prepare`/`db.exec`, demonstrating the extraction risk. |
| **S5 No OD concepts** | **Strains; not proven** | The selected packs should determine all dependencies, so chat+runs alone can be neutral. But “kernel services are always present,” AuthN ownership, defaults, and startup validation are underspecified. The promised fixture is an acceptance criterion, not evidence yet. It passes only when packed tarballs boot without project, artifact, design-system, OD data-root, or Electron concepts. |
| **S6 30 providers/50 tools/5 packs** | **Breaks** | An intersection of five structural dependency interfaces becomes an unreadable mega-type. Same-name properties with different types collapse toward `never`; optionality and multi-bindings are ambiguous; TypeScript diagnostics print the whole intersection; runtime JS can still omit or overwrite a key. Fifty tools should not enter the composition type at all. Use typed tokens and compute only missing token IDs. |
| **S7 OD security patch** | **Breaks** | “Structurally close” is not a sync mechanism. Upstream patches name `apps/daemon/...`, while the proposed target is `products/open-design/daemon/...`; lifted runtime files may no longer exist there; even small facade edits can conflict in the 8K-line composition root. The two grounded consumers are already diverging forks: agentic’s server is 8,616 lines and Open-Marketing’s is 9,452. OD-sync needs path stripping, ownership rules, and a recurring patch-application test. |

## 2. Sharpest flaws and fixes

1. **Kernel noun set is still too broad.** `ProviderRegistry` “keyed by kind” risks becoming a stringly service locator, while AuthN is transport-specific.

   **Fix:** the kernel owns `Principal`, `AuthorizationContext`, `Authorizer`, run lifecycle, events, tools, and agent execution. HTTP/CLI supplies a `PrincipalResolver`. Provider kinds are opaque typed tokens owned by feature packages, not a kernel enum.

2. **The union-of-deps contract is structurally fragile.** It detects some missing properties at compile time but cannot model identity, duplicates, multiple implementations, scopes, disposal, or runtime package/version skew.

   **Fix:** use `ProviderToken<T, Id>` plus explicit bindings and a small typed resolver—not a reflection/class-scanning DI container. Tokens declare `one` versus `many`, optional lifecycle, and contract version. Startup rejects missing, duplicate-singleton, and incompatible-version bindings. Compile-time diagnostics report only `MissingProviderIds`.

3. **“App-service layer in kernel” invites a second god object.** Product business services do not belong in `@jini/kernel`, and transport parity will drift if HTTP and CLI keep separate implementations. OD’s current large route handlers show the likely failure mode.

   **Fix:** every feature pack owns its transport-neutral application services. Its HTTP and CLI contributions call those same services. The kernel owns only run/tool orchestration services. Neither transport calls another transport.

4. **The tool boundary is described but not shaped.** A registry that returns callable handlers lets routes or agents bypass authorization, confirmation, timeout, audit, cancellation, and output limits. Agentic’s current [AgentToolRegistry](/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/contracts/src/agent-tools/registry.ts:21) stores descriptors; execution policy remains outside that port.

   **Fix:** register `{descriptor, handler, policy}` but expose invocation only through `ToolExecutor.execute(principal, run, tool, input, signal)`. The handler is never retrievable publicly. Confirmation must be resumable and audit records must cover requested, authorized, confirmed, started, completed, timed-out, and cancelled states.

5. **OD-sync conflicts with physical extraction.** Moving a stable file into `@jini/*` means a later OD security patch can apply successfully to a dead compatibility copy while the running implementation remains vulnerable.

   **Fix:** maintain a sync-ownership manifest mapping every upstream daemon path to either `product-owned` or `delegated-to-jini`. Apply patches into `products/open-design/daemon` using a tested `-p2`/directory transform. A patch touching delegated paths must fail CI until the equivalent Jini package patch and conformance test land.

6. **The package cut mixes ports with defaults and counts optional UI as engine core.**

   **Fix:** remove the generic `@jini/persistence` umbrella; ports live with their owning feature/kernel and SQLite is an adapter. Rename `artifacts-react` to neutral `renderers-react`, and keep all React packages optional.

## 3. Locked package set and composition contract

Foundation:

- `@jini/protocol`
- `@jini/kernel`
- `@jini/agent-runtime`
- `@jini/sqlite`
- `@jini/http`
- `@jini/cli`
- `@jini/platform`
- `@jini/sidecar`

Feature/UI:

- `@jini/chat-core`
- `@jini/chat-react`
- `@jini/renderers-react`
- `@jini/components`

Convenience:

- `@jini/node-host` — composition preset only; no business nouns.

The raw contract should be:

```ts
createDaemon({
  packs: [runsPack(), chatPack()],
  bindings: defineBindings(
    bind(RunStore, sqlite.runStore),
    bind(EventLog, sqlite.eventLog),
    bind(PrincipalResolver, principalResolver),
    bindMany(DeployTarget, netlifyTarget),
  ),
  agents: [codexAgentPack()],
  tools: [deployTool()],
  transports: [httpTransport(), cliTransport()],
});
```

`RequiredTokenIds<typeof packs> - ProvidedTokenIds<typeof bindings>` must be empty at compile time and startup. Extra bindings are allowed because extension bundles may serve tools or later packs. Agents and tools are registry entries, not dependency-object fields.

For M4, a local consumer implements no interfaces:

```ts
createLocalNodeDaemon({
  dataDir,
  packs: [runsPack(), chatPack()],
  agents: [codexAgentPack()],
});
```

Production replaces the explicit local-only principal policy and may replace SQLite; the application services stay unchanged.

## 4. First ten extraction tasks

Every task has two standing gates: **N** installs only packed `@jini/*` tarballs into `examples/minimal-host`, with an OD-noun/import ban; **O** dry-runs the OD patch canary against `products/open-design/daemon` and rejects unclassified touched paths.

1. **Create the N/O harnesses and sync-ownership manifest.** Gate: neutral health boot from tarballs; known upstream daemon patch applies with the documented path transform.

2. **Extract `@jini/protocol`.** Version run events, errors, cursors, cancellation and idempotency. Gate: fixture compiles without OD contracts; protocol extraction changes no sync-owned OD source path.

3. **Implement typed tokens, bindings, resolver, and startup diagnostics.** Gate: fixture proves missing/duplicate/version errors; OD patch canary remains green.

4. **Extract RunLifecycle and replayable EventLog/EventSink.** Gate: fixture starts, streams, cancels and resumes a fake run; OD characterization tests produce the same ordered event sequence.

5. **Build the ToolExecutor boundary.** Gate: fixture performs one allowed tool call and proves denial, confirmation, timeout, cancellation and output truncation; OD tool behavior remains patch-compatible.

6. **Extract agent-runtime behind registered agent packs.** Replace the handwritten registry with generated built-ins plus external registration. Gate: packed fixture runs a mock CLI; delegated-path security patches must update both OD mapping and Jini.

7. **Define store ports and ship `@jini/sqlite`.** Gate: fixture survives restart and cursor replay; SQLite/Postgres-neutral conformance tests contain no OD schema nouns; OD database patch canary passes.

8. **Extract runs and chat application services.** Keep HTTP absent. Gate: fixture completes a chat turn through services only; OD route responses remain characterization-equivalent and sync-owned routes are not reformatted.

9. **Add HTTP/SSE and CLI contribution registries.** Gate: the same fixture run works via HTTP and CLI `--json --prompt-file`; adding a command pack requires no central map like OD’s current [SUBCOMMAND_MAP](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/cli.ts:315).

10. **Put OD behind the facade and validate external consumption.** Gate: OD, Open-Marketing, and Tovu consume packed tarballs; minimal-host completes chat plus a tool call; a representative upstream security patch applies and tests the running, not dead, implementation.

## 5. Most likely two-year rot

The greatest risk is that typed tokens become a renamed `ServerContext`: every OD convenience gets promoted into a global kernel token until all packs can resolve everything.

The guardrail is strict token ownership: kernel exports only kernel-service tokens; every other token lives in its feature package; packs may resolve only their declared tokens; no ambient resolver escapes setup. CI should enforce that rule alongside API snapshots, forbidden OD nouns/imports, the packed neutral host, and the OD patch canary. A new kernel token requires a kernel invariant—not merely a need discovered by the first consumer.
tokens used
128,110
# Verdict

Option A is still the right architecture, but the current A-design is not lockable as written. It passes S1, strains on S4/S5, and breaks S2/S3/S6/S7. The critical correction is to replace the structural “union of dependency objects” with typed provider tokens plus runtime validation, and to turn OD-sync from an aspiration into an enforced patch lane.

Grounding is verified where noted: OD currently has an 8,635-line [server.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server.ts), a 10,071-line [cli.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/cli.ts), 42 route registrations, and 32 route-dependency interfaces. Its [ServerContext](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server-context.ts:96) still has roughly 40 mostly-`any` product-shaped fields. Chat and run handlers remain 2,267 and 1,489 lines and directly import OD concepts and SQLite ([chat.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/routes/chat.ts:1), [runs.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/routes/runs.ts:1)). Conclusions about future Jini behavior are inferred from those verified seams.

## 1. S1–S7

| Scenario | Verdict | Reason |
|---|---|---|
| **S1 Netlify provider** | **Pass, with a lock** | It should add one provider module/package, tests, and one consumer opt-in such as `netlifyProvider()`. No kernel or deploy route-pack edit. The generic `deploy.publish` action remains a Tool; the Netlify client is a Provider bound into a multi-valued `DeployTarget` token. If adding Netlify requires editing a central provider-kind union, registry switch, or deploy service, M2 has failed. |
| **S2 New coding-agent CLI** | **Breaks as written** | A-design calls the existing runtime registry “add-a-file/zero-switchboard.” It is not: [registry.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/registry.ts:1) manually imports and appends 25 definitions. Lock this as external agent packs registered by the consumer; for Jini-owned built-ins, generate the manifest during build and guard it in CI. No handwritten registry edit. |
| **S3 New chat+runs product** | **Breaks** | `createDaemon({ routePacks, providers })` does not state who creates the run store, replayable event log, executor, principal resolver, tool boundary, HTTP listener, or CLI. A consumer currently has to understand the architecture before using it. Tovu-Runner illustrates the pain: its [dev script](/Users/la/Desktop/Programming/Tovu-Runner/scripts/dev.sh:1) points at an entire Jini/OD checkout and symlinks its UI rather than consuming a small host contract. Provide a Node host preset with SQLite, local eventing, HTTP/SSE, and CLI wiring. |
| **S4 SQLite → Postgres** | **Strains** | With a proper `RunStore`/`EventLog` token, the intended blast radius is the Postgres adapter plus one binding change. But “same TypeScript interface” is insufficient: transaction boundaries, ordering, cursor durability, cancellation races, and migration ownership must have an adapter conformance suite. Current OD routes still use raw `db.prepare`/`db.exec`, demonstrating the extraction risk. |
| **S5 No OD concepts** | **Strains; not proven** | The selected packs should determine all dependencies, so chat+runs alone can be neutral. But “kernel services are always present,” AuthN ownership, defaults, and startup validation are underspecified. The promised fixture is an acceptance criterion, not evidence yet. It passes only when packed tarballs boot without project, artifact, design-system, OD data-root, or Electron concepts. |
| **S6 30 providers/50 tools/5 packs** | **Breaks** | An intersection of five structural dependency interfaces becomes an unreadable mega-type. Same-name properties with different types collapse toward `never`; optionality and multi-bindings are ambiguous; TypeScript diagnostics print the whole intersection; runtime JS can still omit or overwrite a key. Fifty tools should not enter the composition type at all. Use typed tokens and compute only missing token IDs. |
| **S7 OD security patch** | **Breaks** | “Structurally close” is not a sync mechanism. Upstream patches name `apps/daemon/...`, while the proposed target is `products/open-design/daemon/...`; lifted runtime files may no longer exist there; even small facade edits can conflict in the 8K-line composition root. The two grounded consumers are already diverging forks: agentic’s server is 8,616 lines and Open-Marketing’s is 9,452. OD-sync needs path stripping, ownership rules, and a recurring patch-application test. |

## 2. Sharpest flaws and fixes

1. **Kernel noun set is still too broad.** `ProviderRegistry` “keyed by kind” risks becoming a stringly service locator, while AuthN is transport-specific.

   **Fix:** the kernel owns `Principal`, `AuthorizationContext`, `Authorizer`, run lifecycle, events, tools, and agent execution. HTTP/CLI supplies a `PrincipalResolver`. Provider kinds are opaque typed tokens owned by feature packages, not a kernel enum.

2. **The union-of-deps contract is structurally fragile.** It detects some missing properties at compile time but cannot model identity, duplicates, multiple implementations, scopes, disposal, or runtime package/version skew.

   **Fix:** use `ProviderToken<T, Id>` plus explicit bindings and a small typed resolver—not a reflection/class-scanning DI container. Tokens declare `one` versus `many`, optional lifecycle, and contract version. Startup rejects missing, duplicate-singleton, and incompatible-version bindings. Compile-time diagnostics report only `MissingProviderIds`.

3. **“App-service layer in kernel” invites a second god object.** Product business services do not belong in `@jini/kernel`, and transport parity will drift if HTTP and CLI keep separate implementations. OD’s current large route handlers show the likely failure mode.

   **Fix:** every feature pack owns its transport-neutral application services. Its HTTP and CLI contributions call those same services. The kernel owns only run/tool orchestration services. Neither transport calls another transport.

4. **The tool boundary is described but not shaped.** A registry that returns callable handlers lets routes or agents bypass authorization, confirmation, timeout, audit, cancellation, and output limits. Agentic’s current [AgentToolRegistry](/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/packages/contracts/src/agent-tools/registry.ts:21) stores descriptors; execution policy remains outside that port.

   **Fix:** register `{descriptor, handler, policy}` but expose invocation only through `ToolExecutor.execute(principal, run, tool, input, signal)`. The handler is never retrievable publicly. Confirmation must be resumable and audit records must cover requested, authorized, confirmed, started, completed, timed-out, and cancelled states.

5. **OD-sync conflicts with physical extraction.** Moving a stable file into `@jini/*` means a later OD security patch can apply successfully to a dead compatibility copy while the running implementation remains vulnerable.

   **Fix:** maintain a sync-ownership manifest mapping every upstream daemon path to either `product-owned` or `delegated-to-jini`. Apply patches into `products/open-design/daemon` using a tested `-p2`/directory transform. A patch touching delegated paths must fail CI until the equivalent Jini package patch and conformance test land.

6. **The package cut mixes ports with defaults and counts optional UI as engine core.**

   **Fix:** remove the generic `@jini/persistence` umbrella; ports live with their owning feature/kernel and SQLite is an adapter. Rename `artifacts-react` to neutral `renderers-react`, and keep all React packages optional.

## 3. Locked package set and composition contract

Foundation:

- `@jini/protocol`
- `@jini/kernel`
- `@jini/agent-runtime`
- `@jini/sqlite`
- `@jini/http`
- `@jini/cli`
- `@jini/platform`
- `@jini/sidecar`

Feature/UI:

- `@jini/chat-core`
- `@jini/chat-react`
- `@jini/renderers-react`
- `@jini/components`

Convenience:

- `@jini/node-host` — composition preset only; no business nouns.

The raw contract should be:

```ts
createDaemon({
  packs: [runsPack(), chatPack()],
  bindings: defineBindings(
    bind(RunStore, sqlite.runStore),
    bind(EventLog, sqlite.eventLog),
    bind(PrincipalResolver, principalResolver),
    bindMany(DeployTarget, netlifyTarget),
  ),
  agents: [codexAgentPack()],
  tools: [deployTool()],
  transports: [httpTransport(), cliTransport()],
});
```

`RequiredTokenIds<typeof packs> - ProvidedTokenIds<typeof bindings>` must be empty at compile time and startup. Extra bindings are allowed because extension bundles may serve tools or later packs. Agents and tools are registry entries, not dependency-object fields.

For M4, a local consumer implements no interfaces:

```ts
createLocalNodeDaemon({
  dataDir,
  packs: [runsPack(), chatPack()],
  agents: [codexAgentPack()],
});
```

Production replaces the explicit local-only principal policy and may replace SQLite; the application services stay unchanged.

## 4. First ten extraction tasks

Every task has two standing gates: **N** installs only packed `@jini/*` tarballs into `examples/minimal-host`, with an OD-noun/import ban; **O** dry-runs the OD patch canary against `products/open-design/daemon` and rejects unclassified touched paths.

1. **Create the N/O harnesses and sync-ownership manifest.** Gate: neutral health boot from tarballs; known upstream daemon patch applies with the documented path transform.

2. **Extract `@jini/protocol`.** Version run events, errors, cursors, cancellation and idempotency. Gate: fixture compiles without OD contracts; protocol extraction changes no sync-owned OD source path.

3. **Implement typed tokens, bindings, resolver, and startup diagnostics.** Gate: fixture proves missing/duplicate/version errors; OD patch canary remains green.

4. **Extract RunLifecycle and replayable EventLog/EventSink.** Gate: fixture starts, streams, cancels and resumes a fake run; OD characterization tests produce the same ordered event sequence.

5. **Build the ToolExecutor boundary.** Gate: fixture performs one allowed tool call and proves denial, confirmation, timeout, cancellation and output truncation; OD tool behavior remains patch-compatible.

6. **Extract agent-runtime behind registered agent packs.** Replace the handwritten registry with generated built-ins plus external registration. Gate: packed fixture runs a mock CLI; delegated-path security patches must update both OD mapping and Jini.

7. **Define store ports and ship `@jini/sqlite`.** Gate: fixture survives restart and cursor replay; SQLite/Postgres-neutral conformance tests contain no OD schema nouns; OD database patch canary passes.

8. **Extract runs and chat application services.** Keep HTTP absent. Gate: fixture completes a chat turn through services only; OD route responses remain characterization-equivalent and sync-owned routes are not reformatted.

9. **Add HTTP/SSE and CLI contribution registries.** Gate: the same fixture run works via HTTP and CLI `--json --prompt-file`; adding a command pack requires no central map like OD’s current [SUBCOMMAND_MAP](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/cli.ts:315).

10. **Put OD behind the facade and validate external consumption.** Gate: OD, Open-Marketing, and Tovu consume packed tarballs; minimal-host completes chat plus a tool call; a representative upstream security patch applies and tests the running, not dead, implementation.

## 5. Most likely two-year rot

The greatest risk is that typed tokens become a renamed `ServerContext`: every OD convenience gets promoted into a global kernel token until all packs can resolve everything.

The guardrail is strict token ownership: kernel exports only kernel-service tokens; every other token lives in its feature package; packs may resolve only their declared tokens; no ambient resolver escapes setup. CI should enforce that rule alongside API snapshots, forbidden OD nouns/imports, the packed neutral host, and the OD patch canary. A new kernel token requires a kernel invariant—not merely a need discovered by the first consumer.
LOCK_SEAT1_DONE exit=0
