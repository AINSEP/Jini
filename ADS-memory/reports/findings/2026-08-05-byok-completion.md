# BYOK feature completion — 2026-08-05

Programmer-agent dispatch: finish the in-flight BYOK (bring-your-own-key) feature that was
~90% done on the chat side, left uncommitted. Lane: `packages/ui/src/features/execution/**`,
`packages/ui/src/react/components/CustomSelect.tsx`,
`packages/ui/src/features/settings/dialog/styles/settings-dialog.css`,
`packages/chat/src/react/features/chat-pane/**`,
`packages/chat/src/react/features/model-picker/**`,
`packages/agent-runtime/src/providers/connection-test.ts` + `model-catalog.ts` + their tests.

## What was found

On inspection, the feature was substantially further along than "~90% on chat, needs finishing
on ui/execution" suggested. Diffing every uncommitted/untracked file against `HEAD` and against
each other showed the `ui/execution` half (`ByokProviderForm.tsx`, `ExecutionTab.tsx`,
`SearchableModelSelect.tsx`, `constants.ts`, `CustomSelect.tsx`, `settings-dialog.css`) was
already **functionally complete and internally consistent** with the chat-side contract
(`ByokRuntimeSummary`, `byokRuntime`/`onByokModelChange`) — CSS classes referenced by the new
`RuntimeByokDetails` component all existed in `chat-pane/styles.ts`, `CUSTOM_MODEL_SENTINEL` and
`shouldShowCustomModelInput` already existed in `rules.ts`/`constants.ts` (unchanged, reused),
and both packages typechecked clean (`tsc --noEmit`, zero errors) before I made any edits. There
was no red test and no missing wiring to fix. My actual work was: verify this rigorously (not
just trust it), fix debranding, resolve the flattening-commit question, and commit.

## What was changed

