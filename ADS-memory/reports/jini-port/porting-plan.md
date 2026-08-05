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
