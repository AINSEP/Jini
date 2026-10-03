Spec ID: SPEC-JINI-VIBECODING-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:a81d423cafa61ea8ed8e7843c759cb4431333c282735d436c816af63d1df690a
spec_mode: reverse_spec


# Error contract: vibecoding

The package declares no custom error class or package-specific error-code enum. Outcomes and exceptions are distinct contracts.

| Signal | Trigger | Caller action |
|---|---|---|
| `ApplyOutcome { status: 'rejected', id, reason }` | Target validation returns `ok: false` | Feed reason back for a corrected proposal |
| `ApplyOutcome { status: 'failed', id, error }` | `validate` or `replacePart` throws inside apply APIs | Diagnose validation/storage; inspect partial batch results |
| Propagated target exception | Direct validation, read/list/snapshot/restore or replay throws | Catch; re-read authoritative target after partial mutation |
| Plain `Error` | Overlapping history transactions | Serialize transaction work |
| Plain `Error` | HTML region missing, ambiguous or invalid handle | Relist/fix tagged markup; never select a first duplicate |
| Plain `Error` | parse5 cannot safely locate all regions | Correct whole-document structure; do not bypass the guard |
| `ToolInputError` from `@jini-ai/core` | Malformed read/propose tool arguments or more than 50 edits | Correct input to advertised schema |
| `RangeError` | Direct runner receives an unknown tool ID | Use exported IDs/descriptors |
| Session `status: 'error', lastError` | Session work rejects | Show diagnostic and catch the original rejection; later success recovers ready state |
| `null` history result | Empty undo/redo stack or unchanged restore | Treat as no operation, not failure |

`ToolInputError` is imported by the implementation, not re-exported here; use the core package to identify its canonical error class/code. Session listeners are synchronous and are not exception-isolated; callers must keep them nonthrowing.

History reads currently treat every read exception as absence, not just missing-part errors. This can mask storage faults and record empty before-content. Replay/restore failures are not atomic rollbacks. The workbench's `void undo()/redo()` click handlers do not catch rejected promises even though the session exposes lastError.

Evidence: `src/core/apply.ts`, `src/core/history.ts`, `src/html/regions.ts`, `src/html/node/parse5-region-parser.ts`, `src/react/session.ts`, `src/react/tools.ts` and related tests.