1. **Debranding (R5-neutrality).** Rephrased 5 `Tovu` product-identity mentions to describe the
   capability instead of the product:
   - `packages/ui/src/features/execution/react/components/ByokProviderForm.tsx` (2 occurrences,
     1 file-level guard violation)
   - `packages/ui/src/features/execution/react/components/ExecutionTab.tsx` (1)
   - `packages/ui/src/react/components/CustomSelect.tsx` (1)
   - `packages/ui/src/features/settings/dialog/styles/settings-dialog.css` (2 occurrences, not
     guard-scanned — `.css` files are outside `listSourceFiles`'s `.ts`/`.tsx` scan — fixed anyway
     for the same neutrality principle since I already owned the file)

   **Deviation from the dispatch's stated target:** the brief named exactly these 3 `.tsx` files
   and predicted guard would move from 71 to 68. While fixing them I found the *same* class of
   violation in 2 more files inside my lane that the 20-minutes-earlier measurement had missed —
   `packages/chat/src/react/features/chat-pane/hooks/useAgentRuntimePicker.hooks.ts` and its test
   `__tests__/components/AgentRuntimePicker.test.tsx` (both new debt from this same in-flight
   session's `originTheme` work, not pre-existing). I fixed those too, since they're in-lane, the
   same fix shape (comment-only prose, no assertions on the literal string), and leaving known
   product-identity leaks in a `@jini-ai/*` package while touching the exact same file class
   seemed like the kind of "silently narrow the ask" the house rules warn against. Net result:
   **guard went 71 → 66**, not → 68. The one remaining `R5-neutrality` violation
   (`packages/chat/src/react/components/A2uiSurfaceCard.tsx`) is pre-existing, outside my lane,
   and left alone.

2. **Flattening judgement call (`chat-pane/react/{components,hooks}` → flat, and the equivalent
   for `model-picker`).** Investigated whether to split the `react/`-segment flattening into its
   own commit ahead of the BYOK commit, as the dispatch asked me to judge explicitly.

   Finding: `git diff --cached -M50%` (git's own rename-similarity threshold, the same one GitHub
   PR views use) already renders the combined flatten+feature diff for `chat-pane` as clean
   `{react => }` renames with modification hunks for every file but one (which is a byte-identical
   pure rename) — not full delete+add pairs. So the reviewability problem a separate commit would
   solve is already solved by git's native detection.

   Separating further would mean manually reconstructing a pre-BYOK version of each moved file
   (the BYOK logic threads through the exact functions the flattening moved —
   `useAgentRuntimePicker`'s return shape, `AgentRuntimePicker`'s render branch), i.e. hand-editing
   two diffs out of one already-entangled one. That's real surgery for a payoff git already gives
   for free.

   For `model-picker` specifically, the delete half of its flattening had *already landed* in a
   prior, mislabeled commit (`0b6eb2ec`, titled "docs: track the locked architecture authority" —
   it also happened to touch `model-picker/index.ts`'s import-path comment and, apparently as a
   side effect, delete the old `react/` tree). There is no undoing that split retroactively; only
   the add half remained uncommitted, and it isn't a rename from git's perspective regardless of
   how I commit it.

   **Decision: committed together**, one `feat(chat)` commit covering both packages, with the
   reasoning above recorded in the commit body.

3. **Commits** (`cd /Users/la/Programming/Jini`, branch `refactor/jini-admin-extraction`), each
   using `git commit -- <explicit paths>` per the shared-worktree house rule:
   - `e996a81b` `fix(agent-runtime): BYOK connection test survives Gemini 2.5 thinking-token budget`
     — `connection-test.ts`, `model-catalog.ts`, their `__tests__`. This was the work flagged as
     "already verified" in the dispatch; I did not re-litigate it, just confirmed it stayed green
     (99/99 files, 1963/1963 tests, matching baseline exactly) and folded it into this workstream's
     commit sequence since it was still sitting uncommitted.
   - `98bf345d` `feat(chat): BYOK-aware runtime picker, flatten chat-pane/model-picker react/
     segments` — `chat-pane/**`, `model-picker/**` (29 files).
   - `3b5d648d` `feat(ui): live model discovery + write-only credential display in BYOK form,
     debrand` — the 7 `ui/execution` + `CustomSelect.tsx` + `settings-dialog.css` files.

   Full commit messages carry the "why" (the design rationale behind each prop/behavior) and the
   verification evidence; see `git log` on those SHAs rather than duplicating them here.

## Verification

| Package | Before (baseline) | After | Method |
|---|---|---|---|
| `agent-runtime` | 99 files / 1963 tests (dispatch-supplied) | 99 / 1963 | `cd packages/agent-runtime && npx vitest run` |
| `chat` | 67 files / 958 tests (dispatch-supplied) | 67 / 958 | `cd packages/chat && npx vitest run` |
| `ui` | 386 files / 5186 tests (measured myself via `git stash push -- <ui-lane files>`, rerun, `git stash pop`) | 386 / 5189 (+3 new `ExecutionTab` tests, all passing) | `cd packages/ui && npx vitest run` |

All three: `npx tsc --noEmit` clean both before and after my edits (the debranding edits were
comment-only text changes, so typecheck was never expected to move).

`pnpm guard` (repo root): 71 → 66 (see deviation note above). Remaining 66 violations are
entirely `R2-deep-path` (pre-existing `@jini-ai/chat/core` deep-import debt across dozens of
files, clearly a separate pre-existing cleanup item, not touched) plus the one out-of-lane
`R5-neutrality` hit in `A2uiSurfaceCard.tsx`.

**Negative verification** (per house rules — an aggregate pass count alone isn't evidence): spot-
checked the safety-critical `apiKeyStoredExternally` behavior in `ByokProviderForm.tsx`. Disabled
the `missing.delete('apiKey')` line (`if (false && apiKeyStoredExternally) …`), reran
`ExecutionTab.test.tsx -t "forwards apiKeyFooter"` — it failed specifically on the
`Test connection` button no longer being enabled, confirming the test genuinely guards that
behavior rather than passing vacuously. Restored the line, reran the full `ExecutionTab.test.tsx`
file (21/21 passing) to confirm no other assertion was disturbed by the toggle.

## What I deliberately did NOT do

- Did not touch `packages/vibecoding/package.json`, `pnpm-lock.yaml`, or
  `packages/vibecoding/src/html/node/**` — dirty in the shared worktree but outside my assigned
  lane and, per the dispatch, belonging to a concurrent agent's (docs-only, in theory) work. Left
  exactly as found.
- Did not fix the pre-existing `Tovu` mention in `packages/chat/src/react/components/
  A2uiSurfaceCard.tsx` — outside my lane (`chat/src/react/components/`, not `chat-pane/` or
  `model-picker/`).
- Did not touch the 63 `R2-deep-path` guard violations (`@jini-ai/chat/core` /
  `@jini-ai/ui/mcp-ui` deep imports) — pre-existing, unrelated to BYOK, out of scope for this
  dispatch.
- Did not re-verify or modify `connection-test.ts`/`model-catalog.ts`'s actual logic — dispatch
  explicitly marked this as already verified; I only confirmed it was still green and committed
  it.

## Architecture Audit

**Status: PASS.**

- R1/R3 (foundry/examples/AI-Dev-Shop and OD-DTO boundaries): not touched by any of my edits.
- R2 (deep-path imports): none of my changes added a new deep-path import; the 63 pre-existing
  R2 violations are untouched, none introduced by this work.
- R5 (product neutrality): improved (71 → 66); the fixes I made were comment-only rephrasings
  with no behavior change.
- Package boundaries: all new/changed code stayed inside its owning package
  (`@jini-ai/ui`, `@jini-ai/chat`, `@jini-ai/agent-runtime`); no new cross-package relative
  imports were introduced.

## Risks / tech debt

- `settings-dialog.css` carries a large amount of pre-existing `Tovu`-mentioning debt (lines
  ~1922, 2429, 2644, 3760, 3905 as of this commit) that I left alone — it's not guard-enforced
  (CSS isn't scanned) and fixing it wholesale was out of scope for this dispatch; flagging for a
  future dedicated debranding pass over non-`.ts`/`.tsx` files, which the guard module's own doc
  comment already notes as a known gap ("a clean `guard` run is necessary but not sufficient").
- The 63 `R2-deep-path` violations in `@jini-ai/chat` are a pre-existing, unrelated cleanup item
  worth its own dispatch.
