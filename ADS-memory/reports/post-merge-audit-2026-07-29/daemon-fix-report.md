# packages/daemon — post-merge audit: verification and fixes

**Date:** 2026-07-30 · **Branch:** `fix/post-merge-audit-daemon-2026-07-30` (off `main` @ `9efb671`)
**Findings under review:** `daemon-findings.md` in this directory (independent OpenAI Codex
gpt-5.6-sol peer review of `9cb4ffc50…085c4799a`).

Every finding was re-read against current source and judged independently. **All 5 BLOCKING findings
and 2 of the 3 NON-BLOCKING findings are real.** One non-blocking finding is real but its fix is not
small or obviously correct, so per that section's own instruction it is documented rather than
changed. There were **no false positives**.

Each real finding got a failing test first, confirmed red against unfixed code, then the minimal fix,
then a green re-run plus a full-package run. Actual observed output is quoted throughout.

---

## Verdict summary

| # | Finding | Verdict | Fix |
|---|---|---|---|
| B1 | `.mcp.json` per-run credential race in a shared `cwd/.mcp.json` | **Real** | Run-scoped config file + removal after the run |
| B2 | `buildArgs()` failure strands the run and its resources | **Real** | Guarded, routed through `failBeforeSpawn` |
| B3 | Failed durable starts leave ghost runs and hanging terminal waiters | **Real** | `get`/`list`/`waitForTerminal` await the pending start |
| B4 | Buffered stdout is an unbounded memory-denial path | **Real** | 8 MiB default ceiling + non-silent truncation |
| B5 | Stale session handles tear down replacement sessions | **Real** | Ownership by attachment identity, not session id |
| N1 | `remote-tool-bridge.ts` ignores `toolUseId` for dedup | **Real, not fixed** | Documented below — no small correct fix exists |
| N2 | `run-start-handler.ts` drops `imagePaths`/`extraAllowedDirs`/`uploadRoot` | **Real** | Three fields added and forwarded |
| N3 | Post-close cleanup/classification rejection prevents `finish()` | **Real (and broader than reported)** | Both steps guarded, in all three close handlers |

Tests: **654 → 682** in `@jini-ai/daemon` (+28), all passing, no test deleted or weakened.

---

## B1 — per-run MCP credentials race through a shared `cwd/.mcp.json`

**Cited:** `agent-executor.ts:907-929, 1899-1900` · **Verdict: REAL.**

`writeMcpJsonForRun` wrote `join(cwd, '.mcp.json')` with the fixed key `mcpServers.jini`, whose `env`
block carries `JINI_RUN_ID` and the per-run bearer `JINI_DAEMON_TOKEN` (`buildMcpJsonServerEntry`).
Two runs in the same `cwd` therefore wrote the same key in the same file, and a spawned CLI loads its
MCP config when it starts its client rather than synchronously at spawn — so run B's write lands in
the file run A's child has not read yet, and A's `jini-mcp` subprocess then calls back carrying B's run
id and B's token. That is run A's tool calls executing inside run B's authority context. The second
half of the finding is also correct: nothing ever removed or restored the file, so a live bearer token
was left in the project directory after every run.

This is not merely theoretical for this codebase: `agent-executor.test.ts`'s own
*"mints a distinct credential per run, not one shared across the executor"* test drives exactly two
runs against `cwd: '/work'` — it asserted what each write *contained* and never what survived, which
is why it passed while the bug was live.

**Fix** (`agent-executor.ts`): one config file per run.

- New `mcpJsonPathForRun(cwd, runId)` → `<cwd>/.mcp.jini-<runId>.json`. The run id is host-supplied and
  lands in a filename, so everything outside `[A-Za-z0-9_-]` is replaced (dots included, so no `..`
  segment survives) and the result is length-capped at 128 characters.
- `cwd/.mcp.json` is now **read only** — still the merge source, so a project's own MCP servers are
  preserved exactly as before, but never a write target. Nothing needs restoring afterwards.
- New `McpJsonInjectionOptions.removeFile` seam (default `fs.promises.rm(path, { force: true })`). The
  run's config file is removed through the existing `cleanupStagedFiles` closure, so it is released on
  the close handler and on every pre-spawn/spawn-failure path, exactly like the staged prompt and log
  files it sits alongside.

