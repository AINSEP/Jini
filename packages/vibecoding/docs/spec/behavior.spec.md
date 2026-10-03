Spec ID: SPEC-JINI-VIBECODING-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d1eb19532fc778397649bdbf74b9fdf7409000ca56c789cc31263195fa4609c4
spec_mode: reverse_spec


# Behavior contract: vibecoding

## Edit ordering and authority

- WHEN applying an edit, the loop shall await validation before replacing content. Rejected edits shall make no replace call. Validation and replace exceptions shall become failed outcomes with an Error; a validation exception shall make no replace call.
- WHEN applying a batch, the loop shall process proposals sequentially and return aligned outcomes; rejected/failed outcomes, including validation failures, shall not halt later edits. The loop shall not enforce a separate part allowlist beyond the supplied target's validation.
- WHEN a history transaction finishes, it shall record actual successful changes, including repeated IDs, omit unchanged writes and clear redo only for a nonempty entry. Successful partial writes shall remain undoable when work throws.
- WHEN undoing, history shall replay before-content in reverse change order; redo shall replay after-content in original order. Both shall bypass validation and move stacks only after successful replay. Failure can leave partial target changes with the entry still retryable.
- WHEN restoring through history, history shall capture before-content and record the entry before replay; parts absent from the snapshot shall be left alone. Undoing creation shall write empty content because the target has no delete verb.

## HTML guards and limits

- The region target shall accept handles matching `[a-z0-9]+(?:-[a-z0-9]+)*`, at most 128 characters. It shall default to a 262144-character replacement cap; this measures JavaScript string length, not UTF-8 bytes.
- WHEN validating a replacement, the target shall splice the prospective document, apply the optional structural check and require identical handle multisets before/after. It shall reject invented, removed or duplicated handles.
- WHEN replacing directly, the target shall splice only the region's inner range and preserve surrounding string content. Direct replace does not invoke validation. The consumer must route new proposals through apply APIs.
- WHEN reading/replacing, the HTML target shall require exactly one matching handle; it shall not create missing regions, despite the general port's upsert description. Restore shall reparse between writes and skip missing/ambiguous regions.
- WHEN the parse5 parser cannot locate every tagged region, it shall throw on find and reject on structural check. Tagged void/unclosed/dropped nodes shall fail. Raw attribute mentions in comments/scripts can produce conservative false positives.
- WHEN listing/snapshotting duplicate HTML handles, the target shall omit every occurrence of each ambiguous handle. Unique valid handles shall retain document order and metadata; read/replace shall reject ambiguity.

## Session and tools

- The session shall lazily cache content, update cache from successful edit/history data and relist on refresh/apply/restore. Refresh shall drop removed IDs but shall not reread changed content for retained IDs.
- WHEN session work rejects, the session shall expose error/lastError and rethrow. The hook shall catch mount-refresh errors; consumers calling actions directly must handle rejection.
- Tool registrations shall follow fixed list/read/propose/undo/redo order, default to allow policy, and declare 10000ms timeouts except propose at 15000ms. The direct runner shall not enforce these deadlines or authorization.
- WHEN proposing via tools, handlers shall require 1–50 edits, nonempty string IDs and string content; empty replacement content is valid. Runtime handlers do not reject every additional property advertised as forbidden by JSON Schema; the consumer registry owns full schema enforcement.
- History default retention shall be 50 entries. The implementation does not validate limit; consumers must supply a finite nonnegative integer. A negative value can make trimming loop indefinitely.

No request idempotency, process runner, package installer, build manager, model transport, persistent history, HTML sanitizer or CSS theme service is supplied. Preview isolation is defined in `ui.spec.md`.

Evidence: core/apply/history, html/regions, html/node parser, React session/tools and their source tests. Known contradictions are current-source observations, not execution results.

Decision rationale: [Ambiguous region detection refuses rather than dropping a handle](../decisions/DR-001-conservative-region-detection.md).
