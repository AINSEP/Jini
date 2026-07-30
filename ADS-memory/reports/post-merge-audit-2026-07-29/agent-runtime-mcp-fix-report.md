# post-merge audit — `agent-runtime` + `mcp`: verification and fix report

**Branch:** `fix/post-merge-audit-agent-runtime-mcp-2026-07-30`
**Date:** 2026-07-30
**Scope:** every finding in `agent-runtime-findings.md` and `mcp-findings.md`.

**Verdict: 6 of 6 findings are REAL. Zero false positives.** Each was independently confirmed by
reading the cited source, then reproduced by a test that was observed failing against the unfixed
code before any fix was written.

Environment note: a fresh checkout needs `pnpm install --frozen-lockfile && pnpm -r build` before
any package's vitest can even collect (configs resolve workspace packages through their
`package.json` exports map, not source). That was done first; it is a pre-existing environment
quirk, unrelated to anything here.

---

## Summary table

| # | Finding | Verdict | Fix location |
|---|---|---|---|
| AR-1 | `permissionMode: 'restricted'` ignored by 5 adapters | **REAL** | `defs/{aider,amp,copilot,cursor-agent,devin}.ts` |
| AR-2 | Antigravity settings-write failure wedges the model mutex | **REAL** | `packages/daemon/src/agent-executor.ts` (see note) |
| AR-3 | Abort-listener accumulation in `waitForAgyToReadModel` | **REAL** | `defs/antigravity.ts` |
| AR-4 | `turn_end` dedup impossible when `currentMessageId` is null | **REAL** | `claude-stream.ts` |
| MCP-1 | Schema-validator exceptions escape `handleToolCall` | **REAL** | `server/tool-protocol.ts` |
| MCP-2 | `limit` declared as any number despite a documented 1–25 integer range | **REAL** | `server/tools/tool-catalog-tools.ts` |
| MCP-3 | Catalog tool defs not re-exported from the barrels | **REAL** | `server/index.ts`, `src/index.ts` |

---

## AR-1 (BLOCKING) — `permissionMode: 'restricted'` ignored by five adapters

**REAL.** `types.ts:28-42` documents that passing `'restricted'` makes a def "omit its bypass flag".
Six defs implement that (`claude`, `codebuddy`, `qwen`, `qoder`, `opencode`, `trae-cli`). These five
never read `options.permissionMode` at all, so a host asking for a restricted run still got full
auto-approval:

| def | flag emitted regardless of mode | line (pre-fix) |
|---|---|---|
| `aider` | `--yes-always` | `aider.ts:47` |
| `amp` | `--dangerously-allow-all` | `amp.ts:50` |
| `copilot` | `--allow-all-tools` | `copilot.ts:64` |
| `cursor-agent` | `--force`, plus `--trust` when probed | `cursor-agent.ts:84,90` |
| `devin` | `--permission-mode dangerous --respect-workspace-trust false` | `devin.ts:38-44` |

`grep -rn "permissionMode" packages/agent-runtime/src/defs` returned zero hits in all five files —
the flags are unconditional, exactly as reported.

**Fix approach — omit, not reject.** The findings file suggests adapters "should reject the request
rather than silently bypass it". I implemented **omission** instead, because that is what this
repo's own contract already specifies (`types.ts:36-40`: "the def then omits its bypass flag, which
typically means the underlying CLI denies/blocks actions that would otherwise need approval rather
than prompting — still non-interactive-safe, just conservative instead of permissive") and what all
six already-correct defs do. Rejecting would make these five behave differently from the other six
for the same documented option. Both approaches close the security gap; omission is the smaller,
consistent one.

Per-adapter notes:
- **`cursor-agent`**: gated *both* `--force` and `--trust` on restricted mode. `--trust` pre-grants
  the workspace trust the permission prompt would otherwise ask for, so leaving it in would hand
  the run most of what it asked to withhold. The `caps.trust` probe gate is unchanged and still
  applies on the bypass path.
- **`devin`**: restricted drops both overrides and passes bare `['acp']`, so the CLI falls back to
  its own default permission mode and to respecting workspace trust. Deliberately *not* substituting
  some other `--permission-mode` value — I could not verify a safe mode string against a real
  `devin` build, and the CLI default is the conservative side of both flags by construction.
