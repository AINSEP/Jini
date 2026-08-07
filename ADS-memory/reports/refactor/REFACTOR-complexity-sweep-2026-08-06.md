# Handoff — repo-wide complexity refactor sweep

- **Date:** 2026-08-06
- **Branch:** `refactor/jini-admin-extraction`
- **Base commit:** `9a13c824` (`docs(reports): findings on the injectable-hook-as-prop pattern`)
- **State: NOTHING IS COMMITTED.** All work is uncommitted in the working tree.
  `git diff` against HEAD is exactly the change set to review.
- **Totals:** 42 tracked files modified, 14 new files, **+9,460 / −3,229**, ~1,400 tests added.

> ⚠️ **Do not `git stash`, `git checkout .`, or `git reset --hard`.** There is no
> commit to recover from. Consider committing to a scratch branch before reviewing.

---

## 1. How to see the change set

```bash
cd /Users/la/Programming/Jini
git diff --stat                       # everything modified
git status --porcelain | grep '^??'   # new files
git diff -- <path>                    # one file's real diff
```

**Exclude these 9 entries — they were already dirty when the session started and
are NOT part of this work:**

```
 M packages/admin/src/react/components/Sidebar.tsx
 M packages/admin/src/react/index.ts
 M packages/mcp/src/server/tools/tool-catalog-tools.ts
 M packages/vibecoding/package.json
 M pnpm-lock.yaml
?? packages/admin/src/react/__tests__/components/Sidebar.accordion.test.tsx
?? packages/admin/src/react/__tests__/hooks/use-nav-sections.test.tsx
?? packages/admin/src/react/hooks/use-nav-sections.ts
?? packages/vibecoding/src/html/node/
```

Everything else in `git status` is this sweep.

---

## 2. What was asked for

Every function ≤10 cyclomatic **and** ≤10 cognitive, with:
- behavior preserved exactly (public signatures and semantics unchanged);
- a green test baseline first, characterization tests before restructuring;
- extracted helpers **exported at module level** so they are directly testable;
- **nothing added to any package barrel / `index.ts`** — `@jini-ai/*` are published
  packages and a test seam must not become public API.

## 3. The measurement tool

```bash
pnpm complexity          # repo-wide, threshold 15 (pre-existing script)
pnpm complexity:strict <files...>   # threshold 10 — ADDED THIS SESSION
```

