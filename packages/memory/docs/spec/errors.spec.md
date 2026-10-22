Spec ID: SPEC-JINI-MEMORY-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:67a3da4f86751153bbea3340497a8ad4829d4f9898fcd43c09797ab9fabd162b
spec_mode: reverse_spec


# Error contract: memory

| Error / result | Trigger | Caller action |
|---|---|---|
| `NoteStoreConfigError`, `EPARSE` | Corrupt config JSON | Stop enabled-dependent work and repair config explicitly |
| `NoteStoreConfigError`, `ENOTREG` | Config is a symlink, directory or other nonregular file | Restore a regular config file; do not default to enabled |
| `NoteStoreConfigError`, native errno or `EUNKNOWN` | Unreadable config or failed root containment | Correct permissions/root; inspect `cause` |
| Plain `Error`, no stable code | Unsafe subdir/temp ID/note ID; invalid upsert; missing note; attempted folder edit; read-after-write failure | Correct input or reconcile partial disk state before retry |
| Native filesystem error | Atomic write/index/config persistence failure | Diagnose disk/permissions; entry and index can be partially committed |
| Plain `Error`, no stable code | Missing LLM key/model/Azure URL, unsupported provider; network, non-2xx HTTP, non-JSON envelope/model output | Correct configuration/input; use consumer retry policy only after diagnosis |
| Plain `Error`, no stable code | JSON `null` extraction response | Correct model output; configured extraction logging records the failure |
| Native `TypeError` | Invalid URL helper input | Validate transport output/configuration; treat as implementation failure |
| `VerifyResult.status = missing/fail` | Absent scorecard, uncovered rule or failed/unknown row status | Ask for corrected evidence; this is a returned verdict, not an exception |
| `null`, `[]`, default index | Missing/unreadable entry/list/index best-effort read | Treat as unavailable; these paths intentionally erase detailed read errors |

The exported error constructor is `new NoteStoreConfigError({ message, code }, { cause } = {})`; `code` is an open string, not a package-wide closed enum. LLM errors include upstream body/diagnostic text, so callers own redaction before display or retention.

`enforceVerify` propagates consumer extractor exceptions. Logs swallow listener exceptions, but injected clock/ID/defer functions can throw. No HTTP status mapping, retry envelope or aggregate error model is supplied.

Evidence: `src/note-store.ts`, `src/llm-provider.ts`, `src/extract-facts.ts`, `src/verify.ts`; config and failure assertions in their tests.
