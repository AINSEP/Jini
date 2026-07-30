# packages/daemon — post-merge audit findings to verify and fix

Source: independent OpenAI Codex (gpt-5.6-sol, high reasoning) peer review of the production-source
diff for `packages/daemon` between `9cb4ffc50` (base) and `085c4799a` (merge of
`feat/agentic-capability-layer` into `main`). Codex reproduced most of these against the built
package rather than relying on static reading alone (see each item). None of these have been
independently re-verified by a human or another model yet — treat every one as a hypothesis to
confirm against current source, not a given fact.

## BLOCKING

1. **`agent-executor.ts:907-929, 1899-1900` — per-run MCP credentials race through a shared `cwd/.mcp.json`.**
   Two runs in the same working directory overwrite the same `mcpServers.jini` entry. A child
   spawned for run A can consequently read run B's `JINI_RUN_ID` and bearer token, directing A's
   callbacks into B's authority context. The original entry/token is also never restored after
   exit. Reproduced with delayed child config loading: both children observed run B's ID and token.

2. **`agent-executor.ts:1863, 1882-1894` — `buildArgs()` failure strands the run and its resources.**
   `runtimeLock` is acquired and staged files are created before `def.buildArgs()` executes, outside
   any guard. Antigravity's `buildArgs()` performs synchronous filesystem writes, so `EACCES`,
   disk-full, or a read-only home directory can throw here. Reproduced: the executor returned a
   bare `Error`, the run remained `running`, and both lock-release and staged-file-cleanup counters
   remained zero — contradicting the documented "never a bare Error" and cleanup invariants.

3. **`run-lifecycle.ts:451-475, 490-499, 612-619` — failed durable starts leave observable ghost runs and hanging terminal waiters.**
   The record enters `runs` before the start event commits, but `get()`, `list()`, and
   `waitForTerminal()` do not await `startPromise`. If the append rejects, `get`/`list` temporarily
   expose a nonexistent running run, while an already-registered terminal waiter is never resolved
   or rejected after the record is deleted. Reproduced: `get`/`list` returned the ghost run; after
   an append failure, `waitForTerminal()` remained pending indefinitely.

4. **`agent-executor.ts:1089, 1211-1215` — buffered stdout is an unbounded memory-denial path.**
   An `until-close` child can emit indefinitely or never close, and every byte is concatenated into
   one string with no ceiling, backpressure, or disk spooling. Agent subprocesses are explicitly
   treated as potentially adversarial elsewhere in this codebase, so this permits daemon OOM.
   Statically confirmed by Codex; deliberately not reproduced to the point of actually OOMing — you
   should verify by reading the code path, not by trying to trigger a real OOM either.

5. **`frontend-session-registry.ts:261-266, 281-284` — stale handles can tear down replacement sessions.**
   `detach()` and the returned unbind closures identify ownership only by `sessionId`. If a session
   detaches and another attachment later reuses that ID, calling the old handle's `detach()` again
   removes the new attachment and its run bindings. Reproduced: after reattaching `tab`, calling the
   stale handle's `detach()` removed the replacement session and made its still-current bind token
   unusable.

## NON-BLOCKING (fix only if small/obviously correct; otherwise just note in your report)

- `remote-tool-bridge.ts:53-68` ignores the stable `toolUseId` for deduplication. Retried
  cross-process POSTs append duplicate tool events with new event IDs.
- `run-start-handler.ts:37-61, 110-120` does not expose or forward the newly supported
  `imagePaths`, `extraAllowedDirs`, or `uploadRoot`, so hosts using the default handler silently
  lose those inputs.
- `agent-executor.ts:1265-1284` lets staged-file cleanup or failure-classification rejection
  prevent `finish()`, potentially stranding a run after its child has already closed.

## What to do

For each finding: read the actual current source at the cited file:line and confirm or refute it
yourself, independently — don't just trust the description above. If it's a false positive, say
exactly why and don't change the code. If it's real: write a FAILING TEST FIRST that reproduces it
(in the relevant existing test file, following that file's own conventions), confirm it fails
against current unfixed code, THEN implement the minimal correct fix, THEN confirm the new test
passes and the package's full test suite has zero regressions. No fix without a preceding red test.

Full working conventions, branch naming, and report format are in the top-level task prompt you
were given alongside a pointer to this file — follow those.
