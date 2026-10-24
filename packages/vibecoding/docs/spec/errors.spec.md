Spec ID: SPEC-JINI-VIBECODING-ERRORS
Version: 2.1.0
Last Edited: 2026-10-24
Hash: sha256:80c4ac79dd7b115e8d2a21cc000e45c3f13379c9a924f97aeb00e8603fa2566f
spec_mode: reverse_spec


# Error contract: vibecoding

Core/HTML outcomes and exceptions remain distinct contracts. Node projects add `ProjectError` with a stable `code` and optional native `cause`.

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

Universal history reads currently treat every read exception as absence, not just missing-part errors. This can mask storage faults and record empty before-content. Universal replay/restore failures are not atomic rollbacks. The workbench's `void undo()/redo()` click handlers do not catch rejected promises even though the session exposes lastError.

Evidence: `src/core/apply.ts`, `src/core/history.ts`, `src/html/regions.ts`, `src/html/node/parse5-region-parser.ts`, `src/session.ts`, `src/tools.ts` and related tests.


## Node project errors

| Code / signal | Trigger | Caller action |
|---|---|---|
| `CONFLICT` | Another writer's generation (including A→B→A); stale caller token; drift during capture/validation | Another writer's generation clears local stacks; otherwise history is kept. Refresh/capture and retry with a fresh token |
| `INVALID_PATH` | Nonportable path, exclusion, host-policy refusal, collision or containment/link failure | Correct the path; never bypass policy |
| `INVALID_CHANGE` | Duplicate operations, unknown replacement/deletion, existing create, unmanaged directory/file-alias blocker, binary text read, public pointer transaction | Correct the whole turn; use the byte/snapshot APIs for binary assets |
| `LIMIT` | Tree/file/turn/depth/traversal bound or exhausted generation | Reduce scope or raise an appropriate host limit |
| `CANCELLED` | Caller aborts before commit | No candidate selection; retry if desired |
| `VALIDATION` | Validator throws or exceeds deadline; direct target replacement refused | Correct validator/content; inspect cause |
| `rejected` turn | Validator returns `ok:false` | Feed bounded diagnostics back to the model |
| `STORAGE` | Filesystem or lock failure | Inspect cause; a journal may already be committed; recover on the next operation/reopen |
| `CORRUPT` | Invalid current/manifest/object schema, digest, missing referenced storage or root binding | Repair/recover host state; never reset automatically |
| `SNAPSHOT_EXPIRED` | Snapshot manifest was collected | Choose a retained snapshot |
| `CLOSED` | Operation after close | Open a new project |
| `TypeError` | Nonpositive/noninteger limits or history limit | Correct host configuration |

Refusal/validator failure leaves the candidate unpublished. Previously detected external drift is a
separate normal capture. A native I/O error after journal selection may require roll-forward;
`pending` remains durable until all selected files and folder cleanup succeed. A process crash may
lose session history but not the journal's selected destination. Power-loss behavior depends on
platform/file-system fsync support. No native Mac/Windows acceptance results are claimed here.
