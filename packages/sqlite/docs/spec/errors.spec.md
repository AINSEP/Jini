Spec ID: SPEC-JINI-SQLITE-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:b8073141b55a769b52957014cd5a276e9c40e9b9255bac04dbce80b1e4ab1a22
spec_mode: reverse_spec

# SQLite compatibility error contract

No error constructor or facade-wide machine-code vocabulary is exported by the current barrel. SqliteBackendConfigError belongs to server/storage and is outside this facade. The facade leaves owner errors/results unchanged.

Event-log missing borrowed db or invalid retention cap throws Error. Invalid Number-converted replay cursors reject with Error; unknown-run/replay-gap are normal results. JSON/clock/SQL failures propagate. Legacy global message/conversation mismatches throw the canonical MessageConversationMismatchError; that constructor is imported directly from chat/store/legacy/sqlite. ChatStoreError invalid-input/invalid-cursor/conflict/unavailable codes can escape owned-history calls; import the class from its chat owner. SQL/constraint/schema/FTS failures retain driver shape. Inspection degrades selected errors into null/zero/empty reports, and integrity issues carry integrity/foreign_key kinds.

Do not retry a write without establishing its outcome and appropriate dedupe/concurrency policy. Facade and protocol event-log argument shapes now agree. Canonical failures: [daemon](../../../daemon/docs/spec/errors.spec.md), [chat](../../../chat/docs/spec/errors.spec.md), [db](../../../db/docs/spec/errors.spec.md), [registry](../../../registry/docs/spec/errors.spec.md).