**Deliberately not chosen, and why** — recorded because each alternative looks reasonable until pushed
on:

- *Fail closed on a second run in the same cwd (a per-cwd reservation).* Rejected: concurrent runs in
  one working directory are a supported, documented design point (`McpJsonInjectionOptions.credential`
  is a per-run resolver precisely so "two runs under one executor get different secrets"), and this
  would have broken the existing test that pins it. A shared file cannot carry two identities; the
  answer is two files, not one refused run.
- *Move the run id and token out of the file into the spawn env.* Rejected as unverifiable from here —
  it depends on whether each CLI passes its own environment through to MCP stdio subprocesses, which I
  cannot confirm without a live run.

### Residual risk this fix introduces — needs a follow-up outside `packages/daemon`

The run-scoped path only reaches the child because the def passes it on: `claude.ts` emits
`--strict-mcp-config --mcp-config <runtimeContext.mcpJsonPath>`. **`codebuddy.ts` is the other def
declaring `externalMcpInjection: 'claude-mcp-json'`, and it ignores `runtimeContext.mcpJsonPath`,
relying on its CLI auto-discovering `cwd/.mcp.json`.** For a codebuddy run with `mcpJsonInjection`
configured, this change writes a file that def's child never reads, so its jini MCP tools go away.

I did **not** change `codebuddy.ts`, and want that decision visible rather than buried:

- The minimal change is one line mirroring `claude.ts`. But I cannot verify that the codebuddy CLI
  accepts `--strict-mcp-config`/`--mcp-config`, and an unsupported flag would fail codebuddy runs
  outright — worse than losing MCP tools.
- The path being lost is, on this repo's own live evidence, already non-functional: `claude.ts`'s
  comment added 2026-07-30 records that headless auto-discovery of `.mcp.json` "left the MCP server
  connection stuck at `pending` forever" because it needs an interactive trust prompt a
  daemon-spawned child has no TTY to answer. Codebuddy is documented in its own def as behaving
  identically to Claude Code (`--resume`/`--session-id`/`--permission-mode bypassPermissions`, same
  stream format), so the same prompt almost certainly applies.
- Only the `codebuddy` + `mcpJsonInjection` combination is affected. Codebuddy without
  `mcpJsonInjection` is untouched.

**Recommended follow-up:** add the two flags to `codebuddy.ts`'s `buildArgs` under the same
`runtimeContext.mcpJsonPath` guard `claude.ts` uses, after one live codebuddy run confirms the flags
are accepted.

**Red-then-green.** 6 new tests failed against unfixed code:

```
× gives each run its own config file, so neither child can read the other run's id or token
  → expected '/work/shared/.mcp.json' not to be '/work/shared/.mcp.json'
× hands buildArgs the same path it then writes, so the child is pointed at its own file
  → expected '/work/shared/.mcp.json' to contain 'run-xyz'
× merges from the project's own .mcp.json without ever writing to it
  → expected [ '/work/proj/.mcp.json' ] to not include '/work/proj/.mcp.json'
× removes the run's config file once the child closes, so a live token is not left on disk
  → expected [] to deeply equal [ '/work/proj/.mcp.json' ]
× removes the run's config file on a pre-spawn failure after it was already written
  → expected [] to deeply equal [ '/work/proj/.mcp.json' ]
× still finishes the run when removing the config file fails
  → Cannot read properties of undefined (reading '0')
```

A 7th (a path-like run id must not escape the run cwd) passed before the fix — the filename was
constant then — and is kept as a guard on the new naming scheme.

**Three pre-existing tests were updated**, because the write path genuinely changed. None was
weakened; two were strengthened:

- *"reads, merges, and writes …"* → now asserts the exact run-scoped write path **and** still asserts
  the merged content and that the project file was the read source.
- *"…touches the real filesystem"* → discovers the written filename by listing the temp dir and
  asserts it is not `.mcp.json`, keeping the real-fs round trip (its actual subject) intact.
- *"passes runtimeContext.mcpJsonPath to buildArgs …"* → now asserts the path is inside the run cwd,
  is not the project `.mcp.json`, and contains the run id; the "real by spawn time" read-back is kept.

---

## B2 — `buildArgs()` failure strands the run and its resources