- **`aider`**: without `--yes-always` aider prompts for confirmation; on the daemon's non-TTY stdin
  that fails the action closed rather than performing it. Fail-closed is the requested behavior.

**Red-then-green evidence.** 8 new tests; the 8 covering restricted mode were run against unfixed
code first:

```
FAIL  aider.test.ts > omits --yes-always entirely when permissionMode is "restricted"
FAIL  aider.test.ts > still adds --model and --message after omitting --yes-always in restricted mode
FAIL  amp.test.ts > omits --dangerously-allow-all entirely when permissionMode is "restricted"
FAIL  amp.test.ts > still maps a recognized mode onto --mode after omitting the bypass flag in restricted mode
FAIL  copilot.test.ts > omits --allow-all-tools entirely when permissionMode is "restricted"
FAIL  copilot.test.ts > still adds --model and --add-dir after omitting --allow-all-tools in restricted mode
FAIL  cursor-agent.test.ts > omits --force entirely when permissionMode is "restricted"
FAIL  cursor-agent.test.ts > omits --trust in restricted mode even when the capability probe recorded it
FAIL  cursor-agent.test.ts > still adds --workspace and --model after omitting the bypass flags in restricted mode
FAIL  devin.test.ts > omits --permission-mode dangerous and --respect-workspace-trust false when permissionMode is "restricted"
```

Each file also gained a `permissionMode: 'bypass'` test that was **green from the start** — those
pin the unchanged default so the fix cannot silently disarm the normal path.

---

## AR-2 (BLOCKING) — an Antigravity settings-write failure wedges the model mutex

**REAL, and the fix does have to be in `packages/daemon`** — confirmed before editing outside
`agent-runtime`, as the findings file asked.

The chain:
1. `agent-executor.ts:1874` — `await def.runtimeLock?.acquire(...)` takes the hold.
2. `agent-executor.ts:1888` — `const args = def.buildArgs(...)`, **not** inside any try/catch.
3. `antigravity.ts:338-342` — `buildArgs` calls `writeAntigravityModelSelection`, which does
   `mkdirSync` + `writeFileSync` (`antigravity.ts:66-67`). Both throw on a read-only home, a
   permissions failure, or a full disk.

`releaseStagedResources()` sits below the throw and is skipped; no child process exists yet, so the
exit-driven release at `wireChildLifecycle` can never fire either. The hold leaks for the daemon's
lifetime and every later concrete-model Antigravity run blocks forever on `acquire`.

**Fix (minimal, `packages/daemon/src/agent-executor.ts` only).** Wrapped the `def.buildArgs(...)`
call in a try/catch that calls `await releaseStagedResources()` and returns
`failBeforeSpawn(runId, 'AGENT_SPAWN_FAILED', ...)`. This is the identical shape the adjacent
`writeMcpJsonForRun` guard already uses. No change to `agent-runtime`: making
`writeAntigravityModelSelection` swallow its own errors would be worse — agy would then run on the
wrong model silently.

**Red evidence** (2 new tests in `daemon/src/__tests__/agent-executor.test.ts`, in the existing
`AgentExecutor — runtimeLock` describe):

```
FAIL > releases the lock when buildArgs itself throws — the settings.json write it guards can fail
  AssertionError: expected Error: EACCES: permission denied, mkdir '/root/.gemini'
    to match object { code: 'AGENT_SPAWN_FAILED', message: StringContaining "EACCES" }
FAIL > leaves the real antigravity lock acquirable by a later run after a buildArgs failure
  AssertionError: expected Error: EROFS: read-only file system to match object { code: 'AGENT_SPAWN_FAILED' }
```

The second test is the consequence test and uses the **real** `antigravityModelLock`, not a fake: it
fails run A via a throwing `buildArgs`, then asserts run B's `acquire` actually resolves. Without the
fix run B hangs forever, which is the real production symptom.

---

## AR-3 (non-blocking) — abort-listener accumulation. Fixed.

**REAL.** `antigravity.ts:165-172`: each poll iteration installs
`abortSignal.addEventListener('abort', onAbort, { once: true })` alongside its sleep timer.
`{ once: true }` only detaches on the abort path; when the timer wins — the common case, once per
poll — the listener stays attached to a signal that outlives the iteration. Defaults
(15 000 ms / 250 ms) retain ~60 listeners.

Small and obviously correct, so fixed: the timer callback now calls
`abortSignal?.removeEventListener('abort', onAbort)` before resolving.

