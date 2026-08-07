# Todo

Lightweight cross-cutting backlog — not the formal ledger (that's
`ADS-memory/reports/jini-port/extraction-plan.md` §8 for engine port tasks, and
`ADS-memory/reports/jini-port/refactor-roadmap.md` for status). This file is for things
worth remembering that don't fit neatly into either, including items that
live in Open Design's own repo rather than Jini's.

## In flight

- **`features/html-viewer/` extraction** — dispatched 2026-07-18, fires
  09:20 UTC (2:20 AM PDT), branch `feature/jini-ui-html-viewer`. See details
  below; this entry stays until the branch is verified (not just
  self-reported) as actually done. Also folds in the audit-report lessons
  from PR #5228 and tonight's `port/source-config-list-resource-dashboard`
  failure (false i18n claims, unfulfilled port contracts, silently swallowed
  errors, per-file-vs-full-package coverage confusion, undetected duplicate
  primitives) as explicit things not to repeat.

## Unaudited / untested — complexity sweep, 2026-08-06

Everything below is a **known gap in verification**, not a known-good area. Source:
the two Opus 5 audits of the uncommitted complexity sweep on
`refactor/jini-admin-extraction` (handoff:
`ADS-memory/reports/refactor/REFACTOR-complexity-sweep-2026-08-06.md`). Listed so
that "the audit passed" is never read as "all of this was checked."

**No test covers any of these defects. All ~9,900 package tests pass with them present** —
the ~1,400 tests the sweep added pin the *intended* mapping, not the fallback the
deleted `default:` arms used to provide.

- **Regression tests for the `Object.prototype` lookup-table class (5 sites).**
  `if`-chain → `const TABLE = {…}`; `TABLE[runtimeString]` now resolves inherited
  members where the original `===` + `default` was immune. Sites:
  `agent-runtime/src/claude-stream.ts:124,139` (`TASK_STATUS_ALIASES`),
  `agent-runtime/src/agent-protocol/pi-rpc/events.ts:209,239` (`PI_RPC_EVENT_HANDLERS`),
  `daemon/src/agent-executor.ts:490,530` (`EVENT_TYPE_TRANSLATORS`),
  `ui/src/react/components/Icon.tsx:27,683` (`ICON_RENDERERS`),
  `providers/anthropic-messages.ts:476,593` (`ANTHROPIC_FRAME_HANDLERS`).
  Fix is one line each (`Object.create(null)` or an `Object.hasOwn` guard), but the
  tests must feed hostile discriminants (`__proto__`, `constructor`, `toString`,
  `valueOf`, `hasOwnProperty`) — that input shape is what nothing currently exercises.
  `LITERAL_STARTS` in `json-line-stream.ts:285` was checked and is safe (single-char keys).
- **`maxToolTurns: 0` with no `executeTool`, across all five providers.** The
  extracted `*LoopExitReason()` functions check `maxToolTurns` before the surviving
  `!executeTool` guard; the originals did the reverse. `end` reason flips
  `'stop'` → `'max_tool_turns'`. Uncovered.
- **Empty-string `runId` on the idempotency replay path.** `run-lifecycle.ts:612`
  changed `if (existingRunId)` → `if (existingRunId !== undefined)`. Pathological, but
  uncovered.
- **Published-surface check for `@jini-ai/ui`.** The Icon barrel change was verified by
  *reading* `src/index.ts`, not by packing a tarball. The `ICON_RENDERERS` containment
  claim has no packed-artifact proof. Related and larger: `examples/minimal-host/`'s
  packed-tarball proof is a standing red spec, so there is no mechanism here yet.
- **Test *quality* of the ~1,400 added tests was never assessed.** The pass was scoped
  out mid-session. Nobody has diffed the modified test files for **pre-existing
  assertions weakened or deleted** inside the large additive diffs — the single
  cheapest way for this sweep to have lost coverage invisibly.
- **Barrel/export leakage — two confirmed leaks, rest unreviewed.**
  **`agent-runtime/src/providers/` leaks 76 symbols** onto the published surface:
  `src/index.ts` does `export *` from `providers/index.js`, so every new test seam in
  the provider batch is now public API. This is the big one. A second confirmed leak is
  in `agentic/src/a2ui/` (also a wildcard). Confirmed *clean*: `packages/ui/src/index.ts`
  (the old wildcard exported exactly `Icon` + `type IconName`; the explicit list is
  identical — nothing dropped), and all 103 new exports in `claude-stream` /
  `json-line-stream` / `acp` / `pi-rpc`, which reach no public entry point because every
  hop in that barrel chain is an explicit named list. Other packages unreviewed.
- **`acp/session.ts` has had no real-subprocess smoke run.** The 1218-line closure→
  `AcpSessionState` conversion was verified by line-by-line semantic reconstruction plus
  the 106 unchanged e2e tests — but never against a live ACP or pi agent. A rewrite that
  size deserves one before merge.