**Cited:** `agent-executor.ts:1863, 1882-1894` · **Verdict: REAL.**

`def.buildArgs(...)` was called with no guard, after `def.runtimeLock?.acquire()` and after both staged
files exist. Every other step between staging and spawn funnels through `failBeforeSpawn`; this one
did not. Since `buildArgs` is exactly the step a `runtimeLock` exists to guard *because* it performs
synchronous filesystem writes (antigravity writes its model choice into a shared settings file), an
EACCES on a read-only home, ENOSPC, or a malformed settings file all throw here. The consequences are
exactly as reported: a bare `Error` escapes `run()` (breaking the module's documented "never a bare
throw" invariant), the run stays `'running'` forever, and the process-global mutex is never released —
so no later run of that def can acquire it either.

**Fix:** wrap the call; on throw, `await releaseStagedResources()` (lock + staged files) then
`failBeforeSpawn(runId, 'AGENT_SPAWN_FAILED', …)`.

**Red-then-green:**

```
× fails the run before spawn, releasing the lock and staged files, when buildArgs itself throws
  → expected Error: EACCES: permission denied, open '/… to match object { code: 'AGENT_SPAWN_FAILED', … }
× reports a throwing buildArgs as AgentExecutorError even for a def with nothing staged
  → expected Error: def blew up composing argv to be an instance of AgentExecutorError
```

Both now pass and assert the full set: rejection code, no spawn, `['acquire','release']` on the lock,
staged-file cleanup called once, run `'failed'`, and a durable `end` event with `resumable: false`.

---

## B3 — failed durable starts leave ghost runs and hanging terminal waiters

**Cited:** `run-lifecycle.ts:451-475, 490-499, 612-619` · **Verdict: REAL, both halves.**

`start()` inserts the record into `runs` at line 451 and only then awaits the durable `'start'`
append, unwinding the record if that append rejects. `get()` and `list()` read `runs` with no regard
for `record.startPromise`, so inside that window they report a run whose durable start entry does not
exist and never will — a run no restart could rehydrate. `waitForTerminal()` likewise registered a
waiter without awaiting `startPromise`; after the unwind deletes the record, nothing ever calls
`finish()` for it, so that waiter is never resolved *or* rejected.

**Fix:**

- New `settlePendingStart(record)` helper; `get()` and `list()` await it (swallowing the rejection,
  which belongs to `start()`'s own caller) and then re-read `runs`, so a failed start reads as
  "no such run" rather than as a running one. `list()` uses `Promise.all` over pending starts so one
  failing start cannot break the whole listing.
- `waitForTerminal()` awaits and **propagates** `record.startPromise` before registering anything.
  That alone closes the hang: a waiter can now only be parked for a run whose start really committed,
  and a failed start surfaces as the same error that failed the start. No reject-capable waiter
  plumbing was needed.

**Red-then-green:**

```
× never reports a run through get() or list() when its durable start append fails
  → expected { id: 'ghost-run', …(3) } to be undefined
× rejects a waitForTerminal() registered before a failing start append, instead of leaving it pending forever
  → expected 'pending' to be 'rejected'
```

The waiter test races the wait against a timer instead of plainly awaiting it, so the pre-fix
behaviour reports as `'pending'` rather than as a whole-test timeout. A third test (`get`/`list`/
`waitForTerminal` all behave normally once a *slow but successful* start commits) passed before and
after, as the regression guard on the added awaits.

---

## B4 — buffered stdout is an unbounded memory-denial path

**Cited:** `agent-executor.ts:1089, 1211-1215` · **Verdict: REAL.** Confirmed by reading the path, not
by inducing a real OOM.

For a def with `stdoutPolicy.buffering === 'until-close'`, every chunk was appended to one
`bufferedStdout` string with no ceiling, no backpressure and no spooling, flushed only on `'close'`.
An `until-close` child can emit indefinitely or never close, and this driver treats spawned agent CLIs
as potentially adversarial everywhere else (SEC-001 governs their environment for that reason). One
run could therefore exhaust the daemon heap and take every unrelated run in the process with it.

**Fix:**

- Exported `DEFAULT_BUFFERED_STDOUT_MAX_BYTES = 8 * 1024 * 1024`, overridable via
  `CreateAgentExecutorOptions.bufferedStdoutMaxBytes`. 8 MiB sits far above any real buffered-agent
  transcript (antigravity's print-mode output, the only `until-close` def, is a few KiB) while staying
  small enough that a hostile child cannot pressure the heap.
- Accounting is `Buffer.byteLength(chunk, 'utf8')`. **Whole chunks only**: a chunk that would cross the
  ceiling is dropped rather than sliced, so the accumulator never holds a half-written multi-byte
  character, and everything after the first refusal is dropped too — a hard ceiling on resident bytes,
  not a best-effort tail.
- Truncation is never silent. The flush appends `[jini] agent stdout truncated: N byte(s) dropped
  after the M-byte buffer limit was reached.` — added **after** the def's own `sanitize` runs, since it
  is this driver's text and a consumer-supplied redactor must not be able to delete the one line
  saying output is missing. A truncated run emits even when the sanitized text is empty, so
  "the sanitizer redacted everything" and "we dropped output on the floor" cannot look identical.
- The byte journal still records every raw byte — its documented contract — and has its own test.

**Red-then-green:** 3 of 5 new tests failed against unfixed code (the other 2 are guards that held):

```
× stops accumulating at the configured ceiling and reports how much was dropped
  → expected 'kept-head-kept-head-kept-head-DROPPED…' not to contain 'DROPPED-A'
× applies DEFAULT_BUFFERED_STDOUT_MAX_BYTES when a host configures nothing
  → expected value must be number or bigint, received "undefined"
× still reports truncation when the sanitizer blanks the kept text
  → Cannot read properties of undefined (reading 'payload')
```

The default-ceiling test emits a real 8 MiB chunk with nothing configured, so the load-bearing claim —
that a ceiling applies without any host configuration — is exercised rather than assumed.

---

## B5 — stale handles can tear down replacement sessions

**Cited:** `frontend-session-registry.ts:261-266, 281-284` · **Verdict: REAL.**

`detach()` did `sessions.delete(descriptor.sessionId)` unconditionally and dropped every `runBindings`
entry whose value equalled that session id; `bindRun`'s unbind closure compared by session id too. A
session id is reusable by design — a surface that reconnects (tab reload, dropped SSE stream)
re-attaches under the same id — which makes the id useless as an ownership test. A late `detach()`
from the previous attachment therefore removed the live one and its run bindings, and because
`sessions.get(sessionId)` then returned nothing, the replacement's still-current bind token became
unusable and its pending invocations unsettleable.

**Fix:** ownership by attachment identity. `runBindings` is now `Map<string, AttachedSession>`;
`detach()` only deletes `sessions` when `sessions.get(id) === session`; the unbind closure compares the
attachment object. `bindTokens.delete(bindToken)` stays unconditional — a token is minted per
attachment, so that entry can only ever be this handle's own. `resolveTarget`/`sessionFor` read the
bound attachment directly, dropping an indirection.

**Red-then-green:**

```
× ignores a stale handle's detach once its session id has been re-attached
  → expected undefined to be 'tab'
× leaves a replacement attachment's bind token usable after the stale handle detaches
  → Error: FrontendSessionRegistry: cannot bind run "run-2" to unattached session "tab"
× does not let a stale unbind release a binding owned by a re-attachment of the same session id
  → expected undefined to be 'tab'
```

The third covers the gap the existing *"does not let a stale unbind tear down a newer binding"* test
left: it only exercised a newer binding under a **different** session id, which an id-only comparison
already handled.

---

## N1 — `remote-tool-bridge.ts` ignores `toolUseId` for deduplication

**Cited:** `remote-tool-bridge.ts:53-68` · **Verdict: REAL — deliberately not fixed.**

Confirmed: `recordToolUse`/`recordToolResult` pass straight to `lifecycle.emit`, which appends
unconditionally with a fresh event id. A retried cross-process POST does append duplicate tool events.

Not fixed, because no small or obviously correct fix exists — and per this section's own instruction,
noting it is the right outcome:

1. **No durable idempotency store is reachable.** `createRemoteToolEventRecorder` holds only a
   `RunLifecycle`, which exposes no read API. Dedup would have to be an in-memory
   `Map<runId, Set<toolUseId>>`, which does not survive a restart — so a retry after a restart still
   duplicates. That is a fix that looks like a fix while leaving the hole open.
2. **It would need new lifetime machinery.** Per-run sets grow unboundedly without a
   run-completion hook this module does not have.
3. **It would split two paths this module exists to keep identical.** The in-process equivalent,
   `delegated-tool-bridge.ts`'s `execute()`, does not dedup either, and this module's whole contract is
   emitting "the same two event shapes" — its own test is named *"identical in shape to
   `DelegatedToolBridge.execute()`"*. Deduping only the remote half would make the two disagree.

The honest place for this is idempotency at the `RunLifecycle.emit` boundary (or the transport's), so
both paths get it and it is durable. That is a design change, not a patch.

---

## N2 — `run-start-handler.ts` does not forward the newly supported file inputs

**Cited:** `run-start-handler.ts:37-61, 110-120` · **Verdict: REAL.** Small and obviously correct →
fixed.

`ResolvedRunInput` carried `permissionMode`/`model`/`reasoning`/`credentialEnv` but not `imagePaths`,
`extraAllowedDirs` or `uploadRoot`, all three of which `AgentExecutorRunInput` supports. A host
adopting the default handler silently lost them — the agent simply cannot see the image it was asked
about, with nothing anywhere saying why. This is the same failure mode as the `permissionMode` gap
already documented in that file's own doc comment.

**Fix:** three optional fields added, forwarded with the same spread-only-when-present discipline
every other passthrough uses (absent must stay absent, never an explicit `undefined`).

**Red-then-green:**

```
× forwards imagePaths, extraAllowedDirs, and uploadRoot
  → expected { runId: 'run-1', …(3) } to match object { …(3) }
```

The existing *"omits every optional passthrough the resolver did not supply"* test — which asserts the
exact key set — still passes, so the additions cannot leak `undefined` keys.

---

## N3 — post-close cleanup or classification rejection prevents `finish()`

**Cited:** `agent-executor.ts:1265-1284` · **Verdict: REAL, and broader than reported.**

Confirmed at the cited lines, and the identical code shape — hence the identical bug — is duplicated in
`wireAcpLifecycle` and `wirePiRpcLifecycle`. All three close handlers ran
`await ctx.cleanupStagedFiles()` and `await classifyFailure(...)` unguarded inside
`void (async () => { … })()`. Either rejection took the whole terminal transition with it: the child
was already gone, yet the run stayed `'running'` forever — unfinishable and unresumable — and the
failure surfaced only as an unhandled promise rejection.

This was the strongest red of the set: the seven new tests did not merely assert wrong values, they
**hung until vitest's 5 s timeout** and reported unhandled rejections, which is exactly the described
stranding:

```
× child-driven: finishes the run when staged-file cleanup rejects           → Test timed out in 5000ms.
× ACP: finishes the run when staged-file cleanup rejects                    → Test timed out in 5000ms.
× pi-rpc: finishes the run when staged-file cleanup rejects                 → Test timed out in 5000ms.
× ACP: finishes the run when the classifier rejects                         → Test timed out in 5000ms.
× pi-rpc: finishes the run when the classifier rejects                      → Test timed out in 5000ms.
× finishes the run even when the onCleanupFailure sink itself throws        → Test timed out in 5000ms.
× finishes the run with resumable:false when the classifier itself rejects  → Test timed out in 5000ms.
⎯⎯ Unhandled Errors ⎯⎯  (6 × Unhandled Rejection)
```

**Fix:** two small helpers, applied in all three handlers.

- `cleanupStagedFilesSafely` — reports a cleanup rejection through `onCleanupFailure` instead of
  propagating. A leaked temp file is a real problem but strictly smaller than a permanently stranded
  run, and reporting keeps it visible.
- `classifyFailureSafely` — falls back to `resumable: false` on rejection, which is already the answer
  for every run with no classifier configured, so an unavailable classifier degrades to the documented
  default rather than losing the run.
- `reportPostCloseFailure` absorbs a throwing sink, so host diagnostic code cannot reintroduce the
  stranding these guards exist to prevent (same reasoning `run-lifecycle.ts`'s
  `handleInactivityTimeout` already applies to its own sink). Covered by its own test.

`AgentCleanupFailurePhase` gains `'staged-file-cleanup'` and `'failure-classification'`, and
`AgentCleanupFailureContext.pid` widens to `number | undefined` (a post-close phase on a child that
never got a pid is reportable rather than a contradiction). Both are exported from
`@jini-ai/daemon`; the only in-repo consumers are that package's own tests, and the workspace
typecheck is clean.

### One thing I did not fix here, stated rather than silently left

`lifecycle.finish()` itself is still awaited inside an uncaught `void (async () => …)()` in all three
handlers, so a rejecting durable `'end'` append is still an unhandled rejection. That is outside the
finding (which is about cleanup/classification *preventing* `finish()`), and `RunLifecycle` already has
defined behaviour for a failed end append — it keeps the run retryable and resolves existing waiters,
with its own test. Flagging it rather than widening scope on my own initiative.

---

## Validation — actually observed

`cd packages/daemon && pnpm test`:

```
 Test Files  26 passed (26)
      Tests  682 passed (682)
   Duration  4.92s
```

Baseline on unmodified `main`, for comparison: `26 passed (26)` / `654 passed (654)`. **+28 tests, zero
failures, zero skips, no test deleted or weakened.** Per file: `agent-executor.test.ts` 189 → 210,
`frontend-session-registry.test.ts` 41 → 44, `run-lifecycle.test.ts` 53 → 56,
`run-start-handler.test.ts` 7 → 8.

`cd packages/daemon && pnpm typecheck`:

```
> @jini-ai/daemon@0.2.1 typecheck /home/user/Jini/packages/daemon
> tsc -p tsconfig.json --noEmit
```

(no output, exit 0)

`pnpm guard` from the repo root:

```
[guard] ok — self-test passed (checks proven against known-bad fixtures) and zero violations found in
packages/. Vocabulary-firewall and residual-JS-allowlist checks are still TODO.
```

`pnpm -r typecheck` (whole workspace, since two exported types changed): clean, exit 0.

`pnpm test:coverage` in `packages/daemon`:

```
All files          |   99.85 |    99.93 |   99.64 |   99.85 |
  run-lifecycle.ts |    99.5 |     99.4 |     100 |    99.5 | 381-382
```

`agent-executor.ts`, `frontend-session-registry.ts` and `run-start-handler.ts` do not appear in the
uncovered table — every line added by this branch is covered. The single residual gap,
`run-lifecycle.ts:381-382`, is the `!record || isTerminalRunState(...)` guard in
`handleInactivityTimeout`, which that function's own doc comment already documents at length as
unreachable through the public API and deliberately not fake-tested. It is pre-existing and untouched.

### Dependent packages

`@jini-ai/deploy` 231/231 and `@jini-ai/server` 195/195 pass. `@jini-ai/http-kit` shows
**1 pre-existing failure unrelated to this work** — `createDiskAttachmentStore > rejects a file
replaced by a different file of the same size after registration`, a filesystem-timing-sensitive
same-size swap detection test. Verified pre-existing by `git stash push -u` and re-running on clean
`main`: it fails there too (`1 failed | 56 passed`).

### Environment note

`pnpm install --frozen-lockfile && pnpm -r build` was run first, as instructed. Both succeeded. No
collection failure was observed at any point, so the known vitest/exports-map quirk did not surface in
this session.

---

## Files changed

Production source, all inside `packages/daemon`:

- `src/agent-executor.ts` — B1, B2, B4, N3
- `src/run-lifecycle.ts` — B3
- `src/frontend-session-registry.ts` — B5
- `src/continuation/run-start-handler.ts` — N2

Tests:

- `src/__tests__/agent-executor.test.ts` (+21; 3 existing tests updated for B1's changed write path)
- `src/__tests__/frontend-session-registry.test.ts` (+3)
- `src/__tests__/run-lifecycle.test.ts` (+3)
- `src/continuation/__tests__/run-start-handler.test.ts` (+1)

**No file outside `packages/daemon` was modified.** No change was needed in `@jini-ai/protocol` or
`@jini-ai/agent-runtime`; the one place a dependency change is *warranted* is the `codebuddy.ts`
follow-up under B1, which is recommended and explained rather than made blind.