**Red evidence:** a new test wraps the signal's `addEventListener`/`removeEventListener` to count
`abort` registrations across an 80 ms/5 ms run and asserts `removed === added` (with
`added > 3` so the assertion is not vacuous).

```
FAIL  antigravity.test.ts > does not accumulate one abort listener per poll interval when the timer keeps winning
```

---

## AR-4 (non-blocking) — `turn_end` dedup impossible when `currentMessageId` is null. Fixed.

**REAL.** `claude-stream.ts:123-127`: `const signature = currentMessageId === null ? null : ...`,
then `if (signature !== null && turnEndSignature === signature) return;`. When no frame supplied a
message id the key is null and the guard is unreachable. Reproduced: an `assistant` wrapper with no
`message.id` and `stop_reason: 'end_turn'` (line 490 leaves `currentMessageId` null), followed by a
top-level `result` with the same reason (line 689), emits two identical `turn_end` events.

**Fix.** Added an `anonymousMessageEpoch` counter that stands in for the id in the dedup key
(`anon<n>`, prefixed so it cannot collide with a real id). It is incremented at the two frames
that genuinely begin a new assistant message — `message_start`, and an id-less `assistant` wrapper —
and deliberately **not** at `message_delta`/`result`, which report on the message already in flight.

**Why the epoch and not just a constant sentinel.** A constant would dedup two *consecutive* id-less
turns sharing a stop reason, suppressing a legitimate second `tool_use` turn_end — which would strand
the daemon's stdin-close handler waiting on a boundary that never arrives. That failure mode is
strictly worse than the duplicate being fixed, so the fix is designed to be incapable of it, and a
second test pins that.

**Honest limitation.** One narrow shape is still not deduped: a build that emits a non-null
`stop_reason` on *both* a `message_delta` and an id-less `assistant` wrapper for the same message
would still double-emit, because the wrapper advances the epoch. That is exactly today's behavior —
no regression, just not fixed — and it is inconsistent with the documented wire shapes
(`claude-stream.ts:104-108` says the newer partial-stream build carries `stop_reason: null` on the
wrapper). I did not force it green, because closing it requires the constant sentinel whose
suppression risk is worse than the bug.

**Red evidence:**

```
FAIL  claude-stream.test.ts > deduplicates turn_end across an id-less assistant wrapper and a same-reason result frame
```

