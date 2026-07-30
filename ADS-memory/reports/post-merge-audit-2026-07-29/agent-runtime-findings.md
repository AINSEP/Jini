# packages/agent-runtime — post-merge audit findings to verify and fix

Source: independent OpenAI Codex (gpt-5.6-sol, high reasoning) peer review of the production-source
diff for `packages/agent-runtime` between `9cb4ffc50` (base) and `085c4799a` (merge of
`feat/agentic-capability-layer` into `main`). Codex reproduced these against the built package
rather than relying on static reading alone. None of these have been independently re-verified by a
human or another model yet — treat every one as a hypothesis to confirm against current source, not
a given fact.

## BLOCKING

1. **`permissionMode: 'restricted'` is ignored by multiple adapters.**
   `types.ts:31` promises that restricted mode omits auto-approval, but these adapters still emit
   dangerous flags regardless of the requested mode:
   - `defs/aider.ts:45` — `--yes-always`
   - `defs/amp.ts:49` — `--dangerously-allow-all`
   - `defs/copilot.ts:62` — `--allow-all-tools`
   - `defs/cursor-agent.ts:70` — `--force`, plus `--trust` when supported
   - `defs/devin.ts:38` — `--permission-mode dangerous --respect-workspace-trust false`

   Reproduced: calling each `buildArgs(..., { permissionMode: 'restricted' })` retained those
   flags. A host requesting restricted execution therefore still gets full auto-approval on all
   five. Adapters without a safe noninteractive restricted mode should reject the request rather
   than silently bypass it.

2. **An Antigravity settings-write failure permanently wedges the model mutex.**
   The lock is acquired at `defs/antigravity.ts:270`, then `buildArgs` performs throwable
   filesystem writes at `defs/antigravity.ts:338-342`. The sole merged consumer acquires before
   calling `buildArgs` (`packages/daemon/src/agent-executor.ts:1863,1882`) without a `try/finally`;
   no process exists yet, so the exit-based release handler cannot run. Reproduced: forcing the
   settings write to fail with `EEXIST` left a second model-lock acquisition blocked indefinitely
   until the first hold was manually released. A read-only home, permissions failure, or disk error
   can therefore break all later concrete-model Antigravity runs for the daemon's lifetime. Note:
   the actual fix may need to touch `packages/daemon/src/agent-executor.ts` too, since that's where
   the lock is acquired relative to `buildArgs` — confirm before editing outside `agent-runtime`.

## NON-BLOCKING (fix only if small/obviously correct; otherwise just note in your report)

- `defs/antigravity.ts:165-172` installs a new abort listener on every polling interval but removes
  it only when abort fires. Reproduced: a short 80ms/5ms poll retained 15 listeners; defaults can
  retain roughly 60 until process exit. Remove the listener when the timer wins instead.
- `claude-stream.ts:123-127` cannot deduplicate when `currentMessageId` is null. Reproduced: an
  accepted assistant frame without an ID followed by a same-reason result emitted two identical
  `turn_end` events. Normal Claude frames likely carry IDs, so this is lower priority, but the
  stated dedup guarantee is not unconditional.

## What to do

For each finding: read the actual current source at the cited file:line and confirm or refute it
yourself, independently — don't just trust the description above. If it's a false positive, say
exactly why and don't change the code. If it's real: write a FAILING TEST FIRST that reproduces it
(in the relevant existing test file, following that file's own conventions), confirm it fails
against current unfixed code, THEN implement the minimal correct fix, THEN confirm the new test
passes and the package's full test suite has zero regressions. No fix without a preceding red test.

Full working conventions, branch naming, and report format are in the top-level task prompt you
were given alongside a pointer to this file — follow those.