- **Flaky test, not caused by this work:** `agent-runtime/src/defs/__tests__/antigravity.test.ts`
  "does not accumulate one abort listener per poll interval" fails under full-suite load
  and passes 39/39 in isolation. `src/defs/` is unmodified. Timer-sensitive; worth fixing
  separately so it stops muddying baselines.
- **~12 thin orchestration wrappers in `agent-executor.ts` are exported but not
  unit-tested** — deliberate (the 246 characterization tests prove their sequencing),
  but never ratified.
- **`daemon/src/agent-executor.ts:1553`** — `child.stdout.on('data')` has no
  `try/catch`. Not reachable today (all four parsers emit literal `type`), but any
  future parser that forwards a raw `type` turns a malformed subprocess line into an
  uncaught exception that takes the daemon down. Worth a guard regardless of the
  lookup-table fix.
- **No green baseline existed before the sweep started** (`AGENTS.md` cloud-dispatch
  rule 1). One was reconstructed retroactively during the audit — daemon 831,
  agent-runtime 2524, ui 5236, renderers-react 496, agentic 808, memory 231, admin 407,
  http-kit 1275 pass / 40 known-pre-existing fail (`model-proxy.test.ts`, stale `dist/`).
  Also standing: 7 `R2-deep-path` `pnpm guard` violations in `packages/chat/**`, present
  at HEAD.

Open decisions carried from the handoff's §9, still unmade:

- **`providers/turn-loop-kit.ts`** — a shared loop-exit/frame-dispatch abstraction across
  the five providers. Deliberately not built. Note `ollama-chat.ts` is NDJSON with its own
  decoder, not SSE — only `azure-chat.ts` shares `runOpenAiCompatibleRequest`, so any
  shared abstraction must not assume three SSE consumers.
- **Lower `eslint.config.mjs` complexity to 10 and make `pnpm complexity` a hard CI gate.**
  Currently 15 and warn-only, so the sweep's gains can silently regress.
- **Doc drift:** the `failWithPayload` comment in `acp/session.ts` says "both call sites";
  there are three. Intent unverifiable, left alone.
- **Stale index:** `codebase-memory-mcp` holds 41,650 nodes / 87,792 edges against
  `AGENTS.md`'s advertised 61.9K / 153K, and is indexed at `9a13c824` — it cannot see any
  of this work. Re-index before relying on it.

## Priority

- **Extract a `features/html-viewer/` slice from `HtmlViewer` +
  `FileVersionManagerModal` into `@jini/ui`** (source:
  `apps/web/src/components/FileViewer.tsx` in the real Open Design fork/
  upstream). Same "read everything in full, find the real generic core,
  host-inject the rest" discipline already used for `viewer-shell`/
  `connectors`/`browser-chrome` — NOT a verdict that this is un-portable.
  A first pass (2026-07-18) sampled ~200 lines + a full state/handler grep
  and found real generic material worth a proper full-file read, not a
  reason to skip it:
  - `HtmlViewer` (~7,110 lines) — sandboxed HTML/iframe rendering + a
    postMessage bridge (possible overlap with `@jini/renderers-react`'s
    srcDoc sandbox core, check before duplicating), deck/slide navigation
    with zoom/fullscreen present, a full inline visual/DOM editor (click an
    element, edit live, undo/redo), and comment-pinning to rendered elements
    (related to `viewer-shell`'s already-shipped `CommentSidePanel`/
    `CommentSideDock`).
  - `FileVersionManagerModal` (~1,050 lines) — version history list +
    cached preview + restore; the list/preview/restore shape is plausibly
    generic even if the specific version-source data isn't.
  - Genuinely OD-specific, to be dropped or turned into host-injected ports
    (not ported): Cloudflare-specific deploy config, PPTX/template export,
    the board/pod live-collaboration system, brand extraction, and OD's own
    analytics event taxonomy.
  - Needs a real full read (both files, in full) before scoping the actual
    slice boundary — do not assume the split above is final.
  - **Also pick up `CodeWithLines`/`JsonPanel`** (two smaller, separate flat
    atoms also in `FileViewer.tsx`) in this same session — pulled out of a
    2026-07-18 flat-atoms dispatch specifically so they land here instead,
    since this session reads the whole file anyway.
  - **Learn from PR #5228 first** (the `MemorySection.tsx` decomposition
    attempt, closed 2026-07-15 without merging after an exhausting review
    cycle that surfaced real, pre-existing async/state-correctness bugs —
    see `packages/ui/source-map.md`'s memory-feature entry for the full
    writeup). Build the malformed-response / race-condition / missing-error-
    handling / stale-state-on-retry test gate *before* starting this
    extraction, not after discovering the bugs the hard way. Related,
    still-pending task: making that same test-category checklist a standing
    requirement in `ADS-memory/reports/jini-port/skills/fixing-open-design.md`/`-web.md`
    for future ports (tracked separately in this session's task list, not
    yet done).
