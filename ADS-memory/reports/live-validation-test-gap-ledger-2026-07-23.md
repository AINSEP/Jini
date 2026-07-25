# Live-validation test-gap ledger — 2026-07-23

## Purpose

This ledger records cases where Jini's automated tests passed while the real
user journey still failed. These are not ordinary defect notes. Each entry
identifies the false-confidence boundary so later test work can add the missing
layer instead of only adding another isolated unit test.

Standing rule: when package tests pass but a browser, desktop shell, daemon, or
real installed CLI disproves the behavior, record:

1. what passed;
2. what failed in practice;
3. why the existing test could not detect it;
4. the smallest regression test added now; and
5. the broader test layer still needed.

## GAP-001 — Agent discovery existed, but outside the daemon boundary

- Status: fixed in code; comprehensive host test still required
- Surface: `examples/reference-web`, `@jini/http`, `@jini/node-host`
- User-visible failure: the agent picker looked populated, but the Vite
  development server called `detectAgents()` itself. The browser host was not
  proving that the daemon knew which CLIs were installed.
- What passed: package-level agent registry/detection tests, HTTP route tests,
  and the reference-web build.
- Why those tests missed it: they verified the detector, the route, and the
  frontend independently. No test asserted that the visible picker payload
  crossed the production composition boundary
  `browser -> /api/agents -> node-host daemon -> agent-runtime detector`.
- Immediate regression coverage:
  - node-host socket test for live `/api/agents`;
  - async route and `/api/agents/rescan` tests;
  - client-safe projection tests that ensure executable paths/argv builders do
    not leak to the renderer.
- Comprehensive test still needed: boot the reference host with no Vite-local
  discovery plugin, stub/inject daemon detection at the node-host boundary, and
  assert in a browser that only the daemon-reported available agents and models
  appear.

## GAP-002 — Claude answered, but the run never completed

- Status: fixed and re-verified against the installed CLI
- Surface: `@jini/agent-runtime` Claude stream parser and `@jini/daemon`
  `AgentExecutor`
- User-visible failure: Claude Code 2.1.201 produced
  `JINI_WIRING_OK`, usage, and a final result in about two seconds, while the
  daemon run remained `running` and the Claude subprocess stayed alive.
- What passed: 91 Claude parser tests, 509 daemon tests, typechecks, and builds.
- Why those tests missed it:
  - the “representative” Claude trace was hand-built from documented/golden
    shapes rather than captured current CLI input;
  - it asserted emitted parser events, not subprocess exit plus terminal run
    state;
  - it assumed a terminal stop reason would be present on the assistant wrapper;
  - the first correction covered partial `message_delta`, but a live Haiku run
    demonstrated a second valid shape where only the top-level `result` frame
    carried `stop_reason: "end_turn"`.
- Immediate regression coverage:
  - parser tests for assistant-null plus partial-message terminal reason;
  - deduplication when wrapper and partial frames both carry the reason;
  - parser tests for result-only terminal fallback;
  - deduplication when both partial and result frames carry the reason.
- Live re-verification: run
  `5f6ba045-27eb-44fb-9182-e4ff3f11ad44` used Claude Code 2.1.201 with
  `claude-haiku-4-5-20251001`. It returned `JINI_WIRING_OK`, emitted usage,
  exited with code 0, produced the daemon SSE `end` event, and persisted
  `state: "succeeded"`. No matching stream-json Claude process remained.
- Comprehensive test still needed: a recorded current-Claude JSONL corpus test
  plus an executor integration test that asserts all four outcomes together:
  answer text received, stdin closed, child process reaped, and run state
  terminal.

## GAP-003 — Desktop adapter existed, but the window could not be dragged

- Status: fixed in reference shell; native interaction automation still required
- Surface: `examples/reference-desktop`, `examples/reference-web`
- User-visible failure: the Electron window used inset/hidden title-bar chrome,
  but the renderer provided no `-webkit-app-region: drag` element. The app
  opened successfully and still could not be moved.
- What passed: desktop-host adapter tests and desktop/reference-web builds.
- Why those tests missed it: adapter tests prove window creation and bridge
  behavior; they do not prove renderer CSS provides a native draggable region.
