# Code Review — Aug 3–4 committed range

**Reviewer:** Code Review(Analysis)  
**Scope:** `7e86dc8b9f417608337e228ee752e5c1192bbf10^..23b9de818c7c2e0a267e95c8f3b9e2228138247b`  
**Method:** advisory-only, commit-pinned inspection (`git show 23b9de81:<path>`). No source was edited and no tests, builds, typechecks, or services were run.

## Gate and evidence limitations

The expected active feature spec, test-certification inventory, Programmer handoff/function-quality table, and Coordinator verification packet are absent from the committed range. `ADS-memory/governance/adrs/ADR-INDEX.md` is empty, so no governance ADR scope matches apply. The user explicitly stopped test execution for memory pressure; this review did not restart it.

Consequently this is **not ship certification**. Assertions below are source-inspection evidence only; the missing verification evidence is itself a Required finding.

## Required findings

### CR-001 — Verification/certification evidence is absent

**Classification:** `TEST_EVIDENCE_INVALID` / `TDD_RECERTIFICATION_REQUIRED`  
**Dimension:** Spec alignment and test quality

There is no committed active spec or hash for this large multi-package change, no requirement-to-test inventory, no expected-versus-executed test count, no test-file hashes, no coverage artifact, and no verification packet. The range includes new public execution, transport, protocol, UI, package, and security-sensitive surfaces (notably `packages/core`, `packages/daemon`, `packages/mcp`, `packages/chat`, and `packages/vibecoding`), so package-local test source cannot establish acceptance coverage or release-set compatibility.

**Required action:** establish the active scope/spec and test-certification inventory; then run the agreed constrained verification plan when memory capacity is available. It must include the changed public contracts and the packed-package/minimal-host gate required by the locked architecture.

### CR-002 — Cancellation/timeout can be reported as successful when a handler resolves after abort

**Classification:** `IMPLEMENTATION_FIX_REQUIRED`  
**Dimension:** Correctness, security surface, non-functional behavior  
**Commit-pinned evidence:**

- `packages/daemon/src/tool-executor.ts:346-349` aborts the controller for external cancellation and descriptor timeout.
- `packages/daemon/src/tool-executor.ts:368-379` unconditionally records `completed` and returns the handler output after an awaited handler resolves; it does not inspect `controller.signal.aborted` or `timeout.timedOut()` on that success path.
- The new delegated bridge supplies its run/transport abort signal at `packages/daemon/src/delegated-tool-bridge.ts:127-133,178-185` and publishes the returned status as the agent-visible `tool_result` at lines 210-218.

`AbortSignal` is cooperative. A handler can legally complete normally after receiving (or ignoring) abort; under this implementation that execution is recorded and presented to the agent as `completed`, even if the run was cancelled or the descriptor timeout elapsed. For a destructive tool, this is a misleading audit/result state at precisely the point consumers need cancellation truthfulness.

**Required action:** after the handler settles, classify an already-aborted controller as `timed-out` or `cancelled` before emitting a completed result (and decide/document whether its output must be withheld). Preserve the fact that in-process work cannot be forcibly stopped, rather than claiming it completed successfully. Add deterministic tests for a handler that resolves after external abort and after descriptor timeout.

### CR-003 — Authorization/confirmation faults escape the audit state machine and their raw messages are exposed to the agent

**Classification:** `SECURITY_REVIEW_REQUIRED` and `IMPLEMENTATION_FIX_REQUIRED`  
**Dimension:** Security surface, auditability, error contract  
**Commit-pinned evidence:**

- `packages/daemon/src/tool-executor.ts:319-320` awaits policy/delegate authorization outside the only `try/catch`; a throw/rejection leaves an audit record containing only `requested`.
- `packages/daemon/src/tool-executor.ts:337-344` likewise awaits confirmation outside that `try/catch`; a throwing/rejected transport callback has no terminal audit event or `ToolExecutionResult`.
- The new bridge catch publishes `errorMessage(error)` as model-visible `tool_result.content` at `packages/daemon/src/delegated-tool-bridge.ts:220-226`.
- Existing test coverage exercises a handler throw (`packages/daemon/src/__tests__/tool-executor.test.ts:445-458`) but has no policy-throw, delegate-veto-throw, or rejected-confirmation assertion.

This violates the documented executor transition/audit contract and creates a disclosure path: an auth/confirmation implementation can throw messages containing internal paths, provider/API details, or other operational context, and the bridge serializes that message into an agent-readable tool result. The model/human split correctly protects UI tokens, but this error path bypasses its redaction discipline.

