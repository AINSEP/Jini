---
"@jini-ai/core": minor
---

Add optional `expectedRevisionSeq` options to settings `set(required, options)` and
`clear(required, options)`. Compare the addressed scope's stored value revision under
the existing transaction's ledger lock, throwing `SettingsRevisionConflictError`
with expected and actual sequences on mismatch and rolling back the write and revision.
Revision 0 represents a missing row; cleared rows retain their revision. Omitting
the option preserves unconditional writes. Available through `@jini-ai/core/settings`
and the existing `@jini-ai/cms/settings` compatibility re-export.