- Immediate regression coverage: the desktop renderer now has a dedicated
  top strip whose computed `-webkit-app-region` is `drag`, while the Chrome
  rendering omits that strip.
- Comprehensive test still needed: a packaged/native Electron smoke test with
  an automated or explicitly recorded manual assertion that dragging the strip
  changes window bounds.

## GAP-004 — A composed package test can consume stale dependency output

- Status: recorded; workspace test/build policy needs a follow-up decision
- Surface: `@jini/daemon` tests importing built `@jini/agent-runtime`
- Observed failure: the new executor regression still failed immediately after
  the agent-runtime source test passed. The daemon test resolved the existing
  built package output, which did not yet contain the parser correction.
  Building `@jini/agent-runtime` and rerunning made all 510 daemon tests pass.
- Why this matters: a developer can edit a workspace dependency and run a
  consumer package's tests while unknowingly exercising stale code. Depending
  on change order, this can create false failures or false passes.
- Comprehensive test still needed: make composed test commands either resolve
  workspace source intentionally or build/topologically refresh dependency
  outputs before consumer tests, then add a CI assertion that detects stale
  package artifacts.

## GAP-005 — Parsed agent events worked, but the host also rendered raw stdout

- Status: fixed and re-verified against the installed Claude CLI
- Surface: `examples/reference-web` daemon-to-chat transport
- User-visible failure: asking Claude “What model are you?” rendered Claude
  Code's complete stream-json protocol object in the assistant message instead
  of only the parsed answer.
- What passed: Claude stream-parser tests, daemon executor tests, the complete
  `@jini/chat-react` suite, reference-web typecheck, and the production build.
- Why those tests missed it: the daemon intentionally retains raw `stdout`
  events for diagnostics while also emitting parsed `agent` events. The sample
  host translated both channels into visible conversation text, and no test
  exercised the final `RunProtocolEvent -> AgentEvent` host adapter boundary.
- Immediate regression coverage: `daemon-transport.test.ts` now asserts that
  raw stdout is ignored, parsed `text_delta` is rendered once, and stderr
  remains available as diagnostic output.
- Live re-verification: a real Claude Code run prompted to return only
  `MODEL_OK` rendered one assistant answer, `MODEL_OK`, with no JSONL protocol
  text present in the browser.
- Comprehensive test still needed: a browser integration fixture that replays
  a mixed SSE stream containing matching `stdout` plus parsed `agent` events
  and asserts that only the parsed assistant content renders.

## GAP-006 — Valid desktop markup still overflowed under desktop zoom/width

- Status: fixed in the reference shell; persistent viewport parity tests still
  required
- Surface: `examples/reference-web` desktop-sized browser and Electron layouts
- User-visible failure: the center workspace retained too much intrinsic width
  and left only a clipped fragment of the right chat pane. Long unbroken
  protocol text made the failure substantially worse.
- What passed: desktop/reference-web builds and desktop-host adapter tests.
- Why those tests missed it: no rendered test asserted grid track bounds at
  the Electron minimum size, zoom-equivalent desktop widths, or with
  adversarial unbroken message content.
- Immediate validation: Playwright inspected 1320x820, 1213x910, and 840x620
  viewports. The document and shell widths matched at every size, the chat
  pane's right edge stayed on the viewport boundary, and a synthetic
  12,000-character JSON token remained bounded by the message column.
- Comprehensive test still needed: commit those viewport and long-content
  assertions as browser parity tests for both the Chrome URL and Electron
  renderer URL.

## Test-program implications

The next comprehensive pass should use a layered matrix rather than treating
coverage percentage as an end-to-end confidence score:

| Layer | Required proof |
|---|---|
| Parser contract | Replay captured vendor CLI frames, including version-tagged variants |
| Executor integration | stdin lifecycle, process exit, cancellation, terminal run state |
| Daemon composition | real mounted route and injected subsystem, not a parallel dev-server implementation |
| Browser journey | visible state originates from daemon responses and actions reach daemon routes |
| Desktop journey | the same browser journey plus native chrome, drag, bridge, and shutdown behavior |
| Live canary | at least one installed CLI per supported stream family, kept small and cost-bounded |

Any future incident of this class should be appended here until the comprehensive
matrix is implemented and enforced in CI.