`complexity:strict` wraps ESLint's `complexity` rule + `eslint-plugin-sonarjs/cognitive-complexity`
(SonarSource's reference implementation), both already installed and configured in
`eslint.config.mjs`. Exit 0 = clean; exit 1 prints symbol, line, and number.

**This is the only authoritative measurement.** Do not trust any other tool. See §7.

---

## 4. Files changed, by batch — with the diff command to check each

Every batch below was verified by me against the gate, its tests, and a
full-package typecheck. `terminal.ts`, `TooltipLayer.tsx` and `useMemoryEntries.hooks.ts`
were on the original target list but were **already clean** under the real tool and
were deliberately left untouched.

### Batch 1 — claude/JSON stream parsing
```bash
git diff -- packages/agent-runtime/src/claude-stream.ts \
             packages/agent-runtime/src/agent-protocol/core/json-line-stream.ts
```
| Symbol | before | after |
|---|---|---|
| `handleObject` | 57 / 74 | 8 / 4 |
| `handleStreamEvent` | 39 / 57 | 9 / 7 |
| `classifyJsonCandidate` | 27 / 72 | 9 / 8 |
| `emitCanonicalTaskSnapshot` | 18 / 30 | 8 / 8 |

Tests **139 → 314**, 100% branch coverage on both files. ~45 new module-level exports.
Stateful stream/emission core (`emitTurnEnd`, artifact-echo suppression, message-id/epoch
bookkeeping) deliberately left as closures — documented in a module-doc paragraph.

### Batch 2 — ACP / pi-RPC protocol sessions
```bash
git diff -- packages/agent-runtime/src/agent-protocol/
```
| Symbol | before | after |
|---|---|---|
| ACP stream callback | 108 / 179 | ≤10 |
| `mapPiRpcEvent` | 54 / 75 | ≤10 |
| `attachPiRpcSession` | 22 / 48 | ≤10 |

**Largest architectural change: `acp/session.ts`, 1218 lines.** Handlers were closures over
~20 `let`s; converted to free functions over an explicit `AcpSessionState` + `AcpSessionEffects`
pair. Transport glue (`fail`, `writeRpc`, timers, stdin handles) stays as injected callbacks.
The 106 pre-existing end-to-end tests passed unchanged before and after — that is the proof
for a rewrite this size. Tests **208 → 361**, 100% branch coverage. 44 new exports.

I additionally exported `isPathUnderRoot` in `pi-rpc/session.ts` and added 3 tests myself
(sibling-prefix, outside-root, parent-dir). Implementation is **correct** — the `+ path.sep`
properly rejects `/srv/uploads-evil` against root `/srv/uploads` — but that `path.sep` is
exactly what a later edit drops, and nothing pinned it.

### Batch 3 + 10 — LLM providers (all five)
```bash
git diff -- packages/agent-runtime/src/providers/
```
| Symbol | before | after |
|---|---|---|
| `runSingleAnthropicRequest` | 49 / 87 | 6 / 8 |
| `runOpenAiCompatibleRequest` | 37 / 84 | 8 / 9 |
| `runSingleGoogleRequest` | 37 / 83 | ≤10 |
| `runSingleOllamaRequest` | 33 / 64 | ≤10 |
| `runAzureToolTurn` | 12 / 16 | ≤10 |

Pattern: per-frame **handler lookup table** replacing long `if`/`else if` chains, a pure
`…LoopExitReason` decision function, separate request-builder / stream-reducer /
tool-call-accumulator functions, thin I/O wrapper. Provider suite **573 → 654 tests**.

**Factual note carried forward:** `ollama-chat.ts` does *not* share `runOpenAiCompatibleRequest` —
it has its own NDJSON decoder. Only `azure-chat.ts` shares it. Any future shared abstraction
must not assume three SSE consumers.

### Batch 4 — Icon
```bash
git diff -- packages/ui/src/react/components/Icon.tsx packages/ui/src/icon-name.ts packages/ui/src/index.ts
```
`Icon` cyc **95 → ≤10**. 91-arm `switch` → `Record<IconName, IconRenderer>` lookup.
Safety net was a snapshot of **all 91 icons' rendered `outerHTML` taken before the rewrite** —
the pre-existing test only asserted "an svg rendered" and would have passed a mis-keyed table.
Verified 91 union members = 91 table keys = 91 snapshots.

**`packages/ui/src/index.ts` changed `export *` → `export { Icon, type IconName }`** — necessary,
because the wildcard would otherwise have swept the new `ICON_RENDERERS` test seam onto the
published surface. Public surface is unchanged. **Worth a second look at review.**

### Batch 5 — ui hooks
```bash
git diff -- packages/ui/src/features/
```
Four async callbacks over threshold (cyc 13–19 / cog to 26) → all ≤10. New pure
`useMemoryConnectors.rules.ts`. Tests **133 → 177**.

### Batch 6 — daemon ⚠️ **highest-risk diff**
```bash
git diff -- packages/daemon/src/
```
| Symbol | before | after |
|---|---|---|
| `run()` | **63 / 49** (~420 lines) | ~3 |
| `translateAgentRuntimeEvent` | 23 / 18 | ≤10 |
| `createAgentExecutor` | 15 | ≤10 |

`run()` split into 15 named phases. **+1045 / −463.** Full daemon suite **831 tests, 0 failed.**

**Read §6 before reviewing this one.**

### Batch 7 — composio schema + note store
```bash
git diff -- packages/admin/src/server/composio/json-schema.ts packages/memory/src/note-store.ts
```
`validateSchema` **61 / 106 → 8** — largest single reduction in the sweep.
`assertSchemaStructureSupported` 42 / 39 → 5. +107 tests.

Error **ordering** was deliberately preserved: grouping the checks "by keyword family"
instead of strict source order would silently change *which* error wins for a schema
violating several keywords at once, and every single-violation test would still pass.
Error text is contract — it surfaces in a `ConnectorServiceError` HTTP 400 body and a
persisted `unsupportedReason` field.

### Batch 8 — attachments + a2ui
```bash
git diff -- packages/http-kit/src/attachments.ts packages/agentic/src/a2ui/interpreter.ts
```
`detectAttachmentKind` cyc 15 → trivial; `claim` 12 / 13 → ~3. Tests 59 → 74 and 51 → 59.

**Security-relevant:** `reserveAttachmentRecords` was kept **fully synchronous** on purpose.
The "no `await` between reservation check and write" invariant is the TOCTOU guard on the
claim path. Do not make it async.

### Batch 9 — annotation canvas
```bash
git diff -- packages/renderers-react/
```
`useAnnotationCanvas` cyc 22 → ≤10; `send` 29 / 19 → ≤10. New `useAnnotationCanvas.controller.ts`
(14 exports, 46 direct tests). 131 tests total.

Diff touches **only** the import block, `send()`, and the trailing derived-value cluster.
Pointer/drag handlers, all dependency arrays, and all three `exhaustive-deps` disable comments
are untouched — verified by diff grep.

Found a latent bug: `canSubmitValue` and `send()`'s `shouldCapture`/`canSubmitNow` were the
**same boolean chain written twice**, free to drift. Now one `deriveSendGate`.

---

## 5. Verification commands

```bash
# complexity gate — should exit 0 for every file above
pnpm complexity:strict <paths...>

# per-package tests (root-level `npx vitest` lacks jsdom and fails DOM tests misleadingly)
npm --prefix packages/agent-runtime  run test
npm --prefix packages/daemon         run test    # 831 tests
npm --prefix packages/ui             run test
npm --prefix packages/admin          run test
npm --prefix packages/memory         run test
npm --prefix packages/http-kit       run test    # see §8 — model-proxy is pre-existing red
npm --prefix packages/agentic        run test    # 808 tests
npm --prefix packages/renderers-react run test

npm --prefix packages/<pkg> run typecheck
```

---

## 6. Highest-risk thing to review: async/microtask timing

The daemon agent introduced **two real bugs** this way and caught both:

> Wrapping previously-**synchronous** code in an extracted `async function` and awaiting it
> defers the continuation by a microtask tick **even when the body never awaits anything**.

1. `run-lifecycle.ts` `start()` — delayed `runs.set(runId, record)` by a tick, breaking a
   caller that synchronously calls `finish()` right after `start()`.
2. `agent-executor.ts` `run()` — wrapping `spawn()` in an async function meant `'error'`
   listeners weren't registered until after a queued microtask fired, and **Node's
   `EventEmitter` throws synchronously on `'error'` with zero listeners.**

Fix for (2): `spawnAgentChildProcess` is now **genuinely synchronous**, returning a
discriminated `{kind:'ok'|'error'}` instead of throwing. **Do not re-wrap it in `async`.**

**This class was not systematically audited across the other batches.** An Opus 5 audit was
prepared and deliberately deferred to next session — see §9 for the brief.

---

## 7. Process lesson worth not repeating

I wrote a throwaway complexity script before noticing the repo already had
`eslint-plugin-sonarjs` installed and wired. I deleted it; peer agents then recreated
competing versions from memory. **Four of nine agents independently reimplemented it**, the
reimplementations disagreed with each other and with SonarJS, and **two agents reported "done"
on files that still had live violations** (one had a symbol at cyc 13 in a file its own tool
called clean). Adding the committed `pnpm complexity:strict` script fixed it.

Also: the original 20-symbol target list came from a tool that rolls nested functions into the
enclosing symbol. Three of its targets were already clean under SonarJS; several real
offenders were missing from it entirely.

---

## 8. Known pre-existing failures — NOT caused by this work

- **`packages/http-kit/src/__tests__/model-proxy.test.ts`: 40 failures.** `dist/` was built
  Aug 5 12:54; the last `agent-runtime/src` commit landed 12:56. Cross-package imports
  resolve through `dist/`, so **no `src/` edit this session can reach that test's module
  graph.** Both `model-proxy.ts` and its test are unmodified.
- **`pnpm guard`: 7 `R2-deep-path` violations** in `packages/chat/src/react/features/chat-pane/**`
  (deep `@jini-ai/chat/core` imports). Present at HEAD; `packages/chat` untouched by this work.

**No green baseline was recorded before starting** (`AGENTS.md`'s cloud-dispatch rule 1).
That is my miss and it is why "pre-existing red" had to be established retroactively per case.
**Do this first next session:** `pnpm install && pnpm -r build`, then record a full baseline.

---

## 9. Open items for next session

1. **Run the deferred Opus 5 audit.** Brief is in this session's transcript; it targets
   behavior-changes-disguised-as-refactors (esp. the §6 async class across *all* batches),
   test *quality* vs count on the ~1,400 new tests, barrel leakage across ~200 new exports,
   and suppressions/`as` casts. Riskiest diffs: `agent-executor.ts`, `acp/session.ts`,
   `useAnnotationCanvas.ts`, `attachments.ts`.
2. **Decide on `providers/turn-loop-kit.ts`** — a shared loop-exit/frame-dispatch abstraction
   across the five providers. Explicitly *not* built, because it needs sign-off. Remember
   Ollama is NDJSON, not SSE.
3. **Decide whether to lower `eslint.config.mjs` to 10** and make `pnpm complexity` a hard
   CI gate so this doesn't regress. Currently 15, warn-only.
4. **~12 thin orchestration wrappers in `agent-executor.ts` were exported but not
   unit-tested** — deliberately, since the 246 existing characterization tests already prove
   their sequencing and an isolated "does this call that" test would restate the wrapper's
   body. Accepted, but flagged for your judgment.
5. **Pre-existing doc drift:** the `failWithPayload` comment in `acp/session.ts` says "both
   call sites"; there are three. Not fixed — intent unverifiable.
6. **Stale index:** `codebase-memory-mcp` holds 41,650 nodes / 87,792 edges but `AGENTS.md`
   advertises 61.9K / 153K, and it is indexed at `9a13c824` so it cannot see any of this work.
   Re-index before relying on it.