The paired guard test ("still emits a turn_end per id-less assistant wrapper when two consecutive
turns share a stop reason") was **green before and after** — it exists to catch over-deduping, not
to be fixed.

---

## MCP-1 (BLOCKING) — schema-validator exceptions escape `handleToolCall`

**REAL, and reproduced byte-for-byte against the reported error string.** `tool-protocol.ts:160`
runs `validatorForTool(tool)(args)` before the `try` at line 164. `@cfworker/json-schema` throws
rather than returning `{valid:false}` for JS values JSON cannot encode:

```
Error: Instances of "undefined" type are not supported.
 ❯ validate @cfworker/json-schema/dist/esm/validate.js:43:19
 ❯ Module.handleToolCall src/server/tool-protocol.ts:160:43
```

This contradicts the function's own documented guarantee (`tool-protocol.ts:137-148`) that a schema
violation produces `{isError:true}` and never a rejection. Reachable, not theoretical:
`handleToolCall` is exported from the root barrel and typed `Record<string, unknown>`, so a host
calling it directly — or via an injected `McpServerLike` — can pass an explicitly-`undefined`
optional property.

**Fix.** Moved validator creation + execution inside their own try/catch, separate from the
handler's, translating a throw into `invalid arguments for <name>: <message>` through the existing
`sanitizeUntrustedText` path. Keeping the two boundaries distinct preserves the existing message
shapes for validation failures vs handler failures. Compiling a validator from a malformed
`inputSchema` is covered by the same boundary.

**Red evidence** (2 new tests):

```
FAIL  tool-protocol.test.ts > returns an isError result rather than throwing when the schema validator itself throws
FAIL  tool-protocol.test.ts > does not run the handler when the schema validator throws
```

The second is the security-relevant half: it pins that a validator throw does not fall through to
the handler with unvalidated arguments.

---

## MCP-2 (non-blocking) — `limit` accepts any number. Fixed.

**REAL.** `tool-catalog-tools.ts:41` declared `limit: { type: 'number', description: '... (1-25) ...' }`.
Verified the disagreement against the route it proxies — `packages/http-kit/src/tool-catalog.ts`'s
`parseSearchInput` (lines 59-66, `MAX_SEARCH_LIMIT = 25`): it rejects non-integers and `< 1`
outright and clamps anything above 25. So `0`, `-1`, `1.5` passed MCP validation and were then
refused daemon-side, and `26` passed and was silently clamped.

Small and obviously correct, so fixed: `type: 'integer', minimum: 1, maximum: 25`.

**Red evidence** — the 4 reported values were confirmed accepted before the fix:

```
FAIL > describes limit as an integer in the range the route actually accepts
FAIL > rejects out-of-range limit 0 instead of forwarding it to the daemon
FAIL > rejects out-of-range limit -1 instead of forwarding it to the daemon
FAIL > rejects out-of-range limit 1.5 instead of forwarding it to the daemon
FAIL > rejects out-of-range limit 26 instead of forwarding it to the daemon
```

The in-range cases (`1`, `10`, `25`) were green before and after — they pin that the tightened
schema did not over-restrict.

---

## MCP-3 (non-blocking) — catalog tool defs not re-exported. Fixed.

**REAL.** `server/index.ts` re-exported `tools/run-tools.js` and `tools/delegated-tool.js` but not
`tools/tool-catalog-tools.js`, and the root `src/index.ts` likewise omitted them. Since
`package.json` exports only `"."` and `"./bin"`, a consumer building its own `createMcpToolServer`
had no way to reach `searchToolsTool`, `describeToolTool`, or `TOOL_CATALOG_TOOLS` — while
`bin/serve.ts:125` registers all three, so the catalog half of the tool surface was private by
accident rather than by decision.

Fixed: added the sub-barrel `export *` and an explicit named re-export in the root barrel (the root
barrel's convention is explicit names, per its own header comment).

**Red evidence** (2 new tests):

```
FAIL  index.test.ts > re-exports the tool-catalog discovery defs as the same objects the server module defines
FAIL  index.test.ts > exposes the catalog tools as usable McpToolDefs under their wire names
```

The first identity-compares (`toBe`) against the source module rather than using the surrounding
file's `toBeDefined()` presence style, so a re-export that shadowed the real def with a copy would
still fail.

---

## Validation actually observed

All commands run from the stated directory after `pnpm install --frozen-lockfile && pnpm -r build`.

```
packages/agent-runtime$ pnpm test
 Test Files  98 passed (98)
      Tests  1865 passed | 1 skipped (1866)

packages/agent-runtime$ pnpm typecheck
> tsc -p tsconfig.json --noEmit          # clean, no output

packages/mcp$ pnpm test
 Test Files  20 passed (20)
      Tests  369 passed (369)

packages/mcp$ pnpm typecheck
> tsc -p tsconfig.json --noEmit          # clean, no output

packages/daemon$ pnpm test               # touched for AR-2
 Test Files  26 passed (26)
      Tests  656 passed (656)

packages/daemon$ pnpm typecheck
> tsc -p tsconfig.json --noEmit          # clean, no output

(repo root)$ pnpm guard
[guard] ok — self-test passed (checks proven against known-bad fixtures) and zero violations
found in packages/. Vocabulary-firewall and residual-JS-allowlist checks are still TODO.
```

Zero regressions in all three suites. Baselines were measured directly by `git stash`-ing the whole
change set and re-running each suite on the clean checkout, rather than inferred:

| package | before | after | delta |
|---|---|---|---|
| `agent-runtime` | 1847 passed, 1 skipped | 1865 passed, 1 skipped | +18 |
| `mcp` | 357 passed | 369 passed | +12 |
| `daemon` | 654 passed | 656 passed | +2 |

All three baselines were fully green, so every post-fix pass is a real pass and not a
pre-existing failure being carried along. Test counts moved up only. No test was deleted, weakened,
skipped, or replaced with a `toBeDefined()` placeholder; no `exclude` list, coverage threshold, or
ignore comment was touched.

## Scope note

`packages/daemon/src/agent-executor.ts` is the only file changed outside `agent-runtime`/`mcp`. It is
a single try/catch around one existing call, required by AR-2 and pre-authorized by the findings
file. Nothing else in `daemon` was touched.