**Required action:** make all post-`openAudit` failures terminate as a typed, fail-closed execution result with a terminal audit event. Send an opaque, stable agent-facing error code/message; emit detailed error context only to a host-owned redacted diagnostic sink/correlation id. Add tests for policy throw/rejection, authorization-delegate throw/rejection, and confirmation throw/rejection, including audit terminal state and no secret-bearing text in the `tool_result`.

### CR-004 — The committed checkout removes the locked architecture authority while package code continues to cite it

**Classification:** `ARCHITECTURE_REVIEW_REQUIRED`  
**Dimension:** Architecture adherence and documentation correctness

Commit `96f0a5c8` removes `foundry/`, including `foundry/docs/jini-port/START-HERE.md` and `extraction-plan.md`; those paths do not exist in commit `23b9de81`. Yet package code in the same snapshot still describes its contract by linking there, for example `packages/chat/src/core/index.ts:1-5`, `packages/core/src/tool-registry.ts:1-4`, and `packages/daemon/src/tool-executor.ts:1-8`. This makes the published commit self-contradictory: a fresh checkout cannot read the stated locked architecture that governs its core security boundary.

**Required action:** choose and commit a durable, repository-owned replacement for the locked architecture/decision source (or update every affected package reference to the authoritative `ADS-memory` location), then retain a committed redirect/index. Do not rely on a locally untracked workshop for constraints that reviewers and external consumers must verify.

## Recommended follow-up

### CR-R01 — Bound the structured-output contract by bytes, not UTF-16 code units

**Classification:** `REFACTOR_RECOMMENDED`  
**Evidence:** `ToolDescriptor.maxOutputBytes` is described as a byte ceiling in `packages/core/src/tool-registry.ts:55`; `truncateOutput` checks `output.length` and `slice()` in `packages/daemon/src/tool-executor.ts:168-173`, which count UTF-16 code units rather than encoded bytes.

If this limit is used for transport/storage protection, multibyte outputs can exceed the configured byte budget. Either rename/document it as a character/code-unit limit, or implement UTF-8 byte-aware truncation that does not split a Unicode scalar. Add an emoji/non-ASCII boundary test.

## Security surface map

| Entry/boundary | Change reviewed | Risk / routing |
|---|---|---|
| MCP subprocess → daemon delegated-tool route → ToolExecutor | In-flight human UI return path | Full Security Agent review required for CR-003; continue review of principal/run binding and cancellation propagation. |
| Registered tool → run event stream → model | New `emitSurface` bridge and `tool_result` result path | Redaction/error contract must be made fail-closed (CR-003). |
| Agent attachment path → Claude prompt/allowed directory | `image-prompt-delivery.ts` | Attachment store’s documented opaque-id/claim flow appears designed as the validating boundary; this review found no separate source-proven bypass. Add adversarial boundary verification during recertification. |

## Function Quality Assessment

- **Status:** BLOCKED
- **Functions assessed:** 3 (`ToolExecutor.execute`, `failureResult`, `DelegatedToolBridge.execute`)
- **Lowest observed score:** 75/100 (`ToolExecutor.execute`: cancellation and error-state contract gaps)
- **Critical findings:** 0
- **High findings:** 2 (CR-002, CR-003)
- **Missing assessments:** yes — no Programmer handoff assessment table for the materially changed/new logic-bearing units
- **Missing handoff-table evidence:** yes
- **Missing score-skepticism evidence:** yes
- **Missing adversarial aggregate/cross-item evidence:** yes — cancellation/error transition matrix has only abort-aware handler cases
- **Required fixes:** CR-001 through CR-004
- **Recommended refactors:** CR-R01
- **Suggested Coordinator classification:** `SECURITY_REVIEW_REQUIRED`, `IMPLEMENTATION_FIX_REQUIRED`, `TEST_EVIDENCE_INVALID`, `ARCHITECTURE_REVIEW_REQUIRED`

## Overlap check

This review intentionally did not re-file the already surfaced anonymous delegated principal, surface-emission reserved-key forgery, history recovery, A2UI ordering, delegated-call disconnect, equal-length iframe-session, retry-attachment, palette CSS, `ChatPane` packaging, timeout-policy, parser duplication, or handle-grammar findings. CR-002 and CR-003 are distinct executor/error-contract failures discovered from the commit-pinned control flow.
